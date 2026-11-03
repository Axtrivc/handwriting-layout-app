import assert from 'node:assert/strict';
import { fitCanvas, zoomCanvas, canvasPoint } from '../apps/web/src/lib/viewport.ts';
for (const page of [{ width: 4000, height: 3000 }, { width: 80, height: 120 }, { width: 16384, height: 1 }]) {
  const area = { width: 720, height: 480 };
  const view = fitCanvas(page, area);
  assert.ok(view.scale > 0 && view.scale <= 1);
  assert.ok(page.width * view.scale <= area.width && page.height * view.scale <= area.height);
  assert.deepEqual(canvasPoint(view, { x: area.width / 2, y: area.height / 2 }), { x: page.width / 2, y: page.height / 2 });
  const anchor = { x: 167, y: 204 };
  const zoomed = zoomCanvas(view, view.scale * 2, anchor);
  const before = canvasPoint(view, anchor), after = canvasPoint(zoomed, anchor);
  assert.ok(Math.abs(before.x - after.x) < 1e-8 && Math.abs(before.y - after.y) < 1e-8);
}
assert.equal(zoomCanvas({ x: 0, y: 0, scale: 1 }, 1000, { x: 0, y: 0 }).scale, 8);
assert.equal(zoomCanvas({ x: 0, y: 0, scale: 1 }, 0, { x: 0, y: 0 }).scale, 0.01);
console.log('PASS: large/small/thin page fit, centered coordinates, pointer-anchored zoom and limits');
