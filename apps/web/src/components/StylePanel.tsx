import type {
  TextAlign,
  TextObject,
} from "@hw-layout/shared";

interface StylePanelProps {
  selected: TextObject | null;
  onChange: (obj: TextObject) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
}

/** 可选字体族（系统字体为主，避免引入外部字体包）。 */
const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "手写风 (Cursive)", value: "cursive, 'Comic Sans MS', 'PingFang SC', sans-serif" },
  { label: "宋体 / Serif", value: "'Songti SC', 'SimSun', serif" },
  { label: "黑体 / Sans", value: "'PingFang SC', 'Microsoft YaHei', sans-serif" },
  { label: "等宽 / Mono", value: "'Courier New', 'Consolas', monospace" },
];

/**
 * 右侧样式控制面板：调整选中文本的各项参数。
 */
export function StylePanel({
  selected,
  onChange,
  onDelete,
  onDuplicate,
  onBringToFront,
  onSendToBack,
}: StylePanelProps) {
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

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button className="btn" style={{ flex: 1 }} onClick={() => onDuplicate(selected.id)}>
          复制
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => onBringToFront(selected.id)}>
          置顶
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => onSendToBack(selected.id)}>
          置底
        </button>
      </div>

      <p className="panel__title">字体</p>
      <div className="field">
        <label>字体族</label>
        <select value={s.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
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
        <label>对齐</label>
        <div className="seg">
          {(["left", "center", "right"] as TextAlign[]).map((a) => (
            <button
              key={a}
              className={`seg__btn ${s.align === a ? "is-active" : ""}`}
              onClick={() => set({ align: a })}
            >
              {a === "left" ? "左" : a === "center" ? "中" : "右"}
            </button>
          ))}
        </div>
      </div>

      <p className="panel__title">外观</p>
      <div className="field">
        <label>字色</label>
        <input
          type="color"
          value={s.color}
          onChange={(e) => set({ color: e.target.value })}
          style={{ width: "100%", height: 32, padding: 0 }}
        />
      </div>
      <div className="field">
        <label>粗细 / 倾斜</label>
        <div className="seg">
          <button
            className={`seg__btn ${s.fontWeight === "bold" ? "is-active" : ""}`}
            onClick={() =>
              set({ fontWeight: s.fontWeight === "bold" ? "normal" : "bold" })
            }
          >
            B
          </button>
          <button
            className={`seg__btn ${s.fontStyle === "italic" ? "is-active" : ""}`}
            style={{ fontStyle: "italic" }}
            onClick={() =>
              set({ fontStyle: s.fontStyle === "italic" ? "normal" : "italic" })
            }
          >
            I
          </button>
        </div>
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
      <div className="field">
        <label>
          轻微模糊: {s.blur.toFixed(1)}px
          <span className="hint">（模拟墨迹柔边）</span>
        </label>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.1}
          value={s.blur}
          onChange={(e) => set({ blur: Number(e.target.value) })}
        />
        {/* TODO: 混合模式（multiply 正片叠底等）后续阶段实现 */}
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
