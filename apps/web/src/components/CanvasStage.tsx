import { useEffect, useMemo, useRef } from "react";
import { Stage, Layer, Image as KonvaImage, Text, Transformer } from "react-konva";
import type Konva from "konva";
import { applyNaturalness } from "@hw-layout/shared";
import type { CanvasProject, TextObject } from "@hw-layout/shared";

interface CanvasStageProps {
  project: CanvasProject;
  image: HTMLImageElement | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (obj: TextObject) => void;
  /** 用于导出：暴露底层 Stage 实例 */
  onStageReady?: (stage: Konva.Stage) => void;
}

/**
 * 扫描稿画布：背景图 + 可拖拽 / 缩放 / 旋转的文本对象。
 *
 * TODO: 多选、对齐辅助线、吸附。
 * TODO: 文本框尺寸 handle 与字距/行距的视觉反馈。
 */
export function CanvasStage({
  project,
  image,
  selectedId,
  onSelect,
  onChange,
  onStageReady,
}: CanvasStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const textRefs = useRef<Map<string, Konva.Text>>(new Map());

  // Transformer 跟随选中
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const node = selectedId ? textRefs.current.get(selectedId) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId]);

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
    // 双击进入文本编辑（简化版：用 prompt）
    const id = e.target.id();
    const obj = project.textObjects.find((o) => o.id === id);
    if (!obj) return;
    const next = window.prompt("编辑文本", obj.text);
    if (next !== null) {
      onChange({ ...obj, text: next });
    }
  };

  return (
    <Stage
      ref={stageRef}
      width={project.width}
      height={project.height}
      onMouseDown={(e) => {
        // 点击空白处取消选中
        if (e.target === e.target.getStage()) onSelect(null);
      }}
    >
      <Layer>
        {image && (
          <KonvaImage
            image={image}
            width={project.width}
            height={project.height}
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
              draggable
              align="left"
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
