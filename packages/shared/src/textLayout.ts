/**
 * 统一文本布局核心。
 *
 * 目的：让 Konva 预览渲染、当前页导出渲染、非活动页离屏渲染
 * 共用同一套布局逻辑，避免三套算法不一致。
 *
 * 本模块只做「纯布局计算」，不做实际绘制。
 * 绘制层（Konva / Canvas2D）根据 LayoutResult 自行绘制。
 */
import { pickVariant, type HandwritingProfile } from "./handwriting.js";
import type { NaturalnessParams, TextObject } from "./types.js";

/** 一个待绘制单元（glyph 图片 或 fallback 字符）。 */
export interface LayoutGlyph {
  /** 字符 */
  ch: string;
  /** 左上角 x（已应用对齐偏移 + naturalness 位置抖动） */
  x: number;
  /** 左上角 y（已应用行偏移 + baseline jitter） */
  y: number;
  /** 绘制宽度 */
  width: number;
  /** 绘制高度 */
  height: number;
  /** 是否用 glyph 图片渲染 */
  isGlyph: boolean;
  /** glyph 的图片在缓存中的 key（profileId:glyphId），绘制层用它取图 */
  glyphKey: string | null;
  /** fallback 字体绘制时用的字号（已应用 scale jitter） */
  fontSize: number;
  /** 不透明度（已应用 opacity jitter） */
  opacity: number;
}

/** 单行布局结果。 */
export interface LayoutLine {
  glyphs: LayoutGlyph[];
  /** 该行未抖动时的总宽度（用于对齐计算） */
  baseWidth: number;
}

/** 文本布局结果。 */
export interface LayoutResult {
  lines: LayoutLine[];
}

/** 测量一个 glyph 的显示宽度。绘制层传入已加载图片的原始尺寸。 */
export function glyphDisplayWidth(
  imgNaturalWidth: number,
  imgNaturalHeight: number,
  fontSize: number,
  profileScale: number,
): number {
  const scale = (fontSize / Math.max(1, imgNaturalHeight)) * profileScale;
  return imgNaturalWidth * scale;
}

/** fallback 字体单字宽度估算（与 GlyphText 内 fontCharWidth 保持一致）。 */
export function fontCharWidth(ch: string, fontSize: number): number {
  const code = ch.codePointAt(0) ?? 0;
  const isFull = code > 0x2e7f || (code >= 0x3000 && code <= 0x9fff);
  return fontSize * (isFull ? 1.0 : 0.6);
}

export interface LayoutOptions {
  /** glyph 图片尺寸查询：glyphKey -> {naturalWidth, naturalHeight}，缺字时返回 null */
  glyphSize: (glyphKey: string) => { naturalWidth: number; naturalHeight: number } | null;
  /** profile（handwritingGlyph 模式用），font 模式可传 null */
  profile: HandwritingProfile | null;
  /** 该对象使用的 profile id（null = 用项目活动档案，但此处应已解析为具体 profile） */
  /** 是否应用 naturalness 抖动（导出态 true，编辑预览态 false） */
  applyJitter: boolean;
  /** naturalness 参数（applyJitter 时使用） */
  naturalness: NaturalnessParams;
  /** 字距 */
  letterSpacing: number;
  /** 导出种子（applyJitter 时与对象 seed 组合，保证稳定） */
  exportSeed?: number;
}

/**
 * 计算一个 TextObject 的完整布局。
 *
 * @returns LayoutResult，绘制层据此绘制。
 *
 * 算法（与 GlyphText 保持一致）：
 * 1. 按行拆分
 * 2. 每行逐字：查 glyph → 有则记 glyphKey + 图片宽度，无则 fallback 字体宽度
 * 3. 算每行 baseWidth，按 align 算行起始 x
 * 4. 应用 naturalness：逐字 scale/opacity jitter，逐行 baseline jitter
 */
