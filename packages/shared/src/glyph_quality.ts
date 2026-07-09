/**
 * 字形质量检查工具。
 *
 * 检查项（仅提示，不阻止保存）：
 * - bbox 太小 / 太大
 * - 空白比例过高（需要传入 inkRatio，由前端从裁剪后的像素估算）
 * - 黑色像素太少
 * - 裁剪后内容贴边太严重（需要传入 edgeTouchRatio）
 * - 字符为空
 * - 同一字符 variant 过多（提示）
 *
 * 前端调用时可选择性传入像素统计；若不传则只做几何检查。
 */
import type { GlyphBoundingBox, GlyphQualityLevel, GlyphQualityResult } from "./handwriting.js";

/** 质量检查输入。 */
export interface QualityCheckInput {
  /** 字符（trim 后） */
  char: string;
  /** 包围盒 */
  bbox: GlyphBoundingBox;
  /** 墨迹占比 0~1（深色像素 / 总像素），可选 */
  inkRatio?: number;
  /** 贴边像素占比 0~1（前景触碰包围盒四边），可选 */
  edgeTouchRatio?: number;
  /** 该字符已有的 variant 数量 */
  variantCount?: number;
}

/** variant 过多的阈值（超过则提示，但不阻止）。 */
const VARIANT_WARN = 6;

/**
 * 评估字形质量。
 *
 * @returns { level, issues }：level 为 good/warning/poor，issues 为问题列表。
 */
export function assessGlyphQuality(input: QualityCheckInput): GlyphQualityResult {
  const issues: string[] = [];
  let level: GlyphQualityLevel = "good";

  const bump = (to: GlyphQualityLevel) => {
    if (to === "poor" || (to === "warning" && level === "good")) level = to;
  };

  // 字符为空
  if (!input.char.trim()) {
    issues.push("字符为空");
    bump("poor");
  }

  const { width, height } = input.bbox;

  // 几何：太小
  if (width < 6 || height < 6) {
    issues.push(`区域过小（${width}×${height}）`);
    bump("poor");
  }
  // 几何：太大
  if (width > 400 || height > 400) {
    issues.push(`区域过大（${width}×${height}）`);
    bump("warning");
  }

  // 墨迹占比
  if (typeof input.inkRatio === "number") {
    if (input.inkRatio < 0.01) {
      issues.push("墨迹太少，可能是空白区域");
      bump("poor");
    } else if (input.inkRatio < 0.03) {
      issues.push("墨迹偏少");
      bump("warning");
    } else if (input.inkRatio > 0.95) {
      issues.push("几乎全黑，可能是粘连");
      bump("warning");
    }
  }

  // 贴边
  if (typeof input.edgeTouchRatio === "number" && input.edgeTouchRatio > 0.6) {
    issues.push("内容贴边严重，建议留白");
    bump("warning");
  }

  // variant 过多
  if (typeof input.variantCount === "number" && input.variantCount >= VARIANT_WARN) {
    issues.push(`该字符已有 ${input.variantCount} 个变体（够用啦）`);
    bump("warning");
  }

  return { level, issues };
}

/** 统计 profile 的覆盖率信息。 */
export interface CoverageStats {
  /** 总 glyph 数 */
  totalGlyphs: number;
  /** 覆盖的不同字符数 */
  coveredChars: number;
  /** 拥有多个 variant 的字符数 */
  multiVariantChars: number;
}

/** 计算 profile 级覆盖率统计。 */
export function profileCoverage(glyphs: { char: string }[]): CoverageStats {
  const charCount = new Map<string, number>();
  for (const g of glyphs) {
    const c = g.char;
    charCount.set(c, (charCount.get(c) ?? 0) + 1);
  }
  let multi = 0;
  for (const n of charCount.values()) {
    if (n > 1) multi++;
  }
  return {
    totalGlyphs: glyphs.length,
    coveredChars: charCount.size,
    multiVariantChars: multi,
  };
}

/**
 * 统计一段文本在指定 profile 下的缺字。
 *
 * @param text 文本内容
 * @param coveredChars 已有 glyph 覆盖的字符集合
 * @returns 缺失的字符数组（去重、保持出现顺序）
 */
export function missingChars(text: string, coveredChars: Set<string>): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const ch of text) {
    if (ch === " " || ch === "\n") continue;
    if (!coveredChars.has(ch) && !seen.has(ch)) {
      seen.add(ch);
      missing.push(ch);
    }
  }
  return missing;
}
