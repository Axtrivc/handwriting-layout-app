"""生成手写样本采集模板图（供用户参考布局）。

输出一张白底模板图，列出数字 / 字母 / 标点 / 高频汉字 / 句子，
用户可照此在手写纸上誊写后拍照导入。

注意：模板中的字是系统印刷字体，仅用于展示「应该写哪些内容」，
用户实际采集的应是自己的手写笔迹。

用法：
    services/api/.venv/Scripts/python.exe scripts/gen_sample_template.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1200, 1600
OUT = Path(__file__).resolve().parent.parent / "storage" / "samples" / "sample-template.png"

# 高频汉字 100 个（来源：常用汉字频率表节选）
HIGH_FREQ_HANZI = (
    "的 一 是 了 我 不 人 在 他 有 这 个 上 们 来 到 时 大 地 为 子 中 你 说 "
    "生 国 年 着 就 那 和 要 她 出 也 得 里 后 自 以 会 家 可 下 而 过 天 去 "
    "能 对 多 小 于 然 心 么 法 都 好 前 此 用 你 们 一 些 话 起 看 把 给 到"
)

SENTENCES = [
    "今天天气真好，我想出去散步。",
    "笔记要记得整齐，方便以后复习。",
    "把这段话抄写一遍，保持自己的风格。",
    "学习是一个长期的过程，需要坚持。",
    "手写让记忆更深刻，也更有温度。",
]


def get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("msyh.ttc", "simhei.ttf", "simsun.ttc", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(img)

    title_font = get_font(40)
    section_font = get_font(28)
    content_font = get_font(36)

    y = 40
    draw.text((40, y), "手写样本采集模板（参考布局）", fill="#1a1a1a", font=title_font)
    y += 70
    draw.text(
        (40, y),
        "请用黑笔在白纸上誊写以下内容，字写大一些、间距留足，拍照后导入。",
        fill="#666",
        font=section_font,
    )
    y += 60

    def section(title: str) -> None:
        nonlocal y
        y += 20
        draw.text((40, y), title, fill="#2f6df6", font=section_font)
        y += 50

    def line(text: str) -> None:
        nonlocal y
        draw.text((60, y), text, fill="#333", font=content_font)
        y += 56

    # 1. 数字
    section("1. 数字（每个写 3 遍，间距留足）")
    for row in range(0, 10, 5):
        chunk = "  ".join(f"{n} {n} {n}" for n in range(row, row + 5))
        line(chunk)

    # 2. 小写字母
    section("2. 小写字母 a-z")
    line("a b c d e f g h i j k l m")
    line("n o p q r s t u v w x y z")

    # 3. 大写字母
    section("3. 大写字母 A-Z")
    line("A B C D E F G H I J K L M")
    line("N O P Q R S T U V W X Y Z")

    # 4. 标点
    section("4. 常用标点")
    line("， 。 、 ； ： ？ ！ “” ‘’ （ ） 《 》")

    # 5. 高频汉字
    section("5. 高频汉字（节选，每个字留间距）")
    hanzi = HIGH_FREQ_HANZI.split()
    for i in range(0, len(hanzi), 20):
        line(" ".join(hanzi[i : i + 20]))

    # 6. 句子
    section("6. 完整句子（采集连笔与上下文）")
    for s in SENTENCES:
        line(s)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, format="PNG")
    print(f"saved template: {OUT}  ({WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()
