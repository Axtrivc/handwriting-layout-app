import { useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Transformer,
  Rect,
  Line,
  Circle,
  Group,
} from "react-konva";
import type Konva from "konva";
import {
  type HandwritingProfile,
  type NaturalnessParams,
  type TextObject,
  type CleanupStroke,
} from "@hw-layout/shared";
import { TextObjectView } from "./TextObjectView.js";
import { clipSelection, type CleanupTool, type SelectionStroke } from "../lib/cleanSelection.js";
import { useCanvasViewport } from "../lib/useCanvasViewport.js";
import { MAX_VIEW_SCALE, MIN_VIEW_SCALE } from "../lib/viewport.js";

/**
 * CanvasStage 所需的项目视图（多页改造后从 activePage 派生）。
 * 避免直接依赖完整的 CanvasProject（其 textObjects 等字段已 deprecated optional）。
 */
export interface StageView {
  width: number;
  height: number;
  backgroundImage: string | null;
  textObjects: TextObject[];
  naturalnessEnabled: boolean;
  naturalness: NaturalnessParams;
  handwritingProfiles: HandwritingProfile[];
  activeHandwritingProfileId: string | null;
}

/** 用户正在框选的临时矩形（画布坐标）。 */
interface DraftRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 已确认的框选区域（画布坐标）。 */
export interface SelectionRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasStageProps {
  project: StageView;
  image: HTMLImageElement | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (obj: TextObject) => void;
  /** 是否处于「框选清除区域」模式 */
  selectMode: boolean;
  /** 当前已确认的框选区域 */
  selections: SelectionRect[];
  cleanTool: CleanupTool;
  brushWidth: number;
  strokes: SelectionStroke[];
  onStrokeEnd: (stroke: CleanupStroke) => void;
  /** 框选区域被调整时回调（id + 新几何） */
  onSelectionUpdate?: (id: string, rect: Omit<SelectionRect, "id">) => void;
  /** 框选结束时回调 */
  onSelectionEnd: (rect: Omit<SelectionRect, "id">) => void;
  /** 预加载的 glyph 图片缓存（手写素材模式用） */
  glyphImages?: Map<string, HTMLImageElement>;
  /** 清除成功后的闪烁确认框（1.5 秒后消失） */
  cleanFlash?: SelectionRect[] | null;
}

/**
 * 扫描稿画布：背景图 + 可拖拽 / 缩放 / 旋转的文本对象 + 框选清除区域。
 *
 * 视图交互：
 * - 滚轮缩放（以鼠标为中心）
 * - 按住空格 + 拖拽 平移画布（或框选模式外拖拽空白处平移）
 *
 * 框选模式（selectMode=true）：在背景上按住拖拽生成矩形，松开时回调；
 * 已确认的框选矩形可用 Transformer 调整大小。
 *
 * TODO: 多选、对齐辅助线、吸附。
 */
