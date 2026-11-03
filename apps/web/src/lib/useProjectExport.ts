import { useCallback, useRef, useState } from "react";
import { missingChars, type CanvasProject, type CanvasPage } from "@hw-layout/shared";
import { exportPagesToPDF, exportSinglePageToPDF } from "./pdfExport.js";
import { exportPagesToZip } from "./zipExport.js";
import { preloadPageGlyphs, renderPageToDataURL as renderPageOffscreenDataURL } from "./offscreenRender.js";
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "./exportTypes.js";
import { downloadURL, exportFilename } from "./image.js";

export function useProjectExport(project: CanvasProject, activePage: CanvasPage | null,
  showToast: (message: string) => void, setCleanError: (message: string) => void) {
  // ===== 导出 =====
  // Object seeds are persisted in the document; reopening it must not change output.
  const exportSeedRef = useRef(0);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [exportProgress, setExportProgress] = useState<string | null>(null);

  // 用统一的离屏渲染某一页（活动页与非活动页视觉一致，含 glyph + naturalness）
  const renderPage = useCallback(
    async (page: CanvasPage, scale: number) => {
      // 预加载该页 glyph
      const glyphStore = await preloadPageGlyphs(
        page,
        project.handwritingProfiles,
        project.activeHandwritingProfileId,
      );
      return renderPageOffscreenDataURL(page, {
        profiles: project.handwritingProfiles,
        activeProfileId: project.activeHandwritingProfileId,
        naturalness: project.settings.naturalness,
        naturalnessEnabled: project.settings.naturalnessEnabled,
        exportSeed: exportSeedRef.current,
        scale,
        glyphStore,
      });
    },
    [project],
  );

  // 缺字检查：返回各页缺字汇总
  const checkMissingBeforeExport = useCallback((): string | null => {
    const profileMap = new Map(
      project.handwritingProfiles.map((p) => [p.id, p]),
    );
    const perPage: string[] = [];
    for (let i = 0; i < project.pages.length; i++) {
      const page = project.pages[i];
      const allMissing = new Set<string>();
      for (const obj of page.textObjects) {
        if (obj.renderMode !== "handwritingGlyph") continue;
        const pid = obj.handwritingProfileId ?? project.activeHandwritingProfileId;
        const prof = pid ? (profileMap.get(pid) ?? null) : null;

        const covered = new Set((prof?.glyphs ?? []).map((g) => g.char));
        for (const m of missingChars(obj.text, covered)) allMissing.add(m);
      }
      if (allMissing.size > 0) {
        perPage.push(`第 ${i + 1} 页：${[...allMissing].join("、")}`);
      }
    }
    if (perPage.length === 0) return null;
    return `部分页面有缺失字形，将用普通字体代替：\n${perPage.join("\n")}`;
  }, [project]);

  const handleExportPNG = useCallback(async () => {
    if (!activePage) return;
    const miss = checkMissingBeforeExport();
    if (miss && !window.confirm(`${miss}\n\n是否继续导出？`)) return;
    setExportProgress("正在生成 PNG…");
    try {
      const dataURL = await renderPage(activePage, exportSettings.pngScale);
      const idx = project.pages.findIndex(p => p.id === activePage.id);
      downloadURL(dataURL, exportFilename("png", new Date(), idx + 1));
      showToast("已导出当前页 PNG");
    } catch (err) {
      setCleanError(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { setExportProgress(null); }
  }, [activePage, project.pages, renderPage, exportSettings.pngScale, showToast, setCleanError, checkMissingBeforeExport]);

  // 导出当前页 PDF
  const handleExportSinglePDF = useCallback(async () => {
    if (!activePage) return;
    const miss = checkMissingBeforeExport();
    if (miss && !window.confirm(`${miss}\n\n是否继续导出？`)) return;
    setExportProgress("正在生成 PDF…");
    try {
      const dataURL = await renderPage(activePage, exportSettings.pngScale);
      await exportSinglePageToPDF(
        dataURL,
        activePage.originalWidth,
        activePage.originalHeight,
        exportSettings.pdfCompression,
      );
      showToast("已导出当前页 PDF");
    } catch (err) {
      setCleanError(`PDF 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportProgress(null);
    }
  }, [activePage, renderPage, exportSettings, showToast, setCleanError, checkMissingBeforeExport]);

  // 导出全部页 PDF
  const handleExportAllPDF = useCallback(async () => {
    if (project.pages.length === 0) return;
    const miss = checkMissingBeforeExport();
    if (miss && !window.confirm(`${miss}\n\n是否继续导出？`)) return;
    try {
      const inputs: { dataURL: string; width: number; height: number }[] = [];
      for (let i = 0; i < project.pages.length; i++) {
        setExportProgress(`正在生成 PDF ${i + 1}/${project.pages.length}`);
        const page = project.pages[i];
        const dataURL = await renderPage(page, exportSettings.pngScale);
        inputs.push({
          dataURL,
          width: page.originalWidth,
          height: page.originalHeight,
        });
      }
      await exportPagesToPDF(inputs, exportSettings.pdfCompression);
      showToast(`已导出 ${project.pages.length} 页 PDF`);
    } catch (err) {
      setCleanError(`PDF 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportProgress(null);
    }
  }, [project.pages, renderPage, exportSettings, showToast, setCleanError, checkMissingBeforeExport]);

  // 导出全部页 PNG ZIP
  const handleExportAllZip = useCallback(async () => {
    if (project.pages.length === 0) return;
    const miss = checkMissingBeforeExport();
    if (miss && !window.confirm(`${miss}\n\n是否继续导出？`)) return;
    try {
      await exportPagesToZip(project.pages, {
        profiles: project.handwritingProfiles,
        activeProfileId: project.activeHandwritingProfileId,
        naturalness: project.settings.naturalness,
        naturalnessEnabled: project.settings.naturalnessEnabled,
        exportSeed: exportSeedRef.current,
        scale: exportSettings.pngScale,
        onProgress: (cur, total) => setExportProgress(`正在导出 ${cur}/${total}`),
      });
      showToast(`已导出 ${project.pages.length} 页 PNG ZIP`);
    } catch (err) {
      setCleanError(`ZIP 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportProgress(null);
    }
  }, [project.pages, project.handwritingProfiles, project.activeHandwritingProfileId, project.settings, exportSettings.pngScale, showToast, setCleanError, checkMissingBeforeExport]);

  const busy = useRef(false);
  const exclusive = (task: () => Promise<void>) => async () => {
    if (busy.current) return;
    busy.current = true;
    try { await task(); } finally { busy.current = false; }
  };
  return { exportSettings, setExportSettings, exportProgress,
    handleExportPNG: exclusive(handleExportPNG), handleExportSinglePDF: exclusive(handleExportSinglePDF),
    handleExportAllPDF: exclusive(handleExportAllPDF), handleExportAllZip: exclusive(handleExportAllZip) };
}
