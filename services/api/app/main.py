"""FastAPI 应用入口。

路由：
- GET  /health        健康检查
- POST /clean-region  手动框选区域去字迹
- POST /export        导出（MVP 预留，前端先用 canvas 导出 PNG）
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# main.py 在 services/api/app/，parents[2] = services
_VISION_PARENT = Path(__file__).resolve().parents[2] / "vision"
if str(_VISION_PARENT) not in sys.path:
    sys.path.insert(0, str(_VISION_PARENT))

from vision.encoding import ImageLimitError  # noqa: E402

from . import __version__  # noqa: E402
from .config import CORS_ORIGINS, DEFAULT_INPAINT_RADIUS, MAX_REQUEST_BODY_BYTES  # noqa: E402
from .routes.clean import router as clean_router  # noqa: E402
from .routes.export import router as export_router  # noqa: E402
from .routes.glyph import router as glyph_router  # noqa: E402
from .routes.detect import router as detect_router  # noqa: E402
from .routes.ocr import router as ocr_router  # noqa: E402
from .routes.scan import router as scan_router  # noqa: E402
from .schemas import HealthResponse  # noqa: E402
from .workloads import WorkloadError  # noqa: E402


class _RequestBodyLimitError(Exception):
    """实际读取的请求体超过上限。"""


class RequestBodyLimitMiddleware:
    """同时按 Content-Length 和实际读取字节数限制请求体。"""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_REQUEST_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        content_length = Headers(scope=scope).get("content-length")
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except ValueError:
                await self._error(scope, receive, send, 400, "无效的 Content-Length")
                return
            if declared_length < 0:
                await self._error(scope, receive, send, 400, "无效的 Content-Length")
                return
            if declared_length > self.max_bytes:
                await self._error(scope, receive, send, 413, "请求体超过大小上限")
                return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _RequestBodyLimitError
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except _RequestBodyLimitError:
            if response_started:
                raise
            await self._error(scope, receive, send, 413, "请求体超过大小上限")

    @staticmethod
    async def _error(
        scope: Scope, receive: Receive, send: Send, status: int, detail: str
    ) -> None:
        response = JSONResponse(status_code=status, content={"detail": detail})
        await response(scope, receive, send)


app = FastAPI(
    title="handwriting-layout-app API",
    description="本地后端：扫描稿清理与导出。仅处理用户本人的扫描稿。",
    version=__version__,
)

app.add_middleware(RequestBodyLimitMiddleware, max_bytes=MAX_REQUEST_BODY_BYTES)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(WorkloadError)
async def workload_error(_request: Request, exc: WorkloadError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code},
        headers=exc.headers,
    )


@app.exception_handler(ImageLimitError)
async def image_limit_error(_request: Request, exc: ImageLimitError) -> JSONResponse:
    return JSONResponse(status_code=413, content={"detail": str(exc)})


app.include_router(clean_router, tags=["clean"])
app.include_router(export_router, tags=["export"])
app.include_router(glyph_router, tags=["glyph"])
app.include_router(detect_router, tags=["detect"])
app.include_router(ocr_router, tags=["ocr"])
app.include_router(scan_router, tags=["scan"])


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """健康检查。"""
    return HealthResponse(status="ok", version=__version__)


# 让导出的 radius 默认值可通过环境变量调整
_INPAINT_RADIUS = DEFAULT_INPAINT_RADIUS


def get_inpaint_radius() -> int:
    """供路由读取的 inpaint 半径。"""
    return _INPAINT_RADIUS
