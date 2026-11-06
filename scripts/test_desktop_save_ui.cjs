// Run against Vite. The desktop bridge is mocked to verify its renderer-side contract.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const state = { calls: [], behavior: 'canceled', resolve: null };
      window.__saveTest = state;
      window.__HW_DESKTOP__ = {
        saveProject(payload) {
          state.calls.push(payload);
          if (state.behavior === 'error') return Promise.reject(new Error('模拟写盘失败'));
          if (state.behavior === 'delay') {
            return new Promise(resolve => { state.resolve = () => resolve({ status: 'saved', path: 'D:/test/project.json' }); });
          }
          return Promise.resolve({ status: state.behavior, path: 'D:/test/project.json' });
        },
      };
    });
    await page.goto('http://localhost:5173');
    const addText = () => page.getByRole('button', { name: '+ 添加文本框', exact: true }).click();
    const save = () => page.getByRole('button', { name: '保存', exact: true }).click();
    const dirty = () => page.locator('.dirty-dot').count();

    await addText();
    assert.equal(await dirty(), 1);
    await save();
    await page.waitForFunction(() => window.__saveTest.calls.length === 1);
    assert.equal(await dirty(), 1, 'canceling the native dialog must retain dirty state');

    await page.evaluate(() => { window.__saveTest.behavior = 'saved'; });
    await save();
    await page.waitForFunction(() => window.__saveTest.calls.length === 2);
    await page.waitForFunction(() => document.querySelectorAll('.dirty-dot').length === 0);
    const saved = await page.evaluate(() => JSON.parse(window.__saveTest.calls[1].contents));
    assert.equal(saved.pages[0].textObjects.length, 1, 'native save receives the serialized project');

    await addText();
    await page.evaluate(() => { window.__saveTest.behavior = 'delay'; });
    await save();
    await page.waitForFunction(() => window.__saveTest.calls.length === 3);
    await addText();
    await page.evaluate(() => window.__saveTest.resolve());
    await page.waitForTimeout(100);
    assert.equal(await dirty(), 1, 'edits made while saving must remain dirty');

    await page.evaluate(() => { window.__saveTest.behavior = 'error'; });
    await save();
    await page.waitForFunction(() => window.__saveTest.calls.length === 4);
    await page.getByText(/保存失败.*模拟写盘失败/).waitFor();
    assert.equal(await dirty(), 1, 'write failure must retain dirty state');
    assert.deepEqual(errors, []);
    await page.close();

    const browserPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await browserPage.goto('http://localhost:5173');
    await browserPage.getByRole('button', { name: '+ 添加文本框', exact: true }).click();
    const pending = browserPage.waitForEvent('download');
    await browserPage.getByRole('button', { name: '保存', exact: true }).click();
    await pending;
    assert.equal(await browserPage.locator('.dirty-dot').count(), 1,
      'browser download without a durable write acknowledgement must not clear dirty state');
    await browserPage.getByText(/浏览器无法确认写入/).waitFor();
    console.log('PASS: native cancel/success/failure, edits during save, and browser download dirty-state contracts');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
