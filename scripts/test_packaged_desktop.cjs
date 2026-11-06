// Requires pnpm package:dist (or package:desktop) on Windows.
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { _electron: electron } = require('playwright');

const executable = resolve(process.env.HW_PACKAGED_EXE || 'apps/desktop/release/win-unpacked/Handwriting Layout.exe');
const apiBase = 'http://127.0.0.1:8011';
const userData = mkdtempSync(join(tmpdir(), 'hw-desktop-test-'));

async function healthy(timeoutMs = 800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  assert.ok(existsSync(executable), `packaged executable exists: ${executable}`);
  assert.equal(await healthy(), false, 'test port must be free before launch');
  const app = await electron.launch({
    executablePath: executable,
    args: ['--no-sandbox'],
    env: { ...process.env, HW_API_BASE: apiBase, HW_USER_DATA_PATH: userData },
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: '保存', exact: true }).waitFor();
    const bridge = await page.evaluate(() => typeof window.__HW_DESKTOP__?.saveProject === 'function');
    assert.equal(bridge, true, 'packaged preload exposes only the native save bridge');
    assert.equal(await page.evaluate(() => location.origin), 'hw-app://app', 'production uses a non-opaque controlled origin');
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined', 'renderer has no Node require');

    const deadline = Date.now() + 25_000;
    while (!(await healthy()) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(await healthy(), true, 'packaged app starts its bundled API without Python on PATH');
    const rendererHealth = await page.evaluate(async () => {
      const response = await fetch(`${window.__API_BASE__}/health`);
      return response.json();
    });
    assert.equal(rendererHealth.status, 'ok', 'custom application origin is allowed by API CORS');
    const draft = await page.evaluate(async () => {
      const bridge = window.__HW_DESKTOP__;
      await bridge.writeDraft({ contents: '{"draft":true}' });
      const saved = await bridge.readDraft();
      await bridge.discardDraft();
      return { saved, discarded: await bridge.readDraft() };
    });
    assert.equal(draft.saved.contents, '{"draft":true}', 'native draft round-trip uses the isolated test profile');
    assert.ok(draft.saved.updatedAt);
    assert.equal(draft.discarded, null, 'discarded drafts are removed');
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await healthy(), false, 'closing the app stops the API it started');
  console.log('PASS: packaged Electron preload, bundled API startup, and shutdown cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
