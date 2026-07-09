import { useCallback, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import {
  DEFAULT_NATURALNESS,
  DEFAULT_TEXT_STYLE,
  type CanvasProject,
  type TextObject,
} from "@hw-layout/shared";
import { CanvasStage, type SelectionRect } from "./components/CanvasStage.js";
import { LeftPanel } from "./components/LeftPanel.js";
import { StylePanel } from "./components/StylePanel.js";
import { ConnectionBadge } from "./components/ConnectionBadge.js";
import { useConnection } from "./lib/useConnection.js";
import {
  ApiError,
  cleanRegion,
} from "./lib/apiClient.js";
import {
  fileToDataURL,
  loadImage,
  uid,
  downloadDataURL,
  splitDataURL,
  joinDataURL,
} from "./lib/image.js";

const EMPTY_PROJECT: CanvasProject = {
  backgroundImage: null,
  width: 900,
  height: 600,
  textObjects: [],
  naturalnessEnabled: false,
  naturalness: DEFAULT_NATURALNESS,
};

export default function App() {
  const [project, setProject] = useState<CanvasProject>(EMPTY_PROJECT);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  // 框选清除区域状态
  const [selectMode, setSelectMode] = useState(false);
  const [selections, setSelections] = useState<SelectionRect[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  // 导出时隐藏框选 overlay
  const [exporting, setExporting] = useState(false);

  // 后端连接状态
  const { status, apiBase, updateApiBase, reconnect } = useConnection();

  const selected = useMemo(
    () => project.textObjects.find((t) => t.id === selectedId) ?? null,
    [project.textObjects, selectedId],
  );

  // 上传图片
  const handleUpload = useCallback(async (file: File) => {
    const dataURL = await fileToDataURL(file);
    const img = await loadImage(dataURL);
    setImage(img);
    setProject((p) => ({
      ...p,
      backgroundImage: dataURL,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
    // 新图清空框选与选中
    setSelections([]);
    setSelectedId(null);
    setCleanError(null);
  }, []);

  // 添加文本框
  const handleAddText = useCallback(() => {
    if (selectMode) return;
    const newObj: TextObject = {
      id: uid(),
      text: "双击编辑文本",
      x: project.width / 2,
      y: project.height / 2,
      style: { ...DEFAULT_TEXT_STYLE },
    };
    setProject((p) => ({ ...p, textObjects: [...p.textObjects, newObj] }));
    setSelectedId(newObj.id);
  }, [project.width, project.height, selectMode]);

  // 修改文本对象
  const handleChange = useCallback((obj: TextObject) => {
    setProject((p) => ({
      ...p,
      textObjects: p.textObjects.map((t) => (t.id === obj.id ? obj : t)),
    }));
  }, []);

  // 删除文本对象
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

  const handleToggleNaturalness = useCallback((enabled: boolean) => {
    setProject((p) => ({ ...p, naturalnessEnabled: enabled }));
  }, []);

  // 框选模式切换
  const handleToggleSelectMode = useCallback((enabled: boolean) => {
    setSelectMode(enabled);
    if (enabled) setSelectedId(null);
  }, []);

  // 框选结束：加入待清除列表
  const handleSelectionEnd = useCallback(
    (rect: Omit<SelectionRect, "id">) => {
      setSelections((prev) => [
        ...prev,
        { ...rect, id: uid() },
      ]);
    },
    [],
  );

  const handleClearSelections = useCallback(() => {
    setSelections([]);
    setCleanError(null);
  }, []);

  // 清除字迹闭环：发送背景图 + region 列表到后端
  const handleClearRegion = useCallback(async () => {
    if (!project.backgroundImage || selections.length === 0) return;
    setCleaning(true);
    setCleanError(null);
    try {
      const { data, mime } = splitDataURL(project.backgroundImage);
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
      // 用返回的新图替换背景
      const newDataURL = joinDataURL(resp.mime, resp.image);
      const img = await loadImage(newDataURL);
      setImage(img);
      setProject((p) => ({ ...p, backgroundImage: newDataURL }));
      setSelections([]);
    } catch (err) {
      const msg = describeError(err);
      setCleanError(msg);
    } finally {
      setCleaning(false);
    }
  }, [project.backgroundImage, selections]);

  // 导出 PNG（前端 canvas）
  // 注意：导出前临时移除选中，避免 Transformer 出现在导出图中
  const handleExportPNG = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const prevSelected = selectedId;
    const prevSelectMode = selectMode;
    setSelectedId(null);
    setSelectMode(false);
    setExporting(true);
    // 等待 React 重绘 + Konva 重绘后导出
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          const dataURL = stage.toDataURL({
            pixelRatio: 1,
            x: 0,
            y: 0,
            width: project.width,
            height: project.height,
          });
          downloadDataURL(dataURL, `handwriting-${Date.now()}.png`);
        } finally {
          // 恢复原状态
          setSelectedId(prevSelected);
          setSelectMode(prevSelectMode);
          setExporting(false);
        }
      });
    });
  }, [project.width, project.height, selectedId, selectMode]);

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
        <button
          className="btn btn--primary"
          onClick={handleExportPNG}
          disabled={!project.backgroundImage}
          title={project.backgroundImage ? "导出 PNG" : "请先上传图片"}
          style={{ marginLeft: 8 }}
        >
          导出 PNG
        </button>
      </header>

      <LeftPanel
        project={project}
        selectedId={selectedId}
        selectMode={selectMode}
        selections={selections}
        cleaning={cleaning}
        cleanError={cleanError}
        onUpload={handleUpload}
        onAddText={handleAddText}
        onSelectText={setSelectedId}
        onToggleNaturalness={handleToggleNaturalness}
        onToggleSelectMode={handleToggleSelectMode}
        onClearRegion={handleClearRegion}
        onClearSelections={handleClearSelections}
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
              onSelectionEnd={handleSelectionEnd}
              exporting={exporting}
            />
          ) : (
            <div
              className="canvas-empty"
              style={{ width: 900, height: 600 }}
            />
          )}
        </div>
      </main>

      <StylePanel
        selected={selected}
        onChange={handleChange}
        onDelete={handleDelete}
      />
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
