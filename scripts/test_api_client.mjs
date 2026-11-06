import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
globalThis.window = { __API_BASE__: 'http://127.0.0.1:8001' };
const { getApiBase, normalizeApiBase, setApiBase } = await import('../apps/web/src/lib/apiClient.ts');

assert.equal(getApiBase(), 'http://127.0.0.1:8001');
setApiBase(' http://127.0.0.1:8011/// ');
assert.equal(getApiBase(), 'http://127.0.0.1:8011', 'saved desktop override wins over injected default');
assert.equal(normalizeApiBase('https://example.com/api/'), 'https://example.com/api');
for (const invalid of ['', 'javascript:alert(1)', 'ftp://example.com', 'http://user:pass@example.com', 'http://example.com/?x=1', 'http://example.com/#fragment']) {
  assert.throws(() => normalizeApiBase(invalid), undefined, `reject ${invalid || 'empty URL'}`);
}
values.set('hw:apiBase', 'javascript:alert(1)');
assert.equal(getApiBase(), 'http://127.0.0.1:8001', 'invalid legacy storage falls back to safe injected default');
console.log('PASS: API URL validation, desktop overrides and invalid legacy fallback');
