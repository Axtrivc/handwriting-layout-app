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

# 请求体上限：允许主图与参考图各使用 96 MiB 压缩载荷，并预留 JSON/画笔数据。
MAX_REQUEST_BODY_BYTES = 272 * 1024 * 1024

# 每个 Python 进程的重型任务预算；处理超时只停止 HTTP 等待，不强杀原生运算。
VISION_MAX_WORKERS = int(os.environ.get("HW_VISION_MAX_WORKERS", "1"))
VISION_MAX_QUEUE = int(os.environ.get("HW_VISION_MAX_QUEUE", "4"))
VISION_QUEUE_TIMEOUT_SECONDS = float(os.environ.get("HW_VISION_QUEUE_TIMEOUT_SECONDS", "5"))
VISION_PROCESS_TIMEOUT_SECONDS = float(os.environ.get("HW_VISION_PROCESS_TIMEOUT_SECONDS", "50"))
OCR_MAX_WORKERS = int(os.environ.get("HW_OCR_MAX_WORKERS", "1"))
OCR_MAX_QUEUE = int(os.environ.get("HW_OCR_MAX_QUEUE", "4"))
OCR_QUEUE_TIMEOUT_SECONDS = float(os.environ.get("HW_OCR_QUEUE_TIMEOUT_SECONDS", "5"))
OCR_PROCESS_TIMEOUT_SECONDS = float(os.environ.get("HW_OCR_PROCESS_TIMEOUT_SECONDS", "50"))
OPENCV_NUM_THREADS = int(os.environ.get("HW_OPENCV_NUM_THREADS", "1"))

# CORS：仅允许明确的开发前端和 Electron 自定义协议来源。
CORS_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8001",
    "hw-app://app",
]
