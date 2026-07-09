/** 导出设置（UI 可调）。 */
export interface ExportSettings {
  /** PNG 倍率：1 = 原图尺寸，2 = 高清 2x */
  pngScale: number;
  /** PDF 图片压缩质量 */
  pdfCompression: "FAST" | "MEDIUM" | "SLOW";
  /** 导出范围 */
  range: "current" | "all";
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  pngScale: 1,
  pdfCompression: "FAST",
  range: "current",
};
