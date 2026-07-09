"""vision 包：扫描稿图像处理。

子模块：
- encoding: base64 / PIL 互转
- regions: 矩形区域数据结构
- inpaint: 去字迹 / inpaint 算法
"""
from .encoding import image_to_b64, b64_to_image  # noqa: F401
from .regions import RectRegion  # noqa: F401
from .inpaint import clean_regions  # noqa: F401

__all__ = ["image_to_b64", "b64_to_image", "RectRegion", "clean_regions"]
