"""字形（glyph）图像处理。

用于从手写样本图中裁剪单个字形，并做去白边 / 归一化 / 二值化 / 透明背景等处理。

合规说明：仅处理用户本人提供的手写样本，用于个人笔记排版。
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image

from .regions import RectRegion


@dataclass(frozen=True)
class GlyphOutput:
    """字形处理结果。"""

    image: Image.Image
    width: int
    height: int


def crop_glyph(img: Image.Image, region: RectRegion) -> Image.Image:
    """按矩形区域裁剪字形（带边界保护）。"""
    w, h = img.size
    r = region.clip_to(w, h)
    if not r.is_valid():
        raise ValueError(f"无效的裁剪区域: {region}")
    return img.crop((r.x, r.y, r.x + r.width, r.y + r.height))


def trim_whitespace(
    img: Image.Image, threshold: int = 240, padding: int = 2
) -> Image.Image:
    """裁掉四周接近白色的留白。

    Args:
        img: 输入图（将转灰度判断）。
        threshold: 灰度大于该值视为背景（白）。
        padding: 保留的边距像素。
    """
    gray = np.array(img.convert("L"))
    # 前景 = 灰度小于阈值（深色笔画）
    mask = gray < threshold
    if not mask.any():
        # 整图都是背景，原样返回
        return img

    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    y0, y1 = np.where(rows)[0][[0, -1]]
    x0, x1 = np.where(cols)[0][[0, -1]]

    # 加 padding 但不越界
    y0 = max(0, y0 - padding)
    x0 = max(0, x0 - padding)
    y1 = min(gray.shape[0], y1 + padding + 1)
    x1 = min(gray.shape[1], x1 + padding + 1)

    return img.crop((x0, y0, x1, y1))


def normalize_glyph_size(
    img: Image.Image, target_size: int, pad_color: tuple[int, int, int] = (255, 255, 255)
) -> Image.Image:
    """等比缩放并居中填充到 target_size × target_size 的方形画布。"""
    if target_size <= 0:
        return img
    src = img.convert("RGBA") if img.mode == "RGBA" else img.convert("RGB")
    w, h = src.size
    scale = min(target_size / w, target_size / h)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized = src.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new(src.mode, (target_size, target_size), pad_color)
    off_x = (target_size - new_w) // 2
    off_y = (target_size - new_h) // 2
    canvas.paste(resized, (off_x, off_y))
    return canvas


def apply_threshold(img: Image.Image, value: int = 180) -> Image.Image:
    """二值化：灰度 < value -> 黑，否则白。"""
    gray = img.convert("L")
    arr = np.array(gray)
    bin_arr = np.where(arr < value, 0, 255).astype(np.uint8)
    return Image.fromarray(bin_arr).convert("RGB")


def make_transparent(img: Image.Image, threshold: int = 200) -> Image.Image:
    """浅色背景转透明，深色像素保留。

    用 alpha 通道：灰度越深（笔画）alpha 越高。
    """
    src = img.convert("RGBA")
    arr = np.array(src)
    gray = np.array(img.convert("L"))
    # alpha = 255 - gray（深色笔画 alpha 高）
    alpha = (255 - gray).astype(np.uint8)
    # 低于 threshold 视为纯背景，完全透明
    alpha = np.where(gray >= threshold, 0, alpha)
    arr[:, :, 3] = alpha
    return Image.fromarray(arr)


@dataclass
class GlyphProcessOptions:
    """字形处理选项。"""

    trim: bool = True
    normalize_size: int = 0  # 0 = 不归一化
    threshold: bool = False
    threshold_value: int = 180
    transparent: bool = False


def process_glyph(
    img: Image.Image, region: RectRegion, opts: GlyphProcessOptions
) -> GlyphOutput:
    """完整的字形处理流水线：裁剪 -> (去白边) -> (二值化) -> (归一化) -> (透明)。"""
    out = crop_glyph(img, region)

    if opts.trim:
        out = trim_whitespace(out)

    if opts.threshold:
        out = apply_threshold(out, opts.threshold_value)

    if opts.normalize_size > 0:
        pad = (0, 0, 0, 0) if opts.transparent else (255, 255, 255)
        out = normalize_glyph_size(out, opts.normalize_size, pad_color=pad)

    if opts.transparent:
        out = make_transparent(out)

    return GlyphOutput(image=out, width=out.size[0], height=out.size[1])


def image_to_png_bytes(img: Image.Image) -> bytes:
    """PIL Image -> PNG bytes。"""
    buf = io.BytesIO()
    save = img.convert("RGB") if img.mode not in ("RGB", "RGBA") else img
    save.save(buf, format="PNG")
    return buf.getvalue()
