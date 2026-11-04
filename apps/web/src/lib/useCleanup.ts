import { useCallback, useEffect, useRef, useState } from "react";
import { nowISO, type CanvasPage, type CanvasProject, type ScanMode, type ScanDetail, type CleanupStroke } from "@hw-layout/shared";
import type { SelectionRect } from "../components/CanvasStage.js";
import { clipSelection, clipStroke, type CleanupTool, type SelectionStroke } from "./cleanSelection.js";
import { cleanRegion, prepareScan } from "./apiClient.js";
import { describeError } from "./errors.js";
import { loadImage, splitDataURL, joinDataURL, uid } from "./image.js";

type Operation = "clean" | "scan";
interface BackgroundPreview {
  pageId: string; beforeImage: string; afterImage: string;
  image: HTMLImageElement; selections: SelectionRect[]; strokes: SelectionStroke[]; operation: Operation;
}

/** Scan preparation and cleanup share one preview/commit/undo transaction. */
export function useCleanup({ project, activePage, generation, updatePage, showToast, setCleanError }: {
  project: CanvasProject; activePage: CanvasPage | null; generation: number;
  updatePage: (id: string, update: (page: CanvasPage) => CanvasPage) => void;
  showToast: (message: string) => void; setCleanError: (error: string | null) => void;
}) {
  const [selections, setSelections] = useState<SelectionRect[]>([]);
  const [strokes, setStrokes] = useState<SelectionStroke[]>([]);
  const [cleanTool, setCleanTool] = useState<CleanupTool>('rectangle');
  const [brushWidth, setBrushWidth] = useState(24);
  const [processingOperation, setProcessingOperation] = useState<Operation | null>(null);
  const cleaning = processingOperation !== null;
  const [cleanFlash, setCleanFlash] = useState<SelectionRect[] | null>(null);
  const [cleanStrength, setCleanStrength] = useState<"gentle" | "standard" | "strong">("standard");
  const [preserveRules, setPreserveRules] = useState(true);
  const [scanMode, setScanMode] = useState<ScanMode>("bw");
  const [scanDetail, setScanDetail] = useState<ScanDetail>("standard");
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [cleanPreview, setCleanPreview] = useState<BackgroundPreview | null>(null);
  const latest = useRef({ project, generation });
  latest.current = { project, generation };
  const busy = useRef<number | null>(null);
  const context = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const invalidateCleanup = useCallback(() => {
    context.current++;
    requestController.current?.abort();
    requestController.current = null;
    busy.current = null;
    setProcessingOperation(null);
    setCleanPreview(null);
    setCompareOriginal(false);
    setCleanFlash(null);
    setSelections([]);
    setStrokes([]);
    setCleanError(null);
  }, [setCleanError]);
  useEffect(invalidateCleanup, [project.activePageId, generation, invalidateCleanup]);
  useEffect(() => () => { context.current++; busy.current = null; requestController.current?.abort(); }, []);

  const handleCancelProcessing = () => {
    context.current++;
    busy.current = null;
    requestController.current?.abort();
    requestController.current = null;
    setProcessingOperation(null);
    setCleanError(null);
    showToast('已取消处理，保留原图和选区');
  };

  const handleSelectionEnd = useCallback((rect: Omit<SelectionRect, "id">) => {
    if (!activePage || cleaning || cleanPreview) return;
    if (selections.length >= 256) { setCleanError('选区过多，请先处理当前选区'); return; }
    const clipped = clipSelection(rect, activePage.originalWidth, activePage.originalHeight);
    if (clipped) setSelections(prev => [...prev, { ...clipped, id: uid() }]);
  }, [activePage, cleaning, cleanPreview, selections.length, setCleanError]);

  const handleStrokeEnd = (stroke: CleanupStroke) => {
    if (!activePage || cleaning || cleanPreview) return;
    if (strokes.length >= 256) { setCleanError('笔画过多，请先处理当前选区'); return; }
    const clipped = clipStroke(stroke, activePage.originalWidth, activePage.originalHeight);
    if (clipped) setStrokes(previous => [...previous, { ...clipped, id: uid('stroke') }]);
  };

  const handleSelectionUpdate = useCallback((id: string, rect: Omit<SelectionRect, "id">) => {
    if (!activePage || cleaning || cleanPreview) return;
    const clipped = clipSelection(rect, activePage.originalWidth, activePage.originalHeight);
    if (clipped) setSelections(prev => prev.map(s => s.id === id ? { ...s, ...clipped } : s));
  }, [activePage, cleaning, cleanPreview]);

  const handleClearSelections = useCallback(() => { setSelections([]); setStrokes([]); setCleanError(null); }, [setCleanError]);

  const isCurrent = (token: number, pageId: string, source: string) =>
    context.current === token && latest.current.generation === generation &&
    latest.current.project.activePageId === pageId &&
    latest.current.project.pages.find(page => page.id === pageId)?.backgroundImage === source;

  const checkDimensions = (image: HTMLImageElement, page: CanvasPage) => {
    if (image.naturalWidth !== page.originalWidth || image.naturalHeight !== page.originalHeight) {
      throw new Error("处理结果方向或尺寸与画布不一致，已保留原图。请更新后端并重新导入原始照片。");
    }
  };

  const handleUndoClean = async () => {
    if (!activePage?.backgroundImage || busy.current !== null) return;
    const last = activePage.cleanHistory.at(-1);
    if (!last) return;
    const token = ++context.current;
    const source = activePage.backgroundImage;
    busy.current = token;
    setProcessingOperation(last.operation ?? "clean");
    setCleanFlash(null);
    try {
      const image = await loadImage(last.beforeImage);
      if (!isCurrent(token, activePage.id, source)) return;
      checkDimensions(image, activePage);
      updatePage(activePage.id, pg => pg.backgroundImage !== source ? pg : ({
        ...pg, backgroundImage: last.beforeImage, cleanHistory: pg.cleanHistory.slice(0, -1), updatedAt: nowISO(),
      }));
      setCleanPreview(null);
      setSelections([]);
      setStrokes([]);
      setCleanError(null);
      showToast(last.operation === "scan" ? "已撤销扫描增强，恢复上一张背景" : "已撤销最近一次清除");
    } catch (error) {
      if (isCurrent(token, activePage.id, source)) setCleanError(describeError(error));
    } finally {
      if (busy.current === token) { busy.current = null; setProcessingOperation(null); }
    }
  };

  const preview = async (operation: Operation, autoColor = false) => {
    if (!activePage?.backgroundImage || busy.current !== null || cleanPreview) return;
    const regions = selections.map(s => clipSelection(s, activePage.originalWidth, activePage.originalHeight))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (operation === "clean" && !autoColor && !regions.length && !strokes.length) return;
    const beforeImage = activePage.backgroundImage;
    const token = ++context.current;
    busy.current = token;
    setProcessingOperation(operation);
    setCleanFlash(null);
    setCleanError(null);
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const { data, mime } = splitDataURL(beforeImage);
      const colorSource = autoColor ? activePage.cleanHistory.find(entry => entry.operation === "scan")?.beforeImage : undefined;
      const response = operation === "scan"
        ? await prepareScan({ image: data, mime, mode: scanMode, detail: scanDetail }, controller.signal)
        : await cleanRegion({ image: data, mime, autoColor, colorSource: colorSource ? splitDataURL(colorSource).data : undefined, regions: autoColor ? [] : regions, strokes: autoColor ? [] : strokes.map(({ points, width }) => ({ points, width })), strength: cleanStrength, preserveRules }, controller.signal);
      if (!isCurrent(token, activePage.id, beforeImage)) return;
      const afterImage = joinDataURL(response.mime, response.image);
      const image = await loadImage(afterImage);
      if (!isCurrent(token, activePage.id, beforeImage)) return;
      checkDimensions(image, activePage);
      if ("changed" in response && response.changed === false) {
        setCleanError(autoColor ? "未检测到红蓝笔迹。黑白图需要保留彩色原图的扫描历史；黑色手写请使用选区。" : "未检测到可清除的笔迹，请调整选区或尝试加强力度。");
        return;
      }
      setCleanPreview({ pageId: activePage.id, beforeImage, afterImage, image,
        selections: operation === "clean" && !autoColor ? selections : [], strokes: operation === "clean" && !autoColor ? strokes : [], operation });
      setCompareOriginal(false);
    } catch (error) {
      if (isCurrent(token, activePage.id, beforeImage)) setCleanError(describeError(error));
    } finally {
      if (requestController.current === controller) requestController.current = null;
      if (busy.current === token) { busy.current = null; setProcessingOperation(null); }
    }
  };

  const visiblePreview = cleanPreview?.pageId === activePage?.id &&
    cleanPreview?.beforeImage === activePage?.backgroundImage ? cleanPreview : null;

  const handleApplyClean = () => {
    if (!visiblePreview) return;
    const { pageId, beforeImage, afterImage, selections: regions, strokes: paths, operation } = visiblePreview;
    updatePage(pageId, pg => pg.backgroundImage !== beforeImage ? pg : ({ ...pg, backgroundImage: afterImage,
      cleanHistory: [...pg.cleanHistory, { beforeImage, afterImage, regions, operation,
        ...(paths.length ? { strokes: paths.map(({ points, width }) => ({ points, width })) } : {}) }].slice(-10), updatedAt: nowISO(),
    }));
    setCleanPreview(null);
    setCompareOriginal(false);
    setSelections([]);
    setStrokes([]);
    if (operation === "clean") {
      setCleanFlash(regions);
      const token = context.current;
      window.setTimeout(() => { if (context.current === token) setCleanFlash(null); }, 1500);
    }
    showToast(operation === "scan" ? "已应用扫描增强，现在可以框选擦除；可撤销恢复原图" : "已应用清除，可撤销恢复原图");
  };

  const canUndoClean = (activePage?.cleanHistory.length ?? 0) > 0;
  const undoOperation = activePage?.cleanHistory.at(-1)?.operation ?? "clean";
  return { selections, setSelections, cleaning, processingOperation, cleanFlash, cleanStrength, setCleanStrength,
    strokes, cleanTool, setCleanTool, brushWidth, setBrushWidth, handleStrokeEnd,
    handleUndoStroke: () => setStrokes(previous => previous.slice(0, -1)),
    handleCancelProcessing,
    preserveRules, setPreserveRules, scanMode, setScanMode, scanDetail, setScanDetail,
    compareOriginal, setCompareOriginal, visiblePreview, setCleanPreview, invalidateCleanup,
    handleSelectionEnd, handleSelectionUpdate, handleClearSelections, handleUndoClean,
    handleAutoColor: () => preview("clean", true),
    handleClearRegion: () => preview("clean"), handlePrepareScan: () => preview("scan"),
    handleApplyClean, canUndoClean, undoOperation };
}
