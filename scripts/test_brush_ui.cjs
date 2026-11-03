const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { canvasPoint } = require('./browser_canvas.cjs');
const fixture = execFileSync('services/api/.venv/bin/python', ['-c',
  'import sys; sys.path.insert(0,"services/api/scripts"); from test_brush_cleanup import brush_fixture; brush_fixture().save(sys.stdout.buffer,format="PNG")']);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const button = name => page.getByRole('button', { name, exact: true });
    async function save() {
      const pending = page.waitForEvent('download'); await button('保存').click();
      const stream = await (await pending).createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString());
    }
    async function stroke(x1, y1, x2, y2) {
      await page.mouse.move(...await canvasPoint(page, x1, y1)); await page.mouse.down();
      await page.mouse.move(...await canvasPoint(page, x2, y2), { steps: 15 }); await page.mouse.up();
    }
    await page.goto('http://localhost:5173');
    await page.locator('.upload-area input').setInputFiles({ name: 'brush.png', mimeType: 'image/png', buffer: fixture });
    await page.getByText('300×200 · 0 字', { exact: true }).waitFor();
    const original = (await save()).pages[0].backgroundImage;
    await page.getByLabel('选区工具', { exact: true }).selectOption('brush');
    assert.ok(await page.getByLabel('画笔模式', { exact: true }).isChecked());
    await page.getByLabel('画笔粗细', { exact: true }).fill('12');
    await page.getByRole('button', { name: '放大画布', exact: true }).click();
    await stroke(50, 40, 180, 150);
    await stroke(20, 175, 25, 180);
    await button('预览清除 (2)').waitFor(); await button('撤销上一笔选区').click();
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    await page.route('**/clean-region', async route => { await delayed; await route.continue(); });
    const started = page.waitForRequest(request => request.url().endsWith('/clean-region'));
    await button('预览清除 (1)').click(); await started;
    const aborted = page.waitForEvent('requestfailed', request => request.url().endsWith('/clean-region'));
    await button('取消处理').click(); release(); await aborted;
    await page.unroute('**/clean-region');
    assert.equal(await page.locator('.app__left .err-msg').count(), 0);
    assert.equal(await page.locator('.dirty-dot').count(), 0);
    assert.equal(await button('预览清除 (1)').isEnabled(), true, 'cancel retains paths and allows immediate retry');
    const responsePending = page.waitForResponse(response => response.url().endsWith('/clean-region'));
    await button('预览清除 (1)').click();
    const response = await responsePending; assert.equal(response.status(), 200);
    const request = response.request().postDataJSON();
    assert.equal(request.regions.length, 0); assert.equal(request.strokes.length, 1); assert.equal(request.strokes[0].width, 12);
    const points = request.strokes[0].points;
    for (const [actual, expected] of [[points[0], 50], [points[1], 40], [points.at(-2), 180], [points.at(-1), 150]]) assert.ok(Math.abs(actual - expected) < 2);
    await button('查看原图').click(); await button('查看清除效果').click(); await button('取消预览').click();
    assert.equal(await page.locator('.dirty-dot').count(), 0, 'drawing/preview does not edit the saved image');
    await button('预览清除 (1)').click(); await button('应用清除').click();
    const applied = await save();
    assert.equal(applied.pages[0].cleanHistory.at(-1).strokes.length, 1);
    const pixels = await page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { erased: ctx.getImageData(109, 90, 1, 1).data[0], print: ctx.getImageData(140, 60, 1, 1).data[0], other: ctx.getImageData(20, 175, 1, 1).data[0] };
    }, applied.pages[0].backgroundImage);
    assert.deepEqual(pixels, { erased: 255, print: 0, other: 0 });
    await button('↶ 撤销清除').click(); await button('↶ 撤销清除').waitFor({ state: 'detached' });
    await page.waitForFunction(source => document.querySelector('.page-item.is-active img')?.getAttribute('src') === source, original);
    assert.equal((await save()).pages[0].backgroundImage, original);
    await page.mouse.click(...await canvasPoint(page, -20, -20));
    assert.ok(await button('预览清除 (0)').isDisabled(), 'clicking outside the paper must not paint onto its edge');
    // A click forms a round dot, clearing selection removes it without changing the page.
    await page.mouse.click(...await canvasPoint(page, 20, 175));
    await button('预览清除 (1)').waitFor(); await page.getByTitle('清空已框选区域').click();
    assert.ok(await button('预览清除 (0)').isDisabled());
    await stroke(50, 40, 180, 150); await button('+ 新页').click();
    assert.ok(await button('预览清除 (0)').isDisabled(), 'page change clears paint paths');
    for (const invalid of [{ points: [0, 1, 2], width: 4 }, { points: [0, 1], width: 0 }, { points: [-1, 2], width: 4 }]) {
      const bad = await page.request.post('http://127.0.0.1:8001/clean-region', { data: { image: fixture.toString('base64'), regions: [], strokes: [invalid] } });
      assert.equal(bad.status(), 422);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: zoomed brush coordinates, last-stroke undo, request cancellation/retry, preview/cancel/apply, print inside bounds preserved, history undo, dots, page isolation and invalid path rejection');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
