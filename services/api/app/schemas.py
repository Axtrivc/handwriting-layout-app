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


class GlyphBBox(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)


class SegmentGlyphRequest(BaseModel):
    image: str = Field(..., description="样本图 base64（不含 data: 前缀）")
    mime: str = Field("image/png")
    bbox: GlyphBBox
    outMime: str | None = Field(None, description="输出 MIME，默认 image/png")
    threshold: bool = False
    thresholdValue: int = Field(180, ge=0, le=255)
    transparent: bool = False
    normalizeSize: int = Field(0, ge=0, description="归一化边长，0 不归一化")


class SegmentGlyphResponse(BaseModel):
    image: str
    mime: str
    width: int
    height: int


class DetectGlyphCandidatesRequest(BaseModel):
    image: str = Field(..., description="样本图 base64（不含 data: 前缀）")
    mime: str = Field("image/png")
    threshold: int | None = Field(None, ge=0, le=255)
    minWidth: int | None = Field(None, ge=1)
    minHeight: int | None = Field(None, ge=1)
    maxWidth: int | None = Field(None, ge=1)
    maxHeight: int | None = Field(None, ge=1)
    mergeNearby: bool | None = None
    rowTolerance: int | None = Field(None, ge=1)


class GlyphCandidateItem(BaseModel):
    x: int
    y: int
    width: int
    height: int
    score: float
    rowIndex: int
    orderIndex: int


class DetectGlyphCandidatesResponse(BaseModel):
    candidates: list[GlyphCandidateItem]
    count: int


# ===== OCR =====

class OcrBBox(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)


class OcrCandidateItem(BaseModel):
    text: str
    confidence: float
    bbox: OcrBBox | None = None
    provider: str


class OcrResultResponse(BaseModel):
    candidates: list[OcrCandidateItem]
    provider: str
    status: str  # ok | unavailable | error
    message: str | None = None


class OcrGlyphRequest(BaseModel):
    image: str = Field(..., description="单个字形图 base64")
    mime: str = Field("image/png")


class OcrSampleRequest(BaseModel):
    image: str = Field(..., description="样本图 base64")
    mime: str = Field("image/png")
    regions: list[OcrBBox] | None = None


class SuggestGlyphLabelsRequest(BaseModel):
    image: str = Field(..., description="样本图 base64")
    mime: str = Field("image/png")
    candidates: list[GlyphBBox] = Field(..., description="候选框列表")