export function layoutText(obj: TextObject, opts: LayoutOptions): LayoutResult {
  const lines = obj.text.split("\n");
  const lineHeightPx = obj.style.fontSize * obj.style.lineHeight;
  const profileScale = opts.profile?.defaultRenderSettings.scale ?? 1;

  // 组合种子
  const baseSeed =
    opts.exportSeed !== undefined
      ? (obj.naturalnessSeed ^ opts.exportSeed) >>> 0
      : obj.naturalnessSeed;
  const rand = seededRandom(baseSeed);

  // 第一遍：算每行 baseWidth 与每字的基础信息
  interface RawChar {
    ch: string;
    glyphKey: string | null;
    isGlyph: boolean;
    baseWidth: number;
    imgNatural?: { width: number; height: number };
  }
  const rawLines: { chars: RawChar[]; baseWidth: number }[] = [];
  let absIdx = 0;
  for (const line of lines) {
    const chars: RawChar[] = [];
    let baseWidth = 0;
    for (const ch of line) {
      if (ch === " ") {
        const w = obj.style.fontSize * 0.5;
        chars.push({ ch, glyphKey: null, isGlyph: false, baseWidth: w });
        baseWidth += w + opts.letterSpacing;
        absIdx++;
        continue;
      }
      const variants =
        opts.profile?.glyphs.filter((g) => g.char === ch) ?? [];
      const seed = obj.naturalnessSeed + absIdx;
      const glyph =
        variants.length > 0
          ? pickVariant(variants, seed, opts.profile?.defaultRenderSettings.preferredVariantMode)
          : null;
      if (glyph) {
        const glyphKey = `${opts.profile!.id}:${glyph.id}`;
        const img = opts.glyphSize(glyphKey);
        if (img) {
          const w = glyphDisplayWidth(img.naturalWidth, img.naturalHeight, obj.style.fontSize, profileScale);
          chars.push({
            ch, glyphKey, isGlyph: true, baseWidth: w,
            imgNatural: { width: img.naturalWidth, height: img.naturalHeight },
          });
          baseWidth += w + opts.letterSpacing;
        } else {
          // 图片还在加载，按 fallback 宽度占位
          const w = fontCharWidth(ch, obj.style.fontSize);
          chars.push({ ch, glyphKey: null, isGlyph: false, baseWidth: w });
          baseWidth += w + opts.letterSpacing;
        }
      } else {
        const w = fontCharWidth(ch, obj.style.fontSize);
        chars.push({ ch, glyphKey: null, isGlyph: false, baseWidth: w });
        baseWidth += w + opts.letterSpacing;
      }
      absIdx++;
    }
    if (chars.length > 0) baseWidth -= opts.letterSpacing;
    rawLines.push({ chars, baseWidth: Math.max(0, baseWidth) });
  }

  // 第二遍：按对齐 + jitter 生成最终 LayoutGlyph
  const resultLines: LayoutLine[] = [];
  for (let li = 0; li < rawLines.length; li++) {
    const { chars, baseWidth } = rawLines[li];
    let x: number;
    if (obj.style.align === "center") {
      x = obj.x - baseWidth / 2;
    } else if (obj.style.align === "right") {
      x = obj.x - baseWidth;
    } else {
      x = obj.x;
    }
    const y = obj.y + li * lineHeightPx;

    // 行 baseline jitter
    let rowDy = 0;
    if (opts.applyJitter && opts.naturalness.baselineJitter > 0) {
      rowDy = (rand() * 2 - 1) * opts.naturalness.baselineJitter;
    }

    const outGlyphs: LayoutGlyph[] = [];
    for (const rc of chars) {
      if (rc.ch === " ") {
        x += rc.baseWidth + opts.letterSpacing;
        continue;
      }
      // 逐字 jitter
      let jitterScale = 1;
      let jitterDx = 0;
      let jitterOpacity = obj.style.opacity;
      if (opts.applyJitter) {
        const r = rand();
        if (opts.naturalness.fontSizeJitter > 0) {
          jitterScale *= 1 + (r * 2 - 1) * (opts.naturalness.fontSizeJitter / obj.style.fontSize);
        }
        if (opts.naturalness.positionJitter > 0) {
          jitterDx = (rand() * 2 - 1) * opts.naturalness.positionJitter;
        }
        if (opts.naturalness.opacityJitter > 0) {
          jitterOpacity = clamp(
            jitterOpacity + (rand() * 2 - 1) * opts.naturalness.opacityJitter,
            0.1,
            1,
          );
        }
      }

      if (rc.isGlyph && rc.imgNatural) {
        const baseScale = (obj.style.fontSize / Math.max(1, rc.imgNatural.height)) * profileScale;
        const s = baseScale * jitterScale;
        const drawW = rc.imgNatural.width * s;
        const drawH = rc.imgNatural.height * s;
        outGlyphs.push({
          ch: rc.ch,
          x: x + jitterDx,
          y: y + rowDy + (drawH < obj.style.fontSize ? (obj.style.fontSize - drawH) / 2 : 0),
          width: drawW,
          height: drawH,
          isGlyph: true,
          glyphKey: rc.glyphKey,
          fontSize: obj.style.fontSize * jitterScale,
          opacity: jitterOpacity,
        });
        x += drawW + opts.letterSpacing;
      } else {
        outGlyphs.push({
          ch: rc.ch,
          x: x + jitterDx,
          y: y + rowDy,
          width: rc.baseWidth * jitterScale,
          height: obj.style.fontSize,
          isGlyph: false,
          glyphKey: null,
          fontSize: obj.style.fontSize * jitterScale,
          opacity: jitterOpacity,
        });
        x += rc.baseWidth + opts.letterSpacing;
      }
    }
    resultLines.push({ glyphs: outGlyphs, baseWidth });
  }

  return { lines: resultLines };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 确定性伪随机（与 naturalness.ts 一致，独立实现避免循环依赖）。 */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** 收集一个 TextObject 中所有需要加载的 glyphKey（用于离屏渲染前预加载图片）。 */
export function collectGlyphKeys(
  obj: TextObject,
  profile: HandwritingProfile | null,
): string[] {
  if (!profile || obj.renderMode !== "handwritingGlyph") return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const ch of obj.text) {
    if (ch === " " || ch === "\n") continue;
    const variants = profile.glyphs.filter((g) => g.char === ch);
    for (const g of variants) {
      const key = `${profile.id}:${g.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}
