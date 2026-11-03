"""矩形区域数据结构与校验。"""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Sequence


@dataclass(frozen=True)
class BrushStroke:
    points: Sequence[tuple[float, float]]
    width: float

    def bounds(self, width: int, height: int) -> "RectRegion":
        if not self.points or not math.isfinite(self.width) or self.width < 1 or self.width > 512:
            raise ValueError('画笔路径或粗细无效')
        if any(not math.isfinite(v) for point in self.points for v in point):
            raise ValueError('画笔坐标必须为有限数值')
        radius = self.width / 2 + 1
        x0 = math.floor(min(p[0] for p in self.points) - radius)
        y0 = math.floor(min(p[1] for p in self.points) - radius)
        x1 = math.ceil(max(p[0] for p in self.points) + radius)
        y1 = math.ceil(max(p[1] for p in self.points) + radius)
        return RectRegion(x0, y0, x1 - x0, y1 - y0).clip_to(width, height)


@dataclass(frozen=True)
class RectRegion:
    """一个矩形区域（基于原图像素坐标）。"""

    x: int
    y: int
    width: int
    height: int

    def clip_to(self, img_width: int, img_height: int) -> "RectRegion":
        """将区域裁剪到图像范围内，并返回新区域。"""
        x0 = max(0, min(self.x, img_width))
        y0 = max(0, min(self.y, img_height))
        x1 = max(0, min(self.x + self.width, img_width))
        y1 = max(0, min(self.y + self.height, img_height))
        return RectRegion(x=x0, y=y0, width=max(0, x1 - x0), height=max(0, y1 - y0))

    def is_valid(self) -> bool:
        """区域是否有效（宽高都 > 0）。"""
        return self.width > 0 and self.height > 0
