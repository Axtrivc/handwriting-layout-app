import { useEffect, useState } from 'react';
import { loadImage } from './image.js';

/** Decoded images are derived resources, never a second copy of page state. */
export function useImageResource(source: string | null) {
  const [resource, setResource] = useState<{ source: string; image: HTMLImageElement | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    void loadImage(source).then(image => {
      if (!cancelled) setResource({ source, image, error: null });
    }).catch(() => {
      if (!cancelled) setResource({ source, image: null, error: '背景图片无法解码，请重新导入图片。' });
    });
    return () => { cancelled = true; };
  }, [source]);
  return resource?.source === source ? resource : { image: null, error: null };
}
