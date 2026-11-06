const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    let acceptDialogs = true;
    page.on('dialog', dialog => acceptDialogs ? dialog.accept() : dialog.dismiss());
    await page.addInitScript(() => {
      window.__draftWriteCount = 0;
      window.__draftDiscardCount = 0;
      window.__HW_DESKTOP__ = {
        saveProject: async () => ({ status: 'saved', path: 'D:/test/project.json' }),
        writeDraft: async ({ contents }) => {
          localStorage.setItem('__testDraft', JSON.stringify({ contents, updatedAt: '2026-11-06T02:00:00Z' }));
          window.__draftWriteCount++;
          return { status: 'saved', updatedAt: '2026-11-06T02:00:00Z' };
        },
        readDraft: async () => JSON.parse(localStorage.getItem('__testDraft') || 'null'),
        discardDraft: async () => {
          localStorage.removeItem('__testDraft');
          window.__draftDiscardCount++;
        },
      };
    });
    await page.goto('http://localhost:5173');
    await page.getByRole('button', { name: '+ 添加文本框', exact: true }).click();
    await page.waitForFunction(() => window.__draftWriteCount >= 1 && localStorage.getItem('__testDraft'));
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('__testDraft')).contents);
    assert.equal(JSON.parse(draft).pages[0].textObjects.length, 1);

    await page.reload();
    await page.locator('.text-list li').first().click();
    assert.equal(await page.getByLabel('文字内容').inputValue(), '双击编辑文本');
    assert.equal(await page.locator('.dirty-dot').count(), 1, 'restored draft remains explicitly unsaved');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => window.__draftDiscardCount === 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('__testDraft')), null, 'formal save discards its matching draft');
    assert.equal(await page.locator('.dirty-dot').count(), 0);

    await page.evaluate(contents => localStorage.setItem('__testDraft', JSON.stringify({ contents, updatedAt: '2026-11-06T02:00:00Z' })), draft);
    acceptDialogs = false;
    await page.reload();
    await page.waitForFunction(() => window.__draftDiscardCount === 1);
    assert.equal(await page.locator('.text-list li').count(), 1, 'declining restore preserves the current document');
    assert.equal(await page.evaluate(() => localStorage.getItem('__testDraft')), null, 'declined draft is explicitly discarded');
    console.log('PASS: debounced draft, dirty restore, formal-save cleanup and explicit discard');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
