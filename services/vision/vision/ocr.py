"""OCR 辅助识别（可选依赖，provider 抽象）。

设计原则：
- OCR 依赖必须可选。未安装时接口返回 status=unavailable，不崩。
- 只做「辅助建议」，不替用户确认；用户必须检查、修改、确认后再保存。
- provider 可插拔：RapidOCR / mock，统一接口。

合规说明：仅用于辅助用户标注**自己**的手写样本，不涉及他人笔迹识别。
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Optional

from PIL import Image

from .glyph import crop_glyph
from .glyph_detect import GlyphCandidate
from .regions import RectRegion

logger = logging.getLogger(__name__)

# RapidOCR 模型在每进程内懒加载一次；初始化与推理都不能并发进入同一引擎。
_rapidocr_factory = None
_rapidocr_engine = None
_rapidocr_lock = threading.Lock()


# ===== 数据结构 =====

@dataclass
class OcrCandidate:
    """单个 OCR 识别候选。"""

    text: str
    confidence: float  # 0~1
    bbox: Optional[dict] = None  # {x,y,width,height}，整图识别时可空
    provider: str = "unknown"


@dataclass
class OcrResult:
    """OCR 识别结果。"""

    candidates: list[OcrCandidate] = field(default_factory=list)
    provider: str = "none"
    status: str = "ok"  # ok | unavailable | error
    message: Optional[str] = None


# ===== provider 注册 =====

# provider 名称 -> 识别函数
# 函数签名：(image: PIL.Image, crop_hint: Optional[RectRegion]) -> list[OcrCandidate]
# crop_hint 是调用方请求的原图区域；provider 的 bbox 契约沿用原图坐标。
_PROVIDERS: dict[str, callable] = {}


def register_provider(name: str, fn: callable) -> None:
    """注册一个 OCR provider。"""
    _PROVIDERS[name] = fn
    logger.info("OCR provider registered: %s", name)


def _get_rapidocr_engine():
    """返回进程级 RapidOCR 引擎，首次调用时才加载模型。"""
    global _rapidocr_engine
    if _rapidocr_engine is None:
        with _rapidocr_lock:
            if _rapidocr_engine is None:
                if _rapidocr_factory is None:
                    raise RuntimeError("RapidOCR provider 未初始化")
                _rapidocr_engine = _rapidocr_factory()
    return _rapidocr_engine


def _rapidocr_recognize(
    image: Image.Image, crop_hint: Optional[RectRegion] = None
) -> list[OcrCandidate]:
    img_arr = _pil_to_array(image)
    engine = _get_rapidocr_engine()
    with _rapidocr_lock:
        result, _elapsed = engine(img_arr)
    cands: list[OcrCandidate] = []
    if result:
        for box, text, score in result:
            if not text:
                continue
            bbox = _box_to_dict(box)
            if crop_hint and bbox:
                # crop_glyph 会将左/上负偏移 clipping 到 0，其余偏移保持原值。
                bbox["x"] += max(0, crop_hint.x)
                bbox["y"] += max(0, crop_hint.y)
            cands.append(
                OcrCandidate(
                    text=text,
                    confidence=float(score),
                    bbox=bbox,
                    provider="rapidocr",
                )
            )
    return cands


def _try_import_rapidocr() -> None:
    """尝试导入 RapidOCR 作为 provider（可选），模型保持懒加载。"""
    global _rapidocr_factory
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except ImportError:
        logger.info("RapidOCR 未安装，OCR 将返回 unavailable")
        return
    _rapidocr_factory = RapidOCR
    register_provider("rapidocr", _rapidocr_recognize)


def _try_import_easyocr() -> None:
    """EasyOCR 尚无真实识别实现，即使已安装也不注册空占位 provider。"""


def register_mock_provider() -> None:
    """注册一个 mock provider，用于测试和 unavailable 时的占位。

    Mock 不做真实识别，返回固定候选，仅供测试 OCR 流程。
    生产环境不应启用 mock。
    """
    import os

    if os.environ.get("HW_OCR_MOCK") != "1":
        return

    def _mock_recognize(
        image: Image.Image, crop_hint: Optional[RectRegion] = None
    ) -> list[OcrCandidate]:
        # 根据 crop 区域的宽高返回一个假候选，用于测试流程
        w = crop_hint.width if crop_hint else image.size[0]
        # 用宽高比例猜测「单字」，返回占位字符
        text = "?" if 8 <= w <= 200 else ""
        return [
            OcrCandidate(
                text=text,
                confidence=0.5,
                bbox=_rect_to_dict(crop_hint) if crop_hint else None,
                provider="mock",
            )
        ]

    register_provider("mock", _mock_recognize)


# 初始化时注册 provider；RapidOCR 模型仍在首次识别时加载，EasyOCR 占位不注册。
_try_import_rapidocr()
_try_import_easyocr()
register_mock_provider()


# ===== 公共 API =====

def is_ocr_available() -> bool:
    """是否有真实（非 mock）OCR provider 可用。"""
    return any(name != "mock" for name in _PROVIDERS)


def get_provider_name() -> str:
    """当前活跃的 provider 名称（优先非 mock）。无则 none。"""
    for name in _PROVIDERS:
        if name != "mock":
            return name
    if "mock" in _PROVIDERS:
        return "mock"
    return "none"


def _get_engine():
    """获取当前 provider 的识别函数。"""
    for name, fn in _PROVIDERS.items():
        if name != "mock":
            return name, fn
    if "mock" in _PROVIDERS:
        return "mock", _PROVIDERS["mock"]
    return "none", None


def recognize_text_regions(
    image: Image.Image, regions: Optional[list[RectRegion]] = None
) -> OcrResult:
    """识别图像中的文本。

    Args:
        image: 输入 PIL Image。
        regions: 可选的裁剪区域列表。提供时对每个区域单独识别；不提供时整图识别。

    Returns:
        OcrResult。
    """
    name, fn = _get_engine()
    if fn is None:
        return OcrResult(
            status="unavailable",
            provider="none",
            message="OCR 未启用。可安装 rapidocr-onnxruntime 启用，或继续手动标注。",
        )

    try:
        cands: list[OcrCandidate] = []
        if regions:
            for r in regions:
                cropped = crop_glyph(image, r)
                sub = fn(cropped, r)
                # 单区域识别：取置信度最高的
                if sub:
                    best = max(sub, key=lambda c: c.confidence)
                    cands.append(best)
                else:
                    cands.append(OcrCandidate(text="", confidence=0.0, provider=name))
        else:
            cands = fn(image, None)
        return OcrResult(candidates=cands, provider=name, status="ok")
    except Exception as exc:  # noqa: BLE001
        logger.exception("OCR recognize failed")
        return OcrResult(
            status="error",
            provider=name,
            message=f"OCR 识别失败: {exc}",
        )


def recognize_single_glyph(image: Image.Image) -> OcrResult:
    """识别单个字形图像，返回候选字符列表。"""
    name, fn = _get_engine()
    if fn is None:
        return OcrResult(
            status="unavailable",
            provider="none",
            message="OCR 未启用。可安装 rapidocr-onnxruntime 启用。",
        )
    try:
        cands = fn(image, None)
        # 单字：只取首字符，保留 confidence
        refined: list[OcrCandidate] = []
        for c in cands:
            ch = c.text.strip()[:1] if c.text else ""
            refined.append(OcrCandidate(text=ch, confidence=c.confidence, provider=name))
        return OcrResult(candidates=refined, provider=name, status="ok")
    except Exception as exc:  # noqa: BLE001
        logger.exception("OCR single glyph failed")
        return OcrResult(status="error", provider=name, message=f"OCR 识别失败: {exc}")


def suggest_glyph_labels(
    image: Image.Image, candidates: list[GlyphCandidate]
) -> OcrResult:
    """对一组候选框逐个 OCR，返回每个框的建议字符。

    低置信度（<0.6）的候选 text 置空，避免误导用户。
    """
    name, fn = _get_engine()
    if fn is None:
        return OcrResult(
            status="unavailable",
            provider="none",
            message="OCR 未启用。可安装 rapidocr-onnxruntime 启用，或继续手动标注。",
        )
    try:
        out: list[OcrCandidate] = []
        for cand in candidates:
            region = RectRegion(x=cand.x, y=cand.y, width=cand.width, height=cand.height)
            cropped = crop_glyph(image, region)
            sub = fn(cropped, region)
            if sub:
                best = max(sub, key=lambda c: c.confidence)
                # 低置信度：清空 text，只保留 confidence 提示
                text = best.text.strip()[:1] if best.text else ""
                if best.confidence < 0.6:
                    text = ""
                out.append(
                    OcrCandidate(
                        text=text,
                        confidence=round(best.confidence, 3),
                        bbox={"x": cand.x, "y": cand.y, "width": cand.width, "height": cand.height},
                        provider=name,
                    )
                )
            else:
                out.append(
                    OcrCandidate(
                        text="",
                        confidence=0.0,
                        bbox={"x": cand.x, "y": cand.y, "width": cand.width, "height": cand.height},
                        provider=name,
                    )
                )
        return OcrResult(candidates=out, provider=name, status="ok")
    except Exception as exc:  # noqa: BLE001
        logger.exception("OCR suggest failed")
        return OcrResult(status="error", provider=name, message=f"OCR 建议失败: {exc}")


# ===== 辅助 =====

def _pil_to_array(img: Image.Image):
    import numpy as np

    return np.array(img.convert("RGB"))


def _box_to_dict(box) -> dict:
    """RapidOCR 的 box 是 4 个点，转成 bbox dict（取外接矩形）。"""
    try:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        return {
            "x": int(min(xs)),
            "y": int(min(ys)),
            "width": int(max(xs) - min(xs)),
            "height": int(max(ys) - min(ys)),
        }
    except Exception:  # noqa: BLE001
        return {}


def _rect_to_dict(r: Optional[RectRegion]) -> Optional[dict]:
    return {"x": r.x, "y": r.y, "width": r.width, "height": r.height} if r else None
