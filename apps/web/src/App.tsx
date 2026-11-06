import { colorSourceForPage, transformTexts } from "./lib/scanGeometry.js";
import { WorkbookDialog } from "./components/WorkbookDialog.js";
import { useProjectFiles } from "./lib/useProjectFiles.js";
import { useDocument } from "./lib/useDocument.js";
import { useImageResource } from "./lib/useImageResource.js";
import { useCleanup } from "./lib/useCleanup.js";
import { describeError } from "./lib/errors.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TEXT_STYLE,
  collectGlyphKeys,
  createBlankPage,
  layoutText,
  nowISO,
  textPageRanges,
  type CanvasPage,
  type GlyphBoundingBox,
  type GlyphCandidate,
  type HandwritingProfile,
  type NaturalnessParams,
  type OcrResultResponse,
  type TextObject,
} from "@hw-layout/shared";
import { CanvasStage } from "./components/CanvasStage.js";
import { LeftPanel } from "./components/LeftPanel.js";
import { StylePanel } from "./components/StylePanel.js";
import { ConnectionBadge } from "./components/ConnectionBadge.js";
import { ProfileManager } from "./components/ProfileManager.js";
import { GlyphSegmenter } from "./components/GlyphSegmenter.js";
import { PagePanel } from "./components/PagePanel.js";
import { useGlyphImages } from "./lib/useGlyphImages.js";
import { useConnection } from "./lib/useConnection.js";
import { useHandwriting } from "./lib/useHandwriting.js";
import { useHistory } from "./lib/useHistory.js";
import { detectGlyphCandidates, getOcrStatus, suggestGlyphLabels } from "./lib/apiClient.js";
import type { PdfCompression } from "./lib/pdfExport.js";
import { useProjectExport } from "./lib/useProjectExport.js";
import {
  fileToDataURL,
  loadImage,
  randomSeed,
  splitDataURL,
  uid,
} from "./lib/image.js";

/** 手写切割器打开的目标。 */
interface SegmenterTarget {
  profileId: string;
  sampleSetId: string;
}

