/**
 * 批量导出全部页面为 PNG ZIP。
 *
 * 第七轮起：jszip 改为动态导入，降低主包体积。
 */
import type { CanvasPage, HandwritingProfile, NaturalnessParams } from "@hw-layout/shared";
import { downloadURL, exportFilename } from "./image.js";
import { renderPageToDataURL, preloadPageGlyphs, type GlyphImageStore } from "./offscreenRender.js";

export interface ZipExportOptions {
  profiles: HandwritingProfile[];
  activeProfileId: string | null;
  naturalness: NaturalnessParams;
  naturalnessEnabled: boolean;
  exportSeed?: number;
  scale?: number;
  /** 进度回调（当前页索引从 1 开始，总页数） */
  onProgress?: (current: number, total: number) => void;
}

/**
 * 导出全部页面为 PNG ZIP。
 * 逐页 await 渲染，避免 UI 完全卡死。
 */
export async function exportPagesToZip(
  pages: CanvasPage[],
  opts: ZipExportOptions,
): Promise<void> {
  if (pages.length === 0) return;
  // 动态导入 jszip，仅在导出时加载
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const baseName = exportFilename("pages").replace(/\.pages$/, "");

  // 预加载所有页的 glyph（一次性，减少重复加载）
  let glyphStore: GlyphImageStore = new Map();
  for (const page of pages) {
    glyphStore = await preloadPageGlyphs(
      page,
      opts.profiles,
      opts.activeProfileId,
      glyphStore,
    );
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    opts.onProgress?.(i + 1, pages.length);
    const dataURL = await renderPageToDataURL(page, {
      profiles: opts.profiles,
      activeProfileId: opts.activeProfileId,
      naturalness: opts.naturalness,
      naturalnessEnabled: opts.naturalnessEnabled,
      exportSeed: opts.exportSeed,
      scale: opts.scale,
      glyphStore,
    });
    const base64 = dataURL.replace(/^data:image\/png;base64,/, "");
    const pageStr = String(i + 1).padStart(3, "0");
    zip.file(`${baseName}-page-${pageStr}.png`, base64, { base64: true });
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  downloadURL(url, `${baseName}.zip`);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
