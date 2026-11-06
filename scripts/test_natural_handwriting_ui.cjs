const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { canvasPoint } = require('./browser_canvas.cjs');
const path = require('node:path');
const sharedUrl = `/@fs/${path.resolve('packages/shared/src/index.ts').replace(/\\/g, '/').replace(/^\/+/, '')}`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const button = name => page.getByRole('button', { name, exact: true });
    async function download(name) {
      const pending = page.waitForEvent('download');
      await button(name).click();
      const stream = await (await pending).createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    }
    async function load(project) {
      const chooser = page.waitForEvent('filechooser');
      await page.getByTitle('加载项目 JSON').click();
      await (await chooser).setFiles({ name: 'natural.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
      await button('加载').waitFor();
    }
    const save = async () => {
      const text = (await download('保存')).toString();
      const { deserializeProject } = await import('../packages/shared/dist/index.js');
      return deserializeProject(text).project;
    };
    await page.goto('http://localhost:5173');
    const project = await page.evaluate(async sharedUrl => {
      const { createEmptyProject, DEFAULT_TEXT_STYLE, DEFAULT_RENDER_SETTINGS } = await import(sharedUrl);
      const project = createEmptyProject();
      const glyphs = Array.from({ length: 4 }, (_, i) => {
        const canvas = document.createElement('canvas');
        canvas.width = 26; canvas.height = 30;
        const context = canvas.getContext('2d');
        context.strokeStyle = '#184e48'; context.lineWidth = 2;
        context.beginPath(); context.moveTo(3, 6 + i); context.lineTo(22, 6); context.lineTo(9 + i, 25); context.stroke();
        return { id: `g${i}`, char: '文', imageBase64: canvas.toDataURL(), sourceSampleSetId: 'sample', bbox: { x: 0, y: 0, width: 26, height: 30 }, variantIndex: i, createdAt: 'now' };
      });
      project.handwritingProfiles = [{ id: 'p', name: 'Personal samples', createdAt: 'now', updatedAt: 'now', sampleSets: [], glyphs, defaultRenderSettings: DEFAULT_RENDER_SETTINGS }];
      project.activeHandwritingProfileId = 'p';
      project.settings.naturalnessEnabled = true;
      project.settings.naturalness = { positionJitter: 2, rotationJitter: 3, opacityJitter: .06, fontSizeJitter: 1, baselineJitter: 2 };
      Object.assign(project.pages[0], { originalWidth: 500, originalHeight: 350,
        textObjects: [{ id: 't', text: '文文文 文文文', x: 80, y: 80, zIndex: 0, naturalnessSeed: 42,
          style: { ...DEFAULT_TEXT_STYLE, fontSize: 40 }, renderMode: 'handwritingGlyph', handwritingProfileId: 'p' }] });
      return project;
    }, sharedUrl);
    await load(project);
    await button('100%').click();
    const first = await download('导出 PNG');
    assert.deepEqual(await download('导出 PNG'), first, 'naturalized export must be deterministic');
    const difference = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const target = document.createElement('canvas'); target.width = 500; target.height = 350;
      const context = target.getContext('2d'); context.drawImage(image, 0, 0);
      const exported = context.getImageData(0, 0, 500, 350).data;
      const viewport = document.querySelector('.canvas-viewport'); const editor = viewport.querySelector('canvas');
      const ratio = editor.width / editor.clientWidth;
      context.clearRect(0, 0, 500, 350);
      context.drawImage(editor, Number(viewport.dataset.viewX) * ratio, Number(viewport.dataset.viewY) * ratio, 500 * ratio, 350 * ratio, 0, 0, 500, 350);
      const preview = context.getImageData(0, 0, 500, 350).data;
      let total = 0, previewInk = 0, exportInk = 0;
      for (let i = 0; i < exported.length; i += 4) {
        total += Math.abs(exported[i] - preview[i]);
        if (exported[i] < 210) exportInk++;
        if (preview[i] < 210) previewInk++;
      }
      return { mean: total / (500 * 350), previewInk, exportInk };
    }, first.toString('base64'));
    assert.ok(difference.exportInk > 500 && difference.previewInk > 500, JSON.stringify(difference));
    assert.ok(difference.mean < 1, `editor and export disagree: ${JSON.stringify(difference)}`);
    let current = project.pages[0].textObjects[0];
    for (let i = 0; i < 2; i++) {
      const point = await canvasPoint(page, current.x + 12, current.y + 14);
      await page.mouse.move(...point); await page.mouse.down();
      await page.mouse.move(point[0] + 30, point[1] + 20, { steps: 10 }); await page.mouse.up();
      const next = (await save()).pages[0].textObjects[0];
      assert.ok(Math.abs(next.x - current.x - 30) < .01 && Math.abs(next.y - current.y - 20) < .01,
        'drag must not accumulate naturalness offsets');
      current = next;
    }
    const finalProject = await save(), finalPng = await download('导出 PNG');
    await load(finalProject);
    assert.deepEqual(await download('导出 PNG'), finalPng, 'save/reload must preserve naturalized output');
    assert.deepEqual(errors, []);
    console.log('PASS: personal glyph naturalness matches editor/export, repeat export and reload are stable, repeated dragging does not accumulate offsets');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
