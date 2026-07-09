"""vision glyph 模块的单元测试（不依赖网络）。

直接测试 crop/trim/normalize/threshold/transparent 五个函数。
用法（services/api venv 已激活）：
    python scripts/test_glyph.py
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# 把 services/vision 加入 sys.path
_VISION_PARENT = Path(__file__).resolve().parents[2] / "vision"
sys.path.insert(0, str(_VISION_PARENT))

from vision import (  # noqa: E402
    GlyphProcessOptions,
    RectRegion,
    apply_threshold,
    crop_glyph,
    make_transparent,
    normalize_glyph_size,
    process_glyph,
    trim_whitespace,
)


def _make_image(w: int, h: int, blocks: list[tuple[int, int, int, int]]) -> Image.Image:
    img = Image.new("RGB", (w, h), "white")
    arr = np.array(img)
    for x0, y0, x1, y1 in blocks:
        arr[y0:y1, x0:x1] = 0  # 黑块
    return Image.fromarray(arr)


def main() -> int:
    fails = 0

    # crop_glyph
    img = _make_image(100, 100, [(40, 40, 60, 60)])
    cropped = crop_glyph(img, RectRegion(30, 30, 40, 40))
    assert cropped.size == (40, 40), f"crop size wrong: {cropped.size}"
    print("✅ crop_glyph")

    # trim_whitespace：四周白边去掉
    padded = _make_image(100, 100, [(45, 45, 55, 55)])
    trimmed = trim_whitespace(padded)
    # 中心 10x10 黑块 + 2px padding = ~14x14
    assert trimmed.size[0] <= 16 and trimmed.size[1] <= 16, f"trim too big: {trimmed.size}"
    print(f"✅ trim_whitespace ({trimmed.size})")

    # normalize_glyph_size
    small = _make_image(10, 10, [(2, 2, 8, 8)])
    norm = normalize_glyph_size(small, 64)
    assert norm.size == (64, 64), f"normalize size: {norm.size}"
    print("✅ normalize_glyph_size (64x64)")

    # apply_threshold：灰度 128 < 阈值 180 -> 黑(0)；灰度 200 >= 180 -> 白(255)
    gimg = Image.new("L", (10, 10), 200)
    garr = np.array(gimg)
    garr[:5, :] = 128  # 上半部分深色
    binary = apply_threshold(Image.fromarray(garr), 180)
    barr = np.array(binary.convert("L"))
    assert (barr[:5] == 0).all(), "dark region (128) should be black"
    assert (barr[5:] == 255).all(), "light region (200) should be white"
    print("✅ apply_threshold")

    # make_transparent
    blk = _make_image(20, 20, [(5, 5, 15, 15)])
    trans = make_transparent(blk)
    assert trans.mode == "RGBA", f"mode: {trans.mode}"
    aarr = np.array(trans)[:, :, 3]
    # 黑块区应有 alpha，白区 alpha=0
    assert aarr[10, 10] > 0, "black region should be opaque"
    assert aarr[0, 0] == 0, "white region should be transparent"
    print("✅ make_transparent")

    # process_glyph 完整流水线
    opts = GlyphProcessOptions(trim=True, transparent=True, normalize_size=48)
    result = process_glyph(
        _make_image(100, 100, [(40, 40, 60, 60)]),
        RectRegion(20, 20, 60, 60),
        opts,
    )
    assert result.width == 48 and result.height == 48
    print("✅ process_glyph pipeline (48x48 transparent)")

    print("\n所有 vision glyph 测试通过 ✅")
    return fails


if __name__ == "__main__":
    sys.exit(main())
