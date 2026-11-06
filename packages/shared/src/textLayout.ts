/**
 * 统一文本布局核心。
 *
 * 目的：让 Konva 预览渲染、当前页导出渲染、非活动页离屏渲染
 * 共用同一套布局逻辑，避免三套算法不一致。
 *
 * 本模块只做「纯布局计算」，不做实际绘制。
 * 绘制层（Konva / Canvas2D）根据 LayoutResult 自行绘制。
 */
import { pickVariant, type HandwritingProfile, type HandwritingGlyph } from "./handwriting.js";

const glyphGroupCache = new WeakMap<HandwritingGlyph[], { count: number; grouped: Map<string, HandwritingGlyph[]> }>();

function groupGlyphs(profile: HandwritingProfile | null) {
  if (!profile) return new Map<string, HandwritingGlyph[]>();
  const glyphs = profile.glyphs;
  const cached = glyphGroupCache.get(glyphs);
  if (cached?.count === glyphs.length) return cached.grouped;
  const grouped = new Map<string, HandwritingGlyph[]>();
  for (const glyph of glyphs) {
    const variants = grouped.get(glyph.char);
    if (variants) variants.push(glyph);
    else grouped.set(glyph.char, [glyph]);
  }
  glyphGroupCache.set(glyphs, { count: glyphs.length, grouped });
  return grouped;
}
import type { NaturalnessParams, TextObject } from "./types.js";

/** 一个待绘制单元（glyph 图片 或 fallback 字符）。 */
export interface LayoutGlyph {
  /** 原文字符索引，自动换行时用同一索引生成稳定自然化。 */
  sourceIndex: number;
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
  rotation: number;
}

/** 单行布局结果。 */
export interface LayoutLine {
  glyphs: LayoutGlyph[];
  /** 该行未抖动时的总宽度（用于对齐计算） */
  baseWidth: number;
  /** 该行首字符在原文中的 code point 索引。 */
  sourceIndex: number;
  /** 原文 UTF-16 起止偏移，用于无损分页。 */
  sourceStart: number;
  sourceEnd: number;
}

/** 文本布局结果。 */
export interface LayoutResult {
  lines: LayoutLine[];
  /** 超出 maxLines 的行数；内容仍全部布局，不会静默截断。 */
  overflowLines: number;
  /** 超出行中的 Unicode code point 数量。 */
  overflowCharacters: number;
}

export interface TextPageRange {
  startOffset: number;
  endOffset: number;
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
  /** 是否应用自然书写；编辑预览与导出使用相同设置。 */
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
  const lineHeightPx = obj.style.fontSize * obj.style.lineHeight;
  const profileScale = opts.profile?.defaultRenderSettings.scale ?? 1;
  const variantsByChar = groupGlyphs(opts.profile);

  // 随机值使用原文 seed；自动换行/分页另以全局字符索引取样。
  const baseSeed =
    opts.exportSeed !== undefined
      ? (obj.naturalnessSeed ^ opts.exportSeed) >>> 0
      : obj.naturalnessSeed;
  const rand = seededRandom(baseSeed);

