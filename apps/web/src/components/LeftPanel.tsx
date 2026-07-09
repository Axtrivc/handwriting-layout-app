import { useRef } from "react";
import type { CanvasProject } from "@hw-layout/shared";

interface LeftPanelProps {
  project: CanvasProject;
  selectedId: string | null;
  onUpload: (file: File) => void;
  onAddText: () => void;
  onSelectText: (id: string) => void;
  onToggleNaturalness: (enabled: boolean) => void;
}

/**
 * 左侧面板：上传区 + 文本对象列表 + 手写自然化开关。
 */
export function LeftPanel({
  project,
  selectedId,
  onUpload,
  onAddText,
  onSelectText,
  onToggleNaturalness,
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

      <p className="panel__title">文本对象</p>
      <button className="btn" onClick={onAddText} style={{ width: "100%", marginBottom: 12 }}>
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
