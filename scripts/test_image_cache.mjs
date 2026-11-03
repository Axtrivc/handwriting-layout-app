import assert from 'node:assert/strict';
import { ImageCache } from '../apps/web/src/lib/imageCache.ts';
const pending = new Map(), calls = [];
let active = 0, maximum = 0;
const cache = new ImageCache(source => {
  calls.push(source); active++; maximum = Math.max(maximum, active);
  return new Promise((resolve, reject) => pending.set(source, {
    resolve: () => { active--; resolve({ source }); }, reject: () => { active--; reject(new Error('bad image')); },
  }));
}, 2);
const flush = () => new Promise(resolve => setImmediate(resolve));
const first = cache.load('one'), duplicate = cache.load('one');
assert.equal(first, duplicate, 'same source shares its in-flight decode');
const second = cache.load('two'), obsolete = cache.load('obsolete'), fourth = cache.load('four');
await flush(); assert.deepEqual(calls, ['one', 'two']);
cache.retain(new Set(['one', 'two', 'four']));
pending.get('one').resolve(); await flush();
assert.deepEqual(calls, ['one', 'two', 'four'], 'removed queued sources never decode');
assert.equal(await obsolete, null);
pending.get('two').resolve(); pending.get('four').resolve(); await Promise.all([first, second, fourth]);
assert.equal(maximum, 2);
const sources = new Map([['p:g1', 'one'], ['p:g2', 'one'], ['other:g3', 'four']]);
const snap = cache.snapshot(sources);
assert.equal(snap.get('p:g1'), snap.get('p:g2'), 'identical content is reused across glyph IDs');
await cache.load('one'); assert.equal(calls.filter(source => source === 'one').length, 1);
const bad = cache.load('bad'); await flush(); pending.get('bad').reject(); assert.equal(await bad, null);
const retry = cache.load('bad'); await flush(); pending.get('bad').resolve(); assert.ok(await retry);
const removed = cache.load('removed'); await flush(); cache.retain(new Set(['one'])); pending.get('removed').resolve();
assert.equal(await removed, null, 'evicted active load cannot repopulate cache');
assert.equal(cache.snapshot(new Map([['old', 'removed'], ['kept', 'one']])).size, 1);
assert.equal(cache.snapshot(new Map([['same-id', 'changed-source']])).size, 0, 'changed content must not reuse an old image by ID');
console.log('PASS: bounded decode concurrency, in-flight reuse, duplicate sources, queued/active eviction, retries and source replacement');
