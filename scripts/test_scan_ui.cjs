// Requires Vite + API, Playwright and Chromium. Uses a phone-style EXIF JPEG,
// real scan/cleanup requests, and controlled delayed/wrong-orientation responses.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { canvasPoint } = require('./browser_canvas.cjs');
const fixture = execFileSync('services/api/.venv/bin/python', ['-c',
  'import sys; sys.path.insert(0,"services/api/scripts"); from test_document_scan import oriented_jpeg; sys.stdout.buffer.write(oriented_jpeg())']);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const button = name => page.getByRole('button', { name, exact: true });
    const activeBackground = () => page.locator('.page-item.is-active .page-item__thumb img').getAttribute('src');
    async function save() {
      const pending = page.waitForEvent('download'); await button('保存').click();
      const stream = await (await pending).createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString());
    }
    async function load(project) {
      const pending = page.waitForEvent('filechooser'); await page.getByTitle('加载项目 JSON').click();
      await (await pending).setFiles({ name: 'scan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
      await button('加载').waitFor();
    }
    async function select() {
      await page.getByLabel('框选模式', { exact: true }).check();
      await page.mouse.move(...await canvasPoint(page, 90, 90)); await page.mouse.down();
      await page.mouse.move(...await canvasPoint(page, 145, 165), { steps: 10 }); await page.mouse.up();
    }
    async function imageStats(source, before = null) {
      return page.evaluate(async ({ source, before }) => {
        const pixels = async src => {
          const image = new Image(); image.src = src; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
        };
        const { width, height, data } = await pixels(source);
        const prior = before ? (await pixels(before)).data : null;
        let binary = true, whiteSelection = true, changedOutside = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const selected = x >= 90 && x < 145 && y >= 90 && y < 165;
          const i = (y * width + x) * 4;
          if ((data[i] !== 0 && data[i] !== 255) || data[i] !== data[i + 1] || data[i] !== data[i + 2]) binary = false;
          if (selected && data[i] !== 255) whiteSelection = false;
          if (prior && !selected && [0, 1, 2, 3].some(c => prior[i + c] !== data[i + c])) changedOutside++;
        }
        return { width, height, binary, whiteSelection, changedOutside, corner: Array.from(data.slice((15 * width + 15) * 4, (15 * width + 15) * 4 + 3)) };
      }, { source, before });
    }
    async function scanPreview() {
      const pending = page.waitForResponse(response => response.url().endsWith('/prepare-scan'));
      await button('预览扫描').click();
      const response = await pending; assert.equal(response.status(), 200);
      await button('应用扫描').waitFor();
      return { body: await response.json(), request: response.request().postDataJSON() };
    }

    await page.goto('http://localhost:5173');
    await page.locator('.upload-area input').setInputFiles({ name: 'phone.jpg', mimeType: 'image/jpeg', buffer: fixture });
    await page.getByText('240×360 · 0 字', { exact: true }).waitFor();
    const initial = await save(); const original = initial.pages[0].backgroundImage;
    await select();
    const cleanPending = page.waitForResponse(response => response.url().endsWith('/clean-region'));
    await button('预览清除 (1)').click();
    const cleanResponse = await cleanPending; assert.equal(cleanResponse.status(), 200);
    await button('应用清除').waitFor();
    const rawClean = await cleanResponse.json();
    const rawStats = await imageStats(`data:${rawClean.mime};base64,${rawClean.image}`);
    assert.deepEqual([rawStats.width, rawStats.height], [240, 360]);
    assert.ok(rawStats.corner[0] > 180 && rawStats.corner[1] < 80, 'EXIF corner must remain at the displayed top-left');
    await button('查看原图').click(); await button('查看清除效果').click(); await button('取消预览').click();
    assert.equal(await activeBackground(), original);
    assert.equal(await page.locator('.dirty-dot').count(), 0, 'cleanup preview/cancel does not edit the project');
    await page.getByTitle('清空已框选区域').click();
    await page.getByLabel('框选模式', { exact: true }).uncheck();
    await button('+ 添加文本框').click();
    const withText = await save();

    await page.getByLabel('扫描模式', { exact: true }).selectOption('gray');
    const gray = await scanPreview();
    assert.equal(gray.request.mode, 'gray');
    assert.equal((await imageStats(`data:${gray.body.mime};base64,${gray.body.image}`)).binary, false);
    await button('查看原图').click(); await button('查看扫描效果').click(); await button('取消预览').click();
    assert.equal(await page.locator('.dirty-dot').count(), 0, 'scan preview/cancel does not edit the project');
    assert.equal(await activeBackground(), original);

    await page.getByLabel('扫描模式', { exact: true }).selectOption('bw');
    await page.getByLabel('黑白细节', { exact: true }).selectOption('faint');
    const scanned = await scanPreview();
    assert.deepEqual([scanned.request.mode, scanned.request.detail], ['bw', 'faint']);
    assert.deepEqual([scanned.body.width, scanned.body.height], [240, 360]);
    assert.equal((await imageStats(`data:${scanned.body.mime};base64,${scanned.body.image}`)).binary, true);
    await button('应用扫描').click();
    const scanProject = await save(); const scanPage = scanProject.pages[0];
    assert.equal(scanPage.cleanHistory.at(-1).operation, 'scan');
    assert.deepEqual(scanPage.textObjects, withText.pages[0].textObjects);
    await select();
    await button('预览清除 (1)').click(); await button('应用清除').click();
    const cleaned = await save();
    const stats = await imageStats(cleaned.pages[0].backgroundImage, scanPage.backgroundImage);
    assert.equal(stats.binary, true); assert.equal(stats.whiteSelection, true); assert.equal(stats.changedOutside, 0);
    assert.deepEqual(cleaned.pages[0].cleanHistory.map(entry => entry.operation), ['scan', 'clean']);
    await load(cleaned);
    await button('↶ 撤销清除').click(); await button('↶ 撤销扫描').waitFor();
    assert.equal(await activeBackground(), scanPage.backgroundImage);
    await button('↶ 撤销扫描').click(); await button('↶ 撤销扫描').waitFor({ state: 'detached' });
    await page.waitForFunction(source => document.querySelector('.page-item.is-active img')?.getAttribute('src') === source, original);
    assert.equal(await activeBackground(), original);
    assert.deepEqual((await save()).pages[0].textObjects, withText.pages[0].textObjects);
    console.log('PASS: EXIF upload/cleanup direction, gray/B&W preview/compare/cancel, clean white erase, exact exterior, save/load and two-step undo with text retained');

    const wrongImage = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 240; return canvas.toDataURL().split(',')[1]; });
    await page.route('**/prepare-scan', route => route.fulfill({ json: { image: wrongImage, mime: 'image/png', width: 360, height: 240 } }));
    await button('预览扫描').click(); await page.getByText(/处理结果方向或尺寸与画布不一致/).waitFor();
    assert.equal(await button('应用扫描').count(), 0); assert.equal(await activeBackground(), original);
    await page.unroute('**/prepare-scan');

    let release, calls = 0;
    const delay = new Promise(resolve => { release = resolve; });
    await page.route('**/prepare-scan', async route => {
      if (++calls === 1) { await delay; return route.fulfill({ status: 500, json: { detail: '旧页面延迟失败' } }); }
      return route.continue();
    });
    const pending = page.waitForRequest(request => request.url().endsWith('/prepare-scan'));
    await button('预览扫描').click(); await pending;
    const oldResponse = page.waitForEvent('requestfailed', request => request.url().endsWith('/prepare-scan'));
    await button('+ 新页').click();
    await page.locator('.upload-area input').setInputFiles({ name: 'new.jpg', mimeType: 'image/jpeg', buffer: fixture });
    await page.locator('.page-item.is-active').getByText('240×360 · 0 字', { exact: true }).waitFor();
    await scanPreview();
    release(); await oldResponse; await page.waitForTimeout(100);
    assert.equal(await page.locator('.app__left .err-msg').count(), 0, 'old error must not affect the new page');
    await button('应用扫描').click();
    const finalProject = await save();
    assert.equal(finalProject.pages[0].backgroundImage, original);
    assert.equal(finalProject.pages[0].cleanHistory.length, 0);
    assert.equal(finalProject.pages[1].cleanHistory.length, 1);
    await page.unroute('**/prepare-scan');
    for (const options of [{ mode: 'unknown' }, { detail: 'unknown' }, { image: 'broken' }]) {
      const response = await page.request.post('http://127.0.0.1:8001/prepare-scan', { data: { image: fixture.toString('base64'), mime: 'image/jpeg', ...options } });
      assert.equal(response.status(), options.image ? 400 : 422);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: wrong-dimension result rejected, new scan allowed during old request, stale failure isolation, invalid image/options rejected');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
