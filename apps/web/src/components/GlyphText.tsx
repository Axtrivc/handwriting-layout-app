import { useEffect, useState } from "react";
import { Image as KonvaImage, Text } from "react-konva";
import type Konva from "konva";
import {
  pickVariant,
  type HandwritingProfile,
  type NaturalnessParams,
} from "@hw-layout/shared";
import type { TextObject } from "@hw-layout/shared";

interface GlyphTextProps {
  obj: TextObject;
  profile: HandwritingProfile | null;
  glyphImages: Map<string, HTMLImageElement>;
  letterSpacing: number;
  listening: boolean;
  registerRef?: (node: Konva.Node | null) => void;
  onDragEnd?: (x: number, y: number) => void;
  /** 导出/渲染时的自然化参数（null = 编辑态，不应用抖动） */
  naturalness?: NaturalnessParams | null;
  /** 是否应用逐行 baseline jitter（导出态） */
  applyBaselineJitter?: boolean;
}

/** 单个 glyph 在某字号下的渲染宽度。 */
function glyphWidth(
  img: HTMLImageElement,
  fontSize: number,
  scaleMul: number,
): number {
  const scale = (fontSize / Math.max(1, img.naturalHeight)) * scaleMul;
  return img.naturalWidth * scale;
}

/** fallback 字体字符宽度（粗略估算）。 */
function fontCharWidth(ch: string, fontSize: number): number {
  // CJK / 全角约 1.0，半角约 0.6
  const code = ch.codePointAt(0) ?? 0;
  const isFull = code > 0x2e7f || (code >= 0x3000 && code <= 0x9fff);
  return fontSize * (isFull ? 1.0 : 0.6);
}

interface LayoutChar {
  ch: string;
  glyphId: string | null; // null = fallback 字体
  img: HTMLImageElement | null;
  w: number;
}

/**
 * 手写素材模式渲染：逐字查 glyph，有则用图片，无则 fallback 字体。
 *
 * 对齐：先计算每行总宽度，再按 align（left/center/right）计算行起始 x。
 * 自然度：导出态按 naturalness seed 稳定应用 scale/baseline/opacity/blur 抖动。
 */
