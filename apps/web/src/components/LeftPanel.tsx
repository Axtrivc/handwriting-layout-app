import { useRef } from "react";
import type { NaturalnessParams, ScanMode, ScanDetail } from "@hw-layout/shared";
import type { SelectionRect, StageView } from "./CanvasStage.js";
import type { CleanupTool } from '../lib/cleanSelection.js';

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
  strokeCount: number;
  cleanTool: CleanupTool;
  brushWidth: number;
  onCleanTool: (tool: CleanupTool) => void;
  onBrushWidth: (width: number) => void;
  onUndoStroke: () => void;
  cleaning: boolean;
  processingOperation: "clean" | "scan" | null;
  cleanError: string | null;
  canUndoClean: boolean;
  cleanStrength: "gentle" | "standard" | "strong";
  onCleanStrength: (strength: "gentle" | "standard" | "strong") => void;
  preserveRules: boolean;
  onPreserveRules: (value: boolean) => void;
  hasPreview: boolean;
  previewOperation: "clean" | "scan" | null;
  undoOperation: "clean" | "scan";
  scanMode: ScanMode;
  scanDetail: ScanDetail;
  onScanMode: (mode: ScanMode) => void;
  onScanDetail: (detail: ScanDetail) => void;
  onPrepareScan: () => void;
  onCancelProcessing: () => void;
  compareOriginal: boolean;
  onCompareOriginal: () => void;
  onApplyClean: () => void;
  onCancelClean: () => void;
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
  strokeCount, cleanTool, brushWidth, onCleanTool, onBrushWidth, onUndoStroke,
  cleaning,
  processingOperation,
  cleanError,
  canUndoClean, cleanStrength, onCleanStrength, preserveRules, onPreserveRules,
  hasPreview, compareOriginal, onCompareOriginal, onApplyClean, onCancelClean,
  previewOperation, undoOperation, scanMode, scanDetail, onScanMode, onScanDetail, onPrepareScan, onCancelProcessing,
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
  const selectionCount = selections.length + strokeCount;
  const previewLabel = previewOperation === "scan" ? "扫描" : "清除";
  const previewControls = hasPreview && <div role="status">
    <p className="hint">预览尚未保存。切换原图检查细节，或取消后调整设置。</p>
    <button className="btn" onClick={onCompareOriginal}>{compareOriginal ? `查看${previewLabel}效果` : "查看原图"}</button>
    <button className="btn btn--primary" onClick={onApplyClean}>应用{previewLabel}</button>
    <button className="btn" onClick={onCancelClean}>取消预览</button>
  </div>;

  return (
    <aside className="app__left">
      <div className="left-content">
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

      <p className="panel__title">扫描增强</p>
      <p className="hint">照片建议先去阴影、转扫描版，再框选擦除。先检查印刷字、浅字和细线是否完整。</p>
      <label className="field">扫描模式
        <select aria-label="扫描模式" value={scanMode} disabled={cleaning || hasPreview || !project.backgroundImage}
          onChange={e => onScanMode(e.target.value as ScanMode)}>
          <option value="bw">黑白扫描（推荐用于擦除）</option>
          <option value="gray">灰度扫描（保留浅色细节）</option>
        </select>
      </label>
      <label className="field">黑白细节
        <select aria-label="黑白细节" value={scanDetail} disabled={cleaning || hasPreview || !project.backgroundImage || scanMode === "gray"}
          onChange={e => onScanDetail(e.target.value as ScanDetail)}>
          <option value="faint">保留浅字</option><option value="standard">标准</option><option value="denoise">去噪更强</option>
        </select>
      </label>
      <button className="btn" style={{ width: "100%", marginBottom: 8 }} onClick={onPrepareScan}
        disabled={cleaning || hasPreview || !project.backgroundImage}>
        {processingOperation === "scan" ? "扫描处理中…" : "预览扫描"}
      </button>

      <p className="panel__title">清除字迹</p>
      <p className="hint">矩形用于整块区域，画笔可沿笔迹精细涂选。避开印刷内容；与笔迹重叠的原文无法保证恢复。</p>
      <label className="field">选区工具
        <select aria-label="选区工具" value={cleanTool} disabled={cleaning || hasPreview || !project.backgroundImage}
          onChange={e => onCleanTool(e.target.value as CleanupTool)}>
          <option value="rectangle">矩形框选</option><option value="brush">精细画笔</option>
        </select>
      </label>
      {cleanTool === 'brush' && <>
        <label className="field">画笔粗细：{brushWidth} 像素
          <input aria-label="画笔粗细" type="range" min={2} max={160} step={1} value={brushWidth}
            disabled={cleaning || hasPreview} onChange={e => onBrushWidth(Number(e.target.value))} />
        </label>
        <button className="btn" disabled={!strokeCount || cleaning || hasPreview} onClick={onUndoStroke}>撤销上一笔选区</button>
        <p className="hint">红色涂层仅表示选区。先预览，确认后应用；可放大画布处理细节。</p>
      </>}
      <label className="field">
        清除力度
        <select value={cleanStrength} disabled={cleaning || hasPreview}
          onChange={(e) => onCleanStrength(e.target.value as "gentle" | "standard" | "strong")}>
          <option value="gentle">轻柔（保护纸张细节）</option>
          <option value="standard">标准</option>
          <option value="strong">加强（浅色笔迹 / 残留）</option>
        </select>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={preserveRules} disabled={cleaning || hasPreview}
          onChange={(e) => onPreserveRules(e.target.checked)} />保留横线 / 表格竖线
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={selectMode}
          disabled={cleaning || hasPreview || !project.backgroundImage}
          onChange={(e) => onToggleSelectMode(e.target.checked)}
        />
        {cleanTool === 'brush' ? '画笔模式' : '框选模式'}
      </label>
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
      </div>
      <div className="cleanup-actions" role="region" aria-label="图片处理操作">
        {cleanError && <p className="err-msg" role="alert" title={cleanError}>⚠ {cleanError}</p>}
        {cleaning ? <div role="status">
          <p className="hint">{processingOperation === 'scan' ? '正在处理扫描图…' : '正在处理清除结果…'}</p>
          <button className="btn" onClick={onCancelProcessing}>取消处理</button>
        </div> : hasPreview ? previewControls : <>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn--primary" style={{ flex: 1 }} onClick={onClearRegion}
              disabled={selectionCount === 0 || !project.backgroundImage}
              title={selectionCount === 0 ? '请先选择擦除区域' : `清除 ${selectionCount} 个区域`}>
              预览清除 ({selectionCount})
            </button>
            <button className="btn" disabled={selectionCount === 0} onClick={onClearSelections} title="清空已框选区域">✕</button>
          </div>
          {canUndoClean && <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={onUndoClean}
            title="撤销最近一次背景处理，恢复上一张背景">
            {undoOperation === 'scan' ? '↶ 撤销扫描' : '↶ 撤销清除'}
          </button>}
        </>}
      </div>
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
