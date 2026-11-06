const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:5173');
    await page.getByRole('button', { name: '+ 添加文本框', exact: true }).click();
    const source = '一二三四五六七八九十';
    await page.getByLabel('文字内容').fill(source);
    await page.getByLabel('自动换行').check();
    await page.getByLabel('文本宽度（px）').fill('100');
    await page.getByText(/当前共 4 行/).waitFor();
    await page.getByLabel('最大行数（空为不限）').fill('2');
    await page.getByText(/超出 2 行 \/ 4 字/).waitFor();
    await page.getByRole('button', { name: '按最大行数分页', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.page-item').length === 2);
    assert.equal(await page.locator('.page-item').count(), 2, 'one additional page is created');
    await page.locator('.page-item').nth(1).focus();
    await page.keyboard.press('Enter');
    assert.match(await page.locator('.page-item').nth(1).getAttribute('class'), /is-active/, 'page selection works from the keyboard');

    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const stream = await (await pending).createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const saved = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(saved.pages.map(item => item.textObjects[0].text), ['一二三四五六', '七八九十']);
    assert.deepEqual(saved.pages.map(item => item.textObjects[0].naturalnessOffset ?? 0), [0, 6]);
    assert.ok(saved.pages.every(item => item.textObjects[0].autoWrap && item.textObjects[0].layoutWidth === 100));
    assert.equal(saved.pages.flatMap(item => item.textObjects).map(item => item.text).join(''), source);
    assert.deepEqual(errors, []);
    console.log('PASS: automatic wrapping, overflow warning, explicit pagination, offsets and project round-trip');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
