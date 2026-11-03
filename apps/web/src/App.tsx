import { useProjectFiles } from "./lib/useProjectFiles.js";
import { useDocument } from "./lib/useDocument.js";
import { useImageResource } from "./lib/useImageResource.js";
import { useCleanup } from "./lib/useCleanup.js";
import { describeError } from "./lib/errors.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TEXT_STYLE,
  createBlankPage,
  nowISO,
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
  const { project, dirty, generation, edit: touchProject, updatePage,
    selectPage, replace: replaceDocument, markSaved } = useDocument();
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
  );

  const selected = useMemo(
    () => activePage?.textObjects.find((t) => t.id === selectedId) ?? null,
    [activePage, selectedId],
  );

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

  const { selections, setSelections, cleaning, cleanFlash, cleanStrength, setCleanStrength,
    preserveRules, setPreserveRules, compareOriginal, setCompareOriginal, visiblePreview,
    setCleanPreview, invalidateCleanup, handleSelectionEnd, handleSelectionUpdate,
    handleClearSelections, handleUndoClean, handleClearRegion, handleApplyClean, canUndoClean } =
    useCleanup({ project, activePage, generation, updatePage, showToast, setCleanError });

  const uploadSequence = useRef(new Map<string, number>());

  // ===== 上传图片到当前页 =====
  const handleUpload = useCallback(
    async (file: File) => {
      if (!activePage) return;
      const sequence = (uploadSequence.current.get(activePage.id) ?? 0) + 1;
      uploadSequence.current.set(activePage.id, sequence);
      invalidateCleanup();
      try {
        const dataURL = await fileToDataURL(file);
        const img = await loadImage(dataURL);
        if (uploadSequence.current.get(activePage.id) !== sequence) return;
        updatePage(activePage.id, (pg) => ({ ...pg, backgroundImage: dataURL,
          originalWidth: img.naturalWidth, originalHeight: img.naturalHeight, cleanHistory: [] }));
        setCleanPreview(null);
        setSelections([]);
        setSelectedId(null);
        setCleanError(null);
      } catch (err) {
        if (uploadSequence.current.get(activePage.id) === sequence) setCleanError(describeError(err));
      }
    },
    [activePage, updatePage, invalidateCleanup, setCleanPreview, setSelections],
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
    const prev = history.undo(activePage.id, activePage.textObjects);
    if (prev) {
      updatePage(activePage.id, (pg) => ({ ...pg, textObjects: prev, updatedAt: nowISO() }));
      showToast("已撤销");
    }
  }, [activePage, history, updatePage, showToast]);

  const handleRedo = useCallback(() => {
    if (!activePage) return;
    const next = history.redo(activePage.id, activePage.textObjects);
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
    async (char: string, bbox: GlyphBoundingBox) => {
      if (!segmenterTarget) return false;
      const prof = project.handwritingProfiles.find((p) => p.id === segmenterTarget.profileId);
      const ss = prof?.sampleSets.find((s) => s.id === segmenterTarget.sampleSetId);
      if (!ss) return false;
      const epoch = segmenterEpoch.current;
      setSegSaving(true);
      setSegError(null);
      const res = await hw.saveGlyph(segmenterTarget.profileId, segmenterTarget.sampleSetId, char, bbox, ss.imageBase64);
      if (epoch !== segmenterEpoch.current) return false;
      setSegSaving(false);
      if (!res.ok) setSegError(res.error);
      else showToast(`已保存字形「${char}」`);
      return res.ok;
    },
    [segmenterTarget, project.handwritingProfiles, hw, showToast],
  );

  const handleBatchSaveGlyphs = useCallback(
    async (items: { char: string; bbox: GlyphBoundingBox }[]) => {
      if (!segmenterTarget) return { saved: 0, skipped: items.length };
      const prof = project.handwritingProfiles.find((p) => p.id === segmenterTarget.profileId);
      const ss = prof?.sampleSets.find((s) => s.id === segmenterTarget.sampleSetId);
      if (!ss) return { saved: 0, skipped: items.length };
      const epoch = segmenterEpoch.current;
      setSegSaving(true);
      setSegError(null);
      const res = await hw.batchSaveGlyphs(segmenterTarget.profileId, segmenterTarget.sampleSetId, items, ss.imageBase64);
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
    async (sampleDataURL: string): Promise<GlyphCandidate[]> => {
      const epoch = segmenterEpoch.current;
      setDetecting(true);
      setSegError(null);
      try {
        const { data, mime } = splitDataURL(sampleDataURL);
        const resp = await detectGlyphCandidates({ image: data, mime });
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
          <button className="btn" onClick={handleLoadProject} disabled={loadingProject} title="加载项目 JSON">{loadingProject ? "加载中…" : "加载"}</button>
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
        cleaning={cleaning}
        cleanError={cleanError ?? backgroundError}
        canUndoClean={canUndoClean}
        cleanStrength={cleanStrength}
        onCleanStrength={setCleanStrength}
        preserveRules={preserveRules}
        onPreserveRules={setPreserveRules}
        hasPreview={!!visiblePreview}
        compareOriginal={compareOriginal}
        onCompareOriginal={() => setCompareOriginal((v) => !v)}
        onApplyClean={handleApplyClean}
        onCancelClean={() => { setCleanPreview(null); setCompareOriginal(false); }}
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
          {activePage ? (
            <CanvasStage
              key={activePage.id}
              project={stageView}
              image={visiblePreview && !compareOriginal ? visiblePreview.image : activeImage}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={handleChange}
              selectMode={selectMode && !cleaning && !visiblePreview}
              selections={visiblePreview ? [] : selections}
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

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
