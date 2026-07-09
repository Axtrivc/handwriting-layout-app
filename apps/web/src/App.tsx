import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import {
  DEFAULT_TEXT_STYLE,
  createBlankPage,
  createEmptyProject,
  deserializeProject,
  nowISO,
  serializeProject,
  type CanvasPage,
  type CanvasProject,
  type GlyphBoundingBox,
  type GlyphCandidate,
  type HandwritingProfile,
  type NaturalnessParams,
  type OcrResultResponse,
  type TextObject,
} from "@hw-layout/shared";
import { CanvasStage, type SelectionRect } from "./components/CanvasStage.js";
import { LeftPanel } from "./components/LeftPanel.js";
import { StylePanel } from "./components/StylePanel.js";
import { ConnectionBadge } from "./components/ConnectionBadge.js";
import { ProfileManager } from "./components/ProfileManager.js";
import { GlyphSegmenter } from "./components/GlyphSegmenter.js";
import { PagePanel } from "./components/PagePanel.js";
import { useGlyphImages } from "./components/GlyphText.js";
import { useConnection } from "./lib/useConnection.js";
import { useHandwriting } from "./lib/useHandwriting.js";
import { useHistory } from "./lib/useHistory.js";
import { ApiError, cleanRegion, detectGlyphCandidates, getOcrStatus, suggestGlyphLabels } from "./lib/apiClient.js";
import { exportPagesToPDF, exportSinglePageToPDF, type PdfCompression } from "./lib/pdfExport.js";
import { exportPagesToZip } from "./lib/zipExport.js";
import {
  preloadPageGlyphs,
  renderPageToDataURL as renderPageOffscreenDataURL,
} from "./lib/offscreenRender.js";
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "./lib/exportTypes.js";
import { missingChars } from "@hw-layout/shared";
import {
  downloadText,
  downloadURL,
  exportFilename,
  fileToDataURL,
  fileToText,
  loadImage,
  pickFile,
  randomSeed,
  splitDataURL,
  joinDataURL,
  uid,
} from "./lib/image.js";

/** 手写切割器打开的目标。 */
interface SegmenterTarget {
  profileId: string;
  sampleSetId: string;
}

/** 每页的背景图缓存：pageId -> HTMLImageElement。 */
type ImageCache = Map<string, HTMLImageElement>;

