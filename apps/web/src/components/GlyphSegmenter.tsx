import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Stage, Layer, Image as KonvaImage, Rect } from "react-konva";
import type { GlyphBoundingBox, HandwritingProfile, HandwritingSampleSet } from "@hw-layout/shared";

interface GlyphSegmenterProps {
  profile: HandwritingProfile;
  sampleSet: HandwritingSampleSet;
  image: HTMLImageElement | null;
  onSaveGlyph: (char: string, bbox: GlyphBoundingBox) => Promise<void>;
  onDeleteGlyph: (glyphId: string) => void;
  saving: boolean;
  error: string | null;
  onClose: () => void;
}

/**
 * 字形切割器：在样本图上框选一个字 → 输入字符 → 保存。
 * 同时展示当前 profile 下已保存的 glyph 列表，支持搜索/删除。
 */
export function GlyphSegmenter({
  profile,
  sampleSet,
  image,
  onSaveGlyph,
  onDeleteGlyph,
  saving,
  error,
  onClose,
}: GlyphSegmenterProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [char, setChar] = useState("");
  const [query, setQuery] = useState("");

  // 适配预览：限制最大显示宽度
  const MAX_DISPLAY = 720;
  const scale = image ? Math.min(1, MAX_DISPLAY / image.naturalWidth) : 1;
  const dispW = image ? image.naturalWidth * scale : MAX_DISPLAY;
  const dispH = image ? image.naturalHeight * scale : 480;

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
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
    startRef.current = null;
  };

  // 把显示坐标转回原图坐标
  const toOriginal = (d: { x: number; y: number; w: number; h: number }): GlyphBoundingBox => ({
    x: Math.round(d.x / scale),
    y: Math.round(d.y / scale),
    width: Math.round(d.w / scale),
    height: Math.round(d.h / scale),
  });

  const handleSave = async () => {
    if (!draft || draft.w < 4 || draft.h < 4) return;
    await onSaveGlyph(char, toOriginal(draft));
    setChar("");
    setDraft(null);
  };

  // glyph 列表（带搜索）
  const filteredGlyphs = useMemo(() => {
    const q = query.trim();
    if (!q) return profile.glyphs;
    return profile.glyphs.filter((g) => g.char.includes(q));
  }, [profile.glyphs, query]);

  // ESC 关闭
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
                  {draft && draft.w > 0 && draft.h > 0 && (
                    <Rect
                      x={draft.x}
                      y={draft.y}
                      width={draft.w}
                      height={draft.h}
                      stroke="#1aa260"
                      strokeWidth={1.5}
                      dash={[4, 4]}
                      fill="rgba(26,162,96,0.12)"
                    />
                  )}
                </Layer>
              </Stage>
            ) : (
              <div className="hint">样本图加载中…</div>
            )}
            <p className="hint" style={{ marginTop: 6 }}>
              在图上拖拽框选一个字 → 输入字符 → 保存。显示比例 {Math.round(scale * 100)}%。
            </p>
          </div>

          <div className="seg-side">
            <div className="seg-save">
              <div className="field">
                <label>框选字符</label>
                <input
                  type="text"
                  value={char}
                  onChange={(e) => setChar(e.target.value)}
                  placeholder="输入框选的字，如 我"
                  autoFocus
                  maxLength={4}
                />
              </div>
              <button
                className="btn btn--primary"
                style={{ width: "100%" }}
                disabled={!char.trim() || !draft || draft.w < 4 || draft.h < 4 || saving}
                onClick={handleSave}
              >
                {saving ? "保存中…" : "保存字形"}
              </button>
              {error && <p className="err-msg">{error}</p>}
              {draft && draft.w >= 4 && (
                <p className="hint" style={{ marginTop: 6 }}>
                  选区：{Math.round(draft.w / scale)}×{Math.round(draft.h / scale)} (原图)
                </p>
              )}
            </div>

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
