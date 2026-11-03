/** View transforms never change document pixels or stored selection coordinates. */
export interface ViewportSize { width: number; height: number }
export interface CanvasView { x: number; y: number; scale: number }
export const MIN_VIEW_SCALE = 0.01;
export const MAX_VIEW_SCALE = 8;

export function fitCanvas(page: ViewportSize, viewport: ViewportSize): CanvasView {
  const scale = Math.min(1, viewport.width / page.width, viewport.height / page.height);
  return { scale, x: (viewport.width - page.width * scale) / 2, y: (viewport.height - page.height * scale) / 2 };
}

/** Keep the image point under an anchor fixed while zooming. */
export function zoomCanvas(view: CanvasView, scale: number, anchor: { x: number; y: number }): CanvasView {
  const next = Math.max(MIN_VIEW_SCALE, Math.min(MAX_VIEW_SCALE, scale));
  return { scale: next, x: anchor.x - (anchor.x - view.x) * next / view.scale,
    y: anchor.y - (anchor.y - view.y) * next / view.scale };
}

export function canvasPoint(view: CanvasView, point: { x: number; y: number }) {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}
