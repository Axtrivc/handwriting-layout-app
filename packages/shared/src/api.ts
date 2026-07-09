/**
 * 前后端共享的 API 类型与请求/响应契约。
 *
 * TODO: 后续用 zod 或 pydantic schema 双向同步校验。
 */
import type { RectRegion } from "./types.js";
import type { GlyphBoundingBox, GlyphCandidate } from "./handwriting.js";
export type { RectRegion } from "./types.js";
export type { GlyphCandidate } from "./handwriting.js";
export type { OcrCandidateItem, OcrResultResponse } from "./ocr.js";

/** POST /clean-region 请求 */
export interface CleanRegionRequest {
  /** 图片 base64（不含 data: 前缀） */
  image: string;
  /** 图片 MIME 类型，如 image/png */
  mime: string;
  /** 要清理的矩形区域列表（基于原图坐标） */
  regions: RectRegion[];
}

/** POST /clean-region 响应 */
export interface CleanRegionResponse {
  /** 清理后的图片 base64（不含 data: 前缀） */
  image: string;
  /** 输出 MIME 类型 */
  mime: string;
  /** 实际处理的区域数 */
  processed: number;
}

/** POST /export 请求（预留） */
export interface ExportRequest {
  /** 工程数据 JSON */
  project: unknown;
  /** 导出格式 */
  format: "png" | "pdf";
}

/** POST /export 响应（预留） */
export interface ExportResponse {
  /** 导出文件名 */
  filename: string;
  /** 导出文件 base64（不含 data: 前缀） */
  data: string;
  /** MIME 类型 */
  mime: string;
}

/** 默认后端地址 */
export const DEFAULT_API_BASE = "http://127.0.0.1:8001";

/** POST /segment-glyph 请求：从样本图裁剪一个字形 */
export interface SegmentGlyphRequest {
  /** 样本图 base64（不含 data: 前缀） */
  image: string;
  mime: string;
  /** 字形包围盒（基于原图坐标） */
  bbox: GlyphBoundingBox;
  /** 输出 MIME，默认 image/png */
  outMime?: string;
  /** 是否做二值化 */
  threshold?: boolean;
  /** 二值化阈值（0~255），默认 180 */
  thresholdValue?: number;
  /** 是否转透明背景（深色像素保留，浅色透明） */
  transparent?: boolean;
  /** 归一化后的边长（px），等比缩放填充，默认 0 不缩放 */
  normalizeSize?: number;
}

/** POST /segment-glyph 响应 */
export interface SegmentGlyphResponse {
  /** 处理后的字形图 base64（不含 data: 前缀） */
  image: string;
  mime: string;
  /** 输出宽度 */
  width: number;
  /** 输出高度 */
  height: number;
}

/** POST /detect-glyph-candidates 请求 */
export interface DetectGlyphCandidatesRequest {
  image: string;
  mime: string;
  threshold?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  mergeNearby?: boolean;
  rowTolerance?: number;
}

/** POST /detect-glyph-candidates 响应 */
export interface DetectGlyphCandidatesResponse {
  candidates: GlyphCandidate[];
  count: number;
}

/** POST /ocr-glyph 请求 */
export interface OcrGlyphRequest {
  image: string;
  mime: string;
}

/** POST /ocr-sample 请求 */
export interface OcrSampleRequest {
  image: string;
  mime: string;
  regions?: RectRegion[];
}

/** POST /suggest-glyph-labels 请求 */
export interface SuggestGlyphLabelsRequest {
  image: string;
  mime: string;
  candidates: GlyphBoundingBox[];
}
