import { useCallback, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import {
  APP_VERSION,
  DEFAULT_NATURALNESS,
  DEFAULT_TEXT_STYLE,
  deserializeProject,
  serializeProject,
  type CanvasProject,
  type NaturalnessParams,
  type TextObject,
} from "@hw-layout/shared";
import { CanvasStage, type SelectionRect } from "./components/CanvasStage.js";
import { LeftPanel } from "./components/LeftPanel.js";
import { StylePanel } from "./components/StylePanel.js";
import { ConnectionBadge } from "./components/ConnectionBadge.js";
import { useConnection } from "./lib/useConnection.js";
import { ApiError, cleanRegion } from "./lib/apiClient.js";
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

export default function App() {
  const [project, setProject] = useState<CanvasProject>(() => ({
    appVersion: APP_VERSION,
    backgroundImage: null,
    width: 900,
    height: 600,
    textObjects: [],
    naturalnessEnabled: false,
    naturalness: { ...DEFAULT_NATURALNESS },
    cleanHistory: [],
  }));
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  // 框选清除区域状态
  const [selectMode, setSelectMode] = useState(false);
  const [selections, setSelections] = useState<SelectionRect[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 导出时隐藏 overlay
  const [exporting, setExporting] = useState(false);

  // 后端连接状态
  const { status, apiBase, updateApiBase, reconnect } = useConnection();

  const selected = useMemo(
    () => project.textObjects.find((t) => t.id === selectedId) ?? null,
    [project.textObjects, selectedId],
  );

  // ===== 轻提示 =====
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2200);
  }, []);

  // 同步背景图到 image 元素
  const applyBackground = useCallback(async (dataURL: string) => {
    const img = await loadImage(dataURL);
    setImage(img);
    setProject((p) => ({
      ...p,
      backgroundImage: dataURL,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
  }, []);

  // ===== 上传图片 =====
  const handleUpload = useCallback(
    async (file: File) => {
      const dataURL = await fileToDataURL(file);
      await applyBackground(dataURL);
      setSelections([]);
      setSelectedId(null);
      setCleanError(null);
      setProject((p) => ({ ...p, cleanHistory: [] }));
    },
    [applyBackground],
  );

  // ===== 文本对象操作 =====
  const nextZ = useCallback(
    () =>
      project.textObjects.reduce((m, t) => Math.max(m, t.zIndex), -1) + 1,
    [project.textObjects],
  );

  const handleAddText = useCallback(() => {
    if (selectMode) return;
    const newObj: TextObject = {
      id: uid(),
      text: "双击编辑文本",
      x: project.width / 2,
      y: project.height / 2,
      style: { ...DEFAULT_TEXT_STYLE },
      zIndex: nextZ(),
      naturalnessSeed: randomSeed(),
    };
    setProject((p) => ({ ...p, textObjects: [...p.textObjects, newObj] }));
    setSelectedId(newObj.id);
  }, [project.width, project.height, selectMode, nextZ]);

  const handleChange = useCallback((obj: TextObject) => {
    setProject((p) => ({
      ...p,
      textObjects: p.textObjects.map((t) => (t.id === obj.id ? obj : t)),
    }));
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      setProject((p) => ({
        ...p,
        textObjects: p.textObjects.filter((t) => t.id !== id),
      }));
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId],
  );

  // 复制：偏移 16px，新 id 与新 seed
  const handleDuplicate = useCallback(
    (id: string) => {
      const src = project.textObjects.find((t) => t.id === id);
      if (!src) return;
      const copy: TextObject = {
        ...src,
        id: uid(),
        x: src.x + 16,
        y: src.y + 16,
        style: { ...src.style },
        zIndex: nextZ(),
        naturalnessSeed: randomSeed(),
      };
      setProject((p) => ({ ...p, textObjects: [...p.textObjects, copy] }));
      setSelectedId(copy.id);
    },
    [project.textObjects, nextZ],
  );

  const handleBringToFront = useCallback(
    (id: string) => {
      const top = nextZ();
      const obj = project.textObjects.find((t) => t.id === id);
      if (!obj) return;
      handleChange({ ...obj, zIndex: top + 1 });
    },
    [project.textObjects, nextZ, handleChange],
  );

  const handleSendToBack = useCallback(
    (id: string) => {
      const minZ = project.textObjects.reduce(
        (m, t) => Math.min(m, t.zIndex),
        0,
      );
      const obj = project.textObjects.find((t) => t.id === id);
      if (!obj) return;
      handleChange({ ...obj, zIndex: minZ - 1 });
    },
    [project.textObjects, handleChange],
  );

  // ===== 自然化 =====
  const handleToggleNaturalness = useCallback((enabled: boolean) => {
    setProject((p) => ({ ...p, naturalnessEnabled: enabled }));
  }, []);

  const handleChangeNaturalness = useCallback(
    (patch: Partial<NaturalnessParams>) => {
      setProject((p) => ({
        ...p,
        naturalness: { ...p.naturalness, ...patch },
      }));
    },
    [],
  );

  // ===== 框选清除 =====
  const handleToggleSelectMode = useCallback((enabled: boolean) => {
    setSelectMode(enabled);
    if (enabled) setSelectedId(null);
  }, []);

  const handleSelectionEnd = useCallback((rect: Omit<SelectionRect, "id">) => {
    setSelections((prev) => [...prev, { ...rect, id: uid() }]);
  }, []);

  const handleSelectionUpdate = useCallback(
    (id: string, rect: Omit<SelectionRect, "id">) => {
      setSelections((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...rect } : s)),
      );
    },
    [],
  );

  const handleClearSelections = useCallback(() => {
    setSelections([]);
    setCleanError(null);
  }, []);

  // 撤销一次清除：恢复 cleanHistory 栈顶的 beforeImage
  const handleUndoClean = useCallback(() => {
    setProject((p) => {
      const last = p.cleanHistory[p.cleanHistory.length - 1];
      if (!last) return p;
      void applyBackground(last.beforeImage);
      return { ...p, cleanHistory: p.cleanHistory.slice(0, -1) };
    });
    setSelections([]);
    setCleanError(null);
    showToast("已撤销最近一次清除");
  }, [applyBackground, showToast]);

  // 清除字迹闭环
  const handleClearRegion = useCallback(async () => {
    const bg = project.backgroundImage;
    if (!bg || selections.length === 0) return;
    setCleaning(true);
    setCleanError(null);
    try {
      const { data, mime } = splitDataURL(bg);
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
      const beforeImage = bg;
      await applyBackground(newDataURL);
      // 记录历史
      setProject((p) => ({
        ...p,
        cleanHistory: [
          ...p.cleanHistory,
          {
            beforeImage,
            afterImage: newDataURL,
            regions: selections.map((s) => ({
              x: s.x,
              y: s.y,
              width: s.width,
              height: s.height,
            })),
          },
        ],
      }));
      setSelections([]);
      showToast(`已清除 ${resp.processed} 个区域`);
    } catch (err) {
      setCleanError(describeError(err));
    } finally {
      setCleaning(false);
    }
  }, [project.backgroundImage, selections, applyBackground, showToast]);

  const canUndoClean = project.cleanHistory.length > 0;

  // ===== 导出 PNG =====
  // 用固定 exportSeed，保证同一项目多次导出结果一致
  const exportSeedRef = useRef<number>(randomSeed());
  const handleExportPNG = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const prevSelected = selectedId;
    const prevSelectMode = selectMode;
    // 临时进入导出态：取消选中、退出框选、隐藏 overlay、应用 naturalness
    setSelectedId(null);
    setSelectMode(false);
    setExporting(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          const dataURL = stage.toDataURL({
            pixelRatio: 1 / stage.scaleX(), // 用原图像素分辨率，不被显示缩放降低
            x: 0,
            y: 0,
            width: project.width,
            height: project.height,
          });
          downloadURL(dataURL, exportFilename("png"));
          showToast("已导出 PNG");
        } catch (err) {
          setCleanError(`导出失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setSelectedId(prevSelected);
          setSelectMode(prevSelectMode);
          setExporting(false);
        }
      });
    });
  }, [project.width, project.height, selectedId, selectMode, showToast]);

  // ===== 项目保存 / 加载 =====
  const handleSaveProject = useCallback(() => {
    const json = serializeProject(project);
    downloadText(json, exportFilename("json"), "application/json");
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
      if (loaded.backgroundImage) {
        await applyBackground(loaded.backgroundImage);
      } else {
        setImage(null);
      }
      setSelections([]);
      setSelectedId(null);
      setCleanError(null);
      // 新的导出 seed
      exportSeedRef.current = randomSeed();
      showToast("已加载项目，可继续编辑");
    } catch (err) {
      setCleanError(
        `加载失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [applyBackground, showToast]);

  // ===== 渲染 =====
  return (
    <div className="app">
      <header className="app__header">
        <span>📝 Handwriting Layout</span>
        <ConnectionBadge
          status={status}
          apiBase={apiBase}
          onReconnect={reconnect}
          onApiBaseChange={updateApiBase}
        />
        <div className="header-tools" style={{ marginLeft: 8 }}>
          <button
            className="btn"
            onClick={handleLoadProject}
            title="加载项目 JSON"
          >
            加载项目
          </button>
          <button
            className="btn"
            onClick={handleSaveProject}
            disabled={!project.backgroundImage && project.textObjects.length === 0}
            title="保存为本地 JSON"
          >
            保存项目
          </button>
          <button
            className="btn btn--primary"
            onClick={handleExportPNG}
            disabled={!project.backgroundImage}
            title={project.backgroundImage ? "导出 PNG（原图尺寸）" : "请先上传图片"}
          >
            导出 PNG
          </button>
        </div>
      </header>

      <LeftPanel
        project={project}
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
          {project.backgroundImage ? (
            <CanvasStage
              project={project}
              image={image}
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
            />
          ) : (
            <div className="canvas-empty" style={{ width: 900, height: 600 }} />
          )}
        </div>
      </main>

      <StylePanel
        selected={selected}
        onChange={handleChange}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** 把各类错误转成给用户看的中文消息。 */
function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    let detail = err.body;
    try {
      const j = JSON.parse(err.body);
      if (j?.detail)
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
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
