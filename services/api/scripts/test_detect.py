"""vision glyph_detect 模块单元测试（不依赖网络）。

覆盖：
- detect_glyph_candidates 基本检测
- group_candidates_by_rows 行聚类
- sort_candidates_reading_order 阅读顺序
- filter_small_noise 噪点过滤
- 多行多列排序稳定性

用法（services/api venv 已激活）：
    python scripts/test_detect.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

_VISION_PARENT = Path(__file__).resolve().parents[2] / "vision"
sys.path.insert(0, str(_VISION_PARENT))

from vision import (  # noqa: E402
    DetectParams,
    detect_and_sort,
    detect_glyph_candidates,
    filter_small_noise,
    group_candidates_by_rows,
    sort_candidates_reading_order,
)


def _make_rows_img(rows: int, cols: int, w=400, h=200) -> Image.Image:
    """生成 rows×cols 个黑方块的白底图。"""
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    for r in range(rows):
        for c in range(cols):
            x0 = 40 + c * 70
            y0 = 40 + r * 100
            d.rectangle([x0, y0, x0 + 30, y0 + 40], fill="black")
    return img


def main() -> int:
    # 1. 基本检测
    img = _make_rows_img(2, 5)
    cands = detect_glyph_candidates(img)
    assert len(cands) == 10, f"detect count {len(cands)} != 10"
    print(f"✅ detect_glyph_candidates: {len(cands)} 个")

    # 2. 行聚类
    rows = group_candidates_by_rows(cands, row_tolerance=20)
    assert len(rows) == 2, f"rows {len(rows)} != 2"
    assert len(rows[0]) == 5 and len(rows[1]) == 5, "每行 5 个"
    print(f"✅ group_candidates_by_rows: {len(rows)} 行")

    # 3. 阅读顺序排序
    sorted_c = sort_candidates_reading_order(cands, row_tolerance=20)
    assert len(sorted_c) == 10
    # 第 0 行 5 个，第 1 行 5 个
    r0 = [c for c in sorted_c if c.row_index == 0]
    r1 = [c for c in sorted_c if c.row_index == 1]
    assert len(r0) == 5 and len(r1) == 5
    # order_index 应 0-4
    assert [c.order_index for c in r0] == [0, 1, 2, 3, 4], f"row0 order: {[c.order_index for c in r0]}"
    # 第 0 行 x 递增
    xs = [c.x for c in r0]
    assert all(xs[i] <= xs[i + 1] for i in range(len(xs) - 1)), "row0 x not increasing"
    # 第 0 行 y 都小于第 1 行 y
    assert max(c.y for c in r0) < min(c.y for c in r1), "row0 y not above row1"
    print("✅ sort_candidates_reading_order: 行内左到右，行间上到下")

    # 4. 排序稳定性（同一输入两次排序结果一致）
    sorted_c2 = sort_candidates_reading_order(cands, row_tolerance=20)
    assert [(c.x, c.y, c.row_index, c.order_index) for c in sorted_c] == [
        (c.x, c.y, c.row_index, c.order_index) for c in sorted_c2
    ], "排序不稳定"
    print("✅ 排序稳定性: 两次结果一致")

    # 5. 噪点过滤
    noisy = _make_rows_img(1, 3)
    arr = np.array(noisy)
    # 加几个 2x2 小噪点
    arr[5:7, 5:7] = 0
    arr[5:7, 100:102] = 0
    noisy_img = Image.fromarray(arr)
    cands_noisy = detect_glyph_candidates(noisy_img, DetectParams(min_width=5, min_height=5))
    filtered = filter_small_noise(cands_noisy, min_width=8, min_height=8)
    # 噪点被过滤
    assert all(c.width >= 8 and c.height >= 8 for c in filtered), "小噪点未过滤"
    print(f"✅ filter_small_noise: {len(cands_noisy)} -> {len(filtered)}")

    # 6. detect_and_sort 便捷入口
    result = detect_and_sort(img)
    assert len(result) == 10
    assert all(c.row_index >= 0 and c.order_index >= 0 for c in result)
    print("✅ detect_and_sort: 入口正常")

    # 7. 参数调整（更大 min 过滤更多）
    cands_few = detect_glyph_candidates(img, DetectParams(min_width=35, min_height=45))
    assert len(cands_few) < 10, f"大阈值应过滤更多 (got {len(cands_few)})"
    print(f"✅ 参数调整: min 35x45 -> {len(cands_few)} 个")

    print("\n所有 vision glyph_detect 测试通过 ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
