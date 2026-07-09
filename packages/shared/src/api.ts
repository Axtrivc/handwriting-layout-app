/**
 * 前后端共享的 API 类型与请求/响应契约。
 *
 * TODO: 后续用 zod 或 pydantic schema 双向同步校验。
 */

/** 矩形区域（用于清理字迹的框选） */
export interface RectRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
