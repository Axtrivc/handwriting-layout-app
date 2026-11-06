// Requires Vite + API. Exercises real photo detection/cropping, downloads and print layout.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const python = process.platform === 'win32' ? 'services/api/.venv/Scripts/python.exe' : 'services/api/.venv/bin/python';
const fixture = execFileSync(python, ['-c', 'import sys; sys.path.insert(0,"services/api/scripts"); from test_photo_detect import photo_fixture; photo_fixture().save(sys.stdout.buffer,format="PNG")']);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const requests = [];
    page.on('request', request => {
      if (request.method() === 'POST' && /\/(detect-glyph-candidates|segment-glyph)$/.test(request.url())) requests.push({ url: request.url(), data: request.postDataJSON() });
    });
    async function download(name) {
      const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
      const stream = await (await pending).createReadStream(); const chunks = []; for await (const c of stream) chunks.push(c);
      return Buffer.concat(chunks).toString();
    }
    await page.goto('http://localhost:5173');
    await page.getByRole('button', { name: '+ 添加文本框', exact: true }).click();
    await page.locator('.hw-panel > details > summary').click();
    await page.getByPlaceholder('新档案名称（如：我的笔迹）').fill('测试<档案>');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page.locator('.hw-item__name').click();
    await page.locator('.sample-sheet summary').click();
    assert.ok(await page.getByRole('button', { name: '下载采样页', exact: true }).isDisabled());
    await page.getByLabel('待采样文字', { exact: true }).fill('甲甲 乙\n𠮷');
    assert.equal(await download('下载标注顺序'), '甲乙𠮷');
    const html = await download('下载采样页');
    const preview = await browser.newPage(); await preview.setContent(html);
    assert.equal(await preview.locator('h1').innerText(), '测试<档案> · 手写采样');
    assert.equal(await preview.locator('.cell').count(), 3);
    assert.deepEqual(await preview.locator('.cell').allTextContents(), ['', '', '']);
    await page.getByRole('button', { name: /^基础字帖/ }).click();
    const basicLabels=(await download('下载标注顺序')).replaceAll('\n','');
    assert.equal([...basicLabels].filter(c=>c==='0').length,5);
    assert.equal([...basicLabels].filter(c=>c==='A').length,3);
    assert.equal(new Set([...basicLabels].filter(c=>/\p{Script=Han}/u.test(c))).size,300);
    await preview.setContent(await download('下载采样页'));
    assert.equal(await preview.locator('.cell').count(),[...basicLabels].length);
    const basicPdf=await preview.pdf({preferCSSPageSize:true});
    assert.equal((basicPdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,Math.ceil([...basicLabels].length/48));
    await page.getByRole('button', { name: /^进阶字帖/ }).click();
    const advancedLabels=(await download('下载标注顺序')).replaceAll('\n','');
    assert.equal(new Set([...advancedLabels].filter(c=>/\p{Script=Han}/u.test(c))).size,2500);
    assert.equal([...advancedLabels].filter(c=>c==='A').length,5);
    await page.getByRole('button', { name: '起步 500 字', exact: true }).click();
    await preview.setContent(await download('下载采样页'));
    assert.equal(await preview.locator('.page').count(), 11);
    const pdf = await preview.pdf({ preferCSSPageSize: true });
    assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length, 11, 'A4 pages must not split overflowing writing grids');
    await preview.close();
    await page.getByRole('button', { name: '常用 2500 字', exact: true }).click();
    assert.equal(Array.from((await download('下载标注顺序')).replaceAll('\n', '')).length, 2500);
    await page.getByRole('button', { name: '使用项目文字', exact: true }).click();
    assert.equal(await page.getByLabel('待采样文字', { exact: true }).inputValue(), '双击编辑文本');

    await page.locator('.hw-import input').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: fixture });
    await page.getByRole('button', { name: '切割字形', exact: true }).click();
    const detect = () => page.getByRole('button', { name: '🔍 自动检测字形区域', exact: true }).click();
    const count = n => page.waitForFunction(n => document.querySelectorAll('.cand-chip').length === n, n);
    await detect(); await count(2);
    await page.getByLabel('拍照模式（检测并去除纸面阴影）', { exact: true }).check();
    await detect(); await count(8);
    assert.deepEqual(requests.filter(r => r.url.endsWith('/detect-glyph-candidates')).map(r => r.data.thresholdMode), ['fixed', 'adaptive']);
    await page.locator('.cand-chip').first().locator('span').first().click();
    await page.getByPlaceholder('输入字符').fill('甲');
    await page.getByRole('button', { name: '保存选中 (Enter)', exact: true }).click(); await count(7);
    assert.equal(requests.filter(r => r.url.endsWith('/segment-glyph')).at(-1).data.backgroundMode, 'adaptive');
    const alpha = await page.locator('.seg-glyph-cell img').evaluate(async img => {
      await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const values = Array.from(data).filter((_, i) => i % 4 === 3); return { clear: values.filter(v => v === 0).length, ink: values.filter(v => v > 100).length, total: values.length };
    });
    assert.ok(alpha.clear > alpha.total / 2 && alpha.ink > 0, 'saved photo glyph must contain ink on transparent paper');
    await page.getByPlaceholder('如：的一是在不了有').fill('乙丙');
    await page.getByRole('button', { name: '批量保存（用上方文本或各候选标签）', exact: true }).click(); await count(5);
    assert.ok(requests.filter(r => r.url.endsWith('/segment-glyph')).every(r => r.data.backgroundMode === 'adaptive'));
    await page.getByRole('button', { name: '✕ 关闭 (Esc)', exact: true }).click();
    await page.getByLabel('待采样文字', { exact: true }).fill('甲乙丁丁𠮷');
    assert.equal(await download('下载标注顺序'), '丁𠮷', 'sampling excludes glyphs saved in the current profile');
    await page.getByLabel('仅补采当前档案缺字', { exact: true }).uncheck();
    assert.equal(await download('下载标注顺序'), '甲乙丁𠮷');

    const saved = JSON.parse(await download('保存'));
    assert.equal(saved.handwritingProfiles[0].glyphs.length, 3);
    const bad = await page.request.post('http://127.0.0.1:8001/detect-glyph-candidates', { data: { image: fixture.toString('base64'), mime: 'image/png', thresholdMode: 'unknown' } });
    assert.equal(bad.status(), 422);
    const badCrop = await page.request.post('http://127.0.0.1:8001/segment-glyph', { data: { image: fixture.toString('base64'), bbox: { x: 10, y: 10, width: 30, height: 30 }, backgroundMode: 'unknown' } });
    assert.equal(badCrop.status(), 422);
    assert.deepEqual(errors, []);
    console.log('PASS: photo detection 2 -> 8, single/batch photo extraction, missing-character sampling, Unicode downloads, 11 A4 print pages and invalid-mode API rejection');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
