"""生成程序化示例扫描稿（非敏感合成图），用于 smoke test。

生成一张模拟笔记本页面：浅色网格背景 + 几行可清除的「旧字迹」横线，
用户可在应用中框选这些横线做清除练习。

用法（在仓库根目录，用 services/api 的 venv）：
    services/api/.venv/Scripts/python.exe scripts/gen_sample.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

WIDTH, HEIGHT = 800, 1000
OUT = Path(__file__).resolve().parent.parent / "storage" / "samples" / "demo-notes.png"


def main() -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), "#fbfaf6")
    draw = ImageDraw.Draw(img)

    # 横线（笔记本行）
    for y in range(120, HEIGHT - 80, 60):
        draw.line([(60, y), (WIDTH - 60, y)], fill="#d8d2c4", width=1)

    # 左侧装订线
    draw.line([(90, 60), (90, HEIGHT - 60)], fill="#c8b8a8", width=2)

    # 可清除的「旧字迹」：用波浪横线模拟手写文字行
    import math

    for row, y in enumerate(range(150, 700, 60)):
        seed = row * 7 + 3
        x = 120
        while x < WIDTH - 120:
            w = 30 + (seed * (x // 13)) % 40
            w = min(w, WIDTH - 120 - x)
            if w <= 0:
                break
            # 画一条带轻微波动的短横线（模拟一个字）
            pts = []
            for px in range(0, int(w), 3):
                py = math.sin((x + px + seed) * 0.3) * 2
                pts.append((x + px, y + py))
            if len(pts) >= 2:
                draw.line(pts, fill="#2b2b2b", width=2)
            x += int(w) + 6

    # 一行标题样式（更粗）
    draw.line([(120, 90), (300, 90)], fill="#1a1a1a", width=4)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, format="PNG")
    print(f"saved sample: {OUT}  ({WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()
