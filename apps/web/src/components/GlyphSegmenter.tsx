import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Stage, Layer, Image as KonvaImage, Rect, Label, Tag, Text, Group } from "react-konva";
import type {
  GlyphBoundingBox,
  GlyphCandidate,
  GlyphQualityLevel,
  HandwritingProfile,
  HandwritingSampleSet,
  OcrResultResponse,
} from "@hw-layout/shared";
import { assessGlyphQuality, classifyConfidence } from "@hw-layout/shared";

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

/** 候选框的 OCR 建议。 */
interface CandOcr {
  char: string;
  confidence: number;
  level: "high" | "medium" | "low";
  provider: string;
}

/** 候选框的字符标注（用户输入或 OCR 应用）。 */
interface CandLabel {
  char: string;
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
  /** OCR 辅助：对候选框批量识别 */
  onSuggestLabels: (
    sampleDataURL: string,
    cands: CandBox[],
  ) => Promise<OcrResultResponse>;
  /** OCR 状态 */
  ocrStatus: OcrResultResponse | null;
  ocrLoading: boolean;
}

/**
 * 字形切割器：
 * - 手动框选 + 自动检测候选框
 * - OCR 辅助识别（高置信度可一键应用，中低不自动）
 * - 候选框可删除/调整/新增
 * - 键盘导航（←/→ 切换、Enter 保存、Delete 删除）
 * - 单个保存 / 批量标注（含 OCR 建议保存 + 摘要）
 * - glyph 列表 + 搜索 + 删除 + 质量提示
 * - 过滤：只显示未标注 / 只显示低置信度
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
  onSuggestLabels,
  ocrStatus,
  ocrLoading,
}: GlyphSegmenterProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [cands, setCands] = useState<CandBox[]>([]);
  const [candLabels, setCandLabels] = useState<Map<string, CandLabel>>(new Map());
  const [candOcr, setCandOcr] = useState<Map<string, CandOcr>>(new Map());
  const [selectedCandId, setSelectedCandId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [filterUnlabeled, setFilterUnlabeled] = useState(false);
  const [filterLowConf, setFilterLowConf] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [saveSummary, setSaveSummary] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const ocrAvailable = ocrStatus?.status === "ok";

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
  const toOriginal = (d: { x: number; y: number; w: number; h: number }): GlyphBoundingBox => ({
    x: Math.round(d.x / scale),
    y: Math.round(d.y / scale),
    width: Math.round(d.w / scale),
    height: Math.round(d.h / scale),
  });
  const activeDraftBbox = draft && draft.w >= 6 && draft.h >= 6 ? toOriginal(draft) : null;

  // ===== 鼠标交互 =====
  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
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

  // ===== 自动检测 =====
  const handleDetect = async () => {
    try {
      const result = await onDetect(sampleSet.imageBase64);
      setCands(
        result.map((c, i) => ({
          id: `d-${i}-${Date.now()}`,
          x: c.x, y: c.y, width: c.width, height: c.height,
          rowIndex: c.rowIndex, orderIndex: c.orderIndex,
        })),
      );
      setCandLabels(new Map());
      setCandOcr(new Map());
      setSelectedCandId(null);
      setBatchMsg(null);
    } catch {
      /* 错误由上层 error 显示 */
    }
  };

  // ===== OCR 辅助识别 =====
  const handleOcrSuggest = async () => {
    if (cands.length === 0) return;
    const res = await onSuggestLabels(sampleSet.imageBase64, cands);
    if (res.status !== "ok") return;
    const sorted = [...cands].sort(
      (a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex,
    );
    const newOcr = new Map<string, CandOcr>();
    res.candidates.forEach((c, i) => {
      const cand = sorted[i];
      if (cand) {
        newOcr.set(cand.id, {
          char: c.text,
          confidence: c.confidence,
          level: classifyConfidence(c.confidence),
          provider: c.provider,
        });
      }
    });
    setCandOcr(newOcr);
    setBatchMsg(`OCR 返回 ${res.candidates.length} 个建议（高置信度可一键应用）`);
  };

  // 应用高置信度建议（>=0.85）
  const handleApplyHighConf = () => {
    const newLabels = new Map(candLabels);
    let count = 0;
    for (const [id, ocr] of candOcr) {
      if (ocr.level === "high" && ocr.char) {
        newLabels.set(id, { char: ocr.char });
        count++;
      }
    }
    setCandLabels(newLabels);
    setBatchMsg(`已应用 ${count} 个高置信度建议`);
  };

  const clearOcr = () => {
    setCandOcr(new Map());
    setBatchMsg(null);
  };

  // ===== 标签操作 =====
  const setLabel = (id: string, char: string) => {
    setCandLabels((prev) => {
      const next = new Map(prev);
      if (char) next.set(id, { char });
      else next.delete(id);
      return next;
    });
  };

  const handleSaveSelected = async () => {
    const c = cands.find((x) => x.id === selectedCandId);
    const label = selectedCandId ? candLabels.get(selectedCandId)?.char : "";
    const char = label || "";
    if (activeDraftBbox && char) {
      await onSaveGlyph(char, activeDraftBbox);
      setDraft(null);
      return;
    }
    if (!c || !char) return;
    await onSaveGlyph(char, { x: c.x, y: c.y, width: c.width, height: c.height });
    setCands((prev) => prev.filter((x) => x.id !== c.id));
    setCandLabels((prev) => {
      const next = new Map(prev);
      next.delete(c.id);
      return next;
    });
    // 自动跳到下一个
    if (autoAdvance) {
      const idx = cands.findIndex((x) => x.id === c.id);
      const next = cands[idx + 1];
      if (next) setSelectedCandId(next.id);
    }
  };

  // ===== 批量保存（含 OCR 建议或手动批量文本）=====
  const handleBatchSave = async () => {
    const sorted = [...cands].sort(
      (a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex,
    );
    // 优先用 batchText，否则用各候选的 label
    const items: { char: string; bbox: GlyphBoundingBox }[] = [];
    let emptyCount = 0;
    let lowConfCount = 0;
    if (batchText.trim()) {
      const chars = Array.from(batchText);
      for (let i = 0; i < sorted.length && i < chars.length; i++) {
        const ch = chars[i].trim();
        if (!ch) {
          emptyCount++;
          continue;
        }
        items.push({ char: ch, bbox: { x: sorted[i].x, y: sorted[i].y, width: sorted[i].width, height: sorted[i].height } });
      }
    } else {
      for (const c of sorted) {
        const label = candLabels.get(c.id)?.char ?? "";
        const ocr = candOcr.get(c.id);
        if (!label) {
          emptyCount++;
          continue;
        }
        if (ocr && ocr.level === "low") lowConfCount++;
        items.push({ char: label, bbox: { x: c.x, y: c.y, width: c.width, height: c.height } });
      }
    }

    if (items.length === 0) {
      setSaveSummary("没有可保存的字符（全部为空）");
      return;
    }
    // 保存前摘要
    const summary = `将保存 ${items.length} 个字形\n空字符：${emptyCount}\n低置信度：${lowConfCount}`;
    if (!window.confirm(`${summary}\n\n是否继续？`)) return;

    const result = await onBatchSaveGlyphs(items);
    // 移除已保存
    const usedIds = new Set(sorted.slice(0, items.length + emptyCount).map((c) => c.id));
    setCands((prev) => prev.filter((c) => !usedIds.has(c.id)));
    setSaveSummary(`保存成功 ${result.saved} 个${result.skipped > 0 ? `，跳过 ${result.skipped}` : ""}`);
    setBatchText("");
  };

  const handleDeleteCand = (id: string) => {
    setCands((prev) => prev.filter((c) => c.id !== id));
    setCandLabels((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setCandOcr((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    if (selectedCandId === id) setSelectedCandId(null);
  };

  // 键盘导航
  const navCand = (dir: -1 | 1) => {
    if (cands.length === 0) return;
    const sorted = [...cands].sort(
      (a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex,
    );
    const curIdx = sorted.findIndex((c) => c.id === selectedCandId);
    const nextIdx = curIdx < 0 ? 0 : Math.max(0, Math.min(sorted.length - 1, curIdx + dir));
    setSelectedCandId(sorted[nextIdx].id);
  };

  // 候选框质量
  const candQuality = useMemo(() => {
    const map = new Map<string, GlyphQualityLevel>();
    for (const c of cands) {
      const q = assessGlyphQuality({ char: "?", bbox: { x: c.x, y: c.y, width: c.width, height: c.height } });
      map.set(c.id, q.level);
    }
    return map;
  }, [cands]);

  // 过滤显示的候选框列表
  const sortedCands = useMemo(
    () => [...cands].sort((a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex),
    [cands],
  );
  const filteredListCands = useMemo(() => {
    return sortedCands.filter((c) => {
      if (filterUnlabeled && candLabels.has(c.id)) return false;
      if (filterLowConf) {
        const ocr = candOcr.get(c.id);
        if (!ocr || ocr.level !== "low") return false;
      }
      return true;
    });
  }, [sortedCands, filterUnlabeled, filterLowConf, candLabels, candOcr]);

  const filteredGlyphs = useMemo(() => {
    const q = query.trim();
    if (!q) return profile.glyphs;
    return profile.glyphs.filter((g) => g.char.includes(q));
  }, [profile.glyphs, query]);

  // 键盘事件
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); navCand(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); navCand(1); }
      else if (e.key === "Enter" && selectedCandId) { e.preventDefault(); void handleSaveSelected(); }
      else if (e.key === "Delete" && selectedCandId) { e.preventDefault(); handleDeleteCand(selectedCandId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedLabel = selectedCandId ? candLabels.get(selectedCandId)?.char ?? "" : "";
  const selectedOcr = selectedCandId ? candOcr.get(selectedCandId) : undefined;

  return (
    <div className="seg-overlay">
      <div className="seg-modal">
        <div className="seg-modal__head">
          <span>切割字形 — {profile.name} / {sampleSet.name}（候选 {cands.length}）</span>
          <button className="btn btn--xs" onClick={onClose}>✕ 关闭 (Esc)</button>
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
                    const ocr = candOcr.get(c.id);
                    const label = candLabels.get(c.id)?.char;
                    const color = lvl === "poor" ? "#c00" : lvl === "warning" ? "#e0a800" : "#2f6df6";
                    const ocrColor = ocr?.level === "high" ? "#1aa260" : ocr?.level === "medium" ? "#e0a800" : "#999";
                    return (
                      <Group key={c.id}>
                        <Rect
                          id={`cand-${c.id}`}
                          x={d.x} y={d.y} width={d.width} height={d.height}
                          stroke={isSel ? "#1aa260" : color}
                          strokeWidth={isSel ? 2 : 1.2}
                          dash={isSel ? [] : [4, 3]}
                          fill={isSel ? "rgba(26,162,96,0.12)" : "rgba(47,109,246,0.05)"}
                          draggable
                          onDragEnd={(e) => {
                            setCands((prev) => prev.map((cc) => cc.id === c.id ? { ...cc, x: e.target.x() / scale, y: e.target.y() / scale } : cc));
                          }}
                          onTransformEnd={(e) => {
                            const node = e.target as Konva.Rect;
                            const sx = node.scaleX(); const sy = node.scaleY();
                            setCands((prev) => prev.map((cc) => cc.id === c.id ? { ...cc, x: node.x() / scale, y: node.y() / scale, width: Math.max(4, cc.width * sx), height: Math.max(4, cc.height * sy) } : cc));
                            node.scaleX(1); node.scaleY(1);
                          }}
                        />
                        <Label x={d.x} y={d.y - 16} listening={false}>
                          <Tag fill={label ? "#1aa260" : color} cornerRadius={3} />
                          <Text text={`${c.orderIndex}${label ? `:${label}` : ""}`} fill="#fff" fontSize={11} padding={2} />
                        </Label>
                        {ocr && (
                          <Label x={d.x + d.width - 30} y={d.y - 16} listening={false}>
                            <Tag fill={ocrColor} cornerRadius={3} />
                            <Text text={`${Math.round(ocr.confidence * 100)}%`} fill="#fff" fontSize={10} padding={2} />
                          </Label>
                        )}
                      </Group>
                    );
                  })}
                  {draft && draft.w > 0 && draft.h > 0 && (
                    <Rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} stroke="#1aa260" strokeWidth={1.5} dash={[4, 4]} fill="rgba(26,162,96,0.1)" />
                  )}
                </Layer>
              </Stage>
            ) : (
              <div className="hint">样本图加载中…</div>
            )}
            <p className="hint" style={{ marginTop: 6 }}>
              ← →切换 · Enter保存 · Delete删除 · 空白处拖拽新增候选
            </p>
          </div>

          <div className="seg-side">
            <div className="seg-detect">
              <button className="btn btn--primary" style={{ width: "100%", marginBottom: 6 }} disabled={!image || detecting} onClick={handleDetect}>
                {detecting ? "检测中…" : "🔍 自动检测字形区域"}
              </button>
              <button className="btn" style={{ width: "100%", marginBottom: 6 }} disabled={cands.length === 0} onClick={() => setCands([])}>
                清空候选框
              </button>
              <button className="btn" style={{ width: "100%", marginBottom: 6 }} disabled={!ocrAvailable || cands.length === 0 || ocrLoading} onClick={handleOcrSuggest} title={ocrAvailable ? "对候选框逐个 OCR" : "OCR 未启用"}>
                {ocrLoading ? "OCR 识别中…" : "🔤 OCR 辅助识别"}
              </button>
              {ocrAvailable && candOcr.size > 0 && (
                <>
                  <button className="btn" style={{ width: "100%", marginBottom: 6 }} onClick={handleApplyHighConf}>
                    ✅ 应用高置信度建议
                  </button>
                  <button className="btn" style={{ width: "100%", marginBottom: 6 }} onClick={clearOcr}>
                    清空 OCR 建议
                  </button>
                </>
              )}
              {!ocrAvailable && (
                <p className="hint" style={{ marginTop: 4 }}>
                  OCR 未启用，可继续手动标注。{ocrStatus?.message ?? "可安装 rapidocr-onnxruntime 启用。"}
                </p>
              )}
            </div>

            <div className="seg-save">
              <div className="field">
                <label>
                  当前候选（{selectedCandId ? `${selectedCandId.slice(0, 8)}` : "未选"}）
                  {selectedOcr && (
                    <span style={{ marginLeft: 6, color: selectedOcr.level === "high" ? "#1aa260" : selectedOcr.level === "medium" ? "#e0a800" : "#999" }}>
                      OCR: {selectedOcr.char || "空"} ({Math.round(selectedOcr.confidence * 100)}%)
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={selectedLabel}
                  onChange={(e) => selectedCandId && setLabel(selectedCandId, e.target.value)}
                  placeholder="输入字符"
                  maxLength={4}
                  autoFocus
                />
              </div>
              <label className="toggle" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
                保存后自动跳下一个
              </label>
              <button className="btn btn--primary" style={{ width: "100%" }} disabled={!selectedCandId || !selectedLabel || saving} onClick={handleSaveSelected}>
                {saving ? "保存中…" : "保存选中 (Enter)"}
              </button>

              <div className="field" style={{ marginTop: 10 }}>
                <label>批量标注（按阅读顺序匹配）</label>
                <textarea value={batchText} onChange={(e) => setBatchText(e.target.value)} placeholder="如：的一是在不了有" rows={2} />
              </div>
              <button className="btn" style={{ width: "100%" }} disabled={cands.length === 0 || saving} onClick={handleBatchSave}>
                批量保存（用上方文本或各候选标签）
              </button>
              {batchMsg && <p className="hint" style={{ marginTop: 6 }}>{batchMsg}</p>}
              {saveSummary && <p className="hint" style={{ marginTop: 6, whiteSpace: "pre-line" }}>{saveSummary}</p>}
            </div>

            {error && <p className="err-msg">{error}</p>}

            <div className="seg-glyphs">
              <div className="field">
                <label>候选框（{cands.length}）</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <label className="toggle" style={{ fontSize: 11 }}>
                    <input type="checkbox" checked={filterUnlabeled} onChange={(e) => setFilterUnlabeled(e.target.checked)} />
                    未标注
                  </label>
                  <label className="toggle" style={{ fontSize: 11 }}>
                    <input type="checkbox" checked={filterLowConf} onChange={(e) => setFilterLowConf(e.target.checked)} />
                    低置信度
                  </label>
                </div>
              </div>
              <div className="cand-list__items">
                {filteredListCands.map((c) => {
                  const lvl = candQuality.get(c.id) ?? "good";
                  const ocr = candOcr.get(c.id);
                  const label = candLabels.get(c.id)?.char;
                  const color = lvl === "poor" ? "#c00" : lvl === "warning" ? "#e0a800" : "#2f6df6";
                  return (
                    <span
                      key={c.id}
                      className={`cand-chip ${c.id === selectedCandId ? "is-active" : ""}`}
                      onClick={() => setSelectedCandId(c.id)}
                    >
                      <span style={{ color }}>{label ? "✓" : "●"}</span>
                      {c.orderIndex}
                      {label ? `:${label}` : ""}
                      {ocr && <span style={{ color: ocr.level === "high" ? "#1aa260" : ocr.level === "medium" ? "#e0a800" : "#999", fontSize: 10 }}>{Math.round(ocr.confidence * 100)}%</span>}
                      <button className="btn btn--xs" onClick={(e) => { e.stopPropagation(); handleDeleteCand(c.id); }}>✕</button>
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="seg-glyphs">
              <div className="field">
                <label>已保存字形（{profile.glyphs.length}）</label>
                <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="按字符搜索" />
              </div>
              <div className="seg-glyph-grid">
                {filteredGlyphs.length === 0 && <span className="hint">暂无字形</span>}
                {filteredGlyphs.map((g) => (
                  <div key={g.id} className="seg-glyph-cell" title={`${g.char} #${g.variantIndex}`}>
                    <img src={g.imageBase64} alt={g.char} />
                    <div className="seg-glyph-cell__bar">
                      <span>{g.char}#{g.variantIndex}</span>
                      <button className="btn btn--xs" onClick={() => onDeleteGlyph(g.id)}>✕</button>
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

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
