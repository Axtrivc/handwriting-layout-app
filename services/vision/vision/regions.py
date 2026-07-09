"""矩形区域数据结构与校验。"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RectRegion:
    """一个矩形区域（基于原图像素坐标）。"""

    x: int
    y: int
    width: int
    height: int

    def clip_to(self, img_width: int, img_height: int) -> "RectRegion":
        """将区域裁剪到图像范围内，并返回新区域。"""
        x0 = max(0, min(self.x, img_width - 1))
        y0 = max(0, min(self.y, img_height - 1))
        x1 = max(x0 + 1, min(self.x + self.width, img_width))
        y1 = max(y0 + 1, min(self.y + self.height, img_height))
        return RectRegion(x=x0, y=y0, width=x1 - x0, height=y1 - y0)

    def is_valid(self) -> bool:
        """区域是否有效（宽高都 > 0）。"""
        return self.width > 0 and self.height > 0
