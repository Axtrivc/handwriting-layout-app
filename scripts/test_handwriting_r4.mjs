// @ts-nocheck
/**
 * 第四轮综合自动化测试：自动检测 + 批量标注 + 质量 + 对齐 + 缺字 + seed + round-trip。
 *
 * 前提：后端已启动在 http://127.0.0.1:8001
 * 用法：node scripts/test_handwriting_r4.mjs
 */
import {
  createEmptyProject,
  serializeProject,
  deserializeProject,
  pickVariant,
  profileCoverage,
  missingChars,
  assessGlyphQuality,
  DEFAULT_RENDER_SETTINGS,
} from "../packages/shared/dist/index.js";

const API = "http://127.0.0.1:8001";
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

async function main() {
  console.log("=== 第四轮综合测试 ===\n");

  // [1] 后端连通
  console.log("[1] 后端连通");
  const health = await (await fetch(`${API}/health`)).json();
  assert(health.status === "ok", `/health ok (v${health.version})`);

  // 生成两行 5 字的样本图
  const sampleDataURL = await makeRowsPNG(400, 200, 2, 5);

  // [2] /detect-glyph-candidates 返回候选框
  console.log("\n[2] 自动检测候选框");
  const base64 = sampleDataURL.replace(/^data:image\/png;base64,/, "");
  const detectRes = await fetch(`${API}/detect-glyph-candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64, mime: "image/png" }),
  });
  const detectData = await detectRes.json();
  assert(detectRes.status === 200, `/detect 返回 200`);
  assert(detectData.count === 10, `检测到 10 个候选（实际 ${detectData.count}）`);

  // [3] 候选框排序稳定（阅读顺序）
  console.log("\n[3] 候选框阅读顺序");
  const cands = detectData.candidates;
  const rows = new Set(cands.map((c) => c.rowIndex));
  assert(rows.size === 2, `2 行（实际 ${rows.size}）`);
  // 第 0 行的 orderIndex 应 0-4，第 1 行也应 0-4
  const row0 = cands.filter((c) => c.rowIndex === 0).sort((a, b) => a.orderIndex - b.orderIndex);
  const row1 = cands.filter((c) => c.rowIndex === 1).sort((a, b) => a.orderIndex - b.orderIndex);
  assert(row0.map((c) => c.orderIndex).join(",") === "0,1,2,3,4", "第0行 orderIndex 0-4");
  assert(row1.map((c) => c.orderIndex).join(",") === "0,1,2,3,4", "第1行 orderIndex 0-4");
  // 第 0 行的 x 应递增
  const row0Xs = row0.map((c) => c.x);
  assert(
    row0Xs.every((x, i) => i === 0 || x >= row0Xs[i - 1]),
    "第0行 x 递增（左到右）",
  );

  // [4] 批量标注：字符数 == 候选数
  console.log("\n[4] 批量标注（字符数==候选数）");
  const chars10 = "的一是在不了有和人这中大".slice(0, 10).split("");
  assert(chars10.length === 10, "10 个字符");
  let project = makeProjectWithSample(sampleDataURL);
  const profId = project.activeHandwritingProfileId;
  const ssId = project.handwritingProfiles[0].sampleSets[0].id;
  const sortedCands = [...cands].sort(
    (a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex,
  );
  let savedCount = 0;
  for (let i = 0; i < sortedCands.length; i++) {
    const seg = await segGlyph(sampleDataURL, sortedCands[i]);
    if (seg) {
      addGlyph(project, profId, ssId, chars10[i], sortedCands[i], seg);
      savedCount++;
    }
  }
  assert(savedCount === 10, `批量保存 10 个（实际 ${savedCount}）`);

  // [5] 批量标注：字符数 < 候选数（只处理有字符部分）
  console.log("\n[5] 批量标注（字符数<候选数）");
  const proj2 = makeProfileWithCands(sampleDataURL, sortedCands);
  const few = "一二三".split(""); // 3 个字符，10 个候选
  const sorted2 = [...proj2.cands].sort(
    (a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex,
  );
  let saved2 = 0;
  for (let i = 0; i < few.length && i < sorted2.length; i++) {
    const seg = await segGlyph(sampleDataURL, sorted2[i]);
    if (seg) {
      addGlyph(proj2.project, proj2.profileId, proj2.sampleSetId, few[i], sorted2[i], seg);
      saved2++;
    }
  }
  assert(saved2 === 3, `只处理 3 个（实际 ${saved2}）`);
  const leftover2 = few.length - sorted2.length;
  assert(leftover2 < 0, "字符数 < 候选数，无多余字符");

  // [6] 批量标注：字符数 > 候选数（多余字符未使用）
  console.log("\n[6] 批量标注（字符数>候选数）");
  const proj3 = makeProfileWithCands(sampleDataURL, sortedCands.slice(0, 4)); // 4 个候选
  const many = "abcdefghij".split(""); // 10 个字符
  const sorted3 = [...proj3.cands].sort(
    (a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex,
  );
  let saved3 = 0;
  for (let i = 0; i < sorted3.length; i++) {
    const seg = await segGlyph(sampleDataURL, sorted3[i]);
    if (seg) {
      addGlyph(proj3.project, proj3.profileId, proj3.sampleSetId, many[i], sorted3[i], seg);
      saved3++;
    }
  }
  assert(saved3 === 4, `只保存 4 个（实际 ${saved3}）`);
  assert(many.length - sorted3.length === 6, "多余 6 个字符未使用");

  // [7] glyph 质量检查
  console.log("\n[7] glyph 质量检查");
  const qGood = assessGlyphQuality({
    char: "我",
    bbox: { x: 10, y: 10, width: 40, height: 40 },
    inkRatio: 0.3,
  });
  assert(qGood.level === "good", `正常字形 good（实际 ${qGood.level}）`);
  const qPoor = assessGlyphQuality({
    char: "我",
    bbox: { x: 0, y: 0, width: 3, height: 3 },
    inkRatio: 0.005,
  });
  assert(qPoor.level === "poor", `过小+墨迹少 poor（实际 ${qPoor.level}）`);
  const qEmpty = assessGlyphQuality({ char: "", bbox: { x: 0, y: 0, width: 40, height: 40 } });
  assert(qEmpty.level === "poor" && qEmpty.issues.includes("字符为空"), "空字符 poor");
  const qMany = assessGlyphQuality({
    char: "的",
    bbox: { x: 0, y: 0, width: 40, height: 40 },
    variantCount: 7,
  });
  assert(qMany.level === "warning", `variant 过多 warning（实际 ${qMany.level}）`);

  // [8] 对齐逻辑（GlyphText 内部，这里测 fontCharWidth 行为一致性：covered fallback）
  console.log("\n[8] handwritingGlyph 缺字 fallback");
  // project 有 "的一是在不了有和人这" 的 glyph，文本含未覆盖字
  const covered = new Set(
    project.handwritingProfiles[0].glyphs.map((g) => g.char),
  );
  const text = "我的一是"; // "我" 未覆盖
  const miss = missingChars(text, covered);
  assert(miss.includes("我"), `"我" 识别为缺字`);
  assert(!miss.includes("的"), `"的" 已覆盖不算缺字`);

  // [9] 缺字统计
  console.log("\n[9] 缺字统计");
  const text2 = "然后测试ABC";
  const miss2 = missingChars(text2, covered);
  assert(miss2.length > 0, `多字缺字返回列表（${miss2.join("")}）`);

  // [10] 覆盖率统计
  console.log("\n[10] 覆盖率统计");
  const stats = profileCoverage(project.handwritingProfiles[0].glyphs);
  assert(stats.totalGlyphs === 10, `总 glyph 10（实际 ${stats.totalGlyphs}）`);
  assert(stats.coveredChars === 10, `覆盖字符 10`);
  // "的" 出现 2 次（chars10 里...实际 chars10 是 10 个不同字）-> multiVariant 0
  assert(stats.multiVariantChars === 0, `多 variant 字符 0`);

  // [11] seed 一致性
  console.log("\n[11] seed variant 一致性");
  // 给 "的" 加 2 个 variant
  const deGlyphs = project.handwritingProfiles[0].glyphs.filter((g) => g.char === "的");
  for (let i = 0; i < 2; i++) {
    project.handwritingProfiles[0].glyphs.push({
      ...deGlyphs[0],
      id: `g-de-${i}`,
      variantIndex: i + 1,
    });
  }
  const deAll = project.handwritingProfiles[0].glyphs.filter((g) => g.char === "的");
  const p1 = pickVariant(deAll, 777, "random");
  const p2 = pickVariant(deAll, 777, "random");
  assert(p1.id === p2.id, `同 seed 选同一 variant: ${p1.id}`);

  // [12] 项目 round-trip（含 detect 字段无关，profiles/glyphs 恢复）
  console.log("\n[12] 项目 JSON round-trip");
  const json = serializeProject(project);
  const result = deserializeProject(json);
  assert(result.ok, "反序列化成功");
  const loaded = result.project;
  assert(
    loaded.handwritingProfiles[0].glyphs.length === project.handwritingProfiles[0].glyphs.length,
    "glyph 数量恢复",
  );

  // [13] 旧项目兼容（v0.2 之前）
  console.log("\n[13] 旧项目兼容");
  const oldProj = {
    appVersion: "0.1.0",
    backgroundImage: null,
    width: 800,
    height: 600,
    textObjects: [{ id: "t", text: "hi", x: 1, y: 1, style: {} }],
    naturalnessEnabled: false,
    naturalness: {},
    cleanHistory: [],
  };
  const oldRes = deserializeProject(JSON.stringify(oldProj));
  assert(oldRes.ok, "旧项目加载成功");
  assert(oldRes.project.handwritingProfiles.length === 0, "旧项目 profiles 为空");

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}

// ===== 辅助 =====
function makeProfileWithCands(sampleDataURL, cands) {
  const project = createEmptyProject();
  const profId = "prof";
  const now = new Date().toISOString();
  project.handwritingProfiles.push({
    id: profId,
    name: "test",
    createdAt: now,
    updatedAt: now,
    sampleSets: [{
      id: "ss", profileId: profId, name: "s", imageBase64: sampleDataURL,
      sourceImageWidth: 400, sourceImageHeight: 200, createdAt: now, status: "imported",
    }],
    glyphs: [],
    defaultRenderSettings: { ...DEFAULT_RENDER_SETTINGS },
  });
  project.activeHandwritingProfileId = profId;
  return { project, profileId: profId, sampleSetId: "ss", cands };
}

function makeProfileWithSample(sampleDataURL) {
  const project = createEmptyProject();
  const profId = "prof";
  const now = new Date().toISOString();
  project.handwritingProfiles.push({
    id: profId,
    name: "测试档案",
    createdAt: now,
    updatedAt: now,
    sampleSets: [{
      id: "ss-1", profileId: profId, name: "样本1", imageBase64: sampleDataURL,
      sourceImageWidth: 400, sourceImageHeight: 200, createdAt: now, status: "imported",
    }],
    glyphs: [],
    defaultRenderSettings: { ...DEFAULT_RENDER_SETTINGS },
  });
  project.activeHandwritingProfileId = profId;
  return project;
}

// 别名（main 里用了 makeProfileWithSample）
const makeProjectWithSample = makeProfileWithSample;

function addGlyph(project, profId, ssId, char, cand, seg) {
  const prof = project.handwritingProfiles.find((p) => p.id === profId);
  const vi = prof.glyphs.filter((g) => g.char === char).length;
  prof.glyphs.push({
    id: `g-${char}-${vi}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    profileId: profId,
    char,
    imageBase64: `data:${seg.mime};base64,${seg.image}`,
    bbox: { x: cand.x, y: cand.y, width: cand.width, height: cand.height },
    sourceSampleSetId: ssId,
    variantIndex: vi,
    createdAt: new Date().toISOString(),
  });
  prof.updatedAt = new Date().toISOString();
}

