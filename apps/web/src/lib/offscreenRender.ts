/**
 * 离屏渲染：把一页（含 handwritingGlyph + naturalness + 对齐）绘制到 canvas。
 *
 * 用于非活动页的 PDF / PNG 导出，保证与活动页视觉一致。
 * 使用 shared/textLayout 的统一布局核心，避免三套算法不一致。
 *
 * 图片加载是异步的，本模块所有函数返回 Promise，显式 await image.onload。
 */
import Konva from "konva";
import { collectGlyphKeys, type CanvasPage, type HandwritingProfile, type NaturalnessParams } from "@hw-layout/shared";
import { textScene } from "./textScene.js";

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
  const width = Math.round(page.originalWidth * scale);
  const height = Math.round(page.originalHeight * scale);
  if (!Number.isFinite(width * height) || width < 1 || height < 1 ||
      width > 16384 || height > 16384 || width * height > 64_000_000) {
    throw new Error("导出尺寸过大或无效，请降低倍率或缩小原图。");
  }
  await document.fonts.ready;
  const container = document.createElement("div");
  const stage = new Konva.Stage({ container, width: page.originalWidth, height: page.originalHeight });
  try {
    const layer = new Konva.Layer();
    stage.add(layer);
    if (page.backgroundImage) layer.add(new Konva.Image({ image: await loadImageEl(page.backgroundImage),
      width: page.originalWidth, height: page.originalHeight }));
    else layer.add(new Konva.Rect({ width: page.originalWidth, height: page.originalHeight, fill: "white" }));
    const profiles = new Map(opts.profiles.map(p => [p.id, p]));
    const images = opts.glyphStore ?? await preloadPageGlyphs(page, opts.profiles, opts.activeProfileId);
    for (const obj of [...page.textObjects].sort((a, b) => a.zIndex - b.zIndex)) {
      const profile = profiles.get(obj.handwritingProfileId ?? opts.activeProfileId ?? "") ?? null;
      const scene = textScene(obj, profile, images, opts.naturalnessEnabled ? opts.naturalness : undefined, opts.exportSeed);
      const group = new Konva.Group(scene.transform);
      for (const node of scene.nodes) group.add(node.kind === 'text' ? new Konva.Text(node.attrs) : new Konva.Image(node.attrs));
      layer.add(group);
    }
    layer.draw();
    return stage.toCanvas({ pixelRatio: scale });
  } finally {
    stage.destroy();
    container.remove();
  }
}

/** 离屏渲染一页为 dataURL。 */
export async function renderPageToDataURL(
  page: CanvasPage,
  opts: OffscreenRenderOptions,
): Promise<string> {
  const canvas = await renderPageOffscreen(page, opts);
  return canvas.toDataURL("image/png");
}