export function CanvasStage({
  project,
  image,
  selectedId,
  onSelect,
  onChange,
  selectMode,
  selections,
  cleanTool, brushWidth, strokes, onStrokeEnd,
  onSelectionUpdate,
  onSelectionEnd,
  glyphImages,
  cleanFlash,
}: CanvasStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selTransformerRef = useRef<Konva.Transformer>(null);
  const textRefs = useRef<Map<string, Konva.Group>>(new Map());
  const selRectRefs = useRef<Map<string, Konva.Rect>>(new Map());
  const [draft, setDraft] = useState<DraftRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [draftStroke, setDraftStroke] = useState<CleanupStroke | null>(null);
  const strokeRef = useRef<CleanupStroke | null>(null);
  const [brushPointer, setBrushPointer] = useState<{ x: number; y: number } | null>(null);
  // 空格键按下时进入平移模式
  const [spaceDown, setSpaceDown] = useState(false);
  const viewport = useCanvasViewport(project.width, project.height);

  // 按 zIndex 升序渲染（数值大在上层）
  const sortedTexts = useMemo(
    () => [...project.textObjects].sort((a, b) => a.zIndex - b.zIndex),
    [project.textObjects],
  );

  // 文本 Transformer 跟随选中（框选/导出模式下不显示）
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (selectMode) {
      tr.nodes([]);
      return;
    }
    const node = selectedId ? textRefs.current.get(selectedId) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, selectMode]);

  // 选区 Transformer：框选模式下跟随选中的选区（用于调整大小）
  useEffect(() => {
    const tr = selTransformerRef.current;
    if (!tr) return;
    if (!selectMode || cleanTool !== 'rectangle') {
      tr.nodes([]);
      return;
    }
    // 选中最后一个选区用于调整
    const last = selections[selections.length - 1];
    const node = last ? selRectRefs.current.get(last.id) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectMode, cleanTool, selections]);

  // 全局空格键监听：按下进入平移模式
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isEditableTarget(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    const onBlur = () => {
      setSpaceDown(false); setDraft(null); dragStart.current = null;
      setDraftStroke(null); strokeRef.current = null; setBrushPointer(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // 把屏幕坐标转画布坐标（考虑 stage scale/position）
  // 用 getRelativePointerPosition 而非 getPointerPosition，
  // 前者返回 Stage 内容坐标系（已扣除 scale/position 变换），
  // 后者返回容器坐标系（不扣除变换），缩放后会导致框选坐标错乱。
  const getRelativeCanvasPos = (): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    // getRelativePointerPosition 是 Konva Stage 的方法，
    // 返回相对于 Stage 内容坐标系的指针位置（扣除 transform）
    const pos = stage.getRelativePointerPosition();
    if (!pos) return null;
    return { x: clamp(pos.x, 0, project.width), y: clamp(pos.y, 0, project.height) };
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // 空格平移模式：交给 stage draggable
    if (spaceDown || e.evt.button !== 0) return;
    // Transform handles and existing selections must not also start a new box.
    if (e.target !== stageRef.current && e.target.getClassName() !== "Image") return;

    if (!selectMode) {
      // 点击空白处取消选中
      if (e.target === e.target.getStage() || e.target.attrs.listening === false) {
        onSelect(null);
      }
      return;
    }
    const pos = getRelativeCanvasPos();
    if (!pos) return;
    if (cleanTool === 'brush') {
      const pointer = stageRef.current?.getRelativePointerPosition();
      if (!pointer || pointer.x < 0 || pointer.y < 0 || pointer.x >= project.width || pointer.y >= project.height) return;
      const stroke = { points: [pos.x, pos.y], width: brushWidth };
      strokeRef.current = stroke;
      setDraftStroke(stroke);
      return;
    }
    dragStart.current = pos;
    setDraft({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  const handleMouseMove = () => {
    if (!selectMode || spaceDown) return;
    const pos = getRelativeCanvasPos();
    if (!pos) return;
    if (cleanTool === 'brush') {
      setBrushPointer(pos);
      const stroke = strokeRef.current;
      if (!stroke || stroke.points.length >= 8192) return;
      const x = stroke.points.at(-2)!, y = stroke.points.at(-1)!;
      if (Math.hypot(pos.x - x, pos.y - y) < Math.max(0.5, stroke.width / 8)) return;
      const next = { ...stroke, points: [...stroke.points, pos.x, pos.y] };
      strokeRef.current = next; setDraftStroke(next);
      return;
    }
    if (!dragStart.current) return;
    const start = dragStart.current;
    setDraft({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    });
  };

  const handleMouseUp = () => {
    if (!selectMode) return;
    if (strokeRef.current) {
      const stroke = strokeRef.current;
      const pos = getRelativeCanvasPos();
      if (pos && stroke.points.length < 8192 && (pos.x !== stroke.points.at(-2) || pos.y !== stroke.points.at(-1))) {
        onStrokeEnd({ ...stroke, points: [...stroke.points, pos.x, pos.y] });
      } else onStrokeEnd(stroke);
      strokeRef.current = null; setDraftStroke(null);
      return;
    }
    if (!draft) return;
    if (draft.width >= 4 && draft.height >= 4) {
      onSelectionEnd({ ...draft });
    }
    setDraft(null);
    dragStart.current = null;
  };

  // 滚轮缩放（以鼠标为中心）
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    if (dragStart.current || strokeRef.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const scaleBy = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    viewport.zoom(stage.scaleX() * scaleBy, pointer);
  };

  useEffect(() => {
    setDraft(null); dragStart.current = null;
    setDraftStroke(null); strokeRef.current = null; setBrushPointer(null);
  }, [selectMode, cleanTool, spaceDown]);

  const cursor = spaceDown
    ? "grab"
    : selectMode
      ? "crosshair"
      : "default";

  return (
    <div className="canvas-editor">
      <div className="canvas-tools" role="toolbar" aria-label="画布视图">
        <button className="btn btn--xs" onClick={viewport.fit}>适合窗口</button>
        <button className="btn btn--xs" onClick={() => viewport.zoom(1)} title="按原图像素查看">100%</button>
        <button className="btn btn--xs" aria-label="缩小画布" disabled={viewport.view.scale <= MIN_VIEW_SCALE}
          onClick={() => viewport.zoom(viewport.view.scale / 1.25)}>−</button>
        <output aria-label="画布缩放比例">{Math.round(viewport.view.scale * 100)}%</output>
        <button className="btn btn--xs" aria-label="放大画布" disabled={viewport.view.scale >= MAX_VIEW_SCALE}
          onClick={() => viewport.zoom(viewport.view.scale * 1.25)}>＋</button>
        <span className="hint">{project.width} × {project.height} · 空格拖动</span>
      </div>
      <div className="canvas-viewport" ref={viewport.containerRef}
        data-view-x={viewport.view.x} data-view-y={viewport.view.y} data-view-scale={viewport.view.scale}>
    <Stage
      ref={stageRef}
      width={viewport.size.width}
      height={viewport.size.height}
      x={viewport.view.x} y={viewport.view.y}
      scaleX={viewport.view.scale} scaleY={viewport.view.scale}
      style={{ cursor, background: "#e9e9ef" }}
      draggable={spaceDown}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { handleMouseUp(); setBrushPointer(null); }}
      onWheel={handleWheel}
      onDragEnd={e => { if (e.target === stageRef.current) viewport.pan(e.target.x(), e.target.y()); }}
    >
      <Layer>
        <Rect width={project.width} height={project.height} fill="white" listening={false} />
        {image && (
          <KonvaImage
            image={image}
            width={project.width}
            height={project.height}
            listening={selectMode}
          />
        )}

        {/* 框选模式下遮罩提示（导出时隐藏） */}
        {selectMode && (
          <Rect
            x={0}
            y={0}
            width={project.width}
            height={project.height}
            fill="rgba(47,109,246,0.04)"
            listening={false}
          />
        )}

        {sortedTexts.map(obj => <TextObjectView key={obj.id} obj={obj}
          profile={project.handwritingProfiles.find(p => p.id === (obj.handwritingProfileId ?? project.activeHandwritingProfileId)) ?? null}
          images={glyphImages ?? EMPTY_IMAGES} listening={!selectMode}
          registerRef={node => { if (node) textRefs.current.set(obj.id, node); else textRefs.current.delete(obj.id); }}
          onSelect={() => onSelect(obj.id)} onChange={onChange}
          onEdit={() => { const text = window.prompt("编辑文本", obj.text); if (text !== null) onChange({ ...obj, text }); }}
        />)}

        {/* 已确认的框选区域（可视化，导出时隐藏）加粗高对比 */}
        {selections.map((s) => (
            <Rect
              key={s.id}
              id={s.id}
              ref={(node) => {
                if (node) selRectRefs.current.set(s.id, node);
                else selRectRefs.current.delete(s.id);
              }}
              x={s.x}
              y={s.y}
              width={s.width}
              height={s.height}
              stroke="#ff4d4f"
              strokeWidth={2.5 / viewport.view.scale}
              dash={[8, 4]}
              fill="rgba(255,77,79,0.12)"
              listening={selectMode && cleanTool === 'rectangle'}
              draggable={selectMode && cleanTool === 'rectangle' && !spaceDown}
              onDragEnd={(e) => {
                const rect = { x: clamp(e.target.x(), 0, project.width - s.width),
                  y: clamp(e.target.y(), 0, project.height - s.height), width: s.width, height: s.height };
                e.target.position(rect);
                onSelectionUpdate?.(s.id, rect);
              }}
              onTransformEnd={(e) => {
                const node = e.target as Konva.Rect;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                // Transformer 改变 scale，转成实际 width/height 并重置 scale
                const rect = clipSelection({
                  x: node.x(),
                  y: node.y(),
                  width: Math.max(4, s.width * scaleX),
                  height: Math.max(4, s.height * scaleY),
                }, project.width, project.height) ?? s;
                node.position(rect);
                node.size(rect);
                onSelectionUpdate?.(s.id, rect);
                node.scaleX(1);
                node.scaleY(1);
              }}
            />
          ))}

        <Group clipX={0} clipY={0} clipWidth={project.width} clipHeight={project.height} listening={false}>
          {[...strokes, ...(draftStroke ? [{ ...draftStroke, id: 'draft' }] : [])].map(stroke =>
            stroke.points.length === 2
              ? <Circle key={stroke.id} x={stroke.points[0]} y={stroke.points[1]} radius={stroke.width / 2}
                  fill="#ff4d4f" opacity={0.35} />
              : <Line key={stroke.id} points={stroke.points} stroke="#ff4d4f" strokeWidth={stroke.width}
                  opacity={0.35} lineCap="round" lineJoin="round" />
          )}
          {selectMode && cleanTool === 'brush' && brushPointer && !spaceDown &&
            <Circle x={brushPointer.x} y={brushPointer.y} radius={brushWidth / 2}
              stroke="#d32f2f" strokeWidth={1.5 / viewport.view.scale} />}
        </Group>

        {/* 正在拖拽的临时框（加粗 + 高对比，确保可见） */}
        {draft && (
          <Rect
            x={draft.x}
            y={draft.y}
            width={draft.width}
            height={draft.height}
            stroke="#ff4d4f"
            strokeWidth={2.5 / viewport.view.scale}
            dash={[6, 3]}
            fill="rgba(255,77,79,0.15)"
            listening={false}
          />
        )}

        {/* 清除成功的闪烁确认框（绿色，1.5 秒消失） */}
        {cleanFlash &&
          cleanFlash.map((s) => (
            <Rect
              key={`flash-${s.id}`}
              x={s.x}
              y={s.y}
              width={s.width}
              height={s.height}
              stroke="#1aa260"
              strokeWidth={3}
              fill="rgba(26,162,96,0.25)"
              listening={false}
            />
          ))}

        {/* 文本选中框 */}
        <Transformer
          ref={transformerRef}
          rotateEnabled
          rotateAnchorOffset={20}
          enabledAnchors={[]}
          borderStroke="#2f6df6"
          anchorStroke="#2f6df6"
          anchorFill="#fff"
        />
        {/* 选区调整框（仅框选模式，可拖拽四角调整大小） */}
        <Transformer
          ref={selTransformerRef}
          rotateEnabled={false}
          flipEnabled={false}
          keepRatio={false}
          enabledAnchors={["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]}
          borderStroke="#1aa260"
          anchorStroke="#1aa260"
          anchorFill="#fff"
          anchorSize={8}
        />
      </Layer>
    </Stage>
      </div>
    </div>
  );
}

const EMPTY_IMAGES = new Map<string, HTMLImageElement>();

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
