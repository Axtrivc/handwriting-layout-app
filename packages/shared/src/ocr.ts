/** OCR 辅助识别的前后端共享类型。 */

/** 单个 OCR 识别候选。 */
export interface OcrCandidateItem {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number } | null;
  provider: string;
}

/** OCR 结果状态。 */
export type OcrStatus = "ok" | "unavailable" | "error";

/** OCR 结果。 */
export interface OcrResultResponse {
  candidates: OcrCandidateItem[];
  provider: string;
  status: OcrStatus;
  message: string | null;
}

/** OCR 识别结果应用到候选框的建议（前端内部结构）。 */
export interface GlyphOcrSuggestion {
  /** 候选框 id */
  candId: string;
  /** 建议字符 */
  suggestedChar: string;
  /** 置信度 */
  confidence: number;
  /** provider */
  provider: string;
  /** 置信度分级 */
  level: "high" | "medium" | "low";
}

/** 按置信度分级：>=0.85 high，>=0.6 medium，<0.6 low。 */
export function classifyConfidence(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}
