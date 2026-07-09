// @ts-nocheck
/**
 * 第八轮发布前综合测试：demo 工程、空状态、桌面 build 入口、端到端兼容。
 *
 * 用法：node scripts/test_release.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
  createEmptyProject,
  deserializeProject,
  serializeProject,
  missingChars,
  layoutText,
  DEFAULT_NATURALNESS,
} from "../packages/shared/dist/index.js";

const require = createRequire(import.meta.url);
let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
}

async function main() {
  console.log("=== 第八轮发布前综合测试 ===\n");

  // [1] demo 工程可加载
  console.log("[1] demo 工程加载");
  const demoPath = "storage/samples/demo-project.json";
  assert(existsSync(demoPath), `demo-project.json 存在`);
  if (existsSync(demoPath)) {
    const raw = readFileSync(demoPath, "utf-8");
    const res = deserializeProject(raw);
    assert(res.ok, "demo 工程反序列化成功");
    if (res.ok) {
      const p = res.project;
      assert(p.pages.length === 2, `demo 含 2 页（实际 ${p.pages.length}）`);
      assert(p.handwritingProfiles.length === 1, "demo 含 1 个 profile");
      assert(p.handwritingProfiles[0].glyphs.length >= 5, `demo 含 >=5 glyph（实际 ${p.handwritingProfiles[0].glyphs.length}）`);
      assert(p.settings.naturalnessEnabled === true, "demo naturalness 开启");
      // 含 handwritingGlyph 文本
      const hasGlyphText = p.pages.some((pg) =>
        pg.textObjects.some((t) => t.renderMode === "handwritingGlyph")
      );
      assert(hasGlyphText, "demo 含 handwritingGlyph 模式文本");
    }
  }

  // [2] demo round-trip
  console.log("\n[2] demo 工程 round-trip");
  if (existsSync(demoPath)) {
    const raw = readFileSync(demoPath, "utf-8");
    const p1 = deserializeProject(raw).project;
    const json = serializeProject(p1);
    const p2 = deserializeProject(json).project;
    assert(p2.pages.length === p1.pages.length, "round-trip 页数一致");
    assert(p2.handwritingProfiles[0].glyphs.length === p1.handwritingProfiles[0].glyphs.length, "round-trip glyph 数一致");
  }

  // [3] 空项目不崩
  console.log("\n[3] 空项目不崩");
  const empty = createEmptyProject();
  assert(empty.pages.length === 1, "空项目含 1 空白页");
  assert(empty.pages[0].textObjects.length === 0, "空页无文本");
  assert(empty.handwritingProfiles.length === 0, "空项目无 profile");
  const emptyJson = serializeProject(empty);
  const emptyRt = deserializeProject(emptyJson).project;
  assert(emptyRt.pages.length === 1, "空项目 round-trip 1 页");

  // [4] 无 profile 时 layoutText 不崩
  console.log("\n[4] 无 profile / 无 glyph 时布局不崩");
  const obj = {
    id: "t", text: "测试", x: 50, y: 50,
    style: { fontFamily: "sans", fontSize: 28, fontWeight: "normal", fontStyle: "normal", align: "left", letterSpacing: 0, lineHeight: 1.4, color: "#000", opacity: 1, rotation: 0, blur: 0 },
    zIndex: 0, naturalnessSeed: 1, renderMode: "font", handwritingProfileId: null,
  };
  const layout = layoutText(obj, {
    glyphSize: () => null, profile: null, applyJitter: false,
    naturalness: DEFAULT_NATURALNESS, letterSpacing: 0,
  });
  assert(layout.lines.length === 1, "布局返回 1 行");
  assert(layout.lines[0].glyphs.length === 2, "2 字 fallback 字体");
  assert(layout.lines[0].glyphs.every((g) => !g.isGlyph), "全部 fallback（无 glyph）");

  // [5] 缺字 fallback
  console.log("\n[5] 缺字检测");
  const covered = new Set(["我", "的"]);
  const miss = missingChars("我们的测试", covered);
  assert(miss.includes("们") && miss.includes("测") && miss.includes("试"), "缺字: 们测试");
  assert(!miss.includes("我") && !miss.includes("的"), "已有字不算缺字");

  // [6] 旧项目（v0.1 单页）兼容
  console.log("\n[6] 旧项目兼容");
  const oldJson = JSON.stringify({
    appVersion: "0.1.0", backgroundImage: "data:x", width: 800, height: 600,
    textObjects: [{ id: "t", text: "old", x: 0, y: 0, style: { fontSize: 20 }, zIndex: 0, naturalnessSeed: 1 }],
    naturalnessEnabled: false, naturalness: {}, cleanHistory: [], handwritingProfiles: [], activeHandwritingProfileId: null,
  });
  const oldRes = deserializeProject(oldJson);
  assert(oldRes.ok && oldRes.project.pages.length === 1, "v0.1 迁移 1 页");

  // [7] 桌面 build 入口存在
  console.log("\n[7] 桌面 build 入口");
  assert(existsSync("apps/desktop/dist/main.cjs"), "dist/main.cjs 存在");
  assert(existsSync("apps/desktop/package.json"), "desktop package.json 存在");
  const desktopPkg = JSON.parse(readFileSync("apps/desktop/package.json", "utf-8"));
  assert(desktopPkg.main === "dist/main.cjs", `main 指向 dist/main.cjs（实际 ${desktopPkg.main}）`);
  assert(desktopPkg.scripts["build:desktop"] !== undefined, "有 build:desktop 脚本");
  assert(desktopPkg.scripts["package:desktop"] !== undefined, "有 package:desktop 脚本");

  // [8] 懒加载仍有效
  console.log("\n[8] 导出懒加载");
  const pdfSrc = readFileSync("apps/web/src/lib/pdfExport.ts", "utf-8");
  assert(pdfSrc.includes('import("jspdf")'), "pdfExport 动态 import jspdf");
  const zipSrc = readFileSync("apps/web/src/lib/zipExport.ts", "utf-8");
  assert(zipSrc.includes('import("jszip")'), "zipExport 动态 import jszip");

  // [9] 文档存在
  console.log("\n[9] 发布文档");
  assert(existsSync("CHANGELOG.md"), "CHANGELOG.md 存在");
  assert(existsSync("docs/release-checklist.md"), "release-checklist.md 存在");
  assert(existsSync("docs/manual-qa.md"), "manual-qa.md 存在");
  assert(existsSync("docs/performance.md"), "performance.md 存在");
  assert(existsSync("docs/product-boundary.md"), "product-boundary.md 存在");

  // [10] 合规边界检查（product-boundary 应包含禁止项的明确声明）
  console.log("\n[10] 合规边界检查");
  const boundary = readFileSync("docs/product-boundary.md", "utf-8");
  // product-boundary.md 应明确列出禁止项（这是正确的合规表述）
  assert(boundary.includes("签名"), "明确禁止签名");
  assert(boundary.includes("证件"), "明确禁止证件");
  assert(boundary.includes("考试"), "明确禁止考试冒充");
  // README/营销文案不应宣传对抗检测能力
  const readme = existsSync("README.md") ? readFileSync("README.md", "utf-8") : "";
  assert(!readme.includes("骗过检测"), "README 无「骗过检测」");
  assert(!readme.includes("规避审核"), "README 无「规避审核」");

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
