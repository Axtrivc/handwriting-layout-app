"""FastAPI 应用入口。

路由：
- GET  /health        健康检查
- POST /clean-region  手动框选区域去字迹
- POST /export        导出（MVP 预留，前端先用 canvas 导出 PNG）
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import CORS_ORIGINS, DEFAULT_INPAINT_RADIUS
from .routes.clean import router as clean_router
from .routes.export import router as export_router
from .routes.glyph import router as glyph_router
from .schemas import HealthResponse

app = FastAPI(
    title="handwriting-layout-app API",
    description="本地后端：扫描稿清理与导出。仅处理用户本人的扫描稿。",
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(clean_router, tags=["clean"])
app.include_router(export_router, tags=["export"])
app.include_router(glyph_router, tags=["glyph"])


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """健康检查。"""
    return HealthResponse(status="ok", version=__version__)


# 让导出的 radius 默认值可通过环境变量调整
_INPAINT_RADIUS = DEFAULT_INPAINT_RADIUS


def get_inpaint_radius() -> int:
    """供路由读取的 inpaint 半径。"""
    return _INPAINT_RADIUS