async function segGlyph(sampleDataURL, cand) {
  const base64 = sampleDataURL.replace(/^data:image\/png;base64,/, "");
  const res = await fetch(`${API}/segment-glyph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: base64, mime: "image/png",
      bbox: { x: cand.x, y: cand.y, width: cand.width, height: cand.height },
      transparent: true,
    }),
  });
  if (!res.ok) return null;
  return await res.json();
}

// ===== PNG 生成（rows × cols 黑方块） =====
async function makeRowsPNG(w, h, rows, cols) {
  const { deflateSync } = await import("node:zlib");
  const { Buffer } = await import("node:buffer");
  const rowLen = w * 3;
  const raw = Buffer.alloc((rowLen + 1) * h);
  const blockW = 30, blockH = 40;
  const startX = 40, gapX = 70;
  const startY = 40, gapY = 100;
  for (let y = 0; y < h; y++) {
    raw[y * (rowLen + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let isBlack = false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const bx = startX + c * gapX;
          const by = startY + r * gapY;
          if (x >= bx && x < bx + blockW && y >= by && y < by + blockH) {
            isBlack = true;
          }
        }
      }
      const v = isBlack ? 0 : 255;
      const off = y * (rowLen + 1) + 1 + x * 3;
      raw[off] = v; raw[off + 1] = v; raw[off + 2] = v;
    }
  }
  const compressed = deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = makeChunk("IHDR", Buffer.concat([u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0])]));
  const idat = makeChunk("IDAT", compressed);
  const iend = makeChunk("IEND", Buffer.alloc(0));
  return `data:image/png;base64,${Buffer.concat([sig, ihdr, idat, iend]).toString("base64")}`;
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function makeChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const crc = crc32(Buffer.concat([t, data]));
  return Buffer.concat([u32(data.length), t, data, u32(crc >>> 0)]);
}
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return c ^ 0xffffffff; }

main().catch((e) => { console.error(e); process.exit(1); });
