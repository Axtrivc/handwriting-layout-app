import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Stage, Layer, Image as KonvaImage, Rect, Label, Tag, Text, Group } from "react-konva";
import type {
  GlyphBoundingBox,
  GlyphCandidate,
  GlyphQualityLevel,
  HandwritingProfile,
  HandwritingSampleSet,
} from "@hw-layout/shared";
import { assessGlyphQuality } from "@hw-layout/shared";

/** 候选框（可来自自动检测或手动新增）。 */
interface CandBox {
  id: string;
  x: number; // 原图坐标
  y: number;
  width: number;
  height: number;
  rowIndex: number;
  orderIndex: number;
}

interface GlyphSegmenterProps {
  profile: HandwritingProfile;
  sampleSet: HandwritingSampleSet;
  image: HTMLImageElement | null;
  onSaveGlyph: (char: string, bbox: GlyphBoundingBox) => Promise<void>;
  onBatchSaveGlyphs: (
    items: { char: string; bbox: GlyphBoundingBox }[],
  ) => Promise<{ saved: number; skipped: number }>;
  onDeleteGlyph: (glyphId: string) => void;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onDetect: (sampleDataURL: string) => Promise<GlyphCandidate[]>;
  detecting: boolean;
}

/**
 * 字形切割器：
 * - 手动框选 + 自动检测候选框
 * - 候选框可删除/调整/新增
 * - 单个保存 / 批量标注（按 orderIndex 顺序匹配字符）
 * - glyph 列表 + 搜索 + 删除 + 质量提示
 */
