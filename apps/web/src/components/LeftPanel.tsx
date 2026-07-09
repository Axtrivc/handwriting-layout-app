import { useRef } from "react";
import type { NaturalnessParams } from "@hw-layout/shared";
import type { SelectionRect, StageView } from "./CanvasStage.js";

/** LeftPanel 所需的项目视图（多页改造后从 activePage 派生）。 */
type LeftPanelProject = Pick<
  StageView,
  "backgroundImage" | "textObjects" | "naturalnessEnabled" | "naturalness"
>;

interface LeftPanelProps {
  project: LeftPanelProject;
  selectedId: string | null;
  selectMode: boolean;
  selections: SelectionRect[];
  cleaning: boolean;
  cleanError: string | null;
  canUndoClean: boolean;
  onUpload: (file: File) => void;
  onAddText: () => void;
  onSelectText: (id: string) => void;
  onToggleNaturalness: (enabled: boolean) => void;
  onChangeNaturalness: (patch: Partial<NaturalnessParams>) => void;
  onToggleSelectMode: (enabled: boolean) => void;
  onClearRegion: () => void;
  onClearSelections: () => void;
  onUndoClean: () => void;
}

/**
 * 左侧面板：上传区 + 清除工具 + 文本列表 + 自然化控制 + 视图提示。
 */
export function LeftPanel({
  project,
  selectedId,
  selectMode,
  selections,
  cleaning,
  cleanError,
  canUndoClean,
  onUpload,
  onAddText,
  onSelectText,
  onToggleNaturalness,
  onChangeNaturalness,
  onToggleSelectMode,
  onClearRegion,
  onClearSelections,
  onUndoClean,
}: LeftPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const n = project.naturalness;

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
        <span className="hint">支持 PNG / JPG（仅处理你自己的素材）</span>
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
      <p className="hint">框选要清理的矩形区域，可多次；选区可拖角调整。</p>
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
          title={selections.length === 0 ? "请先框选区域" : `清除 ${selections.length} 个区域`}
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
      {canUndoClean && (
        <button
          className="btn"
          style={{ width: "100%", marginBottom: 8 }}
          onClick={onUndoClean}
          disabled={cleaning}
          title="撤销最近一次清除，恢复上一张背景"
        >
          ↶ 撤销清除
        </button>
      )}
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
      <p className="hint" style={{ marginTop: 0 }}>
        编辑时显示原始对象；导出时按固定 seed 应用，结果稳定一致。
      </p>
      {project.naturalnessEnabled && (
        <div className="nat-params">
          <NatSlider
            label="位置抖动"
            value={n.positionJitter}
            min={0}
            max={3}
            step={0.1}
            unit="px"
            onChange={(v) => onChangeNaturalness({ positionJitter: v })}
          />
          <NatSlider
            label="旋转抖动"
            value={n.rotationJitter}
            min={0}
            max={2}
            step={0.1}
            unit="°"
            onChange={(v) => onChangeNaturalness({ rotationJitter: v })}
          />
          <NatSlider
            label="透明度抖动"
            value={n.opacityJitter}
            min={0}
            max={0.1}
            step={0.01}
            unit=""
            pct
            onChange={(v) => onChangeNaturalness({ opacityJitter: v })}
          />
          <NatSlider
            label="字号波动"
            value={n.fontSizeJitter}
            min={0}
            max={2}
            step={0.1}
            unit="px"
            onChange={(v) => onChangeNaturalness({ fontSizeJitter: v })}
          />
          <NatSlider
            label="基线浮动"
            value={n.baselineJitter}
            min={0}
            max={2}
            step={0.1}
            unit="px"
            onChange={(v) => onChangeNaturalness({ baselineJitter: v })}
          />
        </div>
      )}

      <p className="panel__title" style={{ marginTop: 20 }}>
        视图操作
      </p>
      <p className="hint">
        • 滚轮：缩放画布<br />
        • 按住 空格 + 拖拽：平移视图<br />
        • 双击文本：编辑内容
      </p>
    </aside>
  );
}

function NatSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  pct = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  pct?: boolean;
  onChange: (v: number) => void;
}) {
  const display = pct ? `${Math.round(value * 100)}%` : `${value.toFixed(1)}${unit}`;
  return (
    <div className="field nat-params__item">
      <label>
        {label}: {display}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
