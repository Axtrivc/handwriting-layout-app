"""OCR 辅助识别端点。

合规约束：OCR 仅辅助用户标注自己的手写样本，不自动确认，不识别他人笔迹。
OCR 依赖可选，未安装时返回 status=unavailable，不报 500。
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..schemas import (
    OcrCandidateItem,
    OcrGlyphRequest,
    OcrResultResponse,
    OcrSampleRequest,
    SuggestGlyphLabelsRequest,
)

_VISION_PARENT = Path(__file__).resolve().parents[3] / "vision"
if str(_VISION_PARENT) not in sys.path:
    sys.path.insert(0, str(_VISION_PARENT))

from vision import (  # noqa: E402
    GlyphCandidate,
    OcrResult,
    RectRegion,
    b64_to_image,
    get_provider_name,
    is_ocr_available,
    recognize_single_glyph,
    recognize_text_regions,
    suggest_glyph_labels,
)

router = APIRouter()


def _result_to_response(res: OcrResult) -> OcrResultResponse:
    return OcrResultResponse(
        candidates=[
            OcrCandidateItem(
                text=c.text,
                confidence=c.confidence,
                bbox=c.bbox,
                provider=c.provider,
            )
            for c in res.candidates
        ],
        provider=res.provider,
        status=res.status,
        message=res.message,
    )


@router.get("/ocr/status", response_model=OcrResultResponse)
def ocr_status() -> OcrResultResponse:
    """查询 OCR 可用性与 provider。"""
    provider = get_provider_name()
    available = is_ocr_available()
    if available:
        return OcrResultResponse(candidates=[], provider=provider, status="ok")
    # mock provider 可用于测试流程，但标记为 unavailable（非真实识别）
    if provider == "mock":
        return OcrResultResponse(
            candidates=[],
            provider="mock",
            status="ok",
            message="OCR mock provider（仅供测试，非真实识别）",
        )
    return OcrResultResponse(
        candidates=[],
        provider="none",
        status="unavailable",
        message="OCR 未启用。可安装 rapidocr-onnxruntime 启用，或继续手动标注。",
    )


@router.post("/ocr-glyph", response_model=OcrResultResponse)
def ocr_glyph(req: OcrGlyphRequest) -> OcrResultResponse:
    """识别单个字形图片，返回候选字符列表。"""
    try:
        img = b64_to_image(req.image, req.mime)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"图片解码失败: {exc}") from exc
    return _result_to_response(recognize_single_glyph(img))


@router.post("/ocr-sample", response_model=OcrResultResponse)
def ocr_sample(req: OcrSampleRequest) -> OcrResultResponse:
    """识别整张样本图。可选 regions 对每个区域单独识别。"""
    try:
        img = b64_to_image(req.image, req.mime)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"图片解码失败: {exc}") from exc

    regions = None
    if req.regions:
        regions = [RectRegion(x=r.x, y=r.y, width=r.width, height=r.height) for r in req.regions]
    return _result_to_response(recognize_text_regions(img, regions))


@router.post("/suggest-glyph-labels", response_model=OcrResultResponse)
def suggest_labels(req: SuggestGlyphLabelsRequest) -> OcrResultResponse:
    """对一组候选框逐个 OCR，返回每个框的建议字符（低置信度清空）。"""
    try:
        img = b64_to_image(req.image, req.mime)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"图片解码失败: {exc}") from exc

    cands = [
        GlyphCandidate(
            x=b.x, y=b.y, width=b.width, height=b.height, score=0.0,
        )
        for b in req.candidates
    ]
    return _result_to_response(suggest_glyph_labels(img, cands))
