import type { HandwritingGlyph, HandwritingProfile } from '@hw-layout/shared';

/** Assign variant indices against current content, not the request's old snapshot. */
export function appendGlyphs(profile: HandwritingProfile, incoming: HandwritingGlyph[]): HandwritingProfile {
  const next = new Map<string, number>();
  for (const glyph of profile.glyphs) next.set(glyph.char, Math.max(next.get(glyph.char) ?? 0, glyph.variantIndex + 1));
  const added = incoming.filter(g => profile.sampleSets.some(s => s.id === g.sourceSampleSetId)).map(g => {
    const variantIndex = next.get(g.char) ?? 0;
    next.set(g.char, variantIndex + 1);
    return { ...g, variantIndex };
  });
  return added.length ? { ...profile, glyphs: [...profile.glyphs, ...added] } : profile;
}
