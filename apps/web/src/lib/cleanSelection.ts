import type { CleanupStroke } from '@hw-layout/shared';

/** Clip a possibly reversed/fractional selection to original image pixels. */
export function clipSelection(
  rect: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
) {
  if (![rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isFinite)) return null;
  const x = Math.max(0, Math.floor(Math.min(rect.x, rect.x + rect.width)));
  const y = Math.max(0, Math.floor(Math.min(rect.y, rect.y + rect.height)));
  const right = Math.min(width, Math.ceil(Math.max(rect.x, rect.x + rect.width)));
  const bottom = Math.min(height, Math.ceil(Math.max(rect.y, rect.y + rect.height)));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
export type CleanupTool = 'rectangle' | 'brush';
export interface SelectionStroke extends CleanupStroke { id: string }

export function clipStroke(stroke: CleanupStroke, width: number, height: number): CleanupStroke | null {
  if (!Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 512 ||
    stroke.points.length < 2 || stroke.points.length > 8192 || stroke.points.length % 2 || !stroke.points.every(Number.isFinite)) return null;
  return { width: stroke.width, points: stroke.points.map((value, index) => Math.max(0, Math.min(index % 2 ? height : width, value))) };
}
