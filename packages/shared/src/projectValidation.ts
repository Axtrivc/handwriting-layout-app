/** Validate present fields before migration. Never silently discard malformed content. */
type RecordValue = Record<string, unknown>;
function fail(path: string, message: string): never { throw new Error(`${path}：${message}`); }
function object(value: unknown, path: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, '应为对象');
  return value as RecordValue;
}
function stringField(record: RecordValue, key: string, path: string, required = false) {
  const value = record[key];
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || (required && !value.trim())) fail(`${path}.${key}`, '应为有效字符串');
}
function numberField(record: RecordValue, key: string, path: string, min = -Infinity, max = Infinity, required = false, integer = false) {
  const value = record[key];
  if (value === undefined && !required) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(`${path}.${key}`, '数值无效或超出允许范围');
  }
}
function nullableString(record: RecordValue, key: string, path: string) {
  if (record[key] !== null) stringField(record, key, path);
}
function booleanField(record: RecordValue, key: string, path: string) {
  if (record[key] !== undefined && typeof record[key] !== 'boolean') fail(`${path}.${key}`, '应为布尔值');
}
function list(record: RecordValue, key: string, path: string, check: (value: RecordValue, path: string) => void, ids = false) {
  if (record[key] === undefined) return;
  if (!Array.isArray(record[key])) fail(`${path}.${key}`, '应为数组');
  const seen = new Set<string>();
  record[key].forEach((value: unknown, i: number) => {
    const itemPath = `${path}.${key}[${i}]`;
    const item = object(value, itemPath);
    if (ids && item.id !== undefined) {
      stringField(item, 'id', itemPath, true);
      const id = item.id as string;
      if (seen.has(id)) fail(`${itemPath}.id`, `重复 ID「${id}」`);
      seen.add(id);
    }
    check(item, itemPath);
  });
}
function bounds(record: RecordValue, path: string) {
  for (const key of ['x', 'y']) numberField(record, key, path, 0, Infinity, true);
  for (const key of ['width', 'height']) numberField(record, key, path, Number.MIN_VALUE, Infinity, true);
}
function naturalness(record: RecordValue, path: string) {
  for (const key of ['positionJitter', 'rotationJitter', 'fontSizeJitter', 'baselineJitter']) numberField(record, key, path, 0);
  numberField(record, 'opacityJitter', path, 0, 1);
}
function optionalObject(record: RecordValue, key: string, path: string, check: (value: RecordValue, path: string) => void) {
  if (record[key] !== undefined) check(object(record[key], `${path}.${key}`), `${path}.${key}`);
}
function text(record: RecordValue, path: string) {
  stringField(record, 'id', path);
  stringField(record, 'text', path);
  for (const key of ['x', 'y', 'zIndex']) numberField(record, key, path);
  numberField(record, 'naturalnessSeed', path, 0, 0xffffffff, false, true);
  nullableString(record, 'handwritingProfileId', path);
  if (record.renderMode !== undefined && !['font', 'handwritingGlyph'].includes(record.renderMode as string)) fail(`${path}.renderMode`, '未知渲染模式');
  optionalObject(record, 'style', path, (style, p) => {
    for (const key of ['fontFamily', 'color']) stringField(style, key, p);
    numberField(style, 'fontSize', p, Number.MIN_VALUE, 4096);
    numberField(style, 'lineHeight', p, Number.MIN_VALUE);
    numberField(style, 'letterSpacing', p);
    numberField(style, 'opacity', p, 0, 1);
    numberField(style, 'rotation', p);
    numberField(style, 'blur', p, 0, 100);
    for (const [key, values] of Object.entries({ fontWeight: ['normal', 'bold'], fontStyle: ['normal', 'italic'], align: ['left', 'center', 'right'] })) {
      if (style[key] !== undefined && !values.includes(style[key] as string)) fail(`${p}.${key}`, '未知样式值');
    }
  });
}
function page(record: RecordValue, path: string) {
  for (const key of ['id', 'name', 'createdAt', 'updatedAt']) stringField(record, key, path);
  for (const key of ['width', 'height', 'originalWidth', 'originalHeight']) numberField(record, key, path, 1, 16384, false, true);
  const width = (record.originalWidth ?? record.width ?? 900) as number;
  const height = (record.originalHeight ?? record.height ?? 600) as number;
  if (width * height > 64_000_000) fail(path, '页面超过当前画布的 6400 万像素上限');
  nullableString(record, 'backgroundImage', path);
  list(record, 'textObjects', path, text, true);
  list(record, 'cleanHistory', path, (entry, p) => {
    if (entry.operation !== undefined && !['clean', 'scan'].includes(entry.operation as string)) fail(`${p}.operation`, '未知图片操作');
    stringField(entry, 'beforeImage', p, true);
    stringField(entry, 'afterImage', p, true);
    if (!Array.isArray(entry.regions)) fail(`${p}.regions`, '应为数组');
    list(entry, 'regions', p, bounds);
    list(entry, 'strokes', p, (stroke, path) => {
      numberField(stroke, 'width', path, 1, 512, true);
      if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 8192 || stroke.points.length % 2 ||
        stroke.points.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 16384)) {
        fail(`${path}.points`, '应为有效的画笔坐标对');
      }
    });
  });
}
function profile(record: RecordValue, path: string) {
  for (const key of ['id', 'name', 'description', 'createdAt', 'updatedAt']) stringField(record, key, path);
  list(record, 'sampleSets', path, (sample, p) => {
    for (const key of ['id', 'imageBase64']) stringField(sample, key, p, true);
    for (const key of ['name', 'profileId', 'createdAt']) stringField(sample, key, p);
    for (const key of ['sourceImageWidth', 'sourceImageHeight']) numberField(sample, key, p, 1, 16384, true, true);
    if (sample.status !== undefined && !['imported', 'segmented', 'reviewed'].includes(sample.status as string)) fail(`${p}.status`, '未知样本状态');
  }, true);
  list(record, 'glyphs', path, (glyph, p) => {
    for (const key of ['id', 'char', 'imageBase64', 'sourceSampleSetId']) stringField(glyph, key, p, true);
    for (const key of ['profileId', 'createdAt']) stringField(glyph, key, p);
    bounds(object(glyph.bbox, `${p}.bbox`), `${p}.bbox`);
    numberField(glyph, 'variantIndex', p, 0, Infinity, false, true);
    numberField(glyph, 'qualityScore', p, 0, 1);
    if (glyph.tags !== undefined && (!Array.isArray(glyph.tags) || glyph.tags.some(tag => typeof tag !== 'string'))) fail(`${p}.tags`, '应为字符串数组');
  }, true);
  optionalObject(record, 'defaultRenderSettings', path, (settings, p) => {
    naturalness(settings, p);
    numberField(settings, 'scale', p, Number.MIN_VALUE);
    numberField(settings, 'spacingJitter', p, 0);
    if (settings.preferredVariantMode !== undefined && !['random', 'first', 'weighted'].includes(settings.preferredVariantMode as string)) fail(`${p}.preferredVariantMode`, '未知字形选择方式');
  });
}
export function validateProjectFile(value: unknown): void {
  const root = object(value, '项目');
  for (const key of ['id', 'name', 'appVersion', 'createdAt', 'updatedAt']) stringField(root, key, '项目');
  nullableString(root, 'activePageId', '项目');
  nullableString(root, 'activeHandwritingProfileId', '项目');
  if (root.pages !== undefined) {
    if (!Array.isArray(root.pages) || root.pages.length === 0) fail('项目.pages', '需要至少一个有效页面');
    list(root, 'pages', '项目', page, true);
  } else {
    if (root.width === undefined && root.height === undefined) fail('项目', '缺少 pages 或旧版 width/height 字段');
    page(root, '项目');
  }
  optionalObject(root, 'settings', '项目', (settings, p) => {
    booleanField(settings, 'naturalnessEnabled', p);
    optionalObject(settings, 'naturalness', p, naturalness);
  });
  booleanField(root, 'naturalnessEnabled', '项目');
  optionalObject(root, 'naturalness', '项目', naturalness);
  list(root, 'handwritingProfiles', '项目', profile, true);
}
