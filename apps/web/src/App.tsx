import { useCallback, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import {
  DEFAULT_NATURALNESS,
  DEFAULT_TEXT_STYLE,
  type CanvasProject,
  type TextObject,
} from "@hw-layout/shared";
import { CanvasStage } from "./components/CanvasStage.js";
import { LeftPanel } from "./components/LeftPanel.js";
import { StylePanel } from "./components/StylePanel.js";
import {
  fileToDataURL,
  loadImage,
  uid,
  downloadDataURL,
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

  // 选中对象
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
  }, []);

  // 添加文本框
  const handleAddText = useCallback(() => {
    const newObj: TextObject = {
      id: uid(),
      text: "双击编辑文本",
      x: project.width / 2,
      y: project.height / 2,
      style: { ...DEFAULT_TEXT_STYLE },
    };
    setProject((p) => ({ ...p, textObjects: [...p.textObjects, newObj] }));
    setSelectedId(newObj.id);
  }, [project.width, project.height]);

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

  // 导出 PNG（前端 canvas）
  const handleExportPNG = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // 临时取消选中，避免 Transformer 出现在导出图中
    setSelectedId(null);
    // 下一帧再导出，确保 Transformer 已移除
    requestAnimationFrame(() => {
      const dataURL = stage.toDataURL({ pixelRatio: 1 });
      downloadDataURL(dataURL, `handwriting-${Date.now()}.png`);
    });
  }, []);

  // 导出 PNG 后端占位（可选）
  const handleExportBackend = useCallback(async () => {
    // TODO: 等待 /export 接口完善后改为服务端渲染
    const { exportFile } = await import("./lib/apiClient.js");
    const pngData = stageRef.current?.toDataURL({ pixelRatio: 1 }).replace(
      /^data:image\/png;base64,/,
      "",
    );
    if (!pngData) return;
    const resp = await exportFile({ project, format: "png" });
    downloadDataURL(joinDataURL(resp.mime, resp.data), resp.filename);
  }, [project]);

  return (
    <div className="app">
      <header className="app__header">
        <span>📝 Handwriting Layout</span>
        <button className="btn btn--primary" onClick={handleExportPNG}>
          导出 PNG
        </button>
        <button className="btn" onClick={handleExportBackend} title="调用后端 /export（预留）">
          服务端导出
        </button>
      </header>

      <LeftPanel
        project={project}
        selectedId={selectedId}
        onUpload={handleUpload}
        onAddText={handleAddText}
        onSelectText={setSelectedId}
        onToggleNaturalness={handleToggleNaturalness}
      />

      <main className="app__center">
        <div className="canvas-wrap">
          <CanvasStage
            project={project}
            image={image}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={handleChange}
            onStageReady={(s) => (stageRef.current = s)}
          />
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
