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

function colorSourceFromHistory(history: CanvasPage['cleanHistory']): string | null {
  return [...history].reverse().find(entry => entry.scanColorSource)?.scanColorSource
    ?? history.find(entry => entry.operation === 'scan')?.beforeImage
    ?? null;
}

export function colorSourceForPage(page: CanvasPage): string | undefined {
  if (page.colorSource !== undefined) return page.colorSource ?? undefined;
  return colorSourceFromHistory(page.cleanHistory) ?? undefined;
}

/** Store the current color source independently of the bounded visual undo stack. */
export function colorSourceAfterOperation(page: CanvasPage, operation: 'clean' | 'scan',
  beforeImage: string, correctedColor?: string): string | null {
  const current = colorSourceForPage(page) ?? null;
  return correctedColor ?? (operation === 'scan' ? current ?? beforeImage : current);
}

/** New entries restore their exact prior value; old entries derive it from remaining history. */
export function colorSourceAfterUndo(page: CanvasPage): string | null {
  const last = page.cleanHistory.at(-1);
  if (last?.beforeColorSource !== undefined) return last.beforeColorSource;
  return colorSourceFromHistory(page.cleanHistory.slice(0, -1));
}
