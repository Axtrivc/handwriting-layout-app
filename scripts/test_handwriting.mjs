// @ts-nocheck
/**
 * 手写字形系统综合自动化测试（Node + fetch）。
 *
 * 覆盖：
 * 1. 创建 profile
 * 2. 导入样本图
 * 3. 切割并保存 glyph（调用真实 /segment-glyph）
 * 4. 同一字符多个 variant
 * 5. 搜索 glyph
 * 6. 删除 glyph
 * 7. seed 选择 variant 一致性
 * 8. 项目 JSON round-trip（含 profiles/renderMode）
 *
 * 前提：后端已启动在 http://127.0.0.1:8001
 *
 * 用法：node scripts/test_handwriting.mjs
 */
import {
  createEmptyProject,
  serializeProject,
  deserializeProject,
  pickVariant,
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
  console.log("=== 手写字形系统综合测试 ===\n");

  // 1. 后端连通
  console.log("[1] 后端连通");
  const health = await (await fetch(`${API}/health`)).json();
  assert(health.status === "ok", `/health 返回 ok (v${health.version})`);

  // 生成样本图：用 Python 风格的 base64（这里用 Node 生成简单 PNG）
  const sampleDataURL = await makeBlackBlocksPNG(200, 120, 4);

  // 2. 创建 profile
  console.log("\n[2] 创建手写档案");
  let project = createEmptyProject();
  const profId = "prof-test";
  const now = new Date().toISOString();
  project.handwritingProfiles.push({
    id: profId,
    name: "测试档案",
    createdAt: now,
    updatedAt: now,
    sampleSets: [],
    glyphs: [],
    defaultRenderSettings: { ...DEFAULT_RENDER_SETTINGS },
  });
  project.activeHandwritingProfileId = profId;
  assert(project.handwritingProfiles.length === 1, "profile 已创建");
  assert(project.activeHandwritingProfileId === profId, "活动档案已设置");

  // 3. 导入样本
  console.log("\n[3] 导入样本图");
  const sampleSet = {
    id: "ss-1",
    profileId: profId,
    name: "样本1",
    imageBase64: sampleDataURL,
    sourceImageWidth: 200,
    sourceImageHeight: 120,
    createdAt: now,
    status: "imported",
  };
  project.handwritingProfiles[0].sampleSets.push(sampleSet);
  assert(
    project.handwritingProfiles[0].sampleSets.length === 1,
    "样本图已导入",
  );

  // 4. 切割 glyph（调用 /segment-glyph）
  console.log("\n[4] 切割并保存字形（调真实后端）");
  const base64 = sampleDataURL.replace(/^data:image\/png;base64,/, "");
  const segRes = await fetch(`${API}/segment-glyph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: base64,
      mime: "image/png",
      bbox: { x: 10, y: 10, width: 40, height: 40 },
      transparent: true,
    }),
  });
  const segData = await segRes.json();
  assert(segRes.status === 200, `/segment-glyph 返回 200`);
  assert(segData.width > 0 && segData.height > 0, `字形尺寸 ${segData.width}x${segData.height}`);

  // 5. 同一字符多个 variant
  console.log("\n[5] 同一字符多个 variant");
  for (let i = 0; i < 3; i++) {
    project.handwritingProfiles[0].glyphs.push({
      id: `g-我-${i}`,
      profileId: profId,
      char: "我",
      imageBase64: `data:${segData.mime};base64,${segData.image}`,
      bbox: { x: 10 + i * 5, y: 10, width: 40, height: 40 },
      sourceSampleSetId: "ss-1",
      variantIndex: i,
      createdAt: now,
    });
  }
  const woVariants = project.handwritingProfiles[0].glyphs.filter((g) => g.char === "我");
  assert(woVariants.length === 3, `"我" 有 3 个 variant`);

  // 6. seed 选择 variant 一致性
  console.log("\n[6] seed 选择 variant 一致性");
  const seed = 12345;
  const picked1 = pickVariant(woVariants, seed, "random");
  const picked2 = pickVariant(woVariants, seed, "random");
  assert(picked1.id === picked2.id, `同 seed 同模式选同一 variant: ${picked1.id}`);
  const pickedFirst = pickVariant(woVariants, seed, "first");
  assert(pickedFirst.id === "g-我-0", `first 模式选第 0 个`);
  const pickedWeighted = pickVariant(woVariants, seed, "weighted");
  assert(pickedWeighted !== null, `weighted 模式返回非 null`);

  // 7. 搜索 glyph
  console.log("\n[7] 搜索 glyph");
  project.handwritingProfiles[0].glyphs.push({
    id: "g-的-0",
    profileId: profId,
    char: "的",
    imageBase64: `data:${segData.mime};base64,${segData.image}`,
    bbox: { x: 50, y: 50, width: 40, height: 40 },
    sourceSampleSetId: "ss-1",
    variantIndex: 0,
    createdAt: now,
  });
  const allGlyphs = project.handwritingProfiles[0].glyphs;
  const searchWo = allGlyphs.filter((g) => g.char.includes("我"));
  const searchDe = allGlyphs.filter((g) => g.char.includes("的"));
  assert(searchWo.length === 3, `搜索"我"返回 3 个`);
  assert(searchDe.length === 1, `搜索"的"返回 1 个`);

  // 8. 删除 glyph
  console.log("\n[8] 删除 glyph");
  project.handwritingProfiles[0].glyphs = allGlyphs.filter((g) => g.id !== "g-我-1");
  assert(
    project.handwritingProfiles[0].glyphs.length === allGlyphs.length - 1,
    "删除后 glyph 数量减 1",
  );

  // 9. TextObject renderMode
  console.log("\n[9] TextObject 渲染模式");
  project.textObjects.push({
    id: "t-1",
    text: "我的",
    x: 100,
    y: 100,
    style: {
      fontFamily: "sans-serif",
      fontSize: 28,
      fontWeight: "normal",
      fontStyle: "normal",
      align: "left",
      letterSpacing: 0,
      lineHeight: 1.4,
      color: "#000",
      opacity: 1,
      rotation: 0,
      blur: 0,
    },
    zIndex: 0,
    naturalnessSeed: 999,
    renderMode: "handwritingGlyph",
    handwritingProfileId: profId,
  });
  assert(
    project.textObjects[0].renderMode === "handwritingGlyph",
    "TextObject 设为 handwritingGlyph 模式",
  );

  // 10. 项目 round-trip
  console.log("\n[10] 项目 JSON round-trip（含 profiles/renderMode）");
  const json = serializeProject(project);
  const result = deserializeProject(json);
  assert(result.ok, "反序列化成功");
  const loaded = result.project;
  assert(loaded.handwritingProfiles.length === 1, "profile 数量恢复");
  assert(loaded.activeHandwritingProfileId === profId, "活动档案恢复");
  assert(loaded.handwritingProfiles[0].glyphs.length === project.handwritingProfiles[0].glyphs.length, "glyph 数量恢复");
  assert(loaded.textObjects[0].renderMode === "handwritingGlyph", "renderMode 恢复");
  assert(loaded.textObjects[0].handwritingProfileId === profId, "handwritingProfileId 恢复");

  // 11. 旧项目兼容（无 profiles 字段）
  console.log("\n[11] 旧项目 JSON 兼容（v0.1 无 profiles/renderMode）");
  const oldProject = {
    appVersion: "0.1.0",
    backgroundImage: null,
    width: 800,
    height: 600,
    textObjects: [
      { id: "old-1", text: "旧文本", x: 10, y: 10, style: { fontSize: 20 } },
    ],
    naturalnessEnabled: false,
    naturalness: {},
    cleanHistory: [],
  };
  const oldResult = deserializeProject(JSON.stringify(oldProject));
  assert(oldResult.ok, "旧项目加载成功");
  assert(oldResult.project.handwritingProfiles.length === 0, "旧项目 profiles 为空");
  assert(oldResult.project.textObjects[0].renderMode === "font", "旧 TextObject 默认 font 模式");

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ===== 生成最小 PNG（白底 + 黑方块）的 base64 dataURL =====
async function makeBlackBlocksPNG(w, h, count) {
  // 构造一个 PNG：白底，count 个 30x30 黑方块
  const { deflateSync } = await import("node:zlib");
  const { Buffer } = await import("node:buffer");

  // RGB 像素，每行加 filter byte (0)
  const rowLen = w * 3;
  const raw = Buffer.alloc((rowLen + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (rowLen + 1)] = 0; // filter none
    for (let x = 0; x < w; x++) {
      // 黑方块区域
      let isBlack = false;
      for (let i = 0; i < count; i++) {
        if (x >= 10 + 50 * i && x < 40 + 50 * i && y >= 10 && y < 40) {
          isBlack = true;
          break;
        }
      }
      const v = isBlack ? 0 : 255;
      const off = y * (rowLen + 1) + 1 + x * 3;
      raw[off] = v;
      raw[off + 1] = v;
      raw[off + 2] = v;
    }
  }
  const compressed = deflateSync(raw);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = makeChunk("IHDR", Buffer.concat([
    u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0]),
  ]));
  const idat = makeChunk("IDAT", compressed);
  const iend = makeChunk("IEND", Buffer.alloc(0));

  const png = Buffer.concat([sig, ihdr, idat, iend]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

/** 构造一个 PNG chunk：[length][type][data][crc] */
function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = u32(data.length);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  return Buffer.concat([lenBuf, typeBuf, data, u32(crc >>> 0)]);
}

// CRC32 for PNG
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c ^ 0xffffffff;
}
