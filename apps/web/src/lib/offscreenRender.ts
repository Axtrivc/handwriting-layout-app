/**
 * 离屏渲染：把一页（含 handwritingGlyph + naturalness + 对齐）绘制到 canvas。
 *
 * 用于非活动页的 PDF / PNG 导出，保证与活动页视觉一致。
 * 使用 shared/textLayout 的统一布局核心，避免三套算法不一致。
 *
 * 图片加载是异步的，本模块所有函数返回 Promise，显式 await image.onload。
 */
import {
  collectGlyphKeys,
  layoutText,
  type CanvasPage,
  type HandwritingProfile,
  type NaturalnessParams,
} from "@hw-layout/shared";

/** glyphKey("profileId:glyphId") -> HTMLImageElement 的缓存。 */
export type GlyphImageStore = Map<string, HTMLImageElement>;

/** 显式加载一张图片，resolve 在 onload 后。 */
export function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * 预加载一页所需的所有 glyph 图片，返回 glyphKey -> HTMLImageElement 映射。
 * 显式 await 每个 image.onload。
 */
export async function preloadPageGlyphs(
  page: CanvasPage,
  profiles: HandwritingProfile[],
  activeProfileId: string | null,
  existing: GlyphImageStore = new Map(),
): Promise<GlyphImageStore> {
  const store: GlyphImageStore = new Map(existing);
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  for (const obj of page.textObjects) {
    if (obj.renderMode !== "handwritingGlyph") continue;
    const pid = obj.handwritingProfileId ?? activeProfileId;
    const profile = pid ? (profileMap.get(pid) ?? null) : null;
    if (!profile) continue;
    const keys = collectGlyphKeys(obj, profile);
    for (const key of keys) {
      if (store.has(key)) continue;
      const glyphId = key.split(":")[1];
      const glyph = profile.glyphs.find((g) => g.id === glyphId);
      if (!glyph) continue;
      try {
        const img = await loadImageEl(glyph.imageBase64);
        store.set(key, img);
      } catch {
        /* 单个 glyph 加载失败，渲染时 fallback 字体 */
      }
    }
  }
  return store;
}

export interface OffscreenRenderOptions {
  profiles: HandwritingProfile[];
  activeProfileId: string | null;
  naturalness: NaturalnessParams;
  naturalnessEnabled: boolean;
  /** 导出种子（应用 naturalness 时保证稳定） */
  exportSeed?: number;
  /** 倍率（1 = 原图尺寸，2 = 高清 2x） */
  scale?: number;
  /** 已预加载的 glyph 图片缓存 */
  glyphStore?: GlyphImageStore;
}

/**
 * 离屏渲染一页为 canvas。
 *
 * @returns HTMLCanvasElement（调用方可用 toDataURL 取图）
 */
export async function renderPageOffscreen(
  page: CanvasPage,
  opts: OffscreenRenderOptions,
): Promise<HTMLCanvasElement> {
  const scale = opts.scale ?? 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(page.originalWidth * scale);
  canvas.height = Math.round(page.originalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法获取 canvas 上下文");

  ctx.scale(scale, scale);

  // 背景
  if (page.backgroundImage) {
    const bg = await loadImageEl(page.backgroundImage);
    ctx.drawImage(bg, 0, 0, page.originalWidth, page.originalHeight);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, page.originalWidth, page.originalHeight);
  }

  const profileMap = new Map(opts.profiles.map((p) => [p.id, p]));
  const glyphStore = opts.glyphStore ?? new Map();
  const applyJitter = opts.naturalnessEnabled;

  // glyphSize 查询函数（供 layoutText 用）
  const glyphSize = (key: string) => {
    const img = glyphStore.get(key);
    if (!img) return null;
    return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  };

  // 文本对象按 zIndex 排序
  const sorted = [...page.textObjects].sort((a, b) => a.zIndex - b.zIndex);
  for (const obj of sorted) {
    const pid = obj.handwritingProfileId ?? opts.activeProfileId;
    const profile = obj.renderMode === "handwritingGlyph" && pid ? (profileMap.get(pid) ?? null) : null;

    const layout = layoutText(obj, {
      glyphSize,
      profile,
      applyJitter,
      naturalness: opts.naturalness,
      letterSpacing: obj.style.letterSpacing,
      exportSeed: opts.exportSeed,
    });

    // 逐字绘制
    for (const line of layout.lines) {
      for (const lg of line.glyphs) {
        ctx.save();
        ctx.globalAlpha = lg.opacity;
        if (lg.isGlyph && lg.glyphKey) {
          const img = glyphStore.get(lg.glyphKey);
          if (img) {
            // 旋转以字中心为轴
            ctx.translate(lg.x + lg.width / 2, lg.y + lg.height / 2);
            if (applyJitter && opts.naturalness.rotationJitter > 0) {
              // 旋转抖动（与 Konva 一致：obj.style.rotation 为基础，这里 glyph 不再加 obj 旋转避免双重）
            }
            ctx.drawImage(img, -lg.width / 2, -lg.height / 2, lg.width, lg.height);
          } else {
            // glyph 图片缺失，fallback 字体
            drawFallbackChar(ctx, lg, obj.style);
          }
        } else {
          drawFallbackChar(ctx, lg, obj.style);
        }
        ctx.restore();
      }
    }
  }

  return canvas;
}

/** 用字体绘制单个 fallback 字符。 */
function drawFallbackChar(
  ctx: CanvasRenderingContext2D,
  lg: { ch: string; x: number; y: number; fontSize: number; opacity: number },
  style: { fontFamily: string; fontWeight: string; fontStyle: string; color: string; rotation: number; blur: number },
): void {
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${lg.fontSize}px ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  // baseline 对齐：canvas fillText 的 y 是基线位置，近似用 y + fontSize*0.8
  ctx.fillText(lg.ch, lg.x, lg.y + lg.fontSize * 0.8);
}

/** 离屏渲染一页为 dataURL。 */
export async function renderPageToDataURL(
  page: CanvasPage,
  opts: OffscreenRenderOptions,
): Promise<string> {
  const canvas = await renderPageOffscreen(page, opts);
  return canvas.toDataURL("image/png");
}
