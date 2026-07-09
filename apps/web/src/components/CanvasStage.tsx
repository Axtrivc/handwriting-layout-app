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
import { applyNaturalness } from "@hw-layout/shared";
import type { CanvasProject, TextObject } from "@hw-layout/shared";

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
  /** 框选结束时回调 */
  onSelectionEnd: (rect: Omit<SelectionRect, "id">) => void;
  /** 是否正在导出（导出时隐藏框选 overlay） */
  exporting?: boolean;
}

/**
 * 扫描稿画布：背景图 + 可拖拽 / 缩放 / 旋转的文本对象 + 框选清除区域。
 *
 * 框选模式（selectMode=true）：在背景上按住拖拽生成矩形，松开时回调。
 * 非框选模式：可正常选中/拖拽文本。
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
  onSelectionEnd,
  exporting = false,
}: CanvasStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const textRefs = useRef<Map<string, Konva.Text>>(new Map());
  const [draft, setDraft] = useState<DraftRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  // Transformer 跟随选中（框选模式下不显示 Transformer）
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

  // 暴露 Stage 实例给上层用于导出
  useEffect(() => {
    if (stageRef.current && onStageReady) {
      onStageReady(stageRef.current);
    }
  }, [onStageReady]);

  // 应用自然化抖动后的文本对象
  const renderedTexts = useMemo<TextObject[]>(() => {
    if (!project.naturalnessEnabled) return project.textObjects;
    return project.textObjects.map((o) =>
      applyNaturalness(o, project.naturalness),
    );
  }, [project.textObjects, project.naturalnessEnabled, project.naturalness]);

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (selectMode) return;
    const id = e.target.id();
    const obj = project.textObjects.find((o) => o.id === id);
    if (!obj) return;
    const next = window.prompt("编辑文本", obj.text);
    if (next !== null) {
      onChange({ ...obj, text: next });
    }
  };

  // 框选：鼠标按下记录起点
  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!selectMode) {
      if (e.target === e.target.getStage()) onSelect(null);
      return;
    }
    // 仅在点击背景图/空白时开始框选
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    dragStart.current = pos;
    setDraft({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  // 框选：鼠标移动更新尺寸
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

  // 框选：松开时确认
  const handleMouseUp = () => {
    if (!selectMode || !draft) return;
    // 过滤过小的框选（避免误触）
    if (draft.width >= 4 && draft.height >= 4) {
      onSelectionEnd({ ...draft });
    }
    setDraft(null);
    dragStart.current = null;
  };

  return (
    <Stage
      ref={stageRef}
      width={project.width}
      height={project.height}
      style={{ cursor: selectMode ? "crosshair" : "default" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <Layer>
        {image && (
          <KonvaImage
            image={image}
            width={project.width}
            height={project.height}
            listening={selectMode}
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
          const lines = obj.text.split("\n");
          const lineHeightPx = obj.style.fontSize * obj.style.lineHeight;
          return (
            <Text
              key={obj.id}
              id={obj.id}
              ref={(node) => {
                if (node) textRefs.current.set(obj.id, node);
                else textRefs.current.delete(obj.id);
              }}
              text={obj.text}
              x={obj.x}
              y={obj.y}
              offsetX={maxLineHalfWidth(lines, obj.style.fontSize) / 2}
              offsetY={(lines.length * lineHeightPx) / 2}
              rotation={obj.style.rotation}
              fontSize={obj.style.fontSize}
              fontStyle="normal"
              fontFamily="cursive, 'Comic Sans MS', 'PingFang SC', sans-serif"
              fill={obj.style.color}
              opacity={obj.style.opacity}
              lineHeight={obj.style.lineHeight}
              letterSpacing={obj.style.letterSpacing}
              draggable={!selectMode}
              align="left"
              listening={!selectMode}
              onClick={() => onSelect(obj.id)}
              onTap={() => onSelect(obj.id)}
              onDblClick={handleDblClick}
              onDragEnd={(e) => {
                onChange({ ...obj, x: e.target.x(), y: e.target.y() });
              }}
              onTransformEnd={(e) => {
                const node = e.target;
                onChange({
                  ...obj,
                  x: node.x(),
                  y: node.y(),
                  style: {
                    ...obj.style,
                    rotation: node.rotation(),
                  },
                });
              }}
            />
          );
        })}

        {/* 已确认的框选区域（可视化，导出时隐藏） */}
        {selections.map((s) =>
          exporting ? null : (
            <Rect
              key={s.id}
              x={s.x}
              y={s.y}
              width={s.width}
              height={s.height}
              stroke="#2f6df6"
              strokeWidth={1.5}
              dash={[6, 4]}
              fill="rgba(47,109,246,0.08)"
              listening={false}
            />
          ),
        )}

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

        <Transformer
          ref={transformerRef}
          rotateEnabled
          rotateAnchorOffset={20}
          enabledAnchors={[]}
          borderStroke="#2f6df6"
          anchorStroke="#2f6df6"
          anchorFill="#fff"
        />
      </Layer>
    </Stage>
  );
}

/** 粗略估算最长行的半宽，用于居中锚点。 */
function maxLineHalfWidth(lines: string[], fontSize: number): number {
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  return longest.length * fontSize * 0.6;
}
