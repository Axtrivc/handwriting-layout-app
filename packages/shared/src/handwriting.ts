/**
 * 个人手写样本库与字形素材管理的类型定义。
 *
 * 合规说明：仅用于采集**用户本人**的书写风格，用于笔记排版与模板美化。
 * 不采集、不模仿、不生成他人的笔迹。
 */

/** 字形包围盒（基于样本图像像素坐标） */
export interface GlyphBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 样本集状态 */
export type SampleSetStatus = "imported" | "segmented" | "reviewed";

/** 手写样本集（一张手写样本图，含多个可切割的字形） */
export interface HandwritingSampleSet {
  id: string;
  /** 所属档案 id */
  profileId: string;
  name: string;
  /** 样本图 base64（dataURL）或本地引用路径 */
  imageBase64: string;
  /** 原图宽度（px） */
  sourceImageWidth: number;
  /** 原图高度（px） */
  sourceImageHeight: number;
  createdAt: string;
  status: SampleSetStatus;
}

/** 单个字形（一个字的一个变体） */
export interface HandwritingGlyph {
  id: string;
  /** 所属档案 id */
  profileId: string;
  /** 对应字符（如 "我"、"a"、"，"） */
  char: string;
  /** 字形小图 base64（dataURL），通常为裁剪并处理后的透明背景图 */
  imageBase64: string;
  /** 字形包围盒（基于源样本图坐标） */
  bbox: GlyphBoundingBox;
  /** 来源样本集 id */
  sourceSampleSetId: string;
  /** 该字符的第几个变体（从 0 开始） */
  variantIndex: number;
  /** 自定义标签 */
  tags?: string[];
  /** 质量评分 0~1（可选，手工标注或后续算法给出） */
  qualityScore?: number;
  createdAt: string;
}

/** 渲染时优先使用的变体模式 */
export type PreferredVariantMode = "random" | "first" | "weighted";

/** 手写素材渲染设置 */
export interface HandwritingRenderSettings {
  preferredVariantMode: PreferredVariantMode;
  /** 字形整体缩放倍数（相对字号），默认 1.0 */
  scale: number;
  /** 基线浮动 (px) */
  baselineJitter: number;
  /** 旋转抖动 (deg) */
  rotationJitter: number;
  /** 透明度抖动 0~0.1 */
  opacityJitter: number;
  /** 字距抖动 (px) */
  spacingJitter: number;
}

/** 手写档案 */
export interface HandwritingProfile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
  /** 样本集列表 */
  sampleSets: HandwritingSampleSet[];
  /** 字形列表 */
  glyphs: HandwritingGlyph[];
  /** 默认渲染设置 */
  defaultRenderSettings: HandwritingRenderSettings;
}

/** 默认渲染设置 */
export const DEFAULT_RENDER_SETTINGS: HandwritingRenderSettings = {
  preferredVariantMode: "random",
  scale: 1.0,
  baselineJitter: 1,
  rotationJitter: 1.5,
  opacityJitter: 0.05,
  spacingJitter: 0.5,
};

/** 字形质量等级（仅提示，不阻止保存）。 */
export type GlyphQualityLevel = "good" | "warning" | "poor";

/** 字形质量评估结果。 */
export interface GlyphQualityResult {
  level: GlyphQualityLevel;
  /** 具体问题列表（level 为 warning/poor 时非空） */
  issues: string[];
}

/** 自动检测出的字形候选区域（对应后端 /detect-glyph-candidates）。 */
export interface GlyphCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  rowIndex: number;
  orderIndex: number;
}

/** 文本对象的渲染模式 */
export type TextRenderMode = "font" | "handwritingGlyph";

/** 生成 ISO 时间戳。 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * 按 seed 稳定地从一组变体中选择一个。
 *
 * @param variants 变体列表
 * @param seed 种子（通常是 TextObject.naturalnessSeed 或字符哈希）
 * @param mode 选择模式
 * @returns 选中的变体；若 variants 为空返回 null
 */
export function pickVariant<T>(
  variants: T[],
  seed: number,
  mode: PreferredVariantMode = "random",
): T | null {
  if (variants.length === 0) return null;
  if (mode === "first") return variants[0];

  if (mode === "weighted") {
    // 按 qualityScore 加权（无分值视为 0.5），用 seed 稳定采样
    const weights = variants.map((_, i) => {
      const g = variants[i] as unknown as { qualityScore?: number };
      return typeof g.qualityScore === "number" ? Math.max(0.01, g.qualityScore) : 0.5;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = ((seed >>> 0) % 10000) / 10000 * total;
    for (let i = 0; i < variants.length; i++) {
      r -= weights[i];
      if (r <= 0) return variants[i];
    }
    return variants[variants.length - 1];
  }

  // random：seed 稳定取模
  return variants[(seed >>> 0) % variants.length];
}
