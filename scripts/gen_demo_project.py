"""生成演示工程 demo-project.json（合成素材，无真实个人信息）。

内容：
- 2 页（程序生成的笔记本背景）
- 普通文本对象
- handwritingGlyph 模式文本（含缺字 fallback 示例）
- 1 个 handwritingProfile + 5 个 glyph
- naturalness 开启

用法（services/api venv）：
    services/api/.venv/Scripts/python.exe scripts/gen_demo_project.py
"""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "storage" / "samples" / "demo-project.json"


def make_page_bg(w: int, h: int, title: str) -> str:
    """生成一页笔记本背景图 dataURL。"""
    img = Image.new("RGB", (w, h), "#fbfaf6")
    d = ImageDraw.Draw(img)
    # 横线
    for y in range(120, h - 80, 60):
        d.line([(60, y), (w - 60, y)], fill="#d8d2c4", width=1)
    # 装订线
    d.line([(90, 60), (90, h - 60)], fill="#c8b8a8", width=2)
    # 标题
    d.text((120, 60), title, fill="#1a1a1a")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def make_glyph_img(char_hint: str) -> str:
    """生成一个 40x40 黑底白字 glyph（合成，非真实手写）。"""
    img = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 画一个简单图形代表字形（圆/方/线）
    import hashlib
    h = int(hashlib.md5(char_hint.encode()).hexdigest(), 16)
    shape = h % 3
    if shape == 0:
        d.ellipse([8, 8, 32, 32], fill="#1a1a1a")
    elif shape == 1:
        d.rectangle([10, 10, 30, 30], fill="#1a1a1a")
    else:
        d.line([(8, 20), (32, 20)], fill="#1a1a1a", width=6)
        d.line([(20, 8), (20, 32)], fill="#1a1a1a", width=6)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    W, H = 800, 600
    now = "2026-07-09T00:00:00.000Z"

    # 2 页背景
    bg1 = make_page_bg(W, H, "第一页 笔记")
    bg2 = make_page_bg(W, H, "第二页 笔记")

    # 5 个 glyph（覆盖: 我 的 一 是 笔；缺字: 记 录 测 试）
    glyph_chars = ["我", "的", "一", "是", "笔"]
    glyphs = []
    for i, ch in enumerate(glyph_chars):
        glyphs.append({
            "id": f"g-{ch}-{i}",
            "profileId": "prof-demo",
            "char": ch,
            "imageBase64": make_glyph_img(ch),
            "bbox": {"x": 0, "y": 0, "width": 40, "height": 40},
            "sourceSampleSetId": "ss-demo",
            "variantIndex": 0,
            "createdAt": now,
        })

    profile = {
        "id": "prof-demo",
        "name": "演示手写档案（合成）",
        "createdAt": now,
        "updatedAt": now,
        "description": "程序生成的合成字形，仅用于演示，非真实手写。",
        "sampleSets": [{
            "id": "ss-demo",
            "profileId": "prof-demo",
            "name": "合成样本",
            "imageBase64": bg1,
            "sourceImageWidth": W,
            "sourceImageHeight": H,
            "createdAt": now,
            "status": "reviewed",
        }],
        "glyphs": glyphs,
        "defaultRenderSettings": {
            "preferredVariantMode": "random",
            "scale": 1.0,
            "baselineJitter": 1,
            "rotationJitter": 1.5,
            "opacityJitter": 0.05,
            "spacingJitter": 0.5,
        },
    }

    def mk_style():
        return {
            "fontFamily": "cursive, 'Comic Sans MS', 'PingFang SC', sans-serif",
            "fontSize": 28,
            "fontWeight": "normal",
            "fontStyle": "normal",
            "align": "left",
            "letterSpacing": 0,
            "lineHeight": 1.4,
            "color": "#1a1a1a",
            "opacity": 1,
            "rotation": 0,
            "blur": 0,
        }

    project = {
        "appVersion": "0.8.0",
        "id": "proj-demo",
        "name": "演示工程（合成素材）",
        "pages": [
            {
                "id": "page-1",
                "name": "第 1 页",
                "index": 0,
                "backgroundImage": bg1,
                "originalWidth": W,
                "originalHeight": H,
                "createdAt": now,
                "updatedAt": now,
                "textObjects": [
                    {
                        "id": "t-1",
                        "text": "这是普通字体文本",
                        "x": 150, "y": 150,
                        "style": mk_style(),
                        "zIndex": 0,
                        "naturalnessSeed": 111,
                        "renderMode": "font",
                        "handwritingProfileId": None,
                    },
                    {
                        # handwritingGlyph 模式：我的笔是（"我""的""是""笔"有glyph，其他fallback）
                        "id": "t-2",
                        "text": "我的笔记",
                        "x": 150, "y": 250,
                        "style": {**mk_style(), "fontSize": 36},
                        "zIndex": 1,
                        "naturalnessSeed": 222,
                        "renderMode": "handwritingGlyph",
                        "handwritingProfileId": "prof-demo",
                    },
                ],
                "cleanHistory": [],
            },
            {
                "id": "page-2",
                "name": "第 2 页",
                "index": 1,
                "backgroundImage": bg2,
                "originalWidth": W,
                "originalHeight": H,
                "createdAt": now,
                "updatedAt": now,
                "textObjects": [
                    {
                        # 缺字 fallback 示例：记录测试（全部缺字，fallback字体）
                        "id": "t-3",
                        "text": "记录测试",
                        "x": 150, "y": 150,
                        "style": mk_style(),
                        "zIndex": 0,
                        "naturalnessSeed": 333,
                        "renderMode": "handwritingGlyph",
                        "handwritingProfileId": "prof-demo",
                    },
                ],
                "cleanHistory": [],
            },
        ],
        "activePageId": "page-1",
        "settings": {
            "naturalnessEnabled": True,
            "naturalness": {
                "positionJitter": 2,
                "rotationJitter": 1.5,
                "opacityJitter": 0.05,
                "fontSizeJitter": 1,
                "baselineJitter": 1,
            },
        },
        "handwritingProfiles": [profile],
        "activeHandwritingProfileId": "prof-demo",
        "createdAt": now,
        "updatedAt": now,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved demo project: {OUT}")
    print(f"  pages: {len(project['pages'])}")
    print(f"  glyphs: {len(profile['glyphs'])}")
    print(f"  covered chars: {''.join(glyph_chars)}")
    print(f"  missing demo: 记录测试 (全部 fallback)")


if __name__ == "__main__":
    main()
