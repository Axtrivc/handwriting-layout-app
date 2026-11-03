"""base64 与 PIL Image 之间的编解码。"""
from __future__ import annotations

import base64
import io

from PIL import Image, ImageOps


def b64_to_image(data: str, mime: str = "image/png") -> Image.Image:
    """把 base64 字符串解码为 PIL Image。

    Args:
        data: 不含 ``data:`` 前缀的 base64 字符串。
        mime: MIME 类型，决定解码格式。
    """
    raw = base64.b64decode(data)
    with Image.open(io.BytesIO(raw)) as source:
        # Browsers apply EXIF orientation before displaying images and reporting
        # naturalWidth/Height. Use those same pixels for EVERY API coordinate.
        # exif_transpose also removes the tag so PNG output cannot rotate twice.
        oriented = ImageOps.exif_transpose(source)
        has_alpha = "A" in oriented.getbands() or "transparency" in oriented.info
        return oriented.convert("RGBA" if has_alpha else "RGB")


def image_to_b64(img: Image.Image, mime: str = "image/png") -> str:
    """把 PIL Image 编码为 base64 字符串。

    Args:
        img: PIL Image。
        mime: 输出 MIME，``image/png`` 或 ``image/jpeg``。
    """
    buf = io.BytesIO()
    fmt = "PNG" if "png" in mime.lower() else "JPEG"
    save_img = img
    if fmt == "JPEG" and save_img.mode in ("RGBA", "LA", "P"):
        save_img = save_img.convert("RGB")
    save_img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode("ascii")
