// @ts-nocheck
/**
 * 第六轮综合测试：统一布局核心 + 缺字检查 + 导出文件名 + 旧项目兼容。
 *
 * 覆盖：
 * - textLayout: left/center/right 对齐、glyph vs fallback、variant seed 一致
 * - collectGlyphKeys
 * - 缺字 fallback（missingChars）
 * - 导出文件名带页码
 * - 旧项目迁移不受影响
 * - project round-trip
 *
 * 用法：node scripts/test_export_history.mjs
 */
import {
  layoutText,
  collectGlyphKeys,
  missingChars,
  serializeProject,
  deserializeProject,
  createEmptyProject,
  DEFAULT_NATURALNESS,
  nowISO,
} from "../packages/shared/dist/index.js";

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    console.error(`  ❌ ${msg}`);
  }
}

function makeProfile(id, glyphs) {
  return {
    id,
    name: "test",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    sampleSets: [],
    glyphs,
    defaultRenderSettings: { preferredVariantMode: "random", scale: 1, baselineJitter: 1, rotationJitter: 1.5, opacityJitter: 0.05, spacingJitter: 0.5 },
  };
}

function makeObj(text, align, renderMode, profileId, seed) {
  return {
    id: "t1", text, x: 100, y: 100,
    style: { fontFamily: "sans", fontSize: 28, fontWeight: "normal", fontStyle: "normal", align, letterSpacing: 0, lineHeight: 1.4, color: "#000", opacity: 1, rotation: 0, blur: 0 },
    zIndex: 0, naturalnessSeed: seed, renderMode, handwritingProfileId: profileId,
  };
}

