import { useCallback, useEffect, useRef, useState } from "react";
import { nowISO, type CanvasPage, type CanvasProject } from "@hw-layout/shared";
import type { SelectionRect } from "../components/CanvasStage.js";
import { clipSelection } from "./cleanSelection.js";
import { cleanRegion } from "./apiClient.js";
import { describeError } from "./errors.js";
import { loadImage, splitDataURL, joinDataURL, uid } from "./image.js";

/** Owns cleanup requests, temporary preview and explicit document commits. */
export function useCleanup({ project, activePage, generation, updatePage, showToast, setCleanError }: {
  project: CanvasProject; activePage: CanvasPage | null; generation: number;
  updatePage: (id: string, update: (page: CanvasPage) => CanvasPage) => void;
  showToast: (message: string) => void; setCleanError: (error: string | null) => void;
}) {
  // 框选清除区域状态（作用于当前页）
  const [selections, setSelections] = useState<SelectionRect[]>([]);
  const [cleaning, setCleaning] = useState(false);
  // 清除成功后的闪烁反馈（显示绿色确认框的位置）
  const [cleanFlash, setCleanFlash] = useState<SelectionRect[] | null>(null);

  const [cleanStrength, setCleanStrength] = useState<"gentle" | "standard" | "strong">("standard");
  const [preserveRules, setPreserveRules] = useState(true);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [cleanPreview, setCleanPreview] = useState<{
    pageId: string; beforeImage: string; afterImage: string;
    image: HTMLImageElement; selections: SelectionRect[];
  } | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const cleanBusy = useRef(false);
  const cleanContext = useRef(0);

  const invalidateCleanup = useCallback(() => {
    cleanContext.current++;
    setCleanPreview(null);
    setCompareOriginal(false);
    setCleanFlash(null);
    setSelections([]);
    setCleanError(null);
  }, [setCleanError]);

  useEffect(invalidateCleanup, [project.activePageId, generation, invalidateCleanup]);

  const handleSelectionEnd = useCallback((rect: Omit<SelectionRect, "id">) => {
    if (!activePage || cleaning || cleanPreview) return;
    const clipped = clipSelection(rect, activePage.originalWidth, activePage.originalHeight);
    if (clipped) setSelections((prev) => [...prev, { ...clipped, id: uid() }]);
  }, [activePage, cleaning, cleanPreview]);

  const handleSelectionUpdate = useCallback(
    (id: string, rect: Omit<SelectionRect, "id">) => {
      if (!activePage || cleaning || cleanPreview) return;
      const clipped = clipSelection(rect, activePage.originalWidth, activePage.originalHeight);
      if (clipped) setSelections((prev) => prev.map((s) => (s.id === id ? { ...s, ...clipped } : s)));
    }, [activePage, cleaning, cleanPreview],
  );

  const handleClearSelections = useCallback(() => {
    setSelections([]);
    setCleanError(null);
  }, [setCleanError]);

  const handleUndoClean = useCallback(async () => {
    if (!activePage || cleanBusy.current) return;
    const last = activePage.cleanHistory.at(-1);
    if (!last) return;
    cleanBusy.current = true;
    setCleaning(true);
    try {
      await loadImage(last.beforeImage);
      const current = projectRef.current.pages.find((pg) => pg.id === activePage.id);
      if (current?.backgroundImage !== activePage.backgroundImage) return;
      updatePage(activePage.id, (pg) => ({
        ...pg, backgroundImage: last.beforeImage,
        cleanHistory: pg.cleanHistory.slice(0, -1), updatedAt: nowISO(),
      }));
      setCleanPreview(null);
      setSelections([]);
      setCleanError(null);
      showToast("已撤销最近一次清除");
    } catch (err) {
      setCleanError(describeError(err));
    } finally {
      cleanBusy.current = false;
      setCleaning(false);
    }
  }, [activePage, updatePage, showToast, setCleanError]);

  const handleClearRegion = useCallback(async () => {
    if (!activePage?.backgroundImage || selections.length === 0 || cleanBusy.current) return;
    const beforeImage = activePage.backgroundImage;
    const context = cleanContext.current;
    const regions = selections.map((s) => clipSelection(s, activePage.originalWidth, activePage.originalHeight))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (regions.length === 0) return;
    cleanBusy.current = true;
    setCleaning(true);
    setCleanError(null);
    try {
      const { data, mime } = splitDataURL(beforeImage);
      const resp = await cleanRegion({ image: data, mime, regions,
        strength: cleanStrength, preserveRules });
      const afterImage = joinDataURL(resp.mime, resp.image);
      const img = await loadImage(afterImage);
      const current = projectRef.current;
      if (cleanContext.current !== context || current.activePageId !== activePage.id ||
          current.pages.find((pg) => pg.id === activePage.id)?.backgroundImage !== beforeImage) return;
      if (resp.changed === false) {
        setCleanError("未检测到可清除的笔迹，请调整选区或尝试加强力度。");
        return;
      }
      setCleanPreview({ pageId: activePage.id, beforeImage, afterImage, image: img, selections });
      setCompareOriginal(false);
    } catch (err) {
      if (projectRef.current.activePageId === activePage.id) setCleanError(describeError(err));
    } finally {
      cleanBusy.current = false;
      setCleaning(false);
    }
  }, [activePage, selections, cleanStrength, preserveRules, setCleanError]);

  const visiblePreview = cleanPreview?.pageId === activePage?.id &&
    cleanPreview?.beforeImage === activePage?.backgroundImage ? cleanPreview : null;

  const handleApplyClean = () => {
    if (!visiblePreview) return;
    const { pageId, beforeImage, afterImage, selections: regions } = visiblePreview;
    updatePage(pageId, (pg) => ({ ...pg, backgroundImage: afterImage,
      cleanHistory: [...pg.cleanHistory, { beforeImage, afterImage, regions }].slice(-10),
      updatedAt: nowISO(),
    }));
    setCleanPreview(null);
    setCompareOriginal(false);
    setSelections([]);
    setCleanFlash(regions);
    window.setTimeout(() => setCleanFlash(null), 1500);
    showToast("已应用清除，可撤销恢复原图");
  };

  const canUndoClean = (activePage?.cleanHistory.length ?? 0) > 0;

  return { selections, setSelections, cleaning, cleanFlash, cleanStrength, setCleanStrength,
    preserveRules, setPreserveRules, compareOriginal, setCompareOriginal, visiblePreview,
    setCleanPreview, invalidateCleanup, handleSelectionEnd, handleSelectionUpdate,
    handleClearSelections, handleUndoClean, handleClearRegion, handleApplyClean, canUndoClean };
}
