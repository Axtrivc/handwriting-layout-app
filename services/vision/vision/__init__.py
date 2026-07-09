"""vision 包：扫描稿图像处理。

子模块：
- encoding: base64 / PIL 互转
- regions: 矩形区域数据结构
- inpaint: 去字迹 / inpaint 算法
- glyph: 字形裁剪与处理
"""
from .encoding import image_to_b64, b64_to_image  # noqa: F401
from .regions import RectRegion  # noqa: F401
from .inpaint import clean_regions  # noqa: F401
from .glyph import (  # noqa: F401
    GlyphOutput,
    GlyphProcessOptions,
    process_glyph,
    crop_glyph,
    trim_whitespace,
    normalize_glyph_size,
    apply_threshold,
    make_transparent,
)
from .glyph_detect import (  # noqa: F401
    GlyphCandidate,
    DetectParams,
    detect_glyph_candidates,
    filter_small_noise,
    group_candidates_by_rows,
    sort_candidates_reading_order,
    detect_and_sort,
)
from .ocr import (  # noqa: F401
    OcrCandidate,
    OcrResult,
    recognize_text_regions,
    recognize_single_glyph,
    suggest_glyph_labels,
    is_ocr_available,
    get_provider_name,
    register_provider,
    register_mock_provider,
)

__all__ = [
    "image_to_b64",
    "b64_to_image",
    "RectRegion",
    "clean_regions",
    "GlyphOutput",
    "GlyphProcessOptions",
    "process_glyph",
    "crop_glyph",
    "trim_whitespace",
    "normalize_glyph_size",
    "apply_threshold",
    "make_transparent",
    "GlyphCandidate",
    "DetectParams",
    "detect_glyph_candidates",
    "filter_small_noise",
    "group_candidates_by_rows",
    "sort_candidates_reading_order",
    "detect_and_sort",
    "OcrCandidate",
    "OcrResult",
    "recognize_text_regions",
    "recognize_single_glyph",
    "suggest_glyph_labels",
    "is_ocr_available",
    "get_provider_name",
    "register_provider",
    "register_mock_provider",
]
