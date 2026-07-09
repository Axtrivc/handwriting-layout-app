import { useEffect, useState } from "react";
import { Image as KonvaImage, Text } from "react-konva";
import type Konva from "konva";
import { pickVariant, type HandwritingProfile } from "@hw-layout/shared";
import type { TextObject } from "@hw-layout/shared";

interface GlyphTextProps {
  obj: TextObject;
  /** 该对象使用的 profile（handwritingGlyph 模式下） */
  profile: HandwritingProfile | null;
  /** 预加载的 glyph 图片缓存：key = glyph.id -> HTMLImageElement */
  glyphImages: Map<string, HTMLImageElement>;
  /** 字距（px） */
  letterSpacing: number;
  /** 是否参与交互（导出时 false） */
  listening: boolean;
  /** 选中态需要的回调 */
  registerRef?: (node: Konva.Node | null) => void;
  onDragEnd?: (x: number, y: number) => void;
}

/**
 * 手写素材模式渲染：逐字查 glyph，有则用图片，无则 fallback 到字体。
 *
 * 布局：左对齐逐字横排，支持字距、行距、对齐（左对齐为主）。
 * 变体选择按 obj.naturalnessSeed 稳定 pickVariant。
 *
 * TODO: center / right 对齐的精确测量（当前仅左对齐逐字）。
 */
export function GlyphText({
  obj,
  profile,
  glyphImages,
  letterSpacing,
  listening,
  registerRef,
  onDragEnd,
}: GlyphTextProps) {
  const lines = obj.text.split("\n");
  const lineHeightPx = obj.style.fontSize * obj.style.lineHeight;

  // 渲染每个字
  const elements: React.ReactNode[] = [];
  let cursorX = obj.x;
  let cursorY = obj.y;

  let charIdx = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    cursorX = obj.x;
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      // 空格直接推进
      if (ch === " ") {
        cursorX += obj.style.fontSize * 0.5 + letterSpacing;
        charIdx++;
        continue;
      }
      const variants = profile?.glyphs.filter((g) => g.char === ch) ?? [];
      const glyph = variants.length > 0 ? pickVariant(variants, obj.naturalnessSeed + charIdx, profile?.defaultRenderSettings.preferredVariantMode) : null;

      if (glyph) {
        const img = glyphImages.get(glyph.id);
        if (img) {
          const scale = (obj.style.fontSize / Math.max(img.naturalHeight, 1)) * (profile?.defaultRenderSettings.scale ?? 1);
          const drawW = img.naturalWidth * scale;
          const drawH = img.naturalHeight * scale;
          elements.push(
            <KonvaImage
              key={`${obj.id}-g-${li}-${ci}`}
              image={img}
              x={cursorX}
              y={cursorY + (drawH < obj.style.fontSize ? (obj.style.fontSize - drawH) / 2 : 0)}
              width={drawW}
              height={drawH}
              opacity={obj.style.opacity}
              rotation={obj.style.rotation}
              listening={false}
            />,
          );
          cursorX += drawW + letterSpacing;
        } else {
          // 图片还在加载，先用占位宽度推进
          cursorX += obj.style.fontSize + letterSpacing;
        }
      } else {
        // fallback：用字体渲染该字符
        elements.push(
          <Text
            key={`${obj.id}-f-${li}-${ci}`}
            text={ch}
            x={cursorX}
            y={cursorY}
            rotation={obj.style.rotation}
            fontSize={obj.style.fontSize}
            fontStyle={`${obj.style.fontStyle} ${obj.style.fontWeight}`.trim()}
            fontFamily={obj.style.fontFamily}
            fill={obj.style.color}
            opacity={obj.style.opacity}
            listening={false}
          />,
        );
        cursorX += obj.style.fontSize * 0.6 + letterSpacing;
      }
      charIdx++;
    }
    cursorY += lineHeightPx;
  }

  // 一个不可见的占位 Text 用于拖拽/选中（参与交互）
  const placeholder = (
    <Text
      id={obj.id}
      text={obj.text}
      x={obj.x}
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
 * 只加载当前需要的 glyph（按 profile 的 glyphs）。
 */
export function useGlyphImages(profiles: HandwritingProfile[], activeProfileId: string | null): Map<string, HTMLImageElement> {
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
