"""自动辅助切字：从手写样本图中检测可能的单字候选区域。

不要求 OCR 识别具体字符，只找出「可能是单个字」的矩形区域。
算法：灰度化 → 二值化 → 形态学膨胀合并近邻笔画 → 连通域 → 过滤噪声 → 行聚类 → 阅读顺序排序。

合规说明：仅处理用户本人提供的样本图，用于辅助个人笔记排版。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image


@dataclass
class GlyphCandidate:
    """一个字形候选区域。"""

    x: int
    y: int
    width: int
    height: int
    # 质量分 0~1（基于面积/长宽比/墨迹占比启发式），越大越像单字
    score: float
    # 所属行索引（从 0 开始，从上到下）
    row_index: int = -1
    # 行内阅读顺序索引（从 0 开始，从左到右）
    order_index: int = -1
    # 连通域面积（像素）
    area: int = 0


@dataclass
class DetectParams:
    """检测参数（均可选，有默认值）。"""

    # 二值化阈值（灰度 < threshold 视为前景笔画）
    threshold: int = 180
    # 候选框最小宽高（过滤噪点）
    min_width: int = 8
    min_height: int = 8
    # 候选框最大宽高（过滤整段粘连）
    max_width: int = 400
    max_height: int = 400
    # 是否合并相邻近的候选（形态学膨胀）
    merge_nearby: bool = True
    # 合并用的膨胀核尺寸（px）
    merge_kernel: int = 15
    # 行聚类容忍（行中心 y 差小于此值视为同一行）
    row_tolerance: int = 20


def _to_gray(img: Image.Image) -> np.ndarray:
    return np.array(img.convert("L"))


def detect_glyph_candidates(
    img: Image.Image, params: DetectParams | None = None
) -> list[GlyphCandidate]:
    """检测字形候选区域。

    Args:
        img: 输入 PIL Image。
        params: 检测参数，None 用默认。

    Returns:
        候选区域列表（已过滤噪声，但未做行聚类与排序）。
    """
    p = params or DetectParams()
    gray = _to_gray(img)

    # 二值化：前景 mask（笔画为 255）
    _, mask = cv2.threshold(gray, p.threshold, 255, cv2.THRESH_BINARY_INV)

    if p.merge_nearby and p.merge_kernel > 0:
        # 形态学膨胀，把同一字内的笔画断片合并成一个块
        kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (p.merge_kernel, p.merge_kernel)
        )
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    # 连通域
    num, _labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    h, w = gray.shape[:2]
    total_area = max(1, w * h)

    candidates: list[GlyphCandidate] = []
    # stats: [x, y, w, h, area]，第 0 个是背景
    for i in range(1, num):
        x, y, cw, ch, area = stats[i]
        if cw < p.min_width or ch < p.min_height:
            continue
        if cw > p.max_width or ch > p.max_height:
            continue
        # 排除占满近整图的大背景块
        if area > total_area * 0.5:
            continue
        score = _heuristic_score(cw, ch, area, w, h)
        candidates.append(
            GlyphCandidate(x=int(x), y=int(y), width=int(cw), height=int(ch), score=score, area=int(area))
        )

    return candidates


def _heuristic_score(width: int, height: int, area: int, img_w: int, img_h: int) -> float:
    """启发式打分：面积填充率 + 长宽比合理性，输出 0~1。"""
    # 填充率 = 连通域面积 / 包围盒面积
    box_area = max(1, width * height)
    fill = min(1.0, area / box_area)
    # 长宽比接近 1 更像单字（汉字多为方形）
    aspect = width / max(1, height)
    aspect_score = 1.0 - min(1.0, abs(aspect - 1.0) / 2.0)
    # 归一化大小：太小的噪点或太大的粘连都扣分
    size = (width + height) / 2
    size_score = 1.0 if 12 <= size <= 200 else max(0.0, 1.0 - (abs(size - 80) / 200))
    return round(0.4 * fill + 0.3 * aspect_score + 0.3 * size_score, 3)


def filter_small_noise(
    candidates: list[GlyphCandidate],
    min_width: int = 8,
    min_height: int = 8,
) -> list[GlyphCandidate]:
    """过滤过小的候选（二次过滤）。"""
    return [c for c in candidates if c.width >= min_width and c.height >= min_height]


def group_candidates_by_rows(
    candidates: list[GlyphCandidate], row_tolerance: int = 20
) -> list[list[GlyphCandidate]]:
    """按行聚类：行中心 y 接近的候选归为一行。

    Returns:
        二维列表，外层按 y 从上到下排序，内层按 x 从左到右。
    """
    if not candidates:
        return []
    # 按中心 y 排序
    sorted_c = sorted(candidates, key=lambda c: c.y + c.height / 2)
    rows: list[list[GlyphCandidate]] = []
    current_row: list[GlyphCandidate] = [sorted_c[0]]
    current_center = sorted_c[0].y + sorted_c[0].height / 2

    for c in sorted_c[1:]:
        center = c.y + c.height / 2
        if abs(center - current_center) <= row_tolerance:
            current_row.append(c)
            # 更新当前行的平均中心
            current_center = sum(rc.y + rc.height / 2 for rc in current_row) / len(current_row)
        else:
            rows.append(current_row)
            current_row = [c]
            current_center = center
    rows.append(current_row)
    return rows


def sort_candidates_reading_order(
    candidates: list[GlyphCandidate], row_tolerance: int = 20
) -> list[GlyphCandidate]:
    """按阅读顺序排序（从上到下、每行从左到右），并回填 row_index / order_index。

    Returns:
        排序后的候选列表（原对象的副本，含 row_index / order_index）。
    """
    rows = group_candidates_by_rows(candidates, row_tolerance)
    result: list[GlyphCandidate] = []
    for ri, row in enumerate(rows):
        for oi, c in enumerate(sorted(row, key=lambda c: c.x)):
            result.append(
                GlyphCandidate(
                    x=c.x,
                    y=c.y,
                    width=c.width,
                    height=c.height,
                    score=c.score,
                    area=c.area,
                    row_index=ri,
                    order_index=oi,
                )
            )
    return result


def detect_and_sort(
    img: Image.Image, params: DetectParams | None = None
) -> list[GlyphCandidate]:
    """便捷入口：检测 + 排序一次完成。"""
    cands = detect_glyph_candidates(img, params)
    tol = params.row_tolerance if params else 20
    return sort_candidates_reading_order(cands, tol)
