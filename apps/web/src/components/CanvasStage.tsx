import { useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Text,
  Transformer,
  Rect,
} from "react-konva";
import type Konva from "konva";
import {
  applyNaturalness,
  type HandwritingProfile,
  type NaturalizedObject,
} from "@hw-layout/shared";
import type { CanvasProject, TextObject } from "@hw-layout/shared";
import { GlyphText } from "./GlyphText.js";

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
  project: CanvasProject;
  image: HTMLImageElement | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (obj: TextObject) => void;
  /** 用于导出：暴露底层 Stage 实例 */
  onStageReady?: (stage: Konva.Stage) => void;
  /** 是否处于「框选清除区域」模式 */
  selectMode: boolean;
  /** 当前已确认的框选区域 */
  selections: SelectionRect[];
  /** 框选区域被调整时回调（id + 新几何） */
  onSelectionUpdate?: (id: string, rect: Omit<SelectionRect, "id">) => void;
  /** 框选结束时回调 */
  onSelectionEnd: (rect: Omit<SelectionRect, "id">) => void;
  /** 是否正在导出（导出时隐藏 overlay / 不应用 naturalness 编辑差异） */
  exporting?: boolean;
  /** 导出时使用的固定种子（保证重复导出一致） */
  exportSeed?: number;
  /** 预加载的 glyph 图片缓存（手写素材模式用） */
  glyphImages?: Map<string, HTMLImageElement>;
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
  onStageReady,
  selectMode,
  selections,
  onSelectionUpdate,
  onSelectionEnd,
  exporting = false,
  exportSeed,
  glyphImages,
}: CanvasStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selTransformerRef = useRef<Konva.Transformer>(null);
  const textRefs = useRef<Map<string, Konva.Text>>(new Map());
  const selRectRefs = useRef<Map<string, Konva.Rect>>(new Map());
  const [draft, setDraft] = useState<DraftRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  // 空格键按下时进入平移模式
  const [spaceDown, setSpaceDown] = useState(false);

  // 按 zIndex 升序渲染（数值大在上层）
  const sortedTexts = useMemo(
    () => [...project.textObjects].sort((a, b) => a.zIndex - b.zIndex),
    [project.textObjects],
  );

  // 编辑模式显示原始对象；导出时应用 naturalness
  const renderedTexts = useMemo<NaturalizedObject[]>(() => {
    if (exporting && project.naturalnessEnabled) {
      return sortedTexts.map((o) =>
        applyNaturalness(o, project.naturalness, exportSeed),
      );
    }
    return sortedTexts;
  }, [sortedTexts, exporting, project.naturalnessEnabled, project.naturalness, exportSeed]);

  // 文本 Transformer 跟随选中（框选/导出模式下不显示）
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (selectMode || exporting) {
      tr.nodes([]);
      return;
    }
    const node = selectedId ? textRefs.current.get(selectedId) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, selectMode, exporting]);

  // 选区 Transformer：框选模式下跟随选中的选区（用于调整大小）
  useEffect(() => {
    const tr = selTransformerRef.current;
    if (!tr) return;
    if (!selectMode || exporting) {
      tr.nodes([]);
      return;
    }
    // 选中最后一个选区用于调整
    const last = selections[selections.length - 1];
    const node = last ? selRectRefs.current.get(last.id) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectMode, exporting, selections]);

  useEffect(() => {
    if (stageRef.current && onStageReady) {
      onStageReady(stageRef.current);
    }
  }, [onStageReady]);

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
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (selectMode || exporting) return;
    const id = e.target.id();
    const obj = project.textObjects.find((o) => o.id === id);
    if (!obj) return;
    const next = window.prompt("编辑文本", obj.text);
    if (next !== null) {
      onChange({ ...obj, text: next });
    }
  };

  // 把屏幕坐标转画布坐标（考虑 stage scale/position）
  const toCanvasPos = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    return stage?.getPointerPosition() ?? null;
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // 空格平移模式：交给 stage draggable
    if (spaceDown) return;

    if (!selectMode) {
      // 点击空白处取消选中
      if (e.target === e.target.getStage() || e.target.attrs.listening === false) {
        onSelect(null);
      }
      return;
    }
    const pos = toCanvasPos(e);
    if (!pos) return;
    dragStart.current = pos;
    setDraft({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  const handleMouseMove = () => {
    if (!selectMode || !dragStart.current) return;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const start = dragStart.current;
    setDraft({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    });
  };

  const handleMouseUp = () => {
    if (!selectMode || !draft) return;
    if (draft.width >= 4 && draft.height >= 4) {
      onSelectionEnd({ ...draft });
    }
    setDraft(null);
    dragStart.current = null;
  };

  // 滚轮缩放（以鼠标为中心）
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = clamp(oldScale * scaleBy, 0.1, 5);

    // 鼠标指向的画布坐标
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const cursor = spaceDown
    ? "grab"
    : selectMode
      ? "crosshair"
      : "default";

  return (
    <Stage
      ref={stageRef}
      width={project.width}
      height={project.height}
      style={{ cursor, background: "#e9e9ef" }}
      draggable={spaceDown}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
    >
      <Layer>
        {image && (
          <KonvaImage
            image={image}
            width={project.width}
            height={project.height}
            listening={selectMode && !exporting}
          />
        )}

        {/* 框选模式下遮罩提示（导出时隐藏） */}
        {selectMode && !exporting && (
          <Rect
            x={0}
            y={0}
            width={project.width}
            height={project.height}
            fill="rgba(47,109,246,0.04)"
            listening={false}
          />
        )}

        {renderedTexts.map((obj) => {
          // 手写素材模式：逐字 glyph 渲染（缺字 fallback 字体）
          if (obj.renderMode === "handwritingGlyph" && glyphImages) {
            const pid = obj.handwritingProfileId ?? project.activeHandwritingProfileId;
            const prof: HandwritingProfile | null =
              project.handwritingProfiles.find((p) => p.id === pid) ?? null;
            return (
              <GlyphText
                key={obj.id}
                obj={obj}
                profile={prof}
                glyphImages={glyphImages}
                letterSpacing={obj.style.letterSpacing}
                listening={!selectMode && !exporting}
                naturalness={exporting ? project.naturalness : null}
                applyBaselineJitter={exporting && project.naturalnessEnabled}
                registerRef={(node) => {
                  if (node) textRefs.current.set(obj.id, node as Konva.Text);
                  else textRefs.current.delete(obj.id);
                }}
                onDragEnd={(x, y) => onChange({ ...obj, x, y })}
              />
            );
          }
          // 普通字体模式
          return (
            <TextLineAware
              key={obj.id}
              obj={obj}
              registerRef={(node) => {
                if (node) textRefs.current.set(obj.id, node);
                else textRefs.current.delete(obj.id);
              }}
              draggable={!selectMode && !exporting}
              listening={!selectMode && !exporting}
              onSelect={() => onSelect(obj.id)}
              onDblClick={handleDblClick}
              onChange={onChange}
            />
          );
        })}

        {/* 已确认的框选区域（可视化，导出时隐藏） */}
        {!exporting &&
          selections.map((s) => (
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
              stroke="#2f6df6"
              strokeWidth={1.5 / (stageRef.current?.scaleX() ?? 1)}
              dash={[6, 4]}
              fill="rgba(47,109,246,0.08)"
              listening={selectMode}
              onTransformEnd={(e) => {
                const node = e.target as Konva.Rect;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                // Transformer 改变 scale，转成实际 width/height 并重置 scale
                onSelectionUpdate?.(s.id, {
                  x: node.x(),
                  y: node.y(),
                  width: Math.max(4, s.width * scaleX),
                  height: Math.max(4, s.height * scaleY),
                });
                node.scaleX(1);
                node.scaleY(1);
              }}
            />
          ))}

        {/* 正在拖拽的临时框 */}
        {draft && (
          <Rect
            x={draft.x}
            y={draft.y}
            width={draft.width}
            height={draft.height}
            stroke="#1aa260"
            strokeWidth={1.5}
            dash={[4, 4]}
            fill="rgba(26,162,96,0.1)"
            listening={false}
          />
        )}

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
          enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
          borderStroke="#1aa260"
          anchorStroke="#1aa260"
          anchorFill="#fff"
          anchorSize={8}
        />
      </Layer>
    </Stage>
  );
}

/**
 * 处理带逐行基线浮动的文本渲染。
 * 若对象有 lineOffsets（自然化产生），按行拆分渲染；
 * 否则作为整体渲染。
 */
function TextLineAware({
  obj,
  registerRef,
  draggable,
  listening,
  onSelect,
  onDblClick,
  onChange,
}: {
  obj: NaturalizedObject;
  registerRef: (node: Konva.Text | null) => void;
  draggable: boolean;
  listening: boolean;
  onSelect: () => void;
  onDblClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onChange: (obj: TextObject) => void;
}) {
  const lines = obj.text.split("\n");
  const hasLineOffsets = obj.lineOffsets && obj.lineOffsets.length === lines.length;

  // 有逐行偏移时：用一个不可见的整体 Text 占位（用于选中/拖拽），叠加可见的逐行文本
  if (hasLineOffsets) {
    const lineHeightPx = obj.style.fontSize * obj.style.lineHeight;
    return (
      <>
        {/* 占位：用于拖拽与选中（不可见，但参与交互） */}
        <Text
          id={obj.id}
          ref={registerRef}
          text={obj.text}
          x={obj.x}
          y={obj.y}
          rotation={obj.style.rotation}
          fontSize={obj.style.fontSize}
          fontStyle={`${obj.style.fontStyle} ${obj.style.fontWeight}`.trim()}
          fontFamily={obj.style.fontFamily}
          align={obj.style.align}
          lineHeight={obj.style.lineHeight}
          letterSpacing={obj.style.letterSpacing}
          opacity={0}
          draggable={draggable}
          listening={listening}
          onClick={onSelect}
          onTap={onSelect}
          onDblClick={onDblClick}
          onDragEnd={(e) => {
            onChange({ ...obj, x: e.target.x(), y: e.target.y() });
          }}
          onTransformEnd={(e) => {
            const node = e.target;
            onChange({
              ...obj,
              x: node.x(),
              y: node.y(),
              style: { ...obj.style, rotation: node.rotation() },
            });
          }}
        />
        {/* 可见的逐行文本（应用基线浮动），不参与交互 */}
        {lines.map((line, i) => (
          <Text
            key={`${obj.id}-line-${i}`}
            text={line}
            x={obj.x}
            y={obj.y + i * lineHeightPx + (obj.lineOffsets?.[i] ?? 0)}
            rotation={obj.style.rotation}
            fontSize={obj.style.fontSize}
            fontStyle={`${obj.style.fontStyle} ${obj.style.fontWeight}`.trim()}
            fontFamily={obj.style.fontFamily}
            align={obj.style.align}
            width={approxWidth(lines, obj.style.fontSize)}
            lineHeight={obj.style.lineHeight}
            letterSpacing={obj.style.letterSpacing}
            fill={obj.style.color}
            opacity={obj.style.opacity}
            // 轻微模糊：用 shadow 模拟（Konva Text 无原生 blur filter，标注 TODO）
            shadowBlur={obj.style.blur > 0 ? obj.style.blur * 2 : 0}
            shadowColor={obj.style.color}
            listening={false}
          />
        ))}
      </>
    );
  }

  // 无逐行偏移：整体渲染
  return (
    <Text
      id={obj.id}
      ref={registerRef}
      text={obj.text}
      x={obj.x}
      y={obj.y}
      rotation={obj.style.rotation}
      fontSize={obj.style.fontSize}
      fontStyle={`${obj.style.fontStyle} ${obj.style.fontWeight}`.trim()}
      fontFamily={obj.style.fontFamily}
      align={obj.style.align}
      width={approxWidth(lines, obj.style.fontSize)}
      lineHeight={obj.style.lineHeight}
      letterSpacing={obj.style.letterSpacing}
      fill={obj.style.color}
      opacity={obj.style.opacity}
      draggable={draggable}
      listening={listening}
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onDblClick}
      onDragEnd={(e) => {
        onChange({ ...obj, x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={(e) => {
        const node = e.target;
        onChange({
          ...obj,
          x: node.x(),
          y: node.y(),
          style: { ...obj.style, rotation: node.rotation() },
        });
      }}
    />
  );
}

/** 估算文本框宽度（用于 align 生效）。 */
function approxWidth(lines: string[], fontSize: number): number {
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  return Math.max(40, longest.length * fontSize * 1.2);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
