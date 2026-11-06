"""base64 与 PIL Image 之间的编解码。"""
from __future__ import annotations

import base64
import io

from PIL import Image, ImageOps

# 压缩载荷上限与像素上限分别控制，兼顾常见 64MP PNG/JPEG 扫描稿。
MAX_IMAGE_BYTES = 96 * 1024 * 1024
MAX_IMAGE_B64_CHARS = 4 * ((MAX_IMAGE_BYTES + 2) // 3)
MAX_IMAGE_SIDE = 16384
MAX_IMAGE_PIXELS = 64_000_000


class ImageLimitError(ValueError):
    """图片载荷或像素尺寸超过允许上限。"""


def _check_image_limits(image: Image.Image) -> None:
    width, height = image.size
    if max(width, height) > MAX_IMAGE_SIDE or width * height > MAX_IMAGE_PIXELS:
        raise ImageLimitError("图片超过当前画布尺寸上限")


def b64_to_image(data: str, mime: str = "image/png") -> Image.Image:
    """把 base64 字符串解码为 PIL Image，并在转换前检查资源上限。

    Args:
        data: 不含 ``data:`` 前缀的 base64 字符串。
        mime: MIME 类型，保留给调用方描述输入；实际格式由 Pillow 检测。
    """
    if len(data) > MAX_IMAGE_B64_CHARS:
        raise ImageLimitError("图片 base64 数据超过大小上限")
    raw = base64.b64decode(data, validate=True)
    if len(raw) > MAX_IMAGE_BYTES:
        raise ImageLimitError("图片解码数据超过大小上限")

    try:
        with Image.open(io.BytesIO(raw)) as source:
            # Pillow 在 open 阶段只读取元数据；必须在 EXIF/convert 解码像素前检查。
            _check_image_limits(source)
            # Browsers apply EXIF orientation before displaying images and reporting
            # naturalWidth/Height. Use those same pixels for EVERY API coordinate.
            # exif_transpose also removes the tag so PNG output cannot rotate twice.
            oriented = ImageOps.exif_transpose(source)
            has_alpha = "A" in oriented.getbands() or "transparency" in oriented.info
            return oriented.convert("RGBA" if has_alpha else "RGB")
    except Image.DecompressionBombError as exc:
        raise ImageLimitError("图片超过 Pillow 安全像素上限") from exc


def image_to_b64(img: Image.Image, mime: str = "image/png") -> str:
    """把 PIL Image 编码为 base64 字符串。

    Args:
        img: PIL Image。
        mime: 输出 MIME，仅支持精确的 ``image/png`` 或 ``image/jpeg``。
    """
    if mime == "image/png":
        fmt = "PNG"
    elif mime == "image/jpeg":
        fmt = "JPEG"
    else:
        raise ValueError(f"不支持的输出 MIME: {mime}")

    buf = io.BytesIO()
    save_img = img
    if fmt == "JPEG" and save_img.mode in ("RGBA", "LA", "P"):
        rgba = save_img.convert("RGBA")
        save_img = Image.alpha_composite(
            Image.new("RGBA", rgba.size, "white"), rgba
        ).convert("RGB")
    save_img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode("ascii")