export default function App() {
  const [workbookOpen, setWorkbookOpen] = useState(false);
  const { project, dirty, generation, edit: touchProject, updatePage,
    selectPage, replace: replaceDocument, markSaved } = useDocument();
  const latestDocument = useRef({ project, generation });
  latestDocument.current = { project, generation };
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const segmenterEpoch = useRef(0);

  // 手写切割器
  const [segmenterTarget, setSegmenterTarget] = useState<SegmenterTarget | null>(null);
  const [segmenterImage, setSegmenterImage] = useState<HTMLImageElement | null>(null);
  const [segSaving, setSegSaving] = useState(false);
  const [segError, setSegError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<OcrResultResponse | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);

  const { status, apiBase, updateApiBase, reconnect } = useConnection();

  // ===== 派生：当前页 =====
  const activePage = useMemo<CanvasPage | null>(
    () => project.pages.find((p) => p.id === project.activePageId) ?? null,
    [project.pages, project.activePageId],
  );
  const { image: activeImage, error: backgroundError } = useImageResource(activePage?.backgroundImage ?? null);

  // ===== 手写档案管理（project 级） =====
  const hw = useHandwriting({
    profiles: project.handwritingProfiles,
    activeProfileId: project.activeHandwritingProfileId,
    onProfilesChange: (update) =>
      touchProject((p) => ({ ...p, handwritingProfiles: update(p.handwritingProfiles) })),
    onActiveChange: (id) =>
      touchProject((p) => ({ ...p, activeHandwritingProfileId: id })),
  });
  const glyphImages = useGlyphImages(
    project.handwritingProfiles,
    activePage?.textObjects ?? EMPTY_TEXT_OBJECTS,
    project.activeHandwritingProfileId,
  );

  const selected = useMemo(
    () => activePage?.textObjects.find((t) => t.id === selectedId) ?? null,
    [activePage, selectedId],
  );
  const selectedProfile = useMemo(() => {
    if (!selected || selected.renderMode !== "handwritingGlyph") return null;
    return project.handwritingProfiles.find(p => p.id === (selected.handwritingProfileId ?? project.activeHandwritingProfileId)) ?? null;
  }, [selected, project.handwritingProfiles, project.activeHandwritingProfileId]);
  const selectedLayout = useMemo(() => selected ? layoutText(selected, {
    profile: selectedProfile,
    glyphSize: key => glyphImages.get(key) ?? null,
    applyJitter: false,
    naturalness: project.settings.naturalness,
    letterSpacing: selected.style.letterSpacing,
  }) : null, [selected, selectedProfile, glyphImages, project.settings.naturalness]);
  const selectedLayoutReady = useMemo(() => {
    if (!selected) return false;
    if (selected.renderMode !== "handwritingGlyph") return true;
    return collectGlyphKeys(selected, selectedProfile).every(key => glyphImages.has(key));
  }, [selected, selectedProfile, glyphImages]);

  // ===== 文本撤销栈（每页独立） =====
  const history = useHistory();

  // 后端连接后查询 OCR 状态
  useEffect(() => {
    let cancelled = false;
    if (status.kind === "connected") {
      void getOcrStatus().then(value => { if (!cancelled) setOcrStatus(value); })
        .catch(() => { if (!cancelled) setOcrStatus(null); });
    }
    return () => { cancelled = true; };
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

  const { selections, setSelections, cleaning, processingOperation, cleanFlash, cleanStrength, setCleanStrength,
    strokes, cleanTool, setCleanTool, brushWidth, setBrushWidth, handleStrokeEnd, handleUndoStroke, handleCancelProcessing,
    scanDeskew, setScanDeskew, scanMode, setScanMode, scanDetail, setScanDetail, handlePrepareScan, undoOperation,
    preserveRules, setPreserveRules, compareOriginal, setCompareOriginal, visiblePreview,
    setCleanPreview, invalidateCleanup, handleSelectionEnd, handleSelectionUpdate,
    handleClearSelections, handleUndoClean, handleAutoColor, handleReference, handleClearRegion, handleApplyClean, canUndoClean } =
    useCleanup({ project, activePage, generation, updatePage, showToast, setCleanError,
      onGeometryChange: (page, transform, inverse) => history.mapSnapshots(page.id,
        texts => transformTexts(texts, page, transform, inverse)) });

  const uploadSequence = useRef(new Map<string, number>());
  const importSequence = useRef(0);
  const importBusy = useRef(false);
  const [importingImages, setImportingImages] = useState(false);
  useEffect(() => {
    uploadSequence.current.clear();
    importSequence.current++;
    importBusy.current = false;
    setImportingImages(false);
  }, [generation]);

  // ===== 上传图片到当前页 =====
  const handleUpload = useCallback(
    async (file: File) => {
      if (!activePage) return;
      const sequence = (uploadSequence.current.get(activePage.id) ?? 0) + 1;
      uploadSequence.current.set(activePage.id, sequence);
      const current = () => latestDocument.current.generation === generation &&
        uploadSequence.current.get(activePage.id) === sequence &&
        latestDocument.current.project.pages.some(page => page.id === activePage.id);
      const visible = () => current() && latestDocument.current.project.activePageId === activePage.id;
      try {
        const dataURL = await fileToDataURL(file);
        const img = await loadImage(dataURL);
        if (!current()) return;
        updatePage(activePage.id, (pg) => ({ ...pg, backgroundImage: dataURL, colorSource: null,
          originalWidth: img.naturalWidth, originalHeight: img.naturalHeight, cleanHistory: [] }));
        if (visible()) {
          invalidateCleanup();
          setSelectedId(null);
        }
      } catch (err) {
        if (visible()) setCleanError(`图片「${file.name}」导入失败：${describeError(err)}`);
      }
    },
    [activePage, generation, updatePage, invalidateCleanup],
  );

  // ===== 多图导入：每张图建一页（按文件名排序） =====
  const handleImportImages = useCallback(
    async (files: File[]) => {
      if (!files.length || importBusy.current) return;
      const token = ++importSequence.current;
      const current = () => latestDocument.current.generation === generation && importSequence.current === token;
      importBusy.current = true;
      setImportingImages(true);
      let filename = '';
      try {
        const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "zh", { numeric: true }));
        const newPages: CanvasPage[] = [];
        for (const file of sorted) {
          filename = file.name;
          const dataURL = await fileToDataURL(file);
          if (!current()) return;
          const img = await loadImage(dataURL);
          if (!current()) return;
          newPages.push({ ...createBlankPage(0, file.name.replace(/\.[^.]+$/, "")),
            backgroundImage: dataURL, originalWidth: img.naturalWidth, originalHeight: img.naturalHeight });
        }
        // Commit only after EVERY file decodes; index against the latest page list.
        touchProject(p => ({ ...p,
          pages: [...p.pages, ...newPages.map((page, i) => ({ ...page, index: p.pages.length + i }))],
          activePageId: newPages[0].id,
        }));
        setCleanError(null);
        showToast(`已导入 ${newPages.length} 页`);
      } catch (error) {
        if (current()) setCleanError(`图片「${filename}」导入失败，本批次未添加页面：${describeError(error)}`);
      } finally {
        if (current()) { importBusy.current = false; setImportingImages(false); }
      }
    },
    [generation, touchProject, showToast],
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
  }, [touchProject, setSelections]);

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
      setSelectedId(null);
      setSelections([]);
    },
    [touchProject, setSelections],
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
          textObjects: src.textObjects.map((t) => ({ ...t, id: uid("obj") })),
          colorSource: colorSourceForPage(src) ?? null,
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
    [touchProject, setSelections],
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
    selectPage(id);
    setSelectedId(null);
    setSelections([]);
    setCleanError(null);
  }, [selectPage, setSelections]);

  // ===== 文本对象操作（作用于当前页） =====
  const nextZ = useCallback(
    () => (activePage?.textObjects ?? []).reduce((m, t) => Math.max(m, t.zIndex), -1) + 1,
    [activePage],
  );

  const handleAddText = useCallback((handwritten = false) => {
    if (!activePage || cleaning || visiblePreview) return;
    setSelectMode(false);
    const profile = project.handwritingProfiles.find(p => p.id === project.activeHandwritingProfileId);
    history.push(activePage.id, activePage.textObjects);
    const newObj: TextObject = {
      id: uid(),
      text: handwritten ? "Your handwriting" : "双击编辑文本",
      x: activePage.originalWidth / 2,
      y: activePage.originalHeight / 2,
      style: { ...DEFAULT_TEXT_STYLE, ...(handwritten ? { fontFamily: "Caveat, cursive", fontSize: Math.max(32, Math.round(activePage.originalWidth / 45)) } : {}) },
      zIndex: nextZ(),
      naturalnessSeed: randomSeed(),
      renderMode: handwritten && profile?.glyphs.length ? "handwritingGlyph" : "font",
      handwritingProfileId: handwritten ? profile?.id ?? null : null,
    };
    updatePage(activePage.id, (pg) => ({
      ...pg,
      textObjects: [...pg.textObjects, newObj],
      updatedAt: nowISO(),
    }));
    setSelectedId(newObj.id);
  }, [activePage, cleaning, visiblePreview, project.handwritingProfiles, project.activeHandwritingProfileId, nextZ, updatePage, history]);

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

  const handlePaginate = useCallback((id: string) => {
    if (!activePage || !selected || selected.id !== id || !selectedLayout) return;
    if (!selectedLayoutReady) { showToast("字形图片仍在加载，完成后才能分页"); return; }
    if (!selected.maxLines) { showToast("请先设置最大行数"); return; }
    const ranges = textPageRanges(selectedLayout, selected.maxLines);
    if (ranges.length <= 1) { showToast("当前内容无需分页"); return; }
    history.push(activePage.id, activePage.textObjects);
    const source = selected;
    const firstText = source.text.slice(ranges[0].startOffset, ranges[0].endOffset);
    const inserted = ranges.slice(1).map((range, index) => {
      const naturalnessOffset = (source.naturalnessOffset ?? 0) + Array.from(source.text.slice(0, range.startOffset)).length;
      return {
        ...createBlankPage(0, `${activePage.name} · 分页 ${index + 2}`),
        backgroundImage: activePage.backgroundImage,
        colorSource: colorSourceForPage(activePage) ?? null,
        originalWidth: activePage.originalWidth,
        originalHeight: activePage.originalHeight,
        textObjects: [{ ...source, id: uid("obj"), text: source.text.slice(range.startOffset, range.endOffset),
          style: { ...source.style }, naturalnessOffset }],
      };
    });
    touchProject(project => {
      const pages = project.pages.flatMap(page => page.id === activePage.id
        ? [{ ...page, textObjects: page.textObjects.map(obj => obj.id === id ? { ...obj, text: firstText } : obj), updatedAt: nowISO() }, ...inserted]
        : [page]);
      return { ...project, pages: pages.map((page, index) => ({ ...page, index })) };
    });
    showToast(`已按行数分为 ${ranges.length} 页，原文与自然化设置均已保留`);
  }, [activePage, selected, selectedLayout, selectedLayoutReady, history, touchProject, showToast]);

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
    if (!activePage || cleaning || visiblePreview) return;
    const prev = history.undo(activePage.id, activePage.textObjects);
    if (prev) {
      updatePage(activePage.id, (pg) => ({ ...pg, textObjects: prev, updatedAt: nowISO() }));
      showToast("已撤销");
    }
  }, [activePage, cleaning, visiblePreview, history, updatePage, showToast]);

  const handleRedo = useCallback(() => {
    if (!activePage || cleaning || visiblePreview) return;
    const next = history.redo(activePage.id, activePage.textObjects);
    if (next) {
      updatePage(activePage.id, (pg) => ({ ...pg, textObjects: next, updatedAt: nowISO() }));
      showToast("已重做");
    }
  }, [activePage, cleaning, visiblePreview, history, updatePage, showToast]);

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

  const { exportSettings, setExportSettings, exportProgress, handleExportPNG,
    handleExportSinglePDF, handleExportAllPDF, handleExportAllZip } =
    useProjectExport(project, activePage, showToast, setCleanError);

  const resetEditor = useCallback(() => {
    invalidateCleanup();
    history.clear();
    setSelectedId(null);
    segmenterEpoch.current++;
    setSegmenterTarget(null);
    setSegmenterImage(null);
    setSegSaving(false);
    setDetecting(false);
    setOcrLoading(false);
  }, [invalidateCleanup, history]);
  const { save: handleSaveProject, load: handleLoadProject, loading: loadingProject } = useProjectFiles({
    project, dirty, generation, replace: replaceDocument, markSaved,
    onReplaced: resetEditor, onError: setCleanError, notify: showToast,
  });

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
      const epoch = ++segmenterEpoch.current;
      setSegmenterTarget(null);
      let image: HTMLImageElement;
      try { image = await loadImage(ss.imageBase64); }
      catch { if (epoch === segmenterEpoch.current) setCleanError("样本图无法读取"); return; }
      if (epoch !== segmenterEpoch.current) return;
      setSegmenterImage(image);
      setSegSaving(false);
      setDetecting(false);
      setOcrLoading(false);
      setSegError(null);
      setSegmenterTarget({ profileId, sampleSetId });
    },
    [project.handwritingProfiles],
  );

  const handleCloseSegmenter = useCallback(() => {
    segmenterEpoch.current++;
    setSegmenterTarget(null);
    setSegmenterImage(null);
    setSegSaving(false);
    setDetecting(false);
    setOcrLoading(false);
    setSegError(null);
  }, []);

  const handleSaveGlyph = useCallback(
    async (char: string, bbox: GlyphBoundingBox, backgroundMode: "fixed" | "adaptive") => {
      if (!segmenterTarget) return false;
      const prof = project.handwritingProfiles.find((p) => p.id === segmenterTarget.profileId);
      const ss = prof?.sampleSets.find((s) => s.id === segmenterTarget.sampleSetId);
      if (!ss) return false;
      const epoch = segmenterEpoch.current;
      setSegSaving(true);
      setSegError(null);
      const res = await hw.saveGlyph(segmenterTarget.profileId, segmenterTarget.sampleSetId, char, bbox, ss.imageBase64, backgroundMode);
      if (epoch !== segmenterEpoch.current) return false;
      setSegSaving(false);
      if (!res.ok) setSegError(res.error);
      else showToast(`已保存字形「${char}」`);
      return res.ok;
    },
    [segmenterTarget, project.handwritingProfiles, hw, showToast],
  );

  const handleBatchSaveGlyphs = useCallback(
    async (items: { char: string; bbox: GlyphBoundingBox }[], backgroundMode: "fixed" | "adaptive") => {
      if (!segmenterTarget) return { saved: 0, skipped: items.length };
      const prof = project.handwritingProfiles.find((p) => p.id === segmenterTarget.profileId);
      const ss = prof?.sampleSets.find((s) => s.id === segmenterTarget.sampleSetId);
      if (!ss) return { saved: 0, skipped: items.length };
      const epoch = segmenterEpoch.current;
      setSegSaving(true);
      setSegError(null);
      const res = await hw.batchSaveGlyphs(segmenterTarget.profileId, segmenterTarget.sampleSetId, items, ss.imageBase64, backgroundMode);
      if (epoch !== segmenterEpoch.current) return { saved: 0, skipped: items.length, error: "标注会话已结束" };
      setSegSaving(false);
      if (res.error) setSegError(res.error);
      else if (res.saved > 0) showToast(`批量保存 ${res.saved} 个字形`);
      return res;
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
    async (sampleDataURL: string, thresholdMode: "fixed" | "adaptive" = "fixed"): Promise<GlyphCandidate[]> => {
      const epoch = segmenterEpoch.current;
      setDetecting(true);
      setSegError(null);
      try {
        const { data, mime } = splitDataURL(sampleDataURL);
        const resp = await detectGlyphCandidates({ image: data, mime, thresholdMode });
        if (epoch !== segmenterEpoch.current) throw new Error("标注会话已结束");
        return resp.candidates;
      } catch (err) {
        if (epoch === segmenterEpoch.current) setSegError(describeError(err));
        throw err;
      } finally {
        if (epoch === segmenterEpoch.current) setDetecting(false);
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
      const epoch = segmenterEpoch.current;
      setOcrLoading(true);
      setSegError(null);
      try {
        const { data, mime } = splitDataURL(sampleDataURL);
        const result = await suggestGlyphLabels({
          image: data,
          mime,
          candidates: cands.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) })),
        });
        if (epoch !== segmenterEpoch.current) throw new Error("标注会话已结束");
        return result;
      } catch (err) {
        if (epoch === segmenterEpoch.current) setSegError(describeError(err));
        return { candidates: [], provider: "none", status: "error", message: describeError(err) };
      } finally {
        if (epoch === segmenterEpoch.current) setOcrLoading(false);
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
      textObjects: activePage ? transformTexts(activePage.textObjects, activePage, visiblePreview && !compareOriginal ? visiblePreview.transform : undefined) : [],
      naturalnessEnabled: project.settings.naturalnessEnabled,
      naturalness: project.settings.naturalness,
      handwritingProfiles: project.handwritingProfiles,
      activeHandwritingProfileId: project.activeHandwritingProfileId,
    }),
    [project, activePage, visiblePreview, compareOriginal],
  );

  return (
    <div className="app">
      {workbookOpen && <WorkbookDialog profile={hw.activeProfile ?? null} projectText={project.pages.flatMap(page => page.textObjects.map(obj => obj.text)).join("\n")} onClose={() => setWorkbookOpen(false)} />}
      <header className="app__header">
        <div className="app-brand"><span className="brand-mark">墨</span><div><strong>墨迹</strong><span>手写排版工作台</span></div></div>
        <div className="document-name">
          <input aria-label="作品名称" value={project.name === '未命名项目' ? '我的手写作品' : project.name}
            onChange={e => touchProject(p => ({ ...p, name: e.target.value }))}
            onBlur={() => { if (!project.name.trim()) touchProject(p => ({ ...p, name: '我的手写作品' })); }} />
          {dirty && <span className="dirty-dot" title="有未保存的修改" role="status" aria-label="有未保存的修改">●</span>}
        </div>
        <ConnectionBadge status={status} apiBase={apiBase} onReconnect={reconnect} onApiBaseChange={updateApiBase} />
        <div className="header-tools" style={{ marginLeft: 8 }}>
          <button className="btn" onClick={handleLoadProject} disabled={loadingProject} title="加载项目 JSON">{loadingProject ? "加载中…" : "加载"}</button>
          <button className="btn" onClick={handleSaveProject} title="保存为本地 JSON">保存</button>
          <button className="btn workbook-entry" onClick={() => setWorkbookOpen(true)}>字帖工坊</button>
          <button className="btn" onClick={handleUndo} disabled={cleaning || !!visiblePreview || !activePage || !history.canUndo(activePage.id)} title="撤销 (Ctrl+Z)" aria-label="撤销 (Ctrl+Z)">↶</button>
          <button className="btn" onClick={handleRedo} disabled={cleaning || !!visiblePreview || !activePage || !history.canRedo(activePage.id)} title="重做 (Ctrl+Y)" aria-label="重做 (Ctrl+Y)">↷</button>
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
          <button className="btn" onClick={handleExportSinglePDF} disabled={!activePage || !!visiblePreview || !!exportProgress} title="当前页 PDF">页 PDF</button>
          <button className="btn" onClick={handleExportAllPDF} disabled={project.pages.length === 0 || !!visiblePreview || !!exportProgress} title="全部页 PDF">全 PDF</button>
          <button className="btn" onClick={handleExportAllZip} disabled={project.pages.length === 0 || !!visiblePreview || !!exportProgress} title="全部页 PNG ZIP">PNG ZIP</button>
          <button className="btn btn--primary" onClick={handleExportPNG} disabled={!activePage || !!visiblePreview || !!exportProgress} title="当前页 PNG">导出 PNG</button>
        </div>
        {exportProgress && <div className="export-progress">{exportProgress}</div>}
      </header>

      <LeftPanel
        project={stageView}
        selectedId={selectedId}
        selectMode={selectMode}
        selections={selections}
        strokeCount={strokes.length}
        cleanTool={cleanTool}
        brushWidth={brushWidth}
        onCleanTool={tool => { setCleanTool(tool); handleToggleSelectMode(true); }}
        onBrushWidth={setBrushWidth}
        onUndoStroke={handleUndoStroke}
        cleaning={cleaning}
        cleanError={cleanError ?? backgroundError}
        canUndoClean={canUndoClean}
        cleanStrength={cleanStrength}
        onCleanStrength={setCleanStrength}
        preserveRules={preserveRules}
        onPreserveRules={setPreserveRules}
        hasPreview={!!visiblePreview}
        previewOperation={visiblePreview?.operation ?? null}
        undoOperation={undoOperation}
        scanDeskew={scanDeskew}
        onScanDeskew={setScanDeskew}
        previewNote={visiblePreview?.note}
        scanMode={scanMode}
        processingOperation={processingOperation}
        onScanMode={setScanMode}
        scanDetail={scanDetail}
        onScanDetail={setScanDetail}
        onPrepareScan={handlePrepareScan}
        onCancelProcessing={handleCancelProcessing}
        compareOriginal={compareOriginal}
        onCompareOriginal={() => setCompareOriginal((v) => !v)}
        onApplyClean={handleApplyClean}
        onCancelClean={() => { setCleanPreview(null); setCompareOriginal(false); }}
        onUpload={handleUpload}
        onAddText={() => handleAddText()}
        onAddHandwriting={() => handleAddText(true)}
        onOpenHandwriting={() => { const details = document.getElementById("handwriting-profiles") as HTMLDetailsElement; details.open = true; details.scrollIntoView({ behavior: "smooth", block: "start" }); }}
        onSelectText={setSelectedId}
        onToggleNaturalness={handleToggleNaturalness}
        onChangeNaturalness={handleChangeNaturalness}
        onToggleSelectMode={handleToggleSelectMode}
        onReference={handleReference}
        onAutoColor={handleAutoColor}
        onClearRegion={handleClearRegion}
        onClearSelections={handleClearSelections}
        onUndoClean={handleUndoClean}
      />

      <main className="app__center">
        <div className="canvas-wrap">
          {activePage && !activePage.backgroundImage && !activePage.textObjects.length &&
            <div className="workspace-welcome"><span>你的下一页，从这里开始</span><strong>让文字带上你的笔迹</strong><p>在左侧上传试卷，或展开「手写排版」添加文字。<br />第一次使用，可先到「我的字迹 / 采样字帖」准备字库。</p></div>}
          {activePage ? (
            <CanvasStage
              key={`${generation}:${activePage.id}:${uploadSequence.current.get(activePage.id) ?? 0}`}
              readOnly={cleaning || !!visiblePreview}
              project={stageView}
              image={visiblePreview && !compareOriginal ? visiblePreview.image : activeImage}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={handleChange}
              selectMode={selectMode && !cleaning && !visiblePreview}
              selections={visiblePreview ? [] : selections}
              cleanTool={cleanTool}
              brushWidth={brushWidth}
              strokes={visiblePreview ? [] : strokes}
              onStrokeEnd={handleStrokeEnd}
              onSelectionUpdate={handleSelectionUpdate}
              onSelectionEnd={handleSelectionEnd}
              glyphImages={glyphImages}
              cleanFlash={cleanFlash}
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
            importingImages={importingImages}
          />
          <div className="hw-panel">
            <details id="handwriting-profiles">
              <summary>
                手写档案（{project.handwritingProfiles.length}）·活动：
                {hw.activeProfile?.name ?? "无"}
              </summary>
              <ProfileManager
                profiles={project.handwritingProfiles}
                projectText={project.pages.flatMap(page => page.textObjects.map(obj => obj.text)).join('\n')}
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
        selected={cleaning || visiblePreview ? null : selected}
        onChange={handleChange}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
        onPaginate={handlePaginate}
        layout={selectedLayout}
        layoutReady={selectedLayoutReady}
        profiles={project.handwritingProfiles}
        activeProfileId={project.activeHandwritingProfileId}
      />

      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}

      {segmenterTarget && segmenterProfile && segmenterSampleSet && (
        <GlyphSegmenter
          key={`${generation}:${segmenterTarget.profileId}:${segmenterTarget.sampleSetId}`}
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

const EMPTY_TEXT_OBJECTS: TextObject[] = [];

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
