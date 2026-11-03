import { useEffect, useState } from 'react';
import type { HandwritingProfile } from '@hw-layout/shared';
import { loadImage } from './image.js';

/** All referenced profiles use compound keys, matching the export renderer. */
export function useGlyphImages(profiles: HandwritingProfile[]) {
  const [images, setImages] = useState(new Map<string, HTMLImageElement>());
  useEffect(() => {
    let cancelled = false;
    const entries = profiles.flatMap(profile => profile.glyphs.map(async glyph => {
      try { return [`${profile.id}:${glyph.id}`, await loadImage(glyph.imageBase64)] as const; }
      catch { return null; }
    }));
    void Promise.all(entries).then(loaded => {
      if (!cancelled) setImages(new Map(loaded.filter(entry => entry !== null)));
    });
    return () => { cancelled = true; };
  }, [profiles]);
  return images;
}
