"""Pydantic 请求/响应模型（与 packages/shared/src/api.ts 对齐）。"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class RectRegion(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)


class CleanRegionRequest(BaseModel):
    image: str = Field(..., description="图片 base64（不含 data: 前缀）")
    mime: str = Field("image/png", description="图片 MIME 类型")
    regions: List[RectRegion] = Field(default_factory=list)


class CleanRegionResponse(BaseModel):
    image: str
    mime: str
    processed: int


class ExportRequest(BaseModel):
    project: dict = Field(default_factory=dict)
    format: Literal["png", "pdf"] = "png"


class ExportResponse(BaseModel):
    filename: str
    data: str
    mime: str


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
