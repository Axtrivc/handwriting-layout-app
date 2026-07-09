import type { TextObject } from "@hw-layout/shared";

interface StylePanelProps {
  selected: TextObject | null;
  onChange: (obj: TextObject) => void;
  onDelete: (id: string) => void;
}

/**
 * 右侧样式控制面板：调整选中文本的各项参数。
 */
export function StylePanel({ selected, onChange, onDelete }: StylePanelProps) {
  if (!selected) {
    return (
      <aside className="app__right">
        <p className="panel__title">样式</p>
        <p className="hint">请在画布或左侧列表选中一个文本对象。</p>
      </aside>
    );
  }

  const s = selected.style;
  const set = (patch: Partial<TextObject["style"]>): void => {
    onChange({ ...selected, style: { ...s, ...patch } });
  };

  return (
    <aside className="app__right">
      <p className="panel__title">文本内容</p>
      <div className="field">
        <textarea
          value={selected.text}
          onChange={(e) => onChange({ ...selected, text: e.target.value })}
          placeholder="输入文本（支持换行）"
        />
      </div>

      <p className="panel__title">位置</p>
      <div className="field">
        <label>X (px)</label>
        <input
          type="number"
          value={Math.round(selected.x)}
          onChange={(e) => onChange({ ...selected, x: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>Y (px)</label>
        <input
          type="number"
          value={Math.round(selected.y)}
          onChange={(e) => onChange({ ...selected, y: Number(e.target.value) })}
        />
      </div>

      <p className="panel__title">字体</p>
      <div className="field">
        <label>字号: {Math.round(s.fontSize)}px</label>
        <input
          type="range"
          min={8}
          max={120}
          step={1}
          value={s.fontSize}
          onChange={(e) => set({ fontSize: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>字距: {s.letterSpacing}px</label>
        <input
          type="range"
          min={-5}
          max={20}
          step={0.5}
          value={s.letterSpacing}
          onChange={(e) => set({ letterSpacing: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>行距: {s.lineHeight.toFixed(2)}</label>
        <input
          type="range"
          min={0.8}
          max={3}
          step={0.05}
          value={s.lineHeight}
          onChange={(e) => set({ lineHeight: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>颜色</label>
        <input
          type="color"
          value={s.color}
          onChange={(e) => set({ color: e.target.value })}
          style={{ width: "100%", height: 32, padding: 0 }}
        />
      </div>
      <div className="field">
        <label>透明度: {Math.round(s.opacity * 100)}%</label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={s.opacity}
          onChange={(e) => set({ opacity: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>旋转: {s.rotation.toFixed(1)}°</label>
        <input
          type="range"
          min={-15}
          max={15}
          step={0.5}
          value={s.rotation}
          onChange={(e) => set({ rotation: Number(e.target.value) })}
        />
      </div>

      <button
        className="btn"
        onClick={() => onDelete(selected.id)}
        style={{ width: "100%", marginTop: 8, color: "#c00", borderColor: "#e8b4b4" }}
      >
        删除该文本
      </button>
    </aside>
  );
}
