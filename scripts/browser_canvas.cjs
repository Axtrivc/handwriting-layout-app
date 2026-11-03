/** Map document pixels to the displayed canvas, including fit/zoom/pan. */
async function canvasPoint(page, x, y) {
  const viewport = page.locator('.canvas-viewport');
  await viewport.scrollIntoViewIfNeeded();
  return viewport.evaluate((node, point) => {
    const bounds = node.getBoundingClientRect();
    return [bounds.x + Number(node.dataset.viewX) + point.x * Number(node.dataset.viewScale),
      bounds.y + Number(node.dataset.viewY) + point.y * Number(node.dataset.viewScale)];
  }, { x, y });
}
module.exports = { canvasPoint };