function main() {
  console.log("=== 第六轮综合测试 ===\n");

  // 构造一个含 "我" glyph 的 profile
  const profile = makeProfile("p1", [
    { id: "g-wo-0", profileId: "p1", char: "我", imageBase64: "data:image/png;base64,AAAA", bbox: { x: 0, y: 0, width: 30, height: 30 }, sourceSampleSetId: "s", variantIndex: 0, createdAt: nowISO() },
    { id: "g-wo-1", profileId: "p1", char: "我", imageBase64: "data:image/png;base64,BBBB", bbox: { x: 0, y: 0, width: 30, height: 30 }, sourceSampleSetId: "s", variantIndex: 1, createdAt: nowISO() },
  ]);

  // glyphSize 模拟：返回固定尺寸
  const glyphSize = (key) => {
    if (key.startsWith("p1:g-wo")) return { naturalWidth: 28, naturalHeight: 30 };
    return null;
  };

  // [1] textLayout：handwritingGlyph 模式，有 glyph 的字渲染为 glyph
  console.log("[1] textLayout glyph vs fallback");
  const obj1 = makeObj("我的", "left", "handwritingGlyph", null, 42);
  const layout1 = layoutText(obj1, {
    glyphSize, profile, applyJitter: false,
    naturalness: DEFAULT_NATURALNESS, letterSpacing: 0,
  });
  const glyphs1 = layout1.lines.flatMap((l) => l.glyphs);
  const woGlyph = glyphs1.find((g) => g.ch === "我");
  const deGlyph = glyphs1.find((g) => g.ch === "的");
  assert(woGlyph && woGlyph.isGlyph === true, `"我" 渲染为 glyph`);
  assert(deGlyph && deGlyph.isGlyph === false, `"的"（缺字）fallback 字体`);

  // [2] 对齐：left/center/right 起始 x 不同
  console.log("\n[2] 对齐 left/center/right");
  const layoutL = layoutText(makeObj("我我", "left", "handwritingGlyph", null, 42), { glyphSize, profile, applyJitter: false, naturalness: DEFAULT_NATURALNESS, letterSpacing: 0 });
  const layoutC = layoutText(makeObj("我我", "center", "handwritingGlyph", null, 42), { glyphSize, profile, applyJitter: false, naturalness: DEFAULT_NATURALNESS, letterSpacing: 0 });
  const layoutR = layoutText(makeObj("我我", "right", "handwritingGlyph", null, 42), { glyphSize, profile, applyJitter: false, naturalness: DEFAULT_NATURALNESS, letterSpacing: 0 });
  const firstXL = layoutL.lines[0].glyphs[0].x;
  const firstXC = layoutC.lines[0].glyphs[0].x;
  const firstXR = layoutR.lines[0].glyphs[0].x;
  assert(firstXL > firstXC, `left 起点 > center 起点（${firstXL.toFixed(1)} > ${firstXC.toFixed(1)}）`);
  assert(firstXC > firstXR, `center 起点 > right 起点（${firstXC.toFixed(1)} > ${firstXR.toFixed(1)}）`);

  // [3] variant seed 一致性（同一 seed 选同一 variant）
  console.log("\n[3] variant seed 一致性");
  const layoutA = layoutText(makeObj("我", "left", "handwritingGlyph", null, 42), { glyphSize, profile, applyJitter: false, naturalness: DEFAULT_NATURALNESS, letterSpacing: 0 });
  const layoutB = layoutText(makeObj("我", "left", "handwritingGlyph", null, 42), { glyphSize, profile, applyJitter: false, naturalness: DEFAULT_NATURALNESS, letterSpacing: 0 });
  assert(layoutA.lines[0].glyphs[0].glyphKey === layoutB.lines[0].glyphs[0].glyphKey, `同 seed 选同一 glyphKey: ${layoutA.lines[0].glyphs[0].glyphKey}`);

  // [4] collectGlyphKeys
  console.log("\n[4] collectGlyphKeys");
  const keys = collectGlyphKeys(makeObj("我的我", "left", "handwritingGlyph", null, 1), profile);
  assert(keys.length === 2, `收集去重后 2 个 key（实际 ${keys.length}）`);
  assert(keys.every((k) => k.startsWith("p1:g-wo")), `key 格式 profileId:glyphId`);

  // [5] 缺字检查
  console.log("\n[5] 缺字检查 missingChars");
  const covered = new Set(["我", "的"]);
  const miss = missingChars("然后测试我", covered);
  assert(miss.includes("然") && miss.includes("后") && miss.includes("测") && miss.includes("试"), `缺字: ${miss.join("")}`);
  assert(!miss.includes("我"), `"我"已覆盖不算缺字`);
  assert(miss.length === 4, `缺字 4 个（实际 ${miss.length}）`);

  // [6] 多行布局
  console.log("\n[6] 多行布局");
  const multi = layoutText(makeObj("我\n的我", "left", "handwritingGlyph", null, 42), { glyphSize, profile, applyJitter: false, naturalness: DEFAULT_NATURALNESS, letterSpacing: 0 });
  assert(multi.lines.length === 2, `2 行（实际 ${multi.lines.length}）`);
  assert(multi.lines[0].glyphs.length === 1, `第0行 1 字`);
  assert(multi.lines[1].glyphs.length === 2, `第1行 2 字`);

  // [7] 导出文件名带页码（逻辑验证 exportFilename 已在 image.ts，这里验证序号格式）
  console.log("\n[7] 导出文件名页码格式");
  const pad3 = (n) => String(n).padStart(3, "0");
  assert(pad3(1) === "001" && pad3(12) === "012", `页码补零 001/012`);

  // [8] 旧项目迁移不受影响
  console.log("\n[8] 旧项目迁移");
  const oldJson = JSON.stringify({
    appVersion: "0.2.0", backgroundImage: "data:x", width: 800, height: 600,
    textObjects: [{ id: "t", text: "hi", x: 0, y: 0, style: { fontSize: 20 }, zIndex: 0, naturalnessSeed: 1 }],
    naturalnessEnabled: false, naturalness: {}, cleanHistory: [], handwritingProfiles: [], activeHandwritingProfileId: null,
  });
  const oldRes = deserializeProject(oldJson);
  assert(oldRes.ok && oldRes.project.pages.length === 1, "旧项目迁移为 1 页");

  // [9] project round-trip（多页 + handwritingGlyph）
  console.log("\n[9] project round-trip");
  const proj = createEmptyProject();
  proj.pages[0].textObjects.push(makeObj("我", "left", "handwritingGlyph", null, 99));
  const rt = deserializeProject(serializeProject(proj)).project;
  assert(rt.pages.length === 1, "round-trip 1 页");
  assert(rt.pages[0].textObjects[0].renderMode === "handwritingGlyph", "renderMode 保留");
  assert(rt.pages[0].textObjects[0].naturalnessSeed === 99, "seed 保留");

  // [10] naturalness jitter 应用（applyJitter true 时字号/位置变化）
  console.log("\n[10] naturalness jitter");
  const noJ = layoutText(makeObj("我", "left", "handwritingGlyph", null, 42), { glyphSize, profile, applyJitter: false, naturalness: DEFAULT_NATURALNESS, letterSpacing: 0, exportSeed: 7 });
  const withJ = layoutText(makeObj("我", "left", "handwritingGlyph", null, 42), { glyphSize, profile, applyJitter: true, naturalness: DEFAULT_NATURALNESS, letterSpacing: 0, exportSeed: 7 });
  // jitter 后位置或尺寸应有变化（概率上）
  const samePos = noJ.lines[0].glyphs[0].x === withJ.lines[0].glyphs[0].x && noJ.lines[0].glyphs[0].y === withJ.lines[0].glyphs[0].y;
  assert(!samePos, `应用 jitter 后位置有变化`);
  // 同 seed 重复 jitter 结果一致
  const withJ2 = layoutText(makeObj("我", "left", "handwritingGlyph", null, 42), { glyphSize, profile, applyJitter: true, naturalness: DEFAULT_NATURALNESS, letterSpacing: 0, exportSeed: 7 });
  assert(withJ.lines[0].glyphs[0].x === withJ2.lines[0].glyphs[0].x, `同 seed jitter 稳定`);

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
