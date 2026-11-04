import type { CanvasPage, TextObject, ScanTransform } from '@hw-layout/shared';

export function transformTexts(objects: TextObject[], page: Pick<CanvasPage, 'originalWidth' | 'originalHeight'>,
  transform?: ScanTransform, inverse = false): TextObject[] {
  if (!transform) return objects;
  const rotation = transform.rotation * (inverse ? -1 : 1);
  const scale = inverse ? 1 / transform.scale : transform.scale;
  const angle = rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const cx = page.originalWidth / 2, cy = page.originalHeight / 2;
  return objects.map(obj => ({ ...obj,
    x: cx + scale * (c * (obj.x - cx) - s * (obj.y - cy)),
    y: cy + scale * (s * (obj.x - cx) + c * (obj.y - cy)),
    style: { ...obj.style, rotation: obj.style.rotation + rotation, fontSize: obj.style.fontSize * scale,
      letterSpacing: obj.style.letterSpacing * scale, blur: obj.style.blur * scale },
  }));
}

export function colorSourceForPage(page: CanvasPage): string | undefined {
  return [...page.cleanHistory].reverse().find(entry => entry.scanColorSource)?.scanColorSource
    ?? page.cleanHistory.find(entry => entry.operation === 'scan')?.beforeImage;
}
