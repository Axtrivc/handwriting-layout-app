import { useEffect, useRef, useState } from 'react';
import { Group, Rect, Text, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import type { TextObject, HandwritingProfile, NaturalnessParams } from '@hw-layout/shared';
import { textScene } from '../lib/textScene.js';

/** The hit target and the visible content move/rotate together as one object. */
export function TextObjectView({ obj, profile, images, naturalness, listening, registerRef, onSelect, onChange, onEdit }: {
  obj: TextObject; profile: HandwritingProfile | null; images: Map<string, HTMLImageElement>;
  naturalness?: NaturalnessParams;
  listening: boolean; registerRef: (node: Konva.Group | null) => void;
  onSelect: () => void; onChange: (obj: TextObject) => void; onEdit: () => void;
}) {
  const content = useRef<Konva.Group>(null);
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: 40, height: obj.style.fontSize });
  const scene = textScene(obj, profile, images, naturalness);
  useEffect(() => {
    const rect = content.current?.getClientRect({ skipTransform: true });
    if (rect) setBounds({ ...rect, width: Math.max(10, rect.width), height: Math.max(10, rect.height) });
  }, [obj, profile, images, naturalness]);
  return <Group {...scene.transform} id={obj.id} ref={registerRef} draggable={listening}
    listening={listening} onClick={onSelect} onTap={onSelect} onDblClick={onEdit} onDblTap={onEdit}
    onDragEnd={e => onChange({ ...obj, x: obj.x + e.target.x() - scene.transform.x, y: obj.y + e.target.y() - scene.transform.y })}
    onTransformEnd={e => onChange({ ...obj, x: obj.x + e.target.x() - scene.transform.x, y: obj.y + e.target.y() - scene.transform.y,
      style: { ...obj.style, rotation: obj.style.rotation + e.target.rotation() - scene.transform.rotation } })}>
    <Rect {...bounds} fill="rgba(0,0,0,0)" />
    <Group ref={content} listening={false}>
      {scene.nodes.map((node, i) => node.kind === 'text'
        ? <Text key={i} {...node.attrs} /> : <KonvaImage key={i} {...node.attrs} />)}
    </Group>
  </Group>;
}
