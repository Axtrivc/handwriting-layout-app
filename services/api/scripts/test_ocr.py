"""OCR provider unavailable fallback 与 mock provider 单元测试（不依赖网络）。

覆盖：
- is_ocr_available 在无真实 provider 时返回 False
- recognize_text_regions 返回 unavailable
- suggest_glyph_labels 返回 unavailable
- 低置信度候选 text 置空
- mock provider 流程

用法（services/api venv 已激活）：
    python scripts/test_ocr.py            # 测 unavailable
    HW_OCR_MOCK=1 python scripts/test_ocr.py  # 测 mock
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

_VISION_PARENT = Path(__file__).resolve().parents[2] / "vision"
sys.path.insert(0, str(_VISION_PARENT))

from vision import (  # noqa: E402
    GlyphCandidate,
    RectRegion,
    is_ocr_available,
    recognize_single_glyph,
    recognize_text_regions,
    suggest_glyph_labels,
    get_provider_name,
)

FAILS = []


def check(cond: bool, msg: str) -> None:
    if cond:
        print(f"  OK  {msg}")
    else:
        FAILS.append(msg)
        print(f"  FAIL {msg}")


def make_image(w: int = 100, h: int = 100) -> Image.Image:
    img = Image.new("RGB", (w, h), "white")
    ImageDraw.Draw(img).rectangle([30, 30, 70, 70], fill="black")
    return img


def main() -> int:
    mock = os.environ.get("HW_OCR_MOCK") == "1"

    print(f"=== OCR 测试 (mock={mock}) ===\n")

    img = make_image()

    # 1. provider 状态
    print("[1] provider 状态")
    provider = get_provider_name()
    available = is_ocr_available()
    if mock:
        check(provider == "mock", f"mock 模式 provider=mock (实际 {provider})")
        check(not available, "mock 模式 is_ocr_available=False（mock 不算真实）")
    else:
        check(provider == "none", f"无 OCR 时 provider=none (实际 {provider})")
        check(not available, "无 OCR 时 is_ocr_available=False")

    # 2. recognize_text_regions
    print("\n[2] recognize_text_regions")
    res = recognize_text_regions(img)
    if mock:
        check(res.status == "ok", f"mock 返回 ok (实际 {res.status})")
        check(res.provider == "mock", f"mock provider=mock")
    else:
        check(res.status == "unavailable", f"无 OCR 返回 unavailable (实际 {res.status})")
        check("未启用" in (res.message or ""), "unavailable 消息含「未启用」")

    # 3. recognize_single_glyph
    print("\n[3] recognize_single_glyph")
    res2 = recognize_single_glyph(img)
    if mock:
        check(res2.status == "ok", f"mock 单字 ok (实际 {res2.status})")
    else:
        check(res2.status == "unavailable", f"无 OCR 单字 unavailable (实际 {res2.status})")

    # 4. suggest_glyph_labels（候选框数量一致）
    print("\n[4] suggest_glyph_labels")
    cands = [
        GlyphCandidate(x=20, y=20, width=60, height=60, score=0.5),
        GlyphCandidate(x=10, y=10, width=30, height=30, score=0.3),
    ]
    res3 = suggest_glyph_labels(img, cands)
    if mock:
        check(res3.status == "ok", f"mock suggest ok (实际 {res3.status})")
        check(len(res3.candidates) == 2, f"候选数一致 2 (实际 {len(res3.candidates)})")
        # mock confidence=0.5 < 0.6，text 应被清空
        check(all(c.text == "" for c in res3.candidates), "低置信度（<0.6）text 清空")
    else:
        check(res3.status == "unavailable", f"无 OCR suggest unavailable (实际 {res3.status})")
        check(len(res3.candidates) == 0, "unavailable 时候选为空")

    # 5. 候选框数量一致（mock 下）
    if mock:
        print("\n[5] 候选框数量一致")
        cands5 = [GlyphCandidate(x=i * 10, y=i * 10, width=40, height=40, score=0.5) for i in range(5)]
        res5 = suggest_glyph_labels(img, cands5)
        check(len(res5.candidates) == 5, f"5 个候选返回 5 个 (实际 {len(res5.candidates)})")

    print(f"\n{'全部通过' if not FAILS else f'{len(FAILS)} 项失败'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
