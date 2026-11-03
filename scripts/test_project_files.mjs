import assert from 'node:assert/strict';
import { createEmptyProject, deserializeProject, serializeProject, DEFAULT_RENDER_SETTINGS, DEFAULT_TEXT_STYLE } from '../packages/shared/dist/index.js';
import { planGlyphBatch } from '../apps/web/src/lib/glyphBatch.ts';

const project = createEmptyProject();
project.pages[0].cleanHistory = [{ beforeImage: 'before', afterImage: 'after', regions: [], operation: 'clean', strokes: [{ points: [2.5, 3.25, 20, 30], width: 8 }] }];
project.pages[0].textObjects.push({ id: 'text', text: '保存测试', x: 10, y: 20, zIndex: 0, style: { ...DEFAULT_TEXT_STYLE }, naturalnessSeed: 42, renderMode: 'handwritingGlyph', handwritingProfileId: 'profile' });
project.handwritingProfiles.push({ id: 'profile', name: '笔迹', createdAt: 'now', updatedAt: 'now',
  sampleSets: [{ id: 'sample', profileId: 'profile', name: '样本', imageBase64: 'image', sourceImageWidth: 100, sourceImageHeight: 80, createdAt: 'now', status: 'imported' }],
  glyphs: [{ id: 'glyph', profileId: 'profile', char: '存', imageBase64: 'image', bbox: { x: 0, y: 0, width: 20, height: 30 }, sourceSampleSetId: 'sample', variantIndex: 2, createdAt: 'now', tags: ['常用'], qualityScore: 0.8 }],
  defaultRenderSettings: { ...DEFAULT_RENDER_SETTINGS },
});
const read = value => deserializeProject(JSON.stringify(value));
const result = deserializeProject(serializeProject(project));
assert.equal(result.ok, true);
assert.equal(result.migrated, false);
assert.deepEqual(JSON.parse(serializeProject(result.project)), JSON.parse(serializeProject(project)), 'all text, sample, glyph and settings content survives save/load');

const invalid = [
  [p => { p.pages = []; }, 'pages'],
  [p => { p.pages = null; p.width = 900; }, 'pages'],
  [p => { p.pages.push(null); }, 'pages[1]'],
  [p => { p.pages.push({ ...p.pages[0] }); }, '重复 ID'],
  [p => { p.pages[0].originalWidth = -10; }, 'originalWidth'],
  [p => { p.pages[0].originalHeight = 1.5; }, 'originalHeight'],
  [p => { p.pages[0].originalWidth = 16385; }, 'originalWidth'],
  [p => { p.pages[0].originalWidth = 9000; p.pages[0].originalHeight = 9000; }, '像素上限'],
  [p => { p.pages[0].textObjects.push(p.pages[0].textObjects[0]); }, '重复 ID'],
  [p => { p.pages[0].textObjects[0].style.fontSize = 0; }, 'fontSize'],
  [p => { p.pages[0].textObjects[0].style.opacity = 2; }, 'opacity'],
  [p => { p.pages[0].textObjects[0].x = Infinity; }, '.x'],
  [p => { p.pages[0].textObjects[0].style = null; }, 'style'],
  [p => { p.pages[0].textObjects[0].renderMode = 'unknown'; }, 'renderMode'],
  [p => { p.pages[0].textObjects = {}; }, 'textObjects'],
  [p => { p.handwritingProfiles[0].glyphs = [null]; }, 'glyphs[0]'],
  [p => { p.handwritingProfiles[0].glyphs[0].bbox.width = 0; }, 'bbox.width'],
  [p => { p.handwritingProfiles[0].glyphs[0].imageBase64 = ''; }, 'imageBase64'],
  [p => { p.handwritingProfiles[0].glyphs[0].tags = [0]; }, 'tags'],
  [p => { p.handwritingProfiles[0].sampleSets[0].sourceImageWidth = null; }, 'sourceImageWidth'],
  [p => { p.handwritingProfiles[0].sampleSets.push(p.handwritingProfiles[0].sampleSets[0]); }, '重复 ID'],
  [p => { p.handwritingProfiles[0].defaultRenderSettings.scale = 0; }, 'scale'],
  [p => { p.pages[0].cleanHistory = [{ beforeImage: 'a', afterImage: 'b', regions: [{ x: 0, y: 0, width: -1, height: 2 }] }]; }, 'regions[0].width'],
  [p => { p.pages[0].cleanHistory[0].strokes[0].points = [1, 2, 3]; }, '.points'],
  [p => { p.pages[0].cleanHistory[0].strokes[0].points = [1, -3]; }, '.points'],
  [p => { p.pages[0].cleanHistory[0].strokes[0].width = 0; }, '.width'],
  [p => { p.settings.naturalness.opacityJitter = -1; }, 'opacityJitter'],
];
for (const [mutate, path] of invalid) {
  const candidate = structuredClone(project); mutate(candidate);
  const invalidResult = read(candidate);
  assert.equal(invalidResult.ok, false, path);
  assert.ok(invalidResult.error.includes(path), `${path}: ${invalidResult.error}`);
  assert.equal(invalidResult.project, undefined, 'invalid imports never expose a partially repaired project');
}
for (const raw of ['[]', 'null', '{}', '{broken']) assert.equal(deserializeProject(raw).ok, false);
const legacy = read({ width: 400, height: 300, textObjects: [{ text: '旧版内容' }], naturalnessEnabled: true });
assert.equal(legacy.ok, true); assert.equal(legacy.migrated, true);
assert.equal(legacy.project.pages[0].textObjects[0].text, '旧版内容');
assert.equal(legacy.project.settings.naturalnessEnabled, true);
const defaults = read({ pages: [{}], handwritingProfiles: [{ name: '旧档案' }] });
assert.equal(defaults.ok, true);
assert.deepEqual(defaults.project.handwritingProfiles[0].glyphs, []);
assert.ok(defaults.project.pages[0].id);

const candidates = [2, 0, 1].map(n => ({ id: String(n), x: n * 20, y: 0, width: 15, height: 20, rowIndex: 0, orderIndex: n }));
const labels = new Map([['0', { char: '甲' }], ['2', { char: '丙' }]]);
const sparse = planGlyphBatch(candidates, labels, '');
assert.deepEqual(sparse.map(i => i.candidateId), ['0', '2']);
assert.deepEqual(sparse.map(i => i.char), ['甲', '丙']);
assert.deepEqual(planGlyphBatch(candidates, labels, '甲 丙'), sparse, 'blank slots must not consume neighboring candidates');
assert.deepEqual(planGlyphBatch(candidates, labels, '𠮷乙').map(i => i.char), ['𠮷', '乙']);
assert.deepEqual(candidates.map(c => c.id), ['2', '0', '1'], 'planning must not reorder live candidates');
console.log(`PASS: ${invalid.length + 4} invalid project cases, lossless roundtrip, legacy migration, defaults and sparse/Unicode glyph batches`);