  // 第一遍：确定每个字符及无损原文边界，再按宽度分行。
  interface RawChar {
    ch: string;
    glyphKey: string | null;
    isGlyph: boolean;
    baseWidth: number;
    imgNatural?: { width: number; height: number };
    sourceIndex: number;
    sourceStart: number;
    sourceEnd: number;
  }
  const rawLines: { chars: RawChar[]; baseWidth: number; sourceIndex: number; sourceStart: number; sourceEnd: number }[] = [];
  let absIdx = 0;
  let sourceOffset = 0;
  const previousVariants = new Map<string, { id: string; count: number }>();
  const maxWidth = obj.autoWrap ? Math.max(1, obj.layoutWidth ?? 600) : Infinity;
  const continuousFlow = obj.autoWrap || (obj.naturalnessOffset ?? 0) > 0;
  const nextChar = (ch: string): RawChar => {
    const sourceStart = sourceOffset;
    sourceOffset += ch.length;
    const charIndex = absIdx++;
    if (ch === " ") {
      return { ch, glyphKey: null, isGlyph: false, baseWidth: obj.style.fontSize * 0.5,
        sourceIndex: charIndex, sourceStart, sourceEnd: sourceOffset };
    }
    const variants = variantsByChar.get(ch) ?? [];
    const seed = obj.naturalnessSeed + (obj.naturalnessOffset ?? 0) + charIndex;
    const mode = opts.profile?.defaultRenderSettings.preferredVariantMode;
    const previous = previousVariants.get(ch);
    // With only two samples, excluding every repeat would create a mechanical ABAB cycle.
    const avoidRepeat = variants.length > 2 || (previous?.count ?? 0) >= 2;
    const candidates = !continuousFlow && mode !== 'first' && mode !== 'weighted' && variants.length > 1 && avoidRepeat
      ? variants.filter(g => g.id !== previous?.id) : variants;
    const glyph = variants.length > 0 ? pickVariant(candidates, seed, mode) : null;
    if (glyph) {
      previousVariants.set(ch, { id: glyph.id, count: previous?.id === glyph.id ? previous.count + 1 : 1 });
      const glyphKey = `${opts.profile!.id}:${glyph.id}`;
      const img = opts.glyphSize(glyphKey);
      if (img) {
        return { ch, glyphKey, isGlyph: true,
          baseWidth: glyphDisplayWidth(img.naturalWidth, img.naturalHeight, obj.style.fontSize, profileScale),
          imgNatural: { width: img.naturalWidth, height: img.naturalHeight },
          sourceIndex: charIndex, sourceStart, sourceEnd: sourceOffset };
      }
    }
    // 缺字或图片仍在加载时使用 fallback 宽度，加载完成后会重新布局。
    return { ch, glyphKey: null, isGlyph: false,
      baseWidth: fontCharWidth(ch, obj.style.fontSize), sourceIndex: charIndex, sourceStart, sourceEnd: sourceOffset };
  };
  const widthOf = (chars: RawChar[]) => chars.reduce((width, rc, index) =>
    width + rc.baseWidth + (index > 0 ? opts.letterSpacing : 0), 0);
  const lines = obj.text.split("\n");
  for (const [lineIndex, line] of lines.entries()) {
    let chars: RawChar[] = [];
    let currentWidth = 0;
    const pushLine = () => {
      rawLines.push({ chars, baseWidth: Math.max(0, widthOf(chars)),
        sourceIndex: chars[0]?.sourceIndex ?? absIdx,
        sourceStart: chars[0]?.sourceStart ?? sourceOffset,
        sourceEnd: chars.at(-1)?.sourceEnd ?? sourceOffset });
    };
    for (const ch of line) {
      const rc = nextChar(ch);
      if (chars.length > 0 && rc.ch !== " " && currentWidth + opts.letterSpacing + rc.baseWidth > maxWidth) {
        pushLine();
        chars = [];
        currentWidth = 0;
      }
      currentWidth += (chars.length > 0 ? opts.letterSpacing : 0) + rc.baseWidth;
      chars.push(rc);
    }
    pushLine();
    if (lineIndex < lines.length - 1) sourceOffset++;
  }

  // 第二遍：按对齐 + jitter 生成最终 LayoutGlyph
  const resultLines: LayoutLine[] = [];
  const continuousJitter = obj.autoWrap || (obj.naturalnessOffset ?? 0) > 0;
  for (let li = 0; li < rawLines.length; li++) {
    const { chars, baseWidth, sourceIndex, sourceStart, sourceEnd } = rawLines[li];
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
      rowDy = continuousJitter
        ? (randomAt(baseSeed, (obj.naturalnessOffset ?? 0) + sourceIndex, 6) * 2 - 1) * opts.naturalness.baselineJitter
        : (rand() * 2 - 1) * opts.naturalness.baselineJitter;
    }

