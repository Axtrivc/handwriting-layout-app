// @ts-nocheck
/**
 * 第七轮综合测试：OCR 分级 + 懒加载 + 旧项目兼容 + round-trip。
 *
 * 用法：node scripts/test_ocr_lazy.mjs
 */
import {
  classifyConfidence,
  serializeProject,
  deserializeProject,
  createEmptyProject,
  nowISO,
} from "../packages/shared/dist/index.js";

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
}

async function main() {
  console.log("=== 第七轮综合测试 ===\n");

  // [1] classifyConfidence 分级
  console.log("[1] OCR 置信度分级");
  assert(classifyConfidence(0.9) === "high", "0.9 -> high");
  assert(classifyConfidence(0.85) === "high", "0.85 -> high（边界）");
  assert(classifyConfidence(0.84) === "medium", "0.84 -> medium");
  assert(classifyConfidence(0.6) === "medium", "0.6 -> medium（边界）");
  assert(classifyConfidence(0.59) === "low", "0.59 -> low");
  assert(classifyConfidence(0) === "low", "0 -> low");
  assert(classifyConfidence(1) === "high", "1 -> high");

  // [2] OCR 建议应用策略模拟（high 应用，medium/low 不自动）
  console.log("\n[2] OCR 建议应用策略");
  const suggestions = [
    { candId: "c1", char: "我", confidence: 0.9, level: classifyConfidence(0.9), provider: "mock" },
    { candId: "c2", char: "的", confidence: 0.7, level: classifyConfidence(0.7), provider: "mock" },
    { candId: "c3", char: "", confidence: 0.3, level: classifyConfidence(0.3), provider: "mock" },
  ];
  // 模拟「应用高置信度」：只 high 的填入
  const labels = new Map();
  let applied = 0;
  for (const s of suggestions) {
    if (s.level === "high" && s.char) {
      labels.set(s.candId, s.char);
      applied++;
    }
  }
  assert(applied === 1, `只应用 1 个 high（实际 ${applied}）`);
  assert(labels.has("c1") && labels.get("c1") === "我", "c1 应用");
  assert(!labels.has("c2"), "c2 (medium) 不自动应用");
  assert(!labels.has("c3"), "c3 (low) 不自动应用");

  // [3] 批量保存摘要统计模拟
  console.log("\n[3] 批量保存摘要统计");
  const allItems = [
    { char: "我", bbox: { x: 0, y: 0, width: 10, height: 10 } },
    { char: "", bbox: { x: 0, y: 0, width: 10, height: 10 } }, // 空，跳过
    { char: "的", bbox: { x: 0, y: 0, width: 10, height: 10 } },
    { char: "", bbox: { x: 0, y: 0, width: 10, height: 10 } }, // 空，跳过
  ];
  const valid = allItems.filter((i) => i.char.trim());
  const empty = allItems.filter((i) => !i.char.trim());
  assert(valid.length === 2, `有效字符 2（实际 ${valid.length}）`);
  assert(empty.length === 2, `空字符 2（实际 ${empty.length}）`);

  // [4] 旧项目兼容（v0.4）
  console.log("\n[4] 旧项目兼容");
  const oldJson = JSON.stringify({
    appVersion: "0.4.0", backgroundImage: "data:x", width: 800, height: 600,
    textObjects: [{ id: "t", text: "hi", x: 0, y: 0, style: { fontSize: 20 }, zIndex: 0, naturalnessSeed: 1, renderMode: "handwritingGlyph", handwritingProfileId: null }],
    naturalnessEnabled: false, naturalness: {}, cleanHistory: [], handwritingProfiles: [], activeHandwritingProfileId: null,
  });
  const oldRes = deserializeProject(oldJson);
  assert(oldRes.ok && oldRes.project.pages.length === 1, "v0.4 旧项目迁移 1 页");
  assert(oldRes.project.pages[0].textObjects[0].renderMode === "handwritingGlyph", "renderMode 保留");

  // [5] project round-trip（多页 + OCR 相关字段不影响）
  console.log("\n[5] project round-trip");
  const proj = createEmptyProject();
  const json = serializeProject(proj);
  const rt = deserializeProject(json).project;
  assert(rt.pages.length === proj.pages.length, "页数一致");
  assert(rt.appVersion === proj.appVersion, "版本一致");

  // [6] 懒加载：jspdf/jszip 不在顶层静态导入（验证模块可动态 import）
  console.log("\n[6] 导出模块懒加载");
  // 验证 pdfExport 的 exportPagesToPDF 是 async 函数（动态 import 的标志）
  const pdfMod = await import("../apps/web/dist/assets/index-DsyWxU1b.js").catch(() => null);
  // dist 文件名会变，改用直接验证源码不静态 import
  // 这里验证 dynamic import 语法存在于源码
  const fs = await import("node:fs");
  const pdfSrc = fs.readFileSync("apps/web/src/lib/pdfExport.ts", "utf-8");
  assert(pdfSrc.includes('import("jspdf")'), 'pdfExport 动态 import jspdf');
  assert(!pdfSrc.includes('from "jspdf"'), 'pdfExport 不静态 import jspdf');
  const zipSrc = fs.readFileSync("apps/web/src/lib/zipExport.ts", "utf-8");
  assert(zipSrc.includes('import("jszip")'), 'zipExport 动态 import jszip');
  assert(!zipSrc.includes('from "jszip"'), 'zipExport 不静态 import jszip');

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
