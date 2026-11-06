import assert from 'node:assert/strict';
import {
  DEFAULT_NATURALNESS,
  DEFAULT_TEXT_STYLE,
  layoutText,
  textPageRanges,
} from '../packages/shared/dist/index.js';

function object(text, patch = {}) {
  return {
    id: 'flow', text, x: 0, y: 0,
    style: { ...DEFAULT_TEXT_STYLE, fontSize: 20, letterSpacing: 0, lineHeight: 1.2 },
    zIndex: 0, naturalnessSeed: 42, renderMode: 'font', handwritingProfileId: null,
    ...patch,
  };
}
function options(overrides = {}) {
  return {
    glyphSize: () => null, profile: null, applyJitter: false,
    naturalness: DEFAULT_NATURALNESS, letterSpacing: 0, ...overrides,
  };
}
function pageText(layout, text, maxLines) {
  return textPageRanges(layout, maxLines).map(range => ({
    ...range, text: text.slice(range.startOffset, range.endOffset),
  }));
}

const cjk = object('一二三四五六七八', { autoWrap: true, layoutWidth: 100 });
const cjkLayout = layoutText(cjk, options());
assert.equal(cjkLayout.lines.length, 2);
assert.deepEqual(cjkLayout.lines.map(line => line.glyphs.length), [5, 3]);
assert.deepEqual(cjkLayout.lines.map(line => [line.sourceStart, line.sourceEnd]), [[0, 5], [5, 8]]);
assert.equal(pageText(cjkLayout, cjk.text, 1).map(page => page.text).join(''), cjk.text, 'CJK wrapping never drops code points');

const english = object('hello world', { autoWrap: true, layoutWidth: 100 });
const englishLayout = layoutText(english, options());
assert.equal(englishLayout.lines.length, 2);
assert.equal(pageText(englishLayout, english.text, 1).map(page => page.text).join(''), english.text, 'spaces survive wrapping');

const wide = object('甲乙', { autoWrap: true, layoutWidth: 5 });
assert.equal(layoutText(wide, options()).lines.length, 2, 'a single overwide glyph gets its own line without an infinite loop');

const explicit = object('一\n\n二', { maxLines: 1 });
const explicitLayout = layoutText(explicit, options());
assert.equal(explicitLayout.lines.length, 3);
assert.equal(explicitLayout.overflowLines, 2);
assert.equal(explicitLayout.overflowCharacters, 1, 'overflow counts content without newline separators');
assert.equal(explicitLayout.lines[1].glyphs.length, 0, 'blank explicit lines survive');

const profile = {
  id: 'p', name: 'p', createdAt: 'now', updatedAt: 'now', sampleSets: [],
  defaultRenderSettings: { preferredVariantMode: 'random', scale: 1, baselineJitter: 1, rotationJitter: 1, opacityJitter: 0.05, spacingJitter: 0 },
  glyphs: [0, 1].map(index => ({
    id: `g${index}`, profileId: 'p', char: '我', imageBase64: 'data:x',
    bbox: { x: 0, y: 0, width: 20, height: 20 }, sourceSampleSetId: 's', variantIndex: index, createdAt: 'now',
  })),
};
const naturalOptions = options({
  profile,
  glyphSize: () => ({ naturalWidth: 20, naturalHeight: 20 }),
  applyJitter: true,
});
const fullText = '我我我我我我';
const full = object(fullText, { autoWrap: true, layoutWidth: 40, maxLines: 1, renderMode: 'handwritingGlyph', handwritingProfileId: 'p' });
const narrow = { ...full, layoutWidth: 20 };
const fullLayout = layoutText(full, naturalOptions);
const narrowLayout = layoutText(narrow, naturalOptions);
const signature = layout => layout.lines.flatMap(line => line.glyphs).map(glyph => ({
  sourceIndex: glyph.sourceIndex, key: glyph.glyphKey, fontSize: glyph.fontSize,
  opacity: glyph.opacity, rotation: glyph.rotation,
}));
assert.deepEqual(signature(narrowLayout), signature(fullLayout), 'variant and per-character jitter are stable when width changes');

const pages = pageText(fullLayout, fullText, 1);
assert.equal(pages.length, 3);
const paginated = [];
for (const [index, page] of pages.entries()) {
  const offset = pages.slice(0, index).reduce((count, previous) => count + Array.from(previous.text).length, 0);
  const part = { ...full, text: page.text, naturalnessOffset: offset };
  paginated.push(...signature(layoutText(part, naturalOptions)).map(item => ({
    ...item, sourceIndex: item.sourceIndex + offset,
  })));
}
assert.deepEqual(paginated, signature(fullLayout), 'explicit pagination preserves every glyph and naturalization decision');

assert.throws(() => textPageRanges(fullLayout, 0), /正整数/);
console.log('PASS: CJK/Latin wrapping, overwide glyphs, blank lines, overflow, stable jitter and explicit pagination');
