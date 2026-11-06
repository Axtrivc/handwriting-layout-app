import assert from 'node:assert/strict';
import {
  createEmptyProject,
  DEFAULT_RENDER_SETTINGS,
  deserializeProject,
  serializeProject,
} from '../packages/shared/dist/index.js';

const imageA = `data:image/png;base64,${'A'.repeat(20_000)}`;
const imageB = `data:image/jpeg;base64,${'B'.repeat(10_000)}`;
const project = createEmptyProject();
const page = project.pages[0];
page.backgroundImage = imageA;
page.colorSource = imageA;
for (let index = 0; index < 20; index++) {
  page.cleanHistory.push({
    operation: index === 0 ? 'scan' : 'clean',
    beforeImage: index === 0 ? imageA : imageB,
    afterImage: index % 2 ? imageA : imageB,
    beforeColorSource: index === 0 ? null : imageA,
    scanColorSource: index === 0 ? imageA : undefined,
    regions: [],
  });
}
project.handwritingProfiles = [{
  id: 'p', name: 'p', createdAt: 'now', updatedAt: 'now', defaultRenderSettings: DEFAULT_RENDER_SETTINGS,
  sampleSets: [{ id: 's', profileId: 'p', name: 's', imageBase64: imageA, sourceImageWidth: 20, sourceImageHeight: 20, createdAt: 'now', status: 'imported' }],
  glyphs: [{ id: 'g', profileId: 'p', char: '我', imageBase64: imageA, bbox: { x: 0, y: 0, width: 20, height: 20 }, sourceSampleSetId: 's', variantIndex: 0, createdAt: 'now' }],
}];

const packed = serializeProject(project);
const envelope = JSON.parse(packed);
assert.equal(envelope.assets.length, 2, 'identical image payloads are stored once');
assert.equal(packed.split(imageA).length - 1, 1, 'large repeated payload appears only in the asset table');
assert.ok(packed.length < JSON.stringify(project).length / 3, 'asset packing materially reduces project size');
assert.equal(page.backgroundImage, imageA, 'serialization does not mutate the live project');

const loaded = deserializeProject(packed);
assert.equal(loaded.ok, true, loaded.error);
const restored = loaded.project.pages[0];
assert.equal(restored.backgroundImage, imageA);
assert.equal(restored.colorSource, imageA);
assert.equal(restored.cleanHistory.length, 20);
assert.ok(restored.cleanHistory.every((entry, index) => entry.beforeColorSource === (index === 0 ? null : imageA)));
assert.equal(loaded.project.handwritingProfiles[0].sampleSets[0].imageBase64, imageA);
assert.equal(loaded.project.handwritingProfiles[0].glyphs[0].imageBase64, imageA);

for (const invalid of [
  { ...envelope, pages: [{ ...envelope.pages[0], backgroundImage: 'hw-asset:999' }, ...envelope.pages.slice(1)] },
  { ...envelope, assets: { 0: imageA } },
  { ...envelope, assets: [imageA, null] },
]) {
  assert.equal(deserializeProject(JSON.stringify(invalid)).ok, false, 'invalid asset references are rejected');
}
console.log('PASS: project asset deduplication, lossless restore, size reduction and invalid reference rejection');
