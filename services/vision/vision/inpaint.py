"""去字迹 / inpaint 核心实现。

MVP 版本：对用户**手动框选**的矩形区域做 inpaint（基于 OpenCV Telea 算法），
用于清理个人草稿的字迹残留或扫描噪点。

合规说明：本能力仅接受用户主动框选的区域，不做自动整页字迹识别与擦除。
"""
from __future__ import annotations

from typing import Sequence

import cv2
import numpy as np
from PIL import Image

from .regions import RectRegion


def _to_cv(img: Image.Image) -> np.ndarray:
    """PIL Image -> OpenCV BGR ndarray。"""
    arr = np.array(img.convert("RGB"))
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _to_pil(bgr: np.ndarray) -> Image.Image:
    """OpenCV BGR ndarray -> PIL RGB Image。"""
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))


def clean_regions(
    img: Image.Image,
    regions: Sequence[RectRegion],
    radius: int = 3,
) -> tuple[Image.Image, int]:
    """对给定区域做 inpaint。

    Args:
        img: 输入 PIL Image。
        regions: 要清理的矩形区域列表。
        radius: inpaint 半径（像素），越大越平滑但越慢。

    Returns:
        (清理后的 PIL Image, 实际处理区域数)
    """
    if not regions:
        return img, 0

    bgr = _to_cv(img)
    h, w = bgr.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)

    processed = 0
    for region in regions:
        r = region.clip_to(w, h)
        if not r.is_valid():
            continue
        mask[r.y : r.y + r.height, r.x : r.x + r.width] = 255
        processed += 1

    if processed == 0:
        return img, 0

    # TODO: 提供 Telea / NS / 背景填充等多种算法可选
    result = cv2.inpaint(bgr, mask, inpaintRadius=radius, flags=cv2.INPAINT_TELEA)
    return _to_pil(result), processed
