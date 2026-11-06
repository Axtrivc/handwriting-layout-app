const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { canvasPoint } = require('./browser_canvas.cjs');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(() => {
      const NativeReader = FileReader;
      window.heldReads = new Map();
      window.FileReader = class extends NativeReader {
        readAsDataURL(file) {
          if (file.name.startsWith('held-')) window.heldReads.set(file.name, () => super.readAsDataURL(file));
          else super.readAsDataURL(file);
        }
      };
    });
    const button = name => page.getByRole('button', { name, exact: true });
    const release = name => page.evaluate(name => { window.heldReads.get(name)(); window.heldReads.delete(name); }, name);
    const held = name => page.waitForFunction(name => window.heldReads.has(name), name);
    async function save() {
      const pending = page.waitForEvent('download'); await button('保存').click();
      const stream = await (await pending).createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString();
      const { deserializeProject } = await import('../packages/shared/dist/index.js');
      const result = deserializeProject(text); assert.equal(result.ok, true, result.error);
      return result.project;
    }
    async function load(project) {
      const pending = page.waitForEvent('filechooser'); await page.getByTitle('加载项目 JSON').click();
      await (await pending).setFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
      await button('加载').waitFor();
    }
    async function batch(files) {
      await button('📥 多图').click(); await page.locator('.page-panel input[type=file]').setInputFiles(files);
    }
    await page.goto('http://localhost:5173');
    const images = await page.evaluate(() => ['#f22', '#22f', '#2c2'].map(color => {
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 300, 200); return canvas.toDataURL();
    }));
    const file = (name, index = 0) => ({ name, mimeType: 'image/png', buffer: Buffer.from(images[index].split(',')[1], 'base64') });
    const corrupt = name => ({ name, mimeType: 'image/png', buffer: Buffer.from('invalid image') });
    const upload = source => page.locator('.upload-area input').setInputFiles(source);
    await upload(file('first.png')); await page.getByText('300×200 · 0 字', { exact: true }).waitFor();
    const original = await save();
    await batch([file('1.png'), corrupt('2.png')]);
    await page.getByText(/本批次未添加页面/).waitFor();
    assert.equal(await page.locator('.page-item').count(), 1);
    assert.equal(await page.locator('.dirty-dot').count(), 1, 'browser export keeps dirty and failed batch adds no new edits');
    assert.equal((await save()).pages[0].backgroundImage, original.pages[0].backgroundImage);
    await batch([file('held-10.png', 2), file('held-2.png', 1)]); await held('held-2.png');
    assert.ok(await button('导入中…').isDisabled());
    await button('+ 新页').click();
    await release('held-2.png'); await held('held-10.png'); await release('held-10.png');
    await page.waitForFunction(() => document.querySelectorAll('.page-item').length === 4);
    const imported = await save();
    assert.deepEqual(imported.pages.map(p => p.index), [0, 1, 2, 3]);
    assert.deepEqual(imported.pages.slice(2).map(p => p.name), ['held-2', 'held-10']);
    console.log('PASS: failed batch is atomic, import status, numeric filename ordering and indexes after concurrent page creation');

    await page.locator('.page-item').nth(0).click();
    await upload(file('held-old-page.png', 2)); await held('held-old-page.png');
    await page.locator('.page-item').nth(1).click(); await upload(file('new-page.png', 1));
    await page.locator('.page-item.is-active').getByText('300×200 · 0 字', { exact: true }).waitFor();
    await page.getByLabel('选区工具', { exact: true }).selectOption('brush');
    await page.mouse.move(...await canvasPoint(page, 50, 50)); await page.mouse.down();
    await page.mouse.move(...await canvasPoint(page, 100, 100), { steps: 5 }); await page.mouse.up();
    await button('预览清除 (1)').waitFor();
    await release('held-old-page.png');
    await page.waitForFunction(source => document.querySelector('.page-item__thumb img').getAttribute('src') === source, images[2]);
    assert.ok(await button('预览清除 (1)').isEnabled(), 'another page upload cannot clear current paint paths');
    const both = await save(); assert.equal(both.pages[0].backgroundImage, images[2]); assert.equal(both.pages[1].backgroundImage, images[1]);

    await upload(file('held-superseded.png', 2)); await held('held-superseded.png');
    await upload(file('latest.png', 0));
    await page.waitForFunction(source => document.querySelector('.page-item.is-active img').getAttribute('src') === source, images[0]);
    await release('held-superseded.png'); await page.waitForTimeout(100);
    assert.equal((await save()).pages[1].backgroundImage, images[0]);

    await upload(corrupt('held-failed-upload.png')); await held('held-failed-upload.png');
    await load(both); await release('held-failed-upload.png'); await page.waitForTimeout(100);
    assert.equal(await page.locator('.app__left .err-msg').count(), 0, 'old-document upload error must not leak');
    await batch([file('held-old-batch.png')]); await held('held-old-batch.png');
    await load(both);
    await batch([file('held-current-batch.png', 1)]); await held('held-current-batch.png');
    await release('held-old-batch.png'); await page.waitForTimeout(100);
    assert.ok(await button('导入中…').isDisabled(), 'old batch cannot clear the new batch busy state');
    assert.equal(await page.locator('.page-item').count(), 4);
    await release('held-current-batch.png');
    await page.waitForFunction(() => document.querySelectorAll('.page-item').length === 5);
    assert.equal((await save()).pages[4].name, 'held-current-batch');
    assert.deepEqual(errors, []);
    console.log('PASS: cross-page upload isolation, newest upload wins, stale failure suppression, old-document batch cancellation and independent new batch');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