export function GlyphSegmenter({
  profile,
  sampleSet,
  image,
  onSaveGlyph,
  onBatchSaveGlyphs,
  onDeleteGlyph,
  saving,
  error,
  onClose,
  onDetect,
  detecting,
}: GlyphSegmenterProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [cands, setCands] = useState<CandBox[]>([]);
  const [selectedCandId, setSelectedCandId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const [char, setChar] = useState("");
  const [batchText, setBatchText] = useState("");
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const MAX_DISPLAY = 720;
  const scale = image ? Math.min(1, MAX_DISPLAY / image.naturalWidth) : 1;
  const dispW = image ? image.naturalWidth * scale : MAX_DISPLAY;
  const dispH = image ? image.naturalHeight * scale : 480;

  const toDisplay = (b: { x: number; y: number; width: number; height: number }) => ({
    x: b.x * scale,
    y: b.y * scale,
    width: b.width * scale,
    height: b.height * scale,
  });

  // 空白处拖拽 = 新增候选框
  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    // 点中已有候选框则选中
    if (e.target !== e.target.getStage() && e.target.id()?.startsWith("cand-")) {
      setSelectedCandId(e.target.id().replace("cand-", ""));
      return;
    }
    startRef.current = pos;
    setDraft({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };
  const onMouseMove = () => {
    if (!startRef.current) return;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const s = startRef.current;
    setDraft({
      x: Math.min(s.x, pos.x),
      y: Math.min(s.y, pos.y),
      w: Math.abs(pos.x - s.x),
      h: Math.abs(pos.y - s.y),
    });
  };
  const onMouseUp = () => {
    if (draft && draft.w >= 6 && draft.h >= 6) {
      // 新增候选框
      const newCand: CandBox = {
        id: `c-${Date.now()}`,
        x: Math.round(draft.x / scale),
        y: Math.round(draft.y / scale),
        width: Math.round(draft.w / scale),
        height: Math.round(draft.h / scale),
        rowIndex: 0,
        orderIndex: cands.length,
      };
      setCands((prev) => [...prev, newCand]);
      setSelectedCandId(newCand.id);
    }
    setDraft(null);
    startRef.current = null;
  };

  const toOriginal = (d: { x: number; y: number; w: number; h: number }): GlyphBoundingBox => ({
    x: Math.round(d.x / scale),
    y: Math.round(d.y / scale),
    width: Math.round(d.w / scale),
    height: Math.round(d.h / scale),
  });
  // 当选中候选框但用户也想用手动 draft 时，draft 优先
  const activeDraftBbox = draft && draft.w >= 6 && draft.h >= 6 ? toOriginal(draft) : null;

  // 自动检测
  const handleDetect = async () => {
    try {
      const result = await onDetect(sampleSet.imageBase64);
      setCands(
        result.map((c, i) => ({
          id: `d-${i}-${Date.now()}`,
          x: c.x,
          y: c.y,
          width: c.width,
          height: c.height,
          rowIndex: c.rowIndex,
          orderIndex: c.orderIndex,
        })),
      );
      setSelectedCandId(null);
      setBatchMsg(null);
    } catch {
      /* 错误由上层 error 显示 */
    }
  };

  // 保存选中候选框对应字符（若有手动 draft 则优先用 draft）
  const handleSaveSelected = async () => {
    if (!char.trim()) return;
    if (activeDraftBbox) {
      await onSaveGlyph(char, activeDraftBbox);
      setDraft(null);
      setChar("");
      return;
    }
    const c = cands.find((x) => x.id === selectedCandId);
    if (!c) return;
    await onSaveGlyph(char, { x: c.x, y: c.y, width: c.width, height: c.height });
    // 保存后移除该候选框
    setCands((prev) => prev.filter((x) => x.id !== c.id));
    setChar("");
    setSelectedCandId(null);
  };

  // 批量标注：按 orderIndex 顺序匹配字符
  const handleBatchSave = async () => {
    const chars = Array.from(batchText);
    if (chars.length === 0) return;
    // 按 rowIndex, orderIndex 排序
    const sorted = [...cands].sort(
      (a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex,
    );
    const items: { char: string; bbox: GlyphBoundingBox }[] = [];
    for (let i = 0; i < sorted.length && i < chars.length; i++) {
      const ch = chars[i].trim();
      if (!ch) continue;
      items.push({
        char: ch,
        bbox: { x: sorted[i].x, y: sorted[i].y, width: sorted[i].width, height: sorted[i].height },
      });
    }
    const result = await onBatchSaveGlyphs(items);
    // 移除已处理的候选框
    const usedIds = new Set(sorted.slice(0, items.length).map((c) => c.id));
    setCands((prev) => prev.filter((c) => !usedIds.has(c.id)));
    const leftover = chars.length - sorted.length;
    setBatchMsg(
      `已保存 ${result.saved} 个${result.skipped > 0 ? `，跳过 ${result.skipped} 个` : ""}` +
        (leftover > 0 ? `；多余 ${leftover} 个字符未使用` : ""),
    );
    setBatchText("");
  };

  const handleDeleteCand = (id: string) => {
    setCands((prev) => prev.filter((c) => c.id !== id));
    if (selectedCandId === id) setSelectedCandId(null);
  };

  // 候选框质量评估（仅几何）
  const candQuality = useMemo(() => {
    const map = new Map<string, GlyphQualityLevel>();
    for (const c of cands) {
      const q = assessGlyphQuality({
        char: "?",
        bbox: { x: c.x, y: c.y, width: c.width, height: c.height },
        variantCount: 0,
      });
      map.set(c.id, q.level);
    }
    return map;
  }, [cands]);

  // glyph 列表（带搜索）
  const filteredGlyphs = useMemo(() => {
    const q = query.trim();
    if (!q) return profile.glyphs;
    return profile.glyphs.filter((g) => g.char.includes(q));
  }, [profile.glyphs, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="seg-overlay">
      <div className="seg-modal">
        <div className="seg-modal__head">
          <span>
            切割字形 — {profile.name} / {sampleSet.name}
            （候选 {cands.length}）
          </span>
          <button className="btn btn--xs" onClick={onClose}>
            ✕ 关闭 (Esc)
          </button>
        </div>

        <div className="seg-modal__body">
          <div className="seg-canvas-area">
            {image ? (
              <Stage
                ref={stageRef}
                width={dispW}
                height={dispH}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                style={{ cursor: "crosshair", background: "#e9e9ef", borderRadius: 8 }}
              >
                <Layer>
                  <KonvaImage image={image} width={dispW} height={dispH} />
                  {cands.map((c) => {
                    const d = toDisplay(c);
                    const isSel = c.id === selectedCandId;
                    const lvl = candQuality.get(c.id) ?? "good";
                    const color =
                      lvl === "poor" ? "#c00" : lvl === "warning" ? "#e0a800" : "#2f6df6";
                    return (
                      <Group key={c.id}>
                        <Rect
                          id={`cand-${c.id}`}
                          x={d.x}
                          y={d.y}
                          width={d.width}
                          height={d.height}
                          stroke={isSel ? "#1aa260" : color}
                          strokeWidth={isSel ? 2 : 1.2}
                          dash={isSel ? [] : [4, 3]}
                          fill={isSel ? "rgba(26,162,96,0.12)" : "rgba(47,109,246,0.05)"}
                          draggable
                          onDragEnd={(e) => {
                            const nx = e.target.x() / scale;
                            const ny = e.target.y() / scale;
                            setCands((prev) =>
                              prev.map((cc) =>
                                cc.id === c.id ? { ...cc, x: nx, y: ny } : cc,
                              ),
                            );
                          }}
                          onTransformEnd={(e) => {
                            const node = e.target as Konva.Rect;
                            const sx = node.scaleX();
                            const sy = node.scaleY();
                            setCands((prev) =>
                              prev.map((cc) =>
                                cc.id === c.id
                                  ? {
                                      ...cc,
                                      x: node.x() / scale,
                                      y: node.y() / scale,
                                      width: Math.max(4, cc.width * sx),
                                      height: Math.max(4, cc.height * sy),
                                    }
                                  : cc,
                              ),
                            );
                            node.scaleX(1);
                            node.scaleY(1);
                          }}
                        />
                        <Label x={d.x} y={d.y - 16} listening={false}>
                          <Tag fill={color} cornerRadius={3} />
                          <Text
                            text={`${c.orderIndex}`}
                            fill="#fff"
                            fontSize={11}
                            padding={2}
                          />
                        </Label>
                      </Group>
                    );
                  })}
                  {draft && draft.w > 0 && draft.h > 0 && (
                    <Rect
                      x={draft.x}
                      y={draft.y}
                      width={draft.w}
                      height={draft.h}
                      stroke="#1aa260"
                      strokeWidth={1.5}
                      dash={[4, 4]}
                      fill="rgba(26,162,96,0.1)"
                    />
                  )}
                </Layer>
              </Stage>
            ) : (
              <div className="hint">样本图加载中…</div>
            )}
            <p className="hint" style={{ marginTop: 6 }}>
              空白处拖拽 = 新增候选；点候选框选中后拖拽/缩放调整；颜色：蓝=good 黄=warning 红=poor
            </p>
          </div>

          <div className="seg-side">
            <div className="seg-detect">
              <button
                className="btn btn--primary"
                style={{ width: "100%", marginBottom: 6 }}
                disabled={!image || detecting}
                onClick={handleDetect}
              >
                {detecting ? "检测中…" : "🔍 自动检测字形区域"}
              </button>
              <button
                className="btn"
                style={{ width: "100%", marginBottom: 6 }}
                disabled={cands.length === 0}
                onClick={() => setCands([])}
              >
                清空候选框
              </button>
              {cands.length > 0 && (
                <div className="cand-list">
                  <div className="hint" style={{ marginBottom: 4 }}>
                    候选框（点击选中，✕ 删除）
                  </div>
                  <div className="cand-list__items">
                    {[...cands]
                      .sort((a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex)
                      .map((c) => {
                        const lvl = candQuality.get(c.id) ?? "good";
                        const dot =
                          lvl === "poor" ? "●" : lvl === "warning" ? "●" : "●";
                        const color =
                          lvl === "poor" ? "#c00" : lvl === "warning" ? "#e0a800" : "#2f6df6";
                        return (
                          <span
                            key={c.id}
                            className={`cand-chip ${c.id === selectedCandId ? "is-active" : ""}`}
                            onClick={() => setSelectedCandId(c.id)}
                          >
                            <span style={{ color }}>{dot}</span>
                            {c.orderIndex}
                            <button
                              className="btn btn--xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCand(c.id);
                              }}
                            >
                              ✕
                            </button>
                          </span>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            <div className="seg-save">
              <div className="field">
                <label>选中候选框的字符（{selectedCandId ? "已选" : "未选"}）</label>
                <input
                  type="text"
                  value={char}
                  onChange={(e) => setChar(e.target.value)}
                  placeholder="选中候选框后输入字"
                  maxLength={4}
                />
              </div>
              <button
                className="btn btn--primary"
                style={{ width: "100%" }}
                disabled={!selectedCandId || !char.trim() || saving}
                onClick={handleSaveSelected}
              >
                {saving ? "保存中…" : "保存选中"}
              </button>

              <div className="field" style={{ marginTop: 10 }}>
                <label>批量标注（按阅读顺序逐字匹配候选框）</label>
                <textarea
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder="如：的一是在不了有和人这中大"
                  rows={2}
                />
              </div>
              <button
                className="btn"
                style={{ width: "100%" }}
                disabled={cands.length === 0 || !batchText.trim() || saving}
                onClick={handleBatchSave}
              >
                批量保存 ({cands.length} 候选)
              </button>
              {batchMsg && <p className="hint" style={{ marginTop: 6 }}>{batchMsg}</p>}
            </div>

            {error && <p className="err-msg">{error}</p>}

            <div className="seg-glyphs">
              <div className="field">
                <label>已保存字形（{profile.glyphs.length}）</label>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="按字符搜索"
                />
              </div>
              <div className="seg-glyph-grid">
                {filteredGlyphs.length === 0 && (
                  <span className="hint">暂无字形</span>
                )}
                {filteredGlyphs.map((g) => (
                  <div key={g.id} className="seg-glyph-cell" title={`${g.char} #${g.variantIndex}`}>
                    <img src={g.imageBase64} alt={g.char} />
                    <div className="seg-glyph-cell__bar">
                      <span>
                        {g.char}#{g.variantIndex}
                      </span>
                      <button className="btn btn--xs" onClick={() => onDeleteGlyph(g.id)}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
