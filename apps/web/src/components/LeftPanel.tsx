import { useRef } from "react";
import type { CanvasProject } from "@hw-layout/shared";
import type { SelectionRect } from "./CanvasStage.js";

interface LeftPanelProps {
  project: CanvasProject;
  selectedId: string | null;
  selectMode: boolean;
  selections: SelectionRect[];
  cleaning: boolean;
  cleanError: string | null;
  onUpload: (file: File) => void;
  onAddText: () => void;
  onSelectText: (id: string) => void;
  onToggleNaturalness: (enabled: boolean) => void;
  onToggleSelectMode: (enabled: boolean) => void;
  onClearRegion: () => void;
  onClearSelections: () => void;
}

/**
 * 左侧面板：上传区 + 文本对象列表 + 清除区域工具 + 手写自然化开关。
 */
export function LeftPanel({
  project,
  selectedId,
  selectMode,
  selections,
  cleaning,
  cleanError,
  onUpload,
  onAddText,
  onSelectText,
  onToggleNaturalness,
  onToggleSelectMode,
  onClearRegion,
  onClearSelections,
}: LeftPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="app__left">
      <p className="panel__title">扫描稿</p>
      <div
        className="upload-area"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        {project.backgroundImage ? "更换图片" : "点击上传图片"}
        <br />
        <span className="hint">支持 PNG / JPG</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </div>

      <p className="panel__title">清除字迹</p>
      <p className="hint">
        在画布上框选要清理的矩形区域（可多次），完成后点「清除」。
      </p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={selectMode}
          onChange={(e) => onToggleSelectMode(e.target.checked)}
        />
        框选模式
      </label>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button
          className="btn btn--primary"
          style={{ flex: 1 }}
          disabled={selections.length === 0 || cleaning}
          onClick={onClearRegion}
          title={
            selections.length === 0
              ? "请先框选区域"
              : `清除 ${selections.length} 个区域`
          }
        >
          {cleaning ? "处理中…" : `清除字迹 (${selections.length})`}
        </button>
        <button
          className="btn"
          disabled={selections.length === 0}
          onClick={onClearSelections}
          title="清空已框选区域"
        >
          ✕
        </button>
      </div>
      {cleanError && (
        <p className="err-msg" title={cleanError}>
          ⚠ {cleanError}
        </p>
      )}

      <p className="panel__title" style={{ marginTop: 20 }}>
        文本对象
      </p>
      <button
        className="btn"
        onClick={onAddText}
        disabled={selectMode}
        style={{ width: "100%", marginBottom: 12 }}
        title={selectMode ? "请先退出框选模式" : undefined}
      >
        + 添加文本框
      </button>
      <ul className="text-list">
        {project.textObjects.length === 0 && (
          <li className="hint" style={{ cursor: "default" }}>
            暂无文本，点击上方添加
          </li>
        )}
        {project.textObjects.map((t) => (
          <li
            key={t.id}
            className={t.id === selectedId ? "is-active" : ""}
            title={t.text}
            onClick={() => onSelectText(t.id)}
          >
            {t.text.split("\n")[0] || "(空文本)"}
          </li>
        ))}
      </ul>

      <p className="panel__title" style={{ marginTop: 20 }}>
        手写自然化
      </p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={project.naturalnessEnabled}
          onChange={(e) => onToggleNaturalness(e.target.checked)}
        />
        启用温和抖动
      </label>
      <p className="hint">
        对每个文字加入轻微位置 / 旋转 / 透明度变化，让排版更自然。
      </p>
    </aside>
  );
}
