"""去字迹 / inpaint 核心实现。

对用户**手动框选**的区域清除字迹，保留背景（纸张纹理、横线等），
并**重建被清除区域内的横线**（支持实线/虚线，从两侧采样复制）。

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
    ink_threshold: int | None = 100
    dilate_iterations: int = 3
    detect_lines: bool = True


def _detect_horizontal_lines(
    gray: np.ndarray, x: int, y: int, w: int, h: int, img_w: int, img_h: int
) -> list[dict]:
    """检测框选区域附近的水平线（支持实线和虚线）。

    采样策略：在框选区域的**左侧和右侧**（区域外）逐行扫描。
    水平线特征：某一行在区域外有明显的非白像素聚集。

    Returns:
        [{y: 绝对y, left_pattern: 左侧像素数组, right_pattern: 右侧像素数组}]
        pattern 用于重建时复制线型。
    """
    lines = []
    scan_top = max(0, y - 10)
    scan_bottom = min(img_h, y + h + 10)

    # 采样区域外的左右各 40px
    margin = 40
    left_start = max(0, x - margin)
    left_end = x
    right_start = min(img_w, x + w)
    right_end = min(img_w, x + w + margin)

    if left_end - left_start < 5 and right_end - right_start < 5:
        return lines

    for ly in range(scan_top, scan_bottom):
        # 检查左右两侧是否有横线
        left_row = gray[ly, left_start:left_end] if left_end > left_start else np.array([])
        right_row = gray[ly, right_start:right_end] if right_end > right_start else np.array([])

        left_nonwhite = left_row[left_row < 220] if len(left_row) > 0 else np.array([])
        right_nonwhite = right_row[right_row < 220] if len(right_row) > 0 else np.array([])

        # 至少一侧有足够的非白像素
        left_ok = len(left_nonwhite) >= max(3, (left_end - left_start) * 0.2)
        right_ok = len(right_nonwhite) >= max(3, (right_end - right_start) * 0.2)

        if not (left_ok or right_ok):
            continue

        # 灰度一致性（线颜色应接近）
        all_nonwhite = np.concatenate([left_nonwhite, right_nonwhite]) if len(left_nonwhite) + len(right_nonwhite) > 0 else np.array([200])
        if all_nonwhite.std() > 50:
            continue
        median_val = int(np.median(all_nonwhite))
        # 排除太深（文字）或太浅（噪声）
        if median_val < 70 or median_val > 215:
            continue

        lines.append({
            "y": ly,
            "gray": median_val,
            "left_start": left_start,
            "left_end": left_end,
            "right_start": right_start,
            "right_end": right_end,
        })

    # 去重：相近 y 合并
    lines.sort(key=lambda l: l["y"])
    deduped: list[dict] = []
    for l in lines:
        if deduped and abs(l["y"] - deduped[-1]["y"]) <= 1:
            continue
        deduped.append(l)
    return deduped


def _rebuild_line_in_region(
    result_bgr: np.ndarray,
    original_bgr: np.ndarray,
    gray: np.ndarray,
    ln: dict,
    region_x: int,
    region_w: int,
    img_w: int,
) -> None:
    """在清除区域内重建一条横线。

    从区域左右两侧采样原始横线的像素（保留线型：实线/虚线/粗细），
    在清除区域内的对应位置复制。
    """
    ly = ln["y"]
    left_start = ln["left_start"]
    left_end = ln["left_end"]
    right_start = ln["right_start"]
    right_end = ln["right_end"]

    # 采样左右两侧该行的像素
    left_pixels = original_bgr[ly, left_start:left_end] if left_end > left_start else np.array([]).reshape(0, 3)
    right_pixels = original_bgr[ly, right_start:right_end] if right_end > right_start else np.array([]).reshape(0, 3)

    # 重建区域内的横线：用左右采样的像素填充
    gap_start = region_x
    gap_end = min(img_w, region_x + region_w)

    if gap_end <= gap_start:
        return

    gap_width = gap_end - gap_start

    # 策略：把左右两侧的像素拼接成一条 pattern，在 gap 内重复/延伸
    # 左侧像素从右到左读（贴近 gap 的部分在前面），右侧像素从左到右读
    pattern_left = left_pixels[::-1] if len(left_pixels) > 0 else np.array([]).reshape(0, 3)
    pattern_right = right_pixels if len(right_pixels) > 0 else np.array([]).reshape(0, 3)
    pattern = np.vstack([pattern_left, pattern_right]) if len(pattern_left) + len(pattern_right) > 0 else None

    if pattern is None or len(pattern) == 0:
        # 没有可用的 pattern，用纯色画线
        color = (ln["gray"], ln["gray"], ln["gray"])
        cv2.line(result_bgr, (gap_start, ly), (gap_end - 1, ly), color, 1)
        return

    # 在 gap 内逐像素复制 pattern
    for i in range(gap_width):
        px = pattern[i % len(pattern)]
        result_bgr[ly, gap_start + i] = px

    # 如果横线有粗细（多于1px），检查上下行
    for dy in [-1, 1]:
        ny = ly + dy
        if 0 <= ny < result_bgr.shape[0]:
            # 检查原始图该位置是否也是横线（粗线）
            left_check = gray[ny, left_start:left_end] if left_end > left_start else np.array([])
            if len(left_check) > 0 and np.mean(left_check < 220) > 0.3:
                for i in range(gap_width):
                    px = pattern[i % len(pattern)]
                    result_bgr[ny, gap_start + i] = px


def clean_regions(
    img: Image.Image,
    regions: Sequence[RectRegion],
    radius: int = 6,
    options: InpaintOptions | None = None,
) -> tuple[Image.Image, int]:
    """对给定区域清除字迹（保留背景，重建横线）。"""
    if not regions:
        return img, 0

    opts = options or InpaintOptions(radius=radius)
    bgr = _to_cv(img)
    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    ink_mask = np.zeros((h, w), dtype=np.uint8)
    # 记录每个区域检测到的横线 + 区域信息
    region_lines: list[tuple[dict, int, int]] = []  # (line_info, region_x, region_w)
    processed = 0

    for region in regions:
        r = region.clip_to(w, h)
        if not r.is_valid():
            continue

        rx, ry, rw, rh = r.x, r.y, r.width, r.height
        region_gray = gray[ry : ry + rh, rx : rx + rw]
        if region_gray.size == 0:
            continue

        # 1. 提取文字 mask
        if opts.ink_threshold is not None:
            ink = (region_gray < opts.ink_threshold).astype(np.uint8) * 255
        else:
            blurred = cv2.GaussianBlur(region_gray, (3, 3), 0)
            _, ink = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # 2. 横线保护：检测横线并从 mask 排除
        line_mask = np.zeros_like(ink)
        if opts.detect_lines:
            detected = _detect_horizontal_lines(gray, rx, ry, rw, rh, w, h)
            for ln in detected:
                ly_in_region = ln["y"] - ry
                if 0 <= ly_in_region < rh:
                    for dy in range(-2, 3):
                        yy = ly_in_region + dy
                        if 0 <= yy < rh:
                            line_pixels = region_gray[yy, :] >= 120
                            line_mask[yy, line_pixels] = 255
                region_lines.append((ln, rx, rw))

        ink = cv2.bitwise_and(ink, cv2.bitwise_not(line_mask))

        # 3. 膨胀
        if opts.dilate_iterations > 0:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            ink = cv2.dilate(ink, kernel, iterations=opts.dilate_iterations)
            ink = cv2.bitwise_and(ink, cv2.bitwise_not(line_mask))

        ink_mask[ry : ry + rh, rx : rx + rw] = ink
        processed += 1

    if processed == 0:
        return img, 0
    if cv2.countNonZero(ink_mask) == 0:
        return img, processed

    # 4. inpaint
    flag = cv2.INPAINT_NS if opts.algorithm == "ns" else cv2.INPAINT_TELEA
    result = cv2.inpaint(bgr, ink_mask, inpaintRadius=opts.radius, flags=flag)

    # 5. 重建横线：从两侧采样原始线型，在清除区域内复制
    for ln, rx, rw in region_lines:
        _rebuild_line_in_region(result, bgr, gray, ln, rx, rw, w)

    return _to_pil(result), processed
