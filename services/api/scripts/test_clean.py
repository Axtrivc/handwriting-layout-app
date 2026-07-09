"""手动验证脚本：测试 /clean-region 端到端流程。

生成一张带文字的图片 -> base64 -> POST /clean-region -> 保存结果。
仅用于本地开发验证，不是单元测试。

用法（在 services/api 下，venv 已激活）：
    python scripts/test_clean.py
"""
from __future__ import annotations

import base64
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

API = "http://127.0.0.1:8001"
OUT_DIR = Path(__file__).resolve().parents[1] / ".." / "storage" / "outputs"
OUT_DIR = OUT_DIR.resolve()


def make_test_image() -> tuple[str, bytes, Image.Image]:
    """生成 200x80 的白底黑字测试图，返回 (base64, region_json, image)。"""
    img = Image.new("RGB", (200, 80), "white")
    draw = ImageDraw.Draw(img)
    draw.text((20, 30), "HELLO WORLD", fill="black")
    # 框选 "WORLD" 区域（约 x=85~160, y=28~48）
    region = {"x": 80, "y": 25, "width": 90, "height": 30}
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    return data, region, img


def main() -> int:
    img_b64, region, img = make_test_image()

    payload = json.dumps(
        {"image": img_b64, "mime": "image/png", "regions": [region]}
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{API}/clean-region",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:  # noqa: BLE001
        print(f"HTTP {exc.code}: {exc.read().decode('utf-8')}")
        return 1

    print(f"processed regions: {body['processed']}")
    print(f"output mime: {body['mime']}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "clean_before.png").write_bytes(
        base64.b64decode(img_b64)
    )
    (OUT_DIR / "clean_after.png").write_bytes(
        base64.b64decode(body["image"])
    )
    print(f"saved before/after to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
