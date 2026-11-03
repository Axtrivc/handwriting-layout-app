import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fitCanvas, zoomCanvas, type CanvasView, type ViewportSize } from './viewport.js';

/** Allocate canvases for the visible area, including for very large photographs. */
export function useCanvasViewport(width: number, height: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ViewportSize>({ width: 1, height: 1 });
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, scale: 1 });
  const autoFit = useRef(true);
  const priorSize = useRef(size);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => setSize(previous => {
      const next = { width: Math.max(1, node.clientWidth), height: Math.max(1, node.clientHeight) };
      return next.width === previous.width && next.height === previous.height ? previous : next;
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    autoFit.current = true;
    setView(fitCanvas({ width, height }, priorSize.current));
  }, [width, height]);

  useLayoutEffect(() => {
    const previous = priorSize.current;
    setView(current => autoFit.current ? fitCanvas({ width, height }, size) : ({ ...current,
      x: current.x + (size.width - previous.width) / 2, y: current.y + (size.height - previous.height) / 2 }));
    priorSize.current = size;
  }, [size, width, height]);

  const fit = useCallback(() => {
    autoFit.current = true;
    setView(fitCanvas({ width, height }, size));
  }, [width, height, size]);
  const zoom = (scale: number, anchor = { x: size.width / 2, y: size.height / 2 }) => {
    autoFit.current = false;
    setView(current => zoomCanvas(current, scale, anchor));
  };
  const pan = (x: number, y: number) => {
    autoFit.current = false;
    setView(current => ({ ...current, x, y }));
  };
  return { containerRef, size, view, fit, zoom, pan };
}
