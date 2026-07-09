"""POST /export：导出接口（MVP 预留）。

当前 MVP 阶段，前端直接用 canvas 导出 PNG，本接口返回 501 Not Implemented，
仅保留契约与接口签名，便于后续阶段实现服务端矢量导出 / PDF 导出。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas import ExportRequest, ExportResponse

router = APIRouter()


@router.post("/export", response_model=ExportResponse)
def export(req: ExportRequest) -> ExportResponse:
    """导出工程为 PNG / PDF。

    TODO（第二/三阶段）：
    - 接收完整工程数据 + 背景图
    - 服务端重新渲染（保证像素一致）
    - 支持 PDF 矢量导出
    """
    _ = req
    raise HTTPException(
        status_code=501,
        detail="服务端导出尚未实现，请使用前端「导出 PNG」按钮",
    )