export default function App() {
  const [project, setProject] = useState<CanvasProject>(() => createEmptyProject());
  const [imageCache, setImageCache] = useState<ImageCache>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  // 框选清除区域状态（作用于当前页）
  const [selectMode, setSelectMode] = useState(false);
  const [selections, setSelections] = useState<SelectionRect[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // 手写切割器
  const [segmenterTarget, setSegmenterTarget] = useState<SegmenterTarget | null>(null);
  const [segmenterImage, setSegmenterImage] = useState<HTMLImageElement | null>(null);
  const [segSaving, setSegSaving] = useState(false);
  const [segError, setSegError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<OcrResultResponse | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { status, apiBase, updateApiBase, reconnect } = useConnection();

  // ===== 派生：当前页 =====
  const activePage = useMemo<CanvasPage | null>(
    () => project.pages.find((p) => p.id === project.activePageId) ?? null,
    [project.pages, project.activePageId],
  );
  const activeImage = useMemo<HTMLImageElement | null>(
    () => (activePage ? (imageCache.get(activePage.id) ?? null) : null),
    [activePage, imageCache],
  );

  // ===== 手写档案管理（project 级） =====
  const hw = useHandwriting({
    profiles: project.handwritingProfiles,
    activeProfileId: project.activeHandwritingProfileId,
    onProfilesChange: (profiles) =>
      setProject((p) => ({ ...p, handwritingProfiles: profiles })),
    onActiveChange: (id) =>
      setProject((p) => ({ ...p, activeHandwritingProfileId: id })),
  });
  const glyphImages = useGlyphImages(
    project.handwritingProfiles,
    project.activeHandwritingProfileId,
  );

  const selected = useMemo(
    () => activePage?.textObjects.find((t) => t.id === selectedId) ?? null,
    [activePage, selectedId],
  );

  // ===== 文本撤销栈（每页独立） =====
  const history = useHistory();

  // 后端连接后查询 OCR 状态
  useEffect(() => {
    if (status.kind === "connected") {
      void getOcrStatus().then(setOcrStatus).catch(() => setOcrStatus(null));
    }
  }, [status.kind]);

  // 未保存提示：刷新/关闭页面
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2200);
  }, []);

  // ===== 页面级状态更新辅助 =====
  const updatePage = useCallback(
    (pageId: string, updater: (page: CanvasPage) => CanvasPage) => {
      setProject((p) => ({
        ...p,
        updatedAt: nowISO(),
        pages: p.pages.map((pg) => (pg.id === pageId ? updater(pg) : pg)),
      }));
      setDirty(true);
    },
    [],
  );

  const touchProject = useCallback(
    (fn: (p: CanvasProject) => CanvasProject) => {
      setProject((p) => ({ ...fn(p), updatedAt: nowISO() }));
      setDirty(true);
    },
    [],
  );

  // ===== 背景图缓存 =====
  const applyBackground = useCallback(
    async (pageId: string, dataURL: string, width: number, height: number) => {
      const img = await loadImage(dataURL);
      setImageCache((cache) => {
        const next = new Map(cache);
        next.set(pageId, img);
        return next;
      });
      updatePage(pageId, (pg) => ({
        ...pg,
        backgroundImage: dataURL,
        originalWidth: width,
        originalHeight: height,
        updatedAt: nowISO(),
      }));
    },
    [updatePage],
  );

  // ===== 上传图片到当前页 =====
  const handleUpload = useCallback(
    async (file: File) => {
      if (!activePage) return;
      const dataURL = await fileToDataURL(file);
      const img = await loadImage(dataURL);
      await applyBackground(activePage.id, dataURL, img.naturalWidth, img.naturalHeight);
      setSelections([]);
      setSelectedId(null);
      setCleanError(null);
    },
    [activePage, applyBackground],
  );

  // ===== 多图导入：每张图建一页（按文件名排序） =====
  const handleImportImages = useCallback(
    async (files: File[]) => {
      // 按文件名排序
      const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "zh"));
      const newPages: CanvasPage[] = [];
      for (const file of sorted) {
        const dataURL = await fileToDataURL(file);
        const img = await loadImage(dataURL);
        const idx = project.pages.length + newPages.length;
        const page = createBlankPage(idx, file.name.replace(/\.[^.]+$/, ""));
        page.backgroundImage = dataURL;
        page.originalWidth = img.naturalWidth;
        page.originalHeight = img.naturalHeight;
        newPages.push(page);
        // 预载缓存
        setImageCache((cache) => {
          const next = new Map(cache);
          next.set(page.id, img);
          return next;
        });
      }
      touchProject((p) => ({
        ...p,
        pages: [...p.pages, ...newPages],
        activePageId: newPages[0]?.id ?? p.activePageId,
      }));
      showToast(`已导入 ${newPages.length} 页`);
    },
    [project.pages.length, touchProject, showToast],
  );

  // ===== 页面 CRUD =====
  const handleAddPage = useCallback(() => {
    touchProject((p) => {
      const idx = p.pages.length;
      const page = createBlankPage(idx);
      return { ...p, pages: [...p.pages, page], activePageId: page.id };
    });
    setSelectedId(null);
    setSelections([]);
  }, [touchProject]);

  const handleDeletePage = useCallback(
    (id: string) => {
      touchProject((p) => {
        if (p.pages.length <= 1) return p;
        const idx = p.pages.findIndex((pg) => pg.id === id);
        const pages = p.pages.filter((pg) => pg.id !== id).map((pg, i) => ({ ...pg, index: i }));
        const activePageId =
          p.activePageId === id
            ? (pages[Math.min(idx, pages.length - 1)]?.id ?? null)
            : p.activePageId;
        return { ...p, pages, activePageId };
      });
      setImageCache((cache) => {
        const next = new Map(cache);
        next.delete(id);
        return next;
      });
      setSelectedId(null);
      setSelections([]);
    },
    [touchProject],
  );

  const handleDuplicatePage = useCallback(
    (id: string) => {
      touchProject((p) => {
        const src = p.pages.find((pg) => pg.id === id);
        if (!src) return p;
        const idx = p.pages.findIndex((pg) => pg.id === id) + 1;
        const copy: CanvasPage = {
          ...src,
          id: uid("page"),
          name: `${src.name} 副本`,
          textObjects: src.textObjects.map((t) => ({ ...t, id: uid("obj"), naturalnessSeed: randomSeed() })),
          cleanHistory: [],
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        const pages = [...p.pages];
        pages.splice(idx, 0, copy);
        const reindexed = pages.map((pg, i) => ({ ...pg, index: i }));
        return { ...p, pages: reindexed, activePageId: copy.id };
      });
      setSelectedId(null);
      setSelections([]);
    },
    [touchProject],
  );

  const handleRenamePage = useCallback(
    (id: string, name: string) => {
      updatePage(id, (pg) => ({ ...pg, name, updatedAt: nowISO() }));
    },
    [updatePage],
  );

  const handleMovePage = useCallback(
    (id: string, direction: -1 | 1) => {
      touchProject((p) => {
        const idx = p.pages.findIndex((pg) => pg.id === id);
        if (idx < 0) return p;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= p.pages.length) return p;
        const pages = [...p.pages];
        const [moved] = pages.splice(idx, 1);
        pages.splice(newIdx, 0, moved);
        const reindexed = pages.map((pg, i) => ({ ...pg, index: i }));
        return { ...p, pages: reindexed };
      });
    },
    [touchProject],
  );

  const handleSetActivePage = useCallback((id: string) => {
    setProject((p) => ({ ...p, activePageId: id }));
    setSelectedId(null);
    setSelections([]);
    setCleanError(null);
  }, []);

  // ===== 文本对象操作（作用于当前页） =====
  const nextZ = useCallback(
    () => (activePage?.textObjects ?? []).reduce((m, t) => Math.max(m, t.zIndex), -1) + 1,
    [activePage],
  );

  const handleAddText = useCallback(() => {
    if (!activePage || selectMode) return;
    history.push(activePage.id, activePage.textObjects);
    const newObj: TextObject = {
      id: uid(),
      text: "双击编辑文本",
      x: activePage.originalWidth / 2,
      y: activePage.originalHeight / 2,
      style: { ...DEFAULT_TEXT_STYLE },
      zIndex: nextZ(),
      naturalnessSeed: randomSeed(),
      renderMode: "font",
      handwritingProfileId: null,
    };
    updatePage(activePage.id, (pg) => ({
      ...pg,
      textObjects: [...pg.textObjects, newObj],
      updatedAt: nowISO(),
    }));
    setSelectedId(newObj.id);
  }, [activePage, selectMode, nextZ, updatePage, history]);

  const handleChange = useCallback(
    (obj: TextObject) => {
      if (!activePage) return;
      history.push(activePage.id, activePage.textObjects);
      updatePage(activePage.id, (pg) => ({
        ...pg,
        textObjects: pg.textObjects.map((t) => (t.id === obj.id ? obj : t)),
        updatedAt: nowISO(),
      }));
    },
    [activePage, updatePage, history],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (!activePage) return;
      history.push(activePage.id, activePage.textObjects);
      updatePage(activePage.id, (pg) => ({
        ...pg,
        textObjects: pg.textObjects.filter((t) => t.id !== id),
        updatedAt: nowISO(),
      }));
      if (selectedId === id) setSelectedId(null);
    },
    [activePage, selectedId, updatePage, history],
  );

  const handleDuplicate = useCallback(
    (id: string) => {
      if (!activePage) return;
      const src = activePage.textObjects.find((t) => t.id === id);
      if (!src) return;
      history.push(activePage.id, activePage.textObjects);
      const copy: TextObject = {
        ...src,
        id: uid(),
        x: src.x + 16,
        y: src.y + 16,
        style: { ...src.style },
        zIndex: nextZ(),
        naturalnessSeed: randomSeed(),
      };
      updatePage(activePage.id, (pg) => ({
        ...pg,
        textObjects: [...pg.textObjects, copy],
        updatedAt: nowISO(),
      }));
      setSelectedId(copy.id);
    },
    [activePage, nextZ, updatePage, history],
  );

  const handleBringToFront = useCallback(
    (id: string) => {
      if (!activePage) return;
      const top = nextZ();
      const obj = activePage.textObjects.find((t) => t.id === id);
      if (!obj) return;
      handleChange({ ...obj, zIndex: top + 1 });
    },
    [activePage, nextZ, handleChange],
  );

  const handleSendToBack = useCallback(
    (id: string) => {
      if (!activePage) return;
      const minZ = activePage.textObjects.reduce((m, t) => Math.min(m, t.zIndex), 0);
      const obj = activePage.textObjects.find((t) => t.id === id);
      if (!obj) return;
      handleChange({ ...obj, zIndex: minZ - 1 });
    },
    [activePage, handleChange],
  );

  // ===== 文本撤销/重做 =====
  const handleUndo = useCallback(() => {
    if (!activePage) return;
    const prev = history.undo(activePage.id);
    if (prev) {
      updatePage(activePage.id, (pg) => ({ ...pg, textObjects: prev, updatedAt: nowISO() }));
      showToast("已撤销");
    }
  }, [activePage, history, updatePage, showToast]);

  const handleRedo = useCallback(() => {
    if (!activePage) return;
    const next = history.redo(activePage.id);
    if (next) {
      updatePage(activePage.id, (pg) => ({ ...pg, textObjects: next, updatedAt: nowISO() }));
      showToast("已重做");
    }
  }, [activePage, history, updatePage, showToast]);

  // 快捷键 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  // ===== 自然化（项目级设置） =====
  const handleToggleNaturalness = useCallback((enabled: boolean) => {
    touchProject((p) => ({
      ...p,
      settings: { ...p.settings, naturalnessEnabled: enabled },
    }));
  }, [touchProject]);

  const handleChangeNaturalness = useCallback(
    (patch: Partial<NaturalnessParams>) => {
      touchProject((p) => ({
        ...p,
        settings: {
          ...p.settings,
          naturalness: { ...p.settings.naturalness, ...patch },
        },
      }));
    },
    [touchProject],
  );

  // ===== 框选清除（作用于当前页） =====
  const handleToggleSelectMode = useCallback((enabled: boolean) => {
    setSelectMode(enabled);
    if (enabled) setSelectedId(null);
  }, []);

  const handleSelectionEnd = useCallback((rect: Omit<SelectionRect, "id">) => {
    setSelections((prev) => [...prev, { ...rect, id: uid() }]);
  }, []);

  const handleSelectionUpdate = useCallback(
    (id: string, rect: Omit<SelectionRect, "id">) => {
      setSelections((prev) => prev.map((s) => (s.id === id ? { ...s, ...rect } : s)));
    },
    [],
  );

  const handleClearSelections = useCallback(() => {
    setSelections([]);
    setCleanError(null);
  }, []);

  const handleUndoClean = useCallback(() => {
    if (!activePage) return;
    const last = activePage.cleanHistory[activePage.cleanHistory.length - 1];
    if (!last) return;
    void applyBackground(activePage.id, last.beforeImage, activePage.originalWidth, activePage.originalHeight);
    updatePage(activePage.id, (pg) => ({
      ...pg,
      cleanHistory: pg.cleanHistory.slice(0, -1),
      updatedAt: nowISO(),
    }));
    setSelections([]);
    setCleanError(null);
    showToast("已撤销最近一次清除");
  }, [activePage, applyBackground, updatePage, showToast]);

  const handleClearRegion = useCallback(async () => {
    if (!activePage || !activePage.backgroundImage || selections.length === 0) return;
    setCleaning(true);
    setCleanError(null);
    try {
      const { data, mime } = splitDataURL(activePage.backgroundImage);
      const resp = await cleanRegion({
        image: data,
        mime,
        regions: selections.map((s) => ({
          x: Math.round(s.x),
          y: Math.round(s.y),
          width: Math.round(s.width),
          height: Math.round(s.height),
        })),
      });
      const newDataURL = joinDataURL(resp.mime, resp.image);
      const beforeImage = activePage.backgroundImage;
      await applyBackground(activePage.id, newDataURL, activePage.originalWidth, activePage.originalHeight);
      updatePage(activePage.id, (pg) => ({
        ...pg,
        cleanHistory: [
          ...pg.cleanHistory,
          { beforeImage, afterImage: newDataURL, regions: selections.map((s) => ({ x: s.x, y: s.y, width: s.width, height: s.height })) },
        ],
        updatedAt: nowISO(),
      }));
      setSelections([]);
      showToast(`已清除 ${resp.processed} 个区域`);
    } catch (err) {
      setCleanError(describeError(err));
    } finally {
      setCleaning(false);
    }
  }, [activePage, selections, applyBackground, updatePage, showToast]);

  const canUndoClean = (activePage?.cleanHistory.length ?? 0) > 0;

  // ===== 导出 =====
  const exportSeedRef = useRef<number>(randomSeed());
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
        if (!prof) continue;
        const covered = new Set(prof.glyphs.map((g) => g.char));
        for (const m of missingChars(obj.text, covered)) allMissing.add(m);
      }
      if (allMissing.size > 0) {
        perPage.push(`第 ${i + 1} 页：${[...allMissing].join("、")}`);
      }
    }
    if (perPage.length === 0) return null;
    return `部分页面有缺失字形，将用普通字体代替：\n${perPage.join("\n")}`;
  }, [project]);

  // 导出当前页 PNG（用活动页 Stage，高清）
  const handleExportPNG = useCallback(async () => {
    if (!activePage || !stageRef.current) return;
    // 缺字提示（不阻止）
    const miss = checkMissingBeforeExport();
    if (miss && !window.confirm(`${miss}\n\n是否继续导出？`)) return;

    const stage = stageRef.current;
    const prevSelected = selectedId;
    const prevSelectMode = selectMode;
    setSelectedId(null);
    setSelectMode(false);
    setExporting(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    try {
      const dataURL = stage.toDataURL({
        pixelRatio: exportSettings.pngScale / stage.scaleX(),
        x: 0,
        y: 0,
        width: activePage.originalWidth,
        height: activePage.originalHeight,
      });
      const idx = project.pages.findIndex((p) => p.id === activePage.id);
      downloadURL(dataURL, exportFilename("png", new Date(), idx + 1));
      showToast("已导出当前页 PNG");
    } catch (err) {
      setCleanError(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSelectedId(prevSelected);
      setSelectMode(prevSelectMode);
      setExporting(false);
    }
  }, [activePage, selectedId, selectMode, project.pages, exportSettings.pngScale, showToast, checkMissingBeforeExport]);

  // 导出当前页 PDF
  const handleExportSinglePDF = useCallback(async () => {
    if (!activePage) return;
    const miss = checkMissingBeforeExport();
    if (miss && !window.confirm(`${miss}\n\n是否继续导出？`)) return;
    setExportProgress("正在生成 PDF…");
    try {
      const dataURL = await renderPage(activePage, exportSettings.pngScale);
      exportSinglePageToPDF(
        dataURL,
        activePage.originalWidth * exportSettings.pngScale,
        activePage.originalHeight * exportSettings.pngScale,
        exportSettings.pdfCompression,
      );
      showToast("已导出当前页 PDF");
    } catch (err) {
      setCleanError(`PDF 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportProgress(null);
    }
  }, [activePage, renderPage, exportSettings, showToast, checkMissingBeforeExport]);

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
          width: page.originalWidth * exportSettings.pngScale,
          height: page.originalHeight * exportSettings.pngScale,
        });
      }
      exportPagesToPDF(inputs, exportSettings.pdfCompression);
      showToast(`已导出 ${project.pages.length} 页 PDF`);
    } catch (err) {
      setCleanError(`PDF 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportProgress(null);
    }
  }, [project.pages, renderPage, exportSettings, showToast, checkMissingBeforeExport]);

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
  }, [project.pages, project.handwritingProfiles, project.activeHandwritingProfileId, project.settings, exportSettings.pngScale, showToast, checkMissingBeforeExport]);

  // ===== 项目保存 / 加载 =====
  const handleSaveProject = useCallback(() => {
    const json = serializeProject(project);
    downloadText(json, exportFilename("json"), "application/json");
    setDirty(false);
    showToast("已保存项目 JSON");
  }, [project, showToast]);

  const handleLoadProject = useCallback(async () => {
    const file = await pickFile("application/json,.json");
    if (!file) return;
    try {
      const text = await fileToText(file);
      const result = deserializeProject(text);
      if (!result.ok || !result.project) {
        setCleanError(result.error ?? "项目加载失败");
        return;
      }
      const loaded = result.project;
      setProject(loaded);
      // 重建背景图缓存
      const cache: ImageCache = new Map();
      for (const page of loaded.pages) {
        if (page.backgroundImage) {
          try {
            cache.set(page.id, await loadImage(page.backgroundImage));
          } catch {
            /* 忽略单页加载失败 */
          }
        }
      }
      setImageCache(cache);
      setSelections([]);
      setSelectedId(null);
      setCleanError(null);
      exportSeedRef.current = randomSeed();
      setDirty(false);
      const migrated = loaded.pages.length === 1 && !result.project.appVersion.startsWith("0.5");
      showToast(migrated ? "已加载项目（旧版已迁移为多页）" : "已加载项目");
    } catch (err) {
      setCleanError(`加载失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [showToast]);

  // ===== 手写样本导入 =====
  const handleImportSample = useCallback(
    async (profileId: string, file: File) => {
      try {
        const dataURL = await fileToDataURL(file);
        const img = await loadImage(dataURL);
        hw.importSample(profileId, file.name, dataURL, img.naturalWidth, img.naturalHeight);
        showToast("样本图已导入");
      } catch (err) {
        setCleanError(`样本导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [hw, showToast],
  );

  const handleOpenSegmenter = useCallback(
    async (profileId: string, sampleSetId: string) => {
      const prof = project.handwritingProfiles.find((p) => p.id === profileId);
      const ss = prof?.sampleSets.find((s) => s.id === sampleSetId);
      if (!ss) return;
      try {
        setSegmenterImage(await loadImage(ss.imageBase64));
      } catch {
        setSegmenterImage(null);
      }
      setSegError(null);
      setSegmenterTarget({ profileId, sampleSetId });
    },
    [project.handwritingProfiles],
  );

  const handleCloseSegmenter = useCallback(() => {
    setSegmenterTarget(null);
    setSegmenterImage(null);
    setSegError(null);
  }, []);

  const handleSaveGlyph = useCallback(
    async (char: string, bbox: GlyphBoundingBox) => {
      if (!segmenterTarget) return;
      const prof = project.handwritingProfiles.find((p) => p.id === segmenterTarget.profileId);
      const ss = prof?.sampleSets.find((s) => s.id === segmenterTarget.sampleSetId);
      if (!ss) return;
      setSegSaving(true);
      setSegError(null);
      const res = await hw.saveGlyph(segmenterTarget.profileId, segmenterTarget.sampleSetId, char, bbox, ss.imageBase64);
      setSegSaving(false);
      if (!res.ok) setSegError(res.error);
      else showToast(`已保存字形「${char}」`);
    },
    [segmenterTarget, project.handwritingProfiles, hw, showToast],
  );

  const handleBatchSaveGlyphs = useCallback(
    async (items: { char: string; bbox: GlyphBoundingBox }[]) => {
      if (!segmenterTarget) return { saved: 0, skipped: items.length };
      const prof = project.handwritingProfiles.find((p) => p.id === segmenterTarget.profileId);
      const ss = prof?.sampleSets.find((s) => s.id === segmenterTarget.sampleSetId);
      if (!ss) return { saved: 0, skipped: items.length };
      setSegSaving(true);
      setSegError(null);
      const res = await hw.batchSaveGlyphs(segmenterTarget.profileId, segmenterTarget.sampleSetId, items, ss.imageBase64);
      setSegSaving(false);
      if (res.error) setSegError(res.error);
      else if (res.saved > 0) showToast(`批量保存 ${res.saved} 个字形`);
      return { saved: res.saved, skipped: res.skipped };
    },
    [segmenterTarget, project.handwritingProfiles, hw, showToast],
  );

  const handleDeleteGlyph = useCallback(
    (glyphId: string) => {
      if (!segmenterTarget) return;
      hw.deleteGlyph(segmenterTarget.profileId, glyphId);
    },
    [segmenterTarget, hw],
  );

  const handleDetect = useCallback(
    async (sampleDataURL: string): Promise<GlyphCandidate[]> => {
      setDetecting(true);
      setSegError(null);
      try {
        const { data, mime } = splitDataURL(sampleDataURL);
        const resp = await detectGlyphCandidates({ image: data, mime });
        return resp.candidates;
      } catch (err) {
        setSegError(describeError(err));
        return [];
      } finally {
        setDetecting(false);
      }
    },
    [],
  );

  // OCR 辅助：对候选框批量识别
  const handleSuggestLabels = useCallback(
    async (
      sampleDataURL: string,
      cands: { x: number; y: number; width: number; height: number }[],
    ): Promise<OcrResultResponse> => {
      setOcrLoading(true);
      setSegError(null);
      try {
        const { data, mime } = splitDataURL(sampleDataURL);
        return await suggestGlyphLabels({
          image: data,
          mime,
          candidates: cands.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) })),
        });
      } catch (err) {
        setSegError(describeError(err));
        return { candidates: [], provider: "none", status: "error", message: describeError(err) };
      } finally {
        setOcrLoading(false);
      }
    },
    [],
  );

  const segmenterProfile = useMemo<HandwritingProfile | null>(
    () =>
      segmenterTarget
        ? (project.handwritingProfiles.find((p) => p.id === segmenterTarget.profileId) ?? null)
        : null,
    [segmenterTarget, project.handwritingProfiles],
  );
  const segmenterSampleSet = useMemo(
    () =>
      segmenterProfile && segmenterTarget
        ? (segmenterProfile.sampleSets.find((s) => s.id === segmenterTarget.sampleSetId) ?? null)
        : null,
    [segmenterProfile, segmenterTarget],
  );

  // CanvasStage 需要的视图（当前页 + 项目级设置）
  const stageView = useMemo(
    () => ({
      width: activePage?.originalWidth ?? 900,
      height: activePage?.originalHeight ?? 600,
      backgroundImage: activePage?.backgroundImage ?? null,
      textObjects: activePage?.textObjects ?? [],
      naturalnessEnabled: project.settings.naturalnessEnabled,
      naturalness: project.settings.naturalness,
      handwritingProfiles: project.handwritingProfiles,
      activeHandwritingProfileId: project.activeHandwritingProfileId,
    }),
    [project, activePage],
  );

  return (
    <div className="app">
      <header className="app__header">
        <span>
          📝 {project.name}
          {dirty && <span className="dirty-dot" title="有未保存的修改">●</span>}
        </span>
        <ConnectionBadge status={status} apiBase={apiBase} onReconnect={reconnect} onApiBaseChange={updateApiBase} />
        <div className="header-tools" style={{ marginLeft: 8 }}>
          <button className="btn" onClick={handleLoadProject} title="加载项目 JSON">加载</button>
          <button className="btn" onClick={handleSaveProject} title="保存为本地 JSON">保存</button>
          <button className="btn" onClick={handleUndo} disabled={!activePage || !history.canUndo(activePage.id)} title="撤销 (Ctrl+Z)">↶</button>
          <button className="btn" onClick={handleRedo} disabled={!activePage || !history.canRedo(activePage.id)} title="重做 (Ctrl+Y)">↷</button>
          <select
            className="export-scale-select"
            value={exportSettings.pngScale}
            onChange={(e) => setExportSettings((s) => ({ ...s, pngScale: Number(e.target.value) }))}
            title="导出倍率"
          >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
          </select>
          <select
            className="export-scale-select"
            value={exportSettings.pdfCompression}
            onChange={(e) => setExportSettings((s) => ({ ...s, pdfCompression: e.target.value as PdfCompression }))}
            title="PDF 压缩质量"
          >
            <option value="FAST">PDF 快</option>
            <option value="MEDIUM">PDF 中</option>
            <option value="SLOW">PDF 高质</option>
          </select>
          <button className="btn" onClick={handleExportSinglePDF} disabled={!activePage} title="当前页 PDF">页 PDF</button>
          <button className="btn" onClick={handleExportAllPDF} disabled={project.pages.length === 0} title="全部页 PDF">全 PDF</button>
          <button className="btn" onClick={handleExportAllZip} disabled={project.pages.length === 0} title="全部页 PNG ZIP">PNG ZIP</button>
          <button className="btn btn--primary" onClick={handleExportPNG} disabled={!activePage} title="当前页 PNG">导出 PNG</button>
        </div>
        {exportProgress && <div className="export-progress">{exportProgress}</div>}
      </header>

      <LeftPanel
        project={stageView}
        selectedId={selectedId}
        selectMode={selectMode}
        selections={selections}
        cleaning={cleaning}
        cleanError={cleanError}
        canUndoClean={canUndoClean}
        onUpload={handleUpload}
        onAddText={handleAddText}
        onSelectText={setSelectedId}
        onToggleNaturalness={handleToggleNaturalness}
        onChangeNaturalness={handleChangeNaturalness}
        onToggleSelectMode={handleToggleSelectMode}
        onClearRegion={handleClearRegion}
        onClearSelections={handleClearSelections}
        onUndoClean={handleUndoClean}
      />

      <main className="app__center">
        <div className="canvas-wrap">
          {activePage?.backgroundImage ? (
            <CanvasStage
              project={stageView}
              image={activeImage}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={handleChange}
              onStageReady={(s) => (stageRef.current = s)}
              selectMode={selectMode}
              selections={selections}
              onSelectionUpdate={handleSelectionUpdate}
              onSelectionEnd={handleSelectionEnd}
              exporting={exporting}
              exportSeed={exportSeedRef.current}
              glyphImages={glyphImages}
            />
          ) : (
            <div className="canvas-empty" style={{ width: 900, height: 600 }} />
          )}
        </div>

        <div className="bottom-panels">
          <PagePanel
            pages={project.pages}
            activePageId={project.activePageId}
            onAddPage={handleAddPage}
            onDeletePage={handleDeletePage}
            onDuplicatePage={handleDuplicatePage}
            onRenamePage={handleRenamePage}
            onMovePage={handleMovePage}
            onSetActivePage={handleSetActivePage}
            onImportImages={handleImportImages}
          />
          <div className="hw-panel">
            <details>
              <summary>
                手写档案（{project.handwritingProfiles.length}）·活动：
                {hw.activeProfile?.name ?? "无"}
              </summary>
              <ProfileManager
                profiles={project.handwritingProfiles}
                activeProfileId={project.activeHandwritingProfileId}
                onCreate={hw.createProfile}
                onRename={hw.renameProfile}
                onDelete={hw.deleteProfile}
                onSetActive={hw.setActiveProfile}
                onImportSample={handleImportSample}
                onOpenSegmenter={handleOpenSegmenter}
              />
            </details>
          </div>
        </div>
      </main>

      <StylePanel
        selected={selected}
        onChange={handleChange}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
        profiles={project.handwritingProfiles}
        activeProfileId={project.activeHandwritingProfileId}
      />

      {toast && <div className="toast">{toast}</div>}

      {segmenterTarget && segmenterProfile && segmenterSampleSet && (
        <GlyphSegmenter
          profile={segmenterProfile}
          sampleSet={segmenterSampleSet}
          image={segmenterImage}
          onSaveGlyph={handleSaveGlyph}
          onBatchSaveGlyphs={handleBatchSaveGlyphs}
          onDeleteGlyph={handleDeleteGlyph}
          saving={segSaving}
          error={segError}
          onClose={handleCloseSegmenter}
          onDetect={handleDetect}
          detecting={detecting}
          onSuggestLabels={handleSuggestLabels}
          ocrStatus={ocrStatus}
          ocrLoading={ocrLoading}
        />
      )}
    </div>
  );
}

/** 把各类错误转成给用户看的中文消息。 */
function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    let detail = err.body;
    try {
      const j = JSON.parse(err.body);
      if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* keep raw body */
    }
    return `HTTP ${err.status}: ${detail || err.message}`;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") return "请求超时，请检查后端是否运行";
    return err.message;
  }
  return String(err);
}

/** 判断事件目标是否为可编辑元素（输入框/文本域），避免快捷键误触发。 */
function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * 离屏渲染一页为 dataURL（用于非活动页的 PDF 导出）。
 * 绘制背景图 + 简化的文本框（字体模式用 fillText，glyph 模式用图片）。
 * 不应用 naturalness 抖动，保证多页导出稳定。
 */
// 已移至 lib/offscreenRender.ts（支持 handwritingGlyph + naturalness + 对齐）
