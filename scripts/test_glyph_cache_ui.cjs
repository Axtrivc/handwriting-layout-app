const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(() => {
      window.decodeCount = 0;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) { window.decodeCount++; descriptor.set.call(this, value); } });
    });
    await page.goto('http://localhost:5173');
    const project = await page.evaluate(async () => {
      const { createEmptyProject, DEFAULT_TEXT_STYLE, DEFAULT_RENDER_SETTINGS } = await import('/@fs/workspace/handwriting-layout-app/packages/shared/src/index.ts');
      const image = color => {
        const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 12;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 12, 12); return canvas.toDataURL();
      };
      const glyph = (id, char, color) => ({ id, char, imageBase64: image(color), sourceSampleSetId: 'sample', bbox: { x: 0, y: 0, width: 12, height: 12 }, variantIndex: 0, createdAt: 'now' });
      const makeProfile = (id, glyphs) => ({ id, name: id, createdAt: 'now', updatedAt: 'now', sampleSets: [], glyphs, defaultRenderSettings: { ...DEFAULT_RENDER_SETTINGS, preferredVariantMode: 'first' } });
      const project = createEmptyProject();
      project.handwritingProfiles = [
        makeProfile('p', [glyph('red', '甲', '#ff0000'), ...Array.from({ length: 100 }, (_, i) => glyph(`unused${i}`, String.fromCodePoint(0x4e00 + i), `rgb(${i},50,50)`))]),
        makeProfile('p:other', [glyph('green:one', '乙', '#00aa00')]),
      ];
      project.activeHandwritingProfileId = 'p';
      project.pages[0].originalWidth = 300; project.pages[0].originalHeight = 200;
      project.pages[0].textObjects = ['甲', '乙'].map((text, i) => ({ id: `t${i}`, text, x: 50 + i * 100, y: 50,
        zIndex: i, naturalnessSeed: 42, style: { ...DEFAULT_TEXT_STYLE, fontSize: 40 }, renderMode: 'handwritingGlyph', handwritingProfileId: i ? 'p:other' : null }));
      return project;
    });
    const chooser = page.waitForEvent('filechooser'); await page.getByTitle('加载项目 JSON').click();
    await (await chooser).setFiles({ name: 'glyphs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.getByRole('button', { name: '加载', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.canvas-viewport'); if (!viewport) return false;
      const canvas = viewport.querySelector('canvas'), scale = Number(viewport.dataset.viewScale);
      const ctx = canvas.getContext('2d'), ratio = canvas.width / canvas.clientWidth;
      const color = x => ctx.getImageData((Number(viewport.dataset.viewX) + x * scale) * ratio, (Number(viewport.dataset.viewY) + 70 * scale) * ratio, 1, 1).data;
      return color(70)[0] > 240 && color(70)[1] < 10 && color(170)[1] > 150 && color(170)[0] < 10;
    });
    await page.evaluate(() => { window.decodeCount = 0; });
    await page.locator('.hw-panel > details > summary').click();
    await page.getByTitle('重命名', { exact: true }).first().click();
    await page.locator('.hw-item input[type=text]').fill('renamed'); await page.locator('.hw-item input[type=text]').press('Enter');
    await page.locator('.text-list li').first().click();
    await page.getByPlaceholder('输入文本（支持换行）').fill('甲甲');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.decodeCount), 0, 'profile rename and reused characters must not decode the library again');
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
    const stream = await (await downloading).createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const png = Buffer.concat(chunks);
    const colors = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return [70, 110, 170].map(x => Array.from(ctx.getImageData(x, 70, 1, 1).data).slice(0, 3));
    }, png.toString('base64'));
    assert.deepEqual(colors, [[255, 0, 0], [255, 0, 0], [0, 170, 0]], 'editor and export include explicit non-active profiles, including colon IDs');
    assert.deepEqual(errors, []);
    console.log('PASS: no repeated decodes for a 102-glyph library after rename/text edits, explicit profile rendering and matching PNG pixels');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
