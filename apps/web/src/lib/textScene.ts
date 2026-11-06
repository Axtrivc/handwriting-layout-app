import type Konva from 'konva';
import { applyNaturalness, layoutText, type NaturalizedObject, type TextObject, type HandwritingProfile, type NaturalnessParams } from '@hw-layout/shared';

export type TextNode = { kind: 'text'; attrs: Konva.TextConfig } | { kind: 'image'; attrs: Konva.ImageConfig };
const ZERO_NATURALNESS = { positionJitter: 0, rotationJitter: 0, opacityJitter: 0, fontSizeJitter: 0, baselineJitter: 0 };

/** Shared scene description for the editor and every export format. No viewport state. */
export function textScene(obj: TextObject, profile: HandwritingProfile | null,
  images: Map<string, HTMLImageElement>, naturalness?: NaturalnessParams, exportSeed?: number) {
  const styled: NaturalizedObject = naturalness ? applyNaturalness(obj, naturalness, exportSeed) : obj;
  const transform = { x: styled.x, y: styled.y, rotation: styled.style.rotation };
  const nodes: TextNode[] = [];
  const font = { fontFamily: obj.style.fontFamily,
    fontStyle: `${obj.style.fontStyle} ${obj.style.fontWeight}`.trim(), fill: obj.style.color,
    shadowBlur: obj.style.blur * 2, shadowColor: obj.style.color, listening: false };
  if (obj.autoWrap || obj.renderMode === 'handwritingGlyph') {
    const layout = layoutText({ ...obj, x: 0, y: 0 }, {
      profile: obj.renderMode === 'handwritingGlyph' ? profile : null,
      glyphSize: key => images.get(key) ?? null, applyJitter: !!naturalness,
      naturalness: naturalness ?? ZERO_NATURALNESS,
      letterSpacing: obj.style.letterSpacing, exportSeed });
    for (const line of layout.lines) for (const glyph of line.glyphs) {
      const image = glyph.glyphKey ? images.get(glyph.glyphKey) : null;
      const position = { x: glyph.x, y: glyph.y, rotation: glyph.rotation, opacity: glyph.opacity, listening: false };
      if (image) nodes.push({ kind: 'image', attrs: { ...position, image, width: glyph.width,
        height: glyph.height, shadowBlur: obj.style.blur * 2, shadowColor: obj.style.color } });
      else nodes.push({ kind: 'text', attrs: { ...font, ...position, text: glyph.ch, fontSize: glyph.fontSize } });
    }
    // 自动换行由 layout 统一处理自然化，避免对象级与逐字偏移重复叠加。
    return { transform: obj.autoWrap ? { x: obj.x, y: obj.y, rotation: obj.style.rotation } : transform, nodes };
  }

  const lines = obj.text.split('\n');
  const width = Math.max(40, Math.max(...lines.map(line => line.length)) * styled.style.fontSize * 1.2);
  const common = { ...font, width, fontSize: styled.style.fontSize, align: obj.style.align,
    letterSpacing: obj.style.letterSpacing, lineHeight: obj.style.lineHeight, opacity: styled.style.opacity };
  const offsets = styled.lineOffsets;
  if (offsets) lines.forEach((text, i) => nodes.push({ kind: 'text', attrs: { ...common, text,
    y: i * styled.style.fontSize * obj.style.lineHeight + offsets[i] } }));
  else nodes.push({ kind: 'text', attrs: { ...common, text: obj.text } });
  return { transform, nodes };
}
