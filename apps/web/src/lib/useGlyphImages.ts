import { useEffect, useMemo, useRef, useState } from 'react';
import { collectGlyphKeys, type HandwritingProfile, type TextObject } from '@hw-layout/shared';
import { loadImage } from './image.js';
import { ImageCache } from './imageCache.js';

/** Decode only glyphs used on the current page; edits reuse unchanged sources. */
export function useGlyphImages(profiles: HandwritingProfile[], objects: TextObject[], activeProfileId: string | null) {
  const cache = useRef(new ImageCache(loadImage));
  const [revision, setRevision] = useState(0);
  const sources = useMemo(() => {
    const needed = new Map<string, string>();
    const byProfile = new Map(profiles.map(profile => [profile.id, profile]));
    const byKey = new Map<string, string>(profiles.flatMap(profile => profile.glyphs.map(glyph => [`${profile.id}:${glyph.id}`, glyph.imageBase64] as const)));
    for (const object of objects) {
      const profile = byProfile.get(object.handwritingProfileId ?? activeProfileId ?? '') ?? null;
      for (const key of collectGlyphKeys(object, profile)) {
        const source = byKey.get(key);
        if (source) needed.set(key, source);
      }
    }
    return needed;
  }, [profiles, objects, activeProfileId]);
  useEffect(() => {
    let cancelled = false;
    const unique = new Set(sources.values());
    cache.current.retain(unique);
    void Promise.all([...unique].map(source => cache.current.load(source))).then(() => {
      if (!cancelled) setRevision(current => current + 1);
    });
    return () => { cancelled = true; };
  }, [sources]);
  const snapshot = useMemo(() => ({ revision, images: cache.current.snapshot(sources) }), [sources, revision]);
  return snapshot.images;
}
