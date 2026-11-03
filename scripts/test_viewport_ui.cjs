const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { canvasPoint } = require('./browser_canvas.cjs');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:5173');
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 3000;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 4000, 3000);
      ctx.fillStyle = 'black'; ctx.fillRect(1100, 1030, 200, 90); return canvas.toDataURL();
    });
    await page.locator('.upload-area input').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
    await page.getByText('4000×3000 · 0 字', { exact: true }).waitFor();
    const view = () => page.locator('.canvas-viewport').evaluate(node => ({
      width: node.clientWidth, height: node.clientHeight, x: Number(node.dataset.viewX), y: Number(node.dataset.viewY), scale: Number(node.dataset.viewScale),
      canvasWidth: node.querySelector('canvas').width, canvasHeight: node.querySelector('canvas').height,
    }));
    let fitted = await view();
    assert.ok(fitted.scale < 1 && fitted.scale > 0);
    assert.ok(fitted.x >= -1 && fitted.y >= -1);
    assert.ok(4000 * fitted.scale <= fitted.width + 1 && 3000 * fitted.scale <= fitted.height + 1);
    assert.equal(fitted.canvasWidth, fitted.width * 2); assert.equal(fitted.canvasHeight, fitted.height * 2);
    assert.ok(fitted.canvasWidth * fitted.canvasHeight < 12_000_000, 'retina edit canvas must be bounded by the viewport');
    await page.getByLabel('框选模式', { exact: true }).check();
    await page.mouse.move(...await canvasPoint(page, 1000, 1000)); await page.mouse.down();
    await page.mouse.move(...await canvasPoint(page, 1400, 1200), { steps: 12 }); await page.mouse.up();
    const requested = page.waitForRequest(request => request.url().endsWith('/clean-region'));
    await page.route('**/clean-region', route => route.fulfill({ json: { image: image.split(',')[1], mime: 'image/png', processed: 1, changed: true } }));
    await page.getByRole('button', { name: '预览清除 (1)', exact: true }).click();
    const region = (await requested).postDataJSON().regions[0];
    // Pointer events are quantized to screen pixels; allow one at each edge.
    const tolerance = Math.ceil(2 / fitted.scale);
    for (const [key, value] of Object.entries({ x: 1000, y: 1000, width: 400, height: 200 })) assert.ok(Math.abs(region[key] - value) <= tolerance, `${key}: ${region[key]}`);
    await page.getByRole('button', { name: '取消预览', exact: true }).click();
    await page.getByRole('button', { name: '100%', exact: true }).click();
    assert.equal((await view()).scale, 1);
    await page.getByRole('button', { name: '适合窗口', exact: true }).click();
    fitted = await view();
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForFunction(previous => Number(document.querySelector('.canvas-viewport').dataset.viewScale) < previous, fitted.scale);
    const resized = await view(); assert.ok(4000 * resized.scale <= resized.width + 1);
    await page.getByRole('button', { name: '100%', exact: true }).click();
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.waitForFunction(() => document.querySelector('.canvas-viewport').clientWidth > 700);
    assert.equal((await view()).scale, 1, 'manual zoom survives a window resize');
    await page.locator('.upload-area input').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
    await page.waitForFunction(() => Number(document.querySelector('.canvas-viewport').dataset.viewScale) < 1);
    assert.ok((await view()).scale < 1, 'replacing a same-sized photo resets the view to fit');
    await page.keyboard.down('Space');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('Space');
    assert.equal(await page.locator('.konvajs-content').evaluate(node => node.parentElement.style.cursor), 'crosshair');
    await page.getByRole('button', { name: '适合窗口', exact: true }).click();
    if (process.env.VIEWPORT_SCREENSHOT) await page.screenshot({ path: process.env.VIEWPORT_SCREENSHOT });
    assert.deepEqual(errors, []);
    console.log('PASS: 12 MP photo fits, bounded retina canvas, original-pixel selection coordinates, 100%/fit, resize and lost-space-key recovery');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