    const outGlyphs: LayoutGlyph[] = [];
    let drift = 0;
    let tilt = 0;
    for (const rc of chars) {
      if (rc.ch === " ") {
        const spaceJitter = opts.applyJitter
          ? (continuousJitter ? randomAt(baseSeed, (obj.naturalnessOffset ?? 0) + rc.sourceIndex, 5) * 2 - 1 : rand() * 2 - 1) * Math.min(rc.baseWidth * .15, opts.naturalness.positionJitter)
          : 0;
        x += rc.baseWidth + opts.letterSpacing + spaceJitter;
        continue;
      }
      // 逐字 jitter
      let jitterScale = 1;
      let jitterDx = 0;
      let jitterOpacity = obj.style.opacity;
      if (opts.applyJitter) {
        let r: number;
        if (continuousJitter) {
          const globalIndex = (obj.naturalnessOffset ?? 0) + rc.sourceIndex;
          const previousDrift = globalIndex > 0 ? randomAt(baseSeed, globalIndex - 1, 0) * 2 - 1 : 0;
          const previousTilt = globalIndex > 0 ? randomAt(baseSeed, globalIndex - 1, 1) * 2 - 1 : 0;
          drift = (.7 * previousDrift + .3 * (randomAt(baseSeed, globalIndex, 0) * 2 - 1)) * opts.naturalness.baselineJitter;
          tilt = (.65 * previousTilt + .35 * (randomAt(baseSeed, globalIndex, 1) * 2 - 1)) * opts.naturalness.rotationJitter;
          r = randomAt(baseSeed, globalIndex, 2);
        } else {
          drift = .7 * drift + .3 * (rand()*2-1) * opts.naturalness.baselineJitter;
          tilt = .65 * tilt + .35 * (rand()*2-1) * opts.naturalness.rotationJitter;
          r = rand();
        }
        if (opts.naturalness.fontSizeJitter > 0) {
          jitterScale *= 1 + (r * 2 - 1) * (opts.naturalness.fontSizeJitter / obj.style.fontSize);
        }
        if (opts.naturalness.positionJitter > 0) {
          jitterDx = ((continuousJitter ? randomAt(baseSeed, (obj.naturalnessOffset ?? 0) + rc.sourceIndex, 3) : rand()) * 2 - 1) * opts.naturalness.positionJitter;
        }
        if (opts.naturalness.opacityJitter > 0) {
          const opacityRandom = continuousJitter ? randomAt(baseSeed, (obj.naturalnessOffset ?? 0) + rc.sourceIndex, 4) : rand();
          jitterOpacity = clamp(
            jitterOpacity + (opacityRandom * 2 - 1) * opts.naturalness.opacityJitter,
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
          sourceIndex: rc.sourceIndex,
          x: x + jitterDx,
          y: y + rowDy + drift + (drawH < obj.style.fontSize ? (obj.style.fontSize - drawH) / 2 : 0),
          width: drawW,
          height: drawH,
          isGlyph: true,
          glyphKey: rc.glyphKey,
          fontSize: obj.style.fontSize * jitterScale,
          opacity: jitterOpacity,
          rotation: tilt,
        });
        x += drawW + opts.letterSpacing;
      } else {
        outGlyphs.push({
          ch: rc.ch,
          sourceIndex: rc.sourceIndex,
          x: x + jitterDx,
          y: y + rowDy + drift,
          width: rc.baseWidth * jitterScale,
          height: obj.style.fontSize,
          isGlyph: false,
          glyphKey: null,
          fontSize: obj.style.fontSize * jitterScale,
          opacity: jitterOpacity,
          rotation: tilt,
        });
        x += rc.baseWidth + opts.letterSpacing;
      }
    }
    resultLines.push({ glyphs: outGlyphs, baseWidth, sourceIndex, sourceStart, sourceEnd });
  }

  const overflow = obj.maxLines !== undefined ? resultLines.slice(obj.maxLines) : [];
  return {
    lines: resultLines,
    overflowLines: overflow.length,
    overflowCharacters: overflow.reduce((count, line) =>
      count + Array.from(obj.text.slice(line.sourceStart, line.sourceEnd)).length, 0),
  };
}

/** Split a fully laid-out text into explicit pages without dropping overflow. */
export function textPageRanges(layout: LayoutResult, maxLines: number): TextPageRange[] {
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new Error("每页行数必须是正整数");
  const ranges: TextPageRange[] = [];
  for (let start = 0; start < layout.lines.length; start += maxLines) {
    const pageLines = layout.lines.slice(start, start + maxLines);
    ranges.push({
      startOffset: pageLines[0].sourceStart,
      endOffset: pageLines[pageLines.length - 1].sourceEnd,
    });
  }
  return ranges;
}

function randomAt(seed: number, index: number, channel: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
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
  const variantsByChar = groupGlyphs(profile);
  for (const ch of new Set(obj.text)) {
    if (ch === " " || ch === "\n") continue;
    const variants = variantsByChar.get(ch) ?? [];
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
