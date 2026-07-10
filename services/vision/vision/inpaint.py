"""去字迹 / inpaint 核心实现。

对用户**手动框选**的区域清除字迹，保留背景（纸张纹理、横线等）。

核心思路：
1. 只在框选区域内提取深色笔画(文字)mask
2. **横线保护**：检测区域内的水平线位置，从 mask 中排除，避免横线被 inpaint
3. 充分膨胀 mask 确保文字边缘完全覆盖（彻底清除，不残留淡影）
4. inpaint 后**重建横线**：从区域外采样横线颜色，在原位置重绘

合规说明：仅接受用户主动框选的区域，不做自动整页字迹识别与擦除。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import cv2
import numpy as np
from PIL import Image

from .regions import RectRegion


def _to_cv(img: Image.Image) -> np.ndarray:
    arr = np.array(img.convert("RGB"))
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _to_pil(bgr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))


@dataclass
class InpaintOptions:
    algorithm: str = "ns"
    radius: int = 6
    # 笔画检测阈值：灰度低于此值视为文字。None=Otsu自动。
    ink_threshold: int | None = 100
    # mask 膨胀次数（确保文字边缘完全覆盖）
    dilate_iterations: int = 3
    # 是否检测并保护/重建横线
    detect_lines: bool = True


def _detect_horizontal_lines(
    gray: np.ndarray, x: int, y: int, w: int, h: int, img_w: int, img_h: int
) -> list[dict]:
    """检测框选区域及其上下方的水平线。

    在框选区域外（上方20px、下方20px）扫描水平线，
    如果找到，记录其相对框选区域的 y 偏移和颜色。

    Returns:
        线信息列表：[{y: 绝对y坐标, color: (B,G,R), thickness: 粗细}]
    """
    lines = []
    scan_top = max(0, y - 25)
    scan_bottom = min(img_h, y + h + 25)

    for ly in range(scan_top, scan_bottom):
        # 采样该行左右各一段（框选区域外）
        left_x = max(0, x - 30)
        right_x = min(img_w, x + w + 30)
        if right_x - left_x < 10:
            continue
        row = gray[ly, left_x:right_x]
        # 水平线特征：该行大部分像素是中等灰度(非白非黑)，且灰度一致
        non_white = row[row < 220]
        if len(non_white) < (right_x - left_x) * 0.4:
            continue
        # 检查灰度一致性（线的颜色应该接近）
        if non_white.std() > 40:
            continue
        median_val = int(np.median(non_white))
        # 排除太深的线（可能是文字的一部分）
        if median_val < 80:
            continue
        # 排除太浅的（噪声）
        if median_val > 210:
            continue
        # 确认是连续的水平线（允许小间隙）
        line_pixels = row < 220
        # 最长连续段
        max_run = 0
        cur_run = 0
        for v in line_pixels:
            if v:
                cur_run += 1
                max_run = max(max_run, cur_run)
            else:
                cur_run = 0
        if max_run < (right_x - left_x) * 0.5:
            continue

        # 采样线的 BGR 颜色（从原始 BGR 图）
        lines.append({"y": ly, "gray": median_val})

    # 去重：相近 y 合并
    lines.sort(key=lambda l: l["y"])
    deduped: list[dict] = []
    for l in lines:
        if deduped and abs(l["y"] - deduped[-1]["y"]) <= 2:
            continue
        deduped.append(l)
    return deduped


def _sample_line_color(bgr: np.ndarray, gray: np.ndarray, line_y: int, x: int, w: int, img_w: int) -> tuple[int, int, int]:
    """采样横线的 BGR 颜色。"""
    left_x = max(0, x - 20)
    right_x = min(img_w, x + w + 20)
    row_gray = gray[line_y, left_x:right_x]
    mask = row_gray < 220
    if mask.sum() > 0:
        row_bgr = bgr[line_y, left_x:right_x]
        return tuple(int(v) for v in row_bgr[mask].mean(axis=0))
    return (200, 200, 200)


def clean_regions(
    img: Image.Image,
    regions: Sequence[RectRegion],
    radius: int = 6,
    options: InpaintOptions | None = None,
) -> tuple[Image.Image, int]:
    """对给定区域清除字迹（保留背景和横线）。

    流程：
    1. 提取框选区域内的文字 mask（深色笔画）
    2. 检测横线位置，从 mask 中排除横线像素（保护横线）
    3. 充分膨胀 mask（彻底覆盖文字边缘）
    4. inpaint 填充文字位置
    5. 重建横线（在原位置重绘）
    """
    if not regions:
        return img, 0

    opts = options or InpaintOptions(radius=radius)
    bgr = _to_cv(img)
    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # 全图文字 mask
    ink_mask = np.zeros((h, w), dtype=np.uint8)
    # 记录每个区域检测到的横线（用于重建）
    all_lines: list[dict] = []
    processed = 0

    for region in regions:
        r = region.clip_to(w, h)
        if not r.is_valid():
            continue

        rx, ry, rw, rh = r.x, r.y, r.width, r.height
        region_gray = gray[ry : ry + rh, rx : rx + rw]
        if region_gray.size == 0:
            continue

        # --- 1. 提取文字 mask ---
        if opts.ink_threshold is not None:
            ink = (region_gray < opts.ink_threshold).astype(np.uint8) * 255
        else:
            blurred = cv2.GaussianBlur(region_gray, (3, 3), 0)
            _, ink = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # --- 2. 横线保护：从 mask 中排除横线像素 ---
        line_mask = np.zeros_like(ink)
        if opts.detect_lines:
            detected = _detect_horizontal_lines(gray, rx, ry, rw, rh, w, h)
            for ln in detected:
                ly_in_region = ln["y"] - ry
                if 0 <= ly_in_region < rh:
                    # 在横线所在行 ±2 像素标记保护
                    for dy in range(-2, 3):
                        yy = ly_in_region + dy
                        if 0 <= yy < rh:
                            # 只保护浅色像素（横线），不保护深色（可能是文字）
                            line_pixels = region_gray[yy, :] >= 120
                            line_mask[yy, line_pixels] = 255
                    all_lines.append(ln)

        # 从文字 mask 中减去横线保护区
        ink = cv2.bitwise_and(ink, cv2.bitwise_not(line_mask))

        # --- 3. 膨胀 mask（彻底覆盖文字边缘） ---
        if opts.dilate_iterations > 0:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            ink = cv2.dilate(ink, kernel, iterations=opts.dilate_iterations)
            # 膨胀后再次排除横线区域（防止膨胀扩散到横线）
            ink = cv2.bitwise_and(ink, cv2.bitwise_not(line_mask))

        ink_mask[ry : ry + rh, rx : rx + rw] = ink
        processed += 1

    if processed == 0:
        return img, 0

    if cv2.countNonZero(ink_mask) == 0:
        return img, processed

    # --- 4. inpaint ---
    flag = cv2.INPAINT_NS if opts.algorithm == "ns" else cv2.INPAINT_TELEA
    result = cv2.inpaint(bgr, ink_mask, inpaintRadius=opts.radius, flags=flag)

    # --- 5. 重建横线 ---
    if all_lines:
        for ln in all_lines:
            ly = ln["y"]
            if 0 <= ly < h:
                # 采样线的颜色（从 inpaint 前的原图区域外）
                color = _sample_line_color(bgr, gray, ly, min(r.x for r in regions if r.is_valid()), w, w)
                # 在结果图上重绘横线
                cv2.line(result, (0, ly), (w, ly), color, 1)

    return _to_pil(result), processed