export function GlyphText({
  obj,
  profile,
  glyphImages,
  letterSpacing,
  listening,
  registerRef,
  onDragEnd,
  naturalness = null,
  applyBaselineJitter = false,
}: GlyphTextProps) {
  const lines = obj.text.split("\n");
  const lineHeightPx = obj.style.fontSize * obj.style.lineHeight;
  const scaleMul = profile?.defaultRenderSettings.scale ?? 1;

  // 第一遍：按行布局，算每字宽度与行总宽
  const layoutLines: { chars: LayoutChar[]; totalWidth: number }[] = [];
  let charIdx = 0;
  for (const line of lines) {
    const chars: LayoutChar[] = [];
    let totalWidth = 0;
    for (const ch of line) {
      if (ch === " ") {
        const w = obj.style.fontSize * 0.5;
        chars.push({ ch, glyphId: null, img: null, w });
        totalWidth += w + letterSpacing;
        charIdx++;
        continue;
      }
      const variants = profile?.glyphs.filter((g) => g.char === ch) ?? [];
      const seed = obj.naturalnessSeed + charIdx;
      const glyph =
        variants.length > 0
          ? pickVariant(
              variants,
              seed,
              profile?.defaultRenderSettings.preferredVariantMode,
            )
          : null;
      if (glyph) {
        const img = glyphImages.get(glyph.id) ?? null;
        const w = img ? glyphWidth(img, obj.style.fontSize, scaleMul) : obj.style.fontSize;
        chars.push({ ch, glyphId: glyph.id, img, w });
        totalWidth += w + letterSpacing;
      } else {
        const w = fontCharWidth(ch, obj.style.fontSize);
        chars.push({ ch, glyphId: null, img: null, w });
        totalWidth += w + letterSpacing;
      }
      charIdx++;
    }
    // 减去末尾多余的字距
    if (chars.length > 0) totalWidth -= letterSpacing;
    layoutLines.push({ chars, totalWidth: Math.max(0, totalWidth) });
  }

  // 第二遍：按对齐渲染
  const elements: React.ReactNode[] = [];
  let absoluteIdx = 0;
  for (let li = 0; li < layoutLines.length; li++) {
    const { chars, totalWidth } = layoutLines[li];
    let x: number;
    if (obj.style.align === "center") {
      x = obj.x - totalWidth / 2;
    } else if (obj.style.align === "right") {
      x = obj.x - totalWidth;
    } else {
      x = obj.x;
    }
    const y = obj.y + li * lineHeightPx;

    // 逐行 baseline jitter（导出态）
    let rowDy = 0;
    if (applyBaselineJitter && naturalness && naturalness.baselineJitter > 0) {
      const r = seededRand(obj.naturalnessSeed ^ (li * 2654435761));
      rowDy = (r() * 2 - 1) * naturalness.baselineJitter;
    }

    for (const lc of chars) {
      if (lc.ch === " ") {
        x += lc.w + letterSpacing;
        absoluteIdx++;
        continue;
      }
      // 逐字自然化抖动（导出态）
      let jitterScale = 1;
      let jitterOpacity = obj.style.opacity;
      if (naturalness) {
        const r = seededRand(obj.naturalnessSeed ^ (absoluteIdx * 40503));
        if (naturalness.fontSizeJitter > 0) {
          jitterScale *= 1 + (r() * 2 - 1) * (naturalness.fontSizeJitter / obj.style.fontSize);
        }
        if (naturalness.opacityJitter > 0) {
          jitterOpacity = clamp(
            jitterOpacity + (r() * 2 - 1) * naturalness.opacityJitter,
            0.1,
            1,
          );
        }
      }

      if (lc.img) {
        const baseScale =
          (obj.style.fontSize / Math.max(1, lc.img.naturalHeight)) * scaleMul;
        const s = baseScale * jitterScale;
        const drawW = lc.img.naturalWidth * s;
        const drawH = lc.img.naturalHeight * s;
        elements.push(
          <KonvaImage
            key={`${obj.id}-g-${li}-${absoluteIdx}`}
            image={lc.img}
            x={x}
            y={y + rowDy + (drawH < obj.style.fontSize ? (obj.style.fontSize - drawH) / 2 : 0)}
            width={drawW}
            height={drawH}
            opacity={jitterOpacity}
            rotation={obj.style.rotation}
            // 轻微 blur（用 shadow 模拟，Konva Image 支持 filters 但需独立 buffer，这里用 shadowBlur 近似）
            shadowBlur={
              obj.style.blur > 0 ? obj.style.blur * 2 : 0
            }
            shadowColor={obj.style.color}
            listening={false}
          />,
        );
        x += drawW + letterSpacing;
      } else {
        elements.push(
          <Text
            key={`${obj.id}-f-${li}-${absoluteIdx}`}
            text={lc.ch}
            x={x}
            y={y + rowDy}
            rotation={obj.style.rotation}
            fontSize={obj.style.fontSize * jitterScale}
            fontStyle={`${obj.style.fontStyle} ${obj.style.fontWeight}`.trim()}
            fontFamily={obj.style.fontFamily}
            fill={obj.style.color}
            opacity={jitterOpacity}
            listening={false}
          />,
        );
        x += lc.w + letterSpacing;
      }
      absoluteIdx++;
    }
  }

  // 不可见占位：用于拖拽/选中/对齐锚点（覆盖首行宽度估算）
  const approxMaxWidth = layoutLines.reduce((m, l) => Math.max(m, l.totalWidth), 0);
  const placeholder = (
    <Text
      id={obj.id}
      text={obj.text}
      x={obj.x - (obj.style.align === "center" ? approxMaxWidth / 2 : obj.style.align === "right" ? approxMaxWidth : 0)}
      y={obj.y}
      rotation={obj.style.rotation}
      fontSize={obj.style.fontSize}
      lineHeight={obj.style.lineHeight}
      opacity={0}
      draggable={listening}
      listening={listening}
      ref={(node) => registerRef?.(node)}
      onDragEnd={(e) => onDragEnd?.(e.target.x(), e.target.y())}
    />
  );

  return (
    <>
      {elements}
      {placeholder}
    </>
  );
}

/**
 * Hook：预加载一组 glyph 的 HTMLImageElement，返回 id->img 映射。
 */
export function useGlyphImages(
  profiles: HandwritingProfile[],
  activeProfileId: string | null,
): Map<string, HTMLImageElement> {
  const [cache, setCache] = useState<Map<string, HTMLImageElement>>(new Map());

  const profile = profiles.find((p) => p.id === activeProfileId) ?? null;
  const glyphs = profile?.glyphs ?? [];

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, HTMLImageElement>();
    let pending = 0;
    const done = () => {
      if (!cancelled && pending === 0) setCache(next);
    };

    for (const g of glyphs) {
      if (cache.has(g.id)) {
        next.set(g.id, cache.get(g.id)!);
      } else {
        pending++;
        const img = new Image();
        img.onload = () => {
          next.set(g.id, img);
          pending--;
          done();
        };
        img.onerror = () => {
          pending--;
          done();
        };
        img.src = g.imageBase64;
      }
    }
    if (pending === 0) setCache(next);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId, profiles]);

  return cache;
}

// ===== 工具函数 =====

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 确定性伪随机（与 shared/naturalness 保持一致，独立实现避免循环依赖）。 */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
