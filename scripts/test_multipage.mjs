// @ts-nocheck
/**
 * 第五轮多页工程综合测试（纯 Node，不依赖后端）。
 *
 * 覆盖：
 * - 旧单页项目迁移为 pages[0]
 * - 多页项目 round-trip
 * - 新建/删除/复制/重命名/重排页面（逻辑层）
 * - 多图导入生成多页顺序
 * - handwritingProfiles project 级共享
 * - 页面切换不丢失 textObjects
 * - 清除区域按页隔离
 *
 * 用法：node scripts/test_multipage.mjs
 */
import {
  createEmptyProject,
  createBlankPage,
  serializeProject,
  deserializeProject,
  nowISO,
} from "../packages/shared/dist/index.js";

const uid = (p = "id") => `${p}-${Math.random().toString(36).slice(2, 8)}`;

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

function main() {
  console.log("=== 第五轮多页工程测试 ===\n");

  // [1] createEmptyProject 含一页
  console.log("[1] createEmptyProject");
  const proj = createEmptyProject();
  assert(proj.pages.length === 1, "初始有 1 页");
  assert(proj.activePageId === proj.pages[0].id, "activePageId 指向首页");
  assert(proj.pages[0].textObjects.length === 0, "首页无文本");

  // [2] 旧单页项目迁移
  console.log("\n[2] 旧单页项目迁移");
  const oldJson = JSON.stringify({
    appVersion: "0.2.0",
    backgroundImage: "data:image/png;base64,AAAA",
    width: 800,
    height: 600,
    textObjects: [
      {
        id: "t1",
        text: "旧文本",
        x: 10,
        y: 10,
        style: { fontSize: 20 },
        zIndex: 0,
        naturalnessSeed: 1,
      },
    ],
    naturalnessEnabled: true,
    naturalness: { positionJitter: 3 },
    cleanHistory: [],
    handwritingProfiles: [],
    activeHandwritingProfileId: null,
  });
  const oldRes = deserializeProject(oldJson);
  assert(oldRes.ok, "旧项目反序列化成功");
  const migrated = oldRes.project;
  assert(migrated.pages.length === 1, `迁移为 1 页（实际 ${migrated.pages.length}）`);
  assert(migrated.pages[0].backgroundImage === "data:image/png;base64,AAAA", "迁移保留背景图");
  assert(migrated.pages[0].originalWidth === 800, "迁移保留宽度");
  assert(migrated.pages[0].textObjects.length === 1, "迁移保留文本");
  assert(migrated.pages[0].textObjects[0].text === "旧文本", "迁移文本内容正确");
  assert(migrated.settings.naturalnessEnabled === true, "迁移 naturalnessEnabled");
  assert(migrated.settings.naturalness.positionJitter === 3, "迁移 naturalness 参数");
  assert(migrated.pages[0].textObjects[0].renderMode === "font", "迁移默认 font 模式");

  // [3] 多页项目 round-trip
  console.log("\n[3] 多页项目 round-trip");
  const multi = createEmptyProject();
  const page2 = createBlankPage(1, "第二页");
  multi.pages.push(page2);
  multi.pages[0].textObjects.push({
    id: "p1t1",
    text: "首页文本",
    x: 5,
    y: 5,
    style: { fontFamily: "sans", fontSize: 24, fontWeight: "normal", fontStyle: "normal", align: "left", letterSpacing: 0, lineHeight: 1.4, color: "#000", opacity: 1, rotation: 0, blur: 0 },
    zIndex: 0,
    naturalnessSeed: 42,
    renderMode: "handwritingGlyph",
    handwritingProfileId: "prof-1",
  });
  const json = serializeProject(multi);
  const rt = deserializeProject(json);
  assert(rt.ok, "多页 round-trip 成功");
  const rtm = rt.project;
  assert(rtm.pages.length === 2, `恢复 2 页（实际 ${rtm.pages.length}）`);
  assert(rtm.pages[0].textObjects.length === 1, "首页文本恢复");
  assert(rtm.pages[0].textObjects[0].renderMode === "handwritingGlyph", "renderMode 恢复");
  assert(rtm.pages[0].textObjects[0].handwritingProfileId === "prof-1", "handwritingProfileId 恢复");
  // serialize 不含 deprecated 字段
  const parsed = JSON.parse(json);
  assert(parsed.backgroundImage === undefined, "serialize 剥离 deprecated backgroundImage");
  assert(parsed.textObjects === undefined, "serialize 剥离 deprecated textObjects");
  assert(parsed.pages !== undefined, "serialize 保留 pages");

  // [4] 页面 CRUD 逻辑
  console.log("\n[4] 页面 CRUD 逻辑");
  let p = createEmptyProject();
  // 新建页
  const np = createBlankPage(p.pages.length, "新页");
  p.pages.push(np);
  assert(p.pages.length === 2, "新建后 2 页");
  // 复制页（模拟）
  const src = p.pages[0];
  const copyPage = {
    ...src,
    id: uid("page"),
    name: `${src.name} 副本`,
    textObjects: src.textObjects.map((t) => ({ ...t, id: uid("obj") })),
    cleanHistory: [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  p.pages.splice(1, 0, copyPage);
  assert(p.pages.length === 3, "复制后 3 页");
  assert(p.pages[1].name.includes("副本"), "副本名称正确");
  // 删除页
  const delId = p.pages[2].id;
  p.pages = p.pages.filter((pg) => pg.id !== delId);
  assert(p.pages.length === 2, "删除后 2 页");
  // 重命名
  p.pages[0].name = "改名页";
  assert(p.pages[0].name === "改名页", "重命名成功");
  // 上移下移
  const before = [p.pages[0].id, p.pages[1].id];
  [p.pages[0], p.pages[1]] = [p.pages[1], p.pages[0]];
  assert(p.pages[0].id === before[1], "交换顺序成功");

  // [5] 多图导入顺序（按文件名排序）
  console.log("\n[5] 多图导入顺序");
  const files = ["c.png", "a.png", "b.png"].map((n) => ({ name: n }));
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  assert(sorted.map((f) => f.name).join(",") === "a.png,b.png,c.png", "按文件名 a,b,c 排序");

  // [6] handwritingProfiles project 级共享
  console.log("\n[6] handwritingProfiles project 级共享");
  const shared = createEmptyProject();
  shared.handwritingProfiles.push({
    id: "prof-shared",
    name: "共享档案",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    sampleSets: [],
    glyphs: [{ id: "g1", profileId: "prof-shared", char: "我", imageBase64: "x", bbox: { x: 0, y: 0, width: 10, height: 10 }, sourceSampleSetId: "s", variantIndex: 0, createdAt: nowISO() }],
    defaultRenderSettings: { preferredVariantMode: "random", scale: 1, baselineJitter: 1, rotationJitter: 1.5, opacityJitter: 0.05, spacingJitter: 0.5 },
  });
  shared.activeHandwritingProfileId = "prof-shared";
  // 两页都用同一个 profile
  shared.pages[0].textObjects.push({
    id: "t-a", text: "我", x: 0, y: 0,
    style: { fontFamily: "s", fontSize: 24, fontWeight: "normal", fontStyle: "normal", align: "left", letterSpacing: 0, lineHeight: 1.4, color: "#000", opacity: 1, rotation: 0, blur: 0 },
    zIndex: 0, naturalnessSeed: 1, renderMode: "handwritingGlyph", handwritingProfileId: null,
  });
  const pageB = createBlankPage(1);
  pageB.textObjects.push({
    id: "t-b", text: "我", x: 0, y: 0,
    style: { fontFamily: "s", fontSize: 24, fontWeight: "normal", fontStyle: "normal", align: "left", letterSpacing: 0, lineHeight: 1.4, color: "#000", opacity: 1, rotation: 0, blur: 0 },
    zIndex: 0, naturalnessSeed: 2, renderMode: "handwritingGlyph", handwritingProfileId: null,
  });
  shared.pages.push(pageB);
  const sj = serializeProject(shared);
  const srt = deserializeProject(sj).project;
  assert(srt.handwritingProfiles.length === 1, "profile 在 project 级恢复");
  assert(srt.handwritingProfiles[0].glyphs.length === 1, "glyph 在 project 级");
  assert(srt.pages[0].textObjects[0].handwritingProfileId === null, "页0 profileId null=用项目活动档案");
  assert(srt.pages[1].textObjects[0].handwritingProfileId === null, "页1 profileId null=用项目活动档案");
  assert(srt.activeHandwritingProfileId === "prof-shared", "活动档案恢复");

  // [7] 页面切换不丢失 textObjects
  console.log("\n[7] 页面切换不丢失 textObjects");
  const sw = createEmptyProject();
  sw.pages[0].textObjects.push({ id: "p0t", text: "页0", x: 0, y: 0, style: { fontFamily: "s", fontSize: 24, fontWeight: "normal", fontStyle: "normal", align: "left", letterSpacing: 0, lineHeight: 1.4, color: "#000", opacity: 1, rotation: 0, blur: 0 }, zIndex: 0, naturalnessSeed: 1, renderMode: "font", handwritingProfileId: null });
  const swp2 = createBlankPage(1);
  swp2.textObjects.push({ id: "p1t", text: "页1", x: 0, y: 0, style: { fontFamily: "s", fontSize: 24, fontWeight: "normal", fontStyle: "normal", align: "left", letterSpacing: 0, lineHeight: 1.4, color: "#000", opacity: 1, rotation: 0, blur: 0 }, zIndex: 0, naturalnessSeed: 2, renderMode: "font", handwritingProfileId: null });
  sw.pages.push(swp2);
  // 切换到页1 再切回页0，页0 文本仍在
  sw.activePageId = swp2.id;
  assert(sw.pages.find((p) => p.id === sw.pages[0].id).textObjects.length === 1, "切到页1后页0文本仍在");
  sw.activePageId = sw.pages[0].id;
  assert(sw.pages[0].textObjects[0].text === "页0", "切回页0文本正确");

  // [8] 清除区域按页隔离
  console.log("\n[8] 清除区域按页隔离");
  const cl = createEmptyProject();
  cl.pages[0].cleanHistory.push({ beforeImage: "A", afterImage: "B", regions: [{ x: 0, y: 0, width: 10, height: 10 }] });
  const clp2 = createBlankPage(1);
  cl.pages.push(clp2);
  assert(cl.pages[0].cleanHistory.length === 1, "页0 有清除历史");
  assert(cl.pages[1].cleanHistory.length === 0, "页1 无清除历史（隔离）");

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
