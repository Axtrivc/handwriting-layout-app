// Run against Vite. API responses are controlled here to reproduce failure/race paths.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const { createEmptyProject, DEFAULT_RENDER_SETTINGS } = await import('../packages/shared/dist/index.js');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let acceptDialog = true;
    page.on('dialog', dialog => acceptDialog ? dialog.accept() : dialog.dismiss());
    let detectMode = 'ok', releaseDetect, detectPending;
    let segmentCalls = 0, failAt = -1;
    let image;
    const candidates = [2, 0, 1].map(n => ({ x: 10 + 60 * n, y: 10, width: 35, height: 40, rowIndex: 0, orderIndex: n, score: 1 }));
    await page.route('http://127.0.0.1:8001/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const json = body => route.fulfill({ json: body });
      if (path === '/health') return json({ status: 'ok', version: 'test' });
      if (path === '/ocr/status') return json({ status: 'ok', provider: 'test', candidates: [] });
      if (path === '/detect-glyph-candidates') {
        const mode = detectMode;
        if (mode === 'delay') { detectPending(); await new Promise(resolve => { releaseDetect = resolve; }); }
        if (mode !== 'ok') return route.fulfill({ status: 500, json: { detail: '检测失败测试' } });
        return json({ candidates });
      }
      if (path === '/suggest-glyph-labels') {
        const sent = route.request().postDataJSON().candidates;
        assert.deepEqual(sent.map(c => c.x), [10, 70, 130], 'OCR request must use the same order as label mapping');
        return json({ status: 'ok', provider: 'test', candidates: sent.map((c, i) => ({ text: ['甲', '乙', '丙'][i], confidence: 0.95, provider: 'test', ...c })) });
      }
      if (path === '/segment-glyph') {
        segmentCalls++;
        if (segmentCalls === failAt) return route.fulfill({ status: 500, json: { detail: '裁剪失败测试' } });
        return json({ image: image.split(',')[1], mime: 'image/png', width: 200, height: 80 });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    await page.goto('http://localhost:5173');
    image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 80; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 200, 80); ctx.fillStyle = 'black'; ctx.fillText('test', 10, 30); return canvas.toDataURL(); });
    const fixture = createEmptyProject(); fixture.name = '导入测试';
    fixture.handwritingProfiles = [{ id: 'p', name: '测试笔迹', createdAt: 'now', updatedAt: 'now', glyphs: [], defaultRenderSettings: DEFAULT_RENDER_SETTINGS,
      sampleSets: ['a', 'b'].map(id => ({ id, name: id, profileId: 'p', imageBase64: image, sourceImageWidth: 200, sourceImageHeight: 80, createdAt: 'now', status: 'imported' })) }];
    async function load(data) {
      const choose = page.waitForEvent('filechooser');
      await page.getByTitle('加载项目 JSON').click();
      await (await choose).setFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.getByRole('button', { name: '加载', exact: true }).waitFor();
    }
    async function save() {
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: '保存', exact: true }).click();
      const stream = await (await download).createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString());
    }
    await page.getByRole('button', { name: '+ 添加文本框', exact: true }).click();
    await load({ pages: [null] });
    await page.getByText(/加载失败.*pages\[0\]/).waitFor();
    assert.equal(await page.locator('.text-list li').count(), 1);
    assert.equal(await page.locator('.dirty-dot').count(), 1);
    const corrupt = structuredClone(fixture); corrupt.pages[0].backgroundImage = 'data:image/png;base64,broken';
    await load(corrupt); await page.getByText(/背景.*无法读取/).waitFor();
    assert.equal(await page.locator('.text-list li').count(), 1);
    const corruptHistory = structuredClone(fixture);
    corruptHistory.pages[0].cleanHistory = [{ beforeImage: 'data:image/png;base64,broken', afterImage: image, regions: [] }];
    await load(corruptHistory); await page.getByText(/清除历史原图.*无法读取/).waitFor();
    assert.equal(await page.locator('.text-list li').count(), 1);
    const oversized = await page.evaluate(async () => {
      const { loadImage } = await import('/src/lib/image.ts');
      const canvas = document.createElement('canvas'); canvas.width = 16385; canvas.height = 1;
      try { await loadImage(canvas.toDataURL()); return null; } catch (error) { return error.message; }
    });
    assert.match(oversized, /图片尺寸超过/);
    acceptDialog = false; await load(fixture);
    assert.equal(await page.locator('.text-list li').count(), 1, 'declining replacement retains edits');
    const chooser = page.waitForEvent('filechooser'); await page.getByTitle('加载项目 JSON').click(); await chooser;
    await page.locator('input[accept="application/json,.json"]').dispatchEvent('cancel');
    await page.getByRole('button', { name: '加载', exact: true }).waitFor();
    acceptDialog = true; await load(fixture);
    assert.equal(await page.locator('.dirty-dot').count(), 0);
    assert.equal((await save()).name, '导入测试');
    console.log('PASS: invalid structure/image, declined replacement and cancelled picker retain the document; valid import/save succeeds');

    await page.locator('.hw-panel > details > summary').click(); await page.locator('.hw-item__name').click();
    const open = index => page.getByRole('button', { name: '切割字形', exact: true }).nth(index).click();
    const detect = () => page.getByRole('button', { name: '🔍 自动检测字形区域', exact: true }).click();
    const count = n => page.waitForFunction(n => document.querySelectorAll('.cand-chip').length === n, n);
    const label = async (index, text) => { await page.locator('.cand-chip').nth(index).locator('span').first().click(); await page.getByPlaceholder('输入字符').fill(text); };
    const batch = () => page.getByRole('button', { name: '批量保存（用上方文本或各候选标签）', exact: true }).click();
    await open(0); await detect(); await count(3);
    await label(0, '甲乙'); await page.getByRole('button', { name: '保存选中 (Enter)', exact: true }).click();
    await page.locator('.seg-modal .err-msg').waitFor();
    assert.equal(await page.locator('.cand-chip').count(), 3, 'multiple code points must not consume a candidate');
    assert.equal(await page.getByPlaceholder('输入字符').inputValue(), '甲乙');
    assert.equal(segmentCalls, 0, 'invalid glyph labels must not reach the crop API');
    await label(0, '甲'); failAt = 1;
    await page.getByRole('button', { name: '保存选中 (Enter)', exact: true }).click();
    await page.locator('.seg-modal .err-msg').waitFor();
    assert.equal(await page.locator('.cand-chip').count(), 3);
    assert.equal(await page.getByPlaceholder('输入字符').inputValue(), '甲');
    await page.getByRole('button', { name: '保存选中 (Enter)', exact: true }).click(); await count(2);
    await label(1, '丙'); await batch(); await count(1);
    assert.match(await page.locator('.cand-chip').innerText(), /1/);
    assert.equal(await page.locator('.seg-glyph-cell').count(), 2, 'sparse batch keeps the unlabeled middle candidate');

    await detect(); await count(3); await label(0, '甲');
    detectMode = 'fail'; await detect(); await page.locator('.seg-modal .err-msg').waitFor();
    assert.equal(await page.locator('.cand-chip').count(), 3);
    assert.equal(await page.getByPlaceholder('输入字符').inputValue(), '甲', 'detect failure must preserve labels');
    await label(2, '丙'); failAt = segmentCalls + 2; await batch();
    await page.locator('.seg-modal .err-msg').waitFor();
    assert.equal(await page.locator('.cand-chip').count(), 3);
    assert.equal(await page.locator('.seg-glyph-cell').count(), 2, 'partial batch request failure must not commit partial content');
    await batch(); await count(1); assert.equal(await page.locator('.seg-glyph-cell').count(), 4);
    detectMode = 'ok'; await detect(); await count(3);
    await page.getByRole('button', { name: '🔤 OCR 辅助识别', exact: true }).click();
    await page.getByRole('button', { name: '✅ 应用高置信度建议', exact: true }).click();
    const chips = await page.locator('.cand-chip').allTextContents();
    assert.match(chips[0], /0:甲/); assert.match(chips[1], /1:乙/); assert.match(chips[2], /2:丙/);

    detectMode = 'delay'; const pending = new Promise(resolve => { detectPending = resolve; });
    await detect(); await pending;
    await page.getByRole('button', { name: '✕ 关闭 (Esc)', exact: true }).click();
    await open(1); detectMode = 'ok'; await detect(); await count(3);
    const finished = page.waitForResponse(response => response.url().endsWith('/detect-glyph-candidates') && response.status() === 500);
    releaseDetect(); await finished; await page.waitForTimeout(100);
    assert.equal(await page.locator('.seg-modal .err-msg').count(), 0, 'old session failure must not change new session errors');
    assert.equal(await page.locator('.cand-chip').count(), 3);
    const canvasBox = await page.locator('.seg-canvas-area canvas').first().boundingBox();
    await page.mouse.move(canvasBox.x + 20, canvasBox.y + 25); await page.mouse.down();
    await page.mouse.move(canvasBox.x - 10, canvasBox.y - 10, { steps: 10 }); await page.mouse.up();
    await label(0, '移'); await page.getByRole('button', { name: '保存选中 (Enter)', exact: true }).click(); await count(2);
    await page.getByRole('button', { name: '✕ 关闭 (Esc)', exact: true }).click();
    const saved = await save(); assert.equal(saved.handwritingProfiles[0].glyphs.length, 5);
    assert.deepEqual(saved.handwritingProfiles[0].glyphs.find(g => g.char === '移').bbox, { x: 0, y: 0, width: 35, height: 40 }, 'dragged candidates remain within the source image');
    assert.deepEqual(saved.handwritingProfiles[0].glyphs.filter(g => g.char === '甲').map(g => g.variantIndex), [0, 1]);
    assert.deepEqual(errors, []);
    console.log('PASS: single/batch failure retry, sparse labels, atomic batch, OCR ordering, stale session isolation, clipped dragging and saved glyph variants');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
