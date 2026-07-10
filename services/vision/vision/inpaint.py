"""去字迹 / inpaint 核心实现。

对用户**手动框选**的矩形区域清除字迹，但尽量保留背景（纸张纹理、横线等）。

核心思路：
1. 只在用户框选的区域内处理，不做全图自动识别
2. 在框选区域内，用自适应阈值提取「深色笔画」mask（文字）
3. 对 mask 做 inpaint，用周围背景像素填充文字位置
4. 框选区域内的浅色背景（横线、纸张）不被当 mask，因此保留

这样比「整块矩形 inpaint」效果好很多，不会把横线和背景一起糊掉。

合规说明：本能力仅接受用户主动框选的区域，不做自动整页字迹识别与擦除。
"""
from __future__ import annotations

from dataclasses import dataclass
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


@dataclass
class InpaintOptions:
    """清除选项。"""

    algorithm: str = "ns"  # "ns" (Navier-Stokes, 更平滑) | "telea"
    radius: int = 5  # inpaint 半径
    # 笔画检测：灰度低于此值视为文字笔画（深色）。
    # 默认 140：能区分黑色/深蓝笔迹(灰度<100)与浅灰横线/网格(灰度>180)。
    # 设为 None 用 Otsu 自动阈值（但在浅色背景上可能误判浅灰为笔画）。
    ink_threshold: int | None = 140
    # 笔画 mask 膨胀核大小（让文字边缘更完整被覆盖）
    dilate_kernel: int = 3
    # 是否做高斯模糊平滑 mask 边缘
    smooth_mask: bool = True


def _detect_ink_mask(
    gray_region: np.ndarray,
    threshold: int | None = None,
) -> np.ndarray:
    """在灰度图区域中检测深色笔画 mask。

    Args:
        gray_region: 单个框选区域的灰度图
        threshold: 固定阈值。None 时用 Otsu 自动阈值。

    Returns:
        二值 mask（255=文字笔画，0=背景）
    """
    if threshold is not None:
        # 固定阈值：低于阈值的像素 = 文字
        _, mask = cv2.threshold(gray_region, threshold, 255, cv2.THRESH_BINARY_INV)
    else:
        # Otsu 自动阈值：自动计算最佳分割点
        # 先轻微高斯模糊减少噪点干扰
        blurred = cv2.GaussianBlur(gray_region, (3, 3), 0)
        _, mask = cv2.threshold(
            blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )
    return mask


def clean_regions(
    img: Image.Image,
    regions: Sequence[RectRegion],
    radius: int = 5,
    options: InpaintOptions | None = None,
) -> tuple[Image.Image, int]:
    """对给定区域清除字迹（保留背景）。

    Args:
        img: 输入 PIL Image。
        regions: 要清理的矩形区域列表。
        radius: inpaint 半径（默认 5）。
        options: 高级选项（算法/阈值/膨胀等）。

    Returns:
        (清理后的 PIL Image, 实际处理区域数)
    """
    if not regions:
        return img, 0

    opts = options or InpaintOptions(radius=radius)
    bgr = _to_cv(img)
    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # 全图 mask（只标记文字笔画像素，不标记背景）
    ink_mask = np.zeros((h, w), dtype=np.uint8)

    processed = 0
    for region in regions:
        r = region.clip_to(w, h)
        if not r.is_valid():
            continue

        # 裁剪区域灰度图
        region_gray = gray[r.y : r.y + r.height, r.x : r.x + r.width]
        if region_gray.size == 0:
            continue

        # 检测该区域内的文字笔画
        region_mask = _detect_ink_mask(region_gray, opts.ink_threshold)

        # 膨胀 mask（让笔画边缘更完整地被覆盖，减少残留）
        if opts.dilate_kernel > 0:
            kernel = cv2.getStructuringElement(
                cv2.MORPH_RECT, (opts.dilate_kernel, opts.dilate_kernel)
            )
            region_mask = cv2.dilate(region_mask, kernel, iterations=1)

        # 写入全图 mask（只标记文字位置，背景=0 不被 inpaint）
        ink_mask[r.y : r.y + r.height, r.x : r.x + r.width] = region_mask
        processed += 1

    if processed == 0:
        return img, 0

    # 平滑 mask 边缘（减少 inpaint 后的边界痕迹）
    if opts.smooth_mask:
        ink_mask = cv2.GaussianBlur(ink_mask, (5, 5), 0)
        # 模糊后再二值化，保持 mask 干净但边缘柔和
        _, ink_mask = cv2.threshold(ink_mask, 50, 255, cv2.THRESH_BINARY)

    # 如果 mask 几乎为空（框选区域没有深色笔画），跳过 inpaint
    if cv2.countNonZero(ink_mask) == 0:
        return img, processed

    # 选择算法
    flag = cv2.INPAINT_NS if opts.algorithm == "ns" else cv2.INPAINT_TELEA
    result = cv2.inpaint(bgr, ink_mask, inpaintRadius=opts.radius, flags=flag)
    return _to_pil(result), processed
