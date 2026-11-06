"""Desktop/development entry point for the local API."""
from __future__ import annotations

import os

import uvicorn

from app.main import app


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("HW_API_HOST", "127.0.0.1"),
        port=int(os.environ.get("HW_API_PORT", "8001")),
        log_level=os.environ.get("HW_API_LOG_LEVEL", "info"),
    )
