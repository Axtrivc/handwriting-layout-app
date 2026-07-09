"""应用配置。"""
from __future__ import annotations

import os
from pathlib import Path

# 项目根目录（handwriting-layout-app/）
REPO_ROOT = Path(__file__).resolve().parents[3]

# 存储目录
STORAGE_DIR = REPO_ROOT / "storage"
OUTPUTS_DIR = STORAGE_DIR / "outputs"
PROJECTS_DIR = STORAGE_DIR / "projects"
SAMPLES_DIR = STORAGE_DIR / "samples"

# 服务配置
HOST = os.environ.get("HW_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("HW_API_PORT", "8001"))

# inpaint 默认半径
DEFAULT_INPAINT_RADIUS = int(os.environ.get("HW_INPAINT_RADIUS", "3"))

# CORS：允许本地前端
CORS_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8001",
    "null",  # Electron file://
]
