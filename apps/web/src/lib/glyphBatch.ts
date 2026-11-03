import type { GlyphBoundingBox } from '@hw-layout/shared';

/** Keep candidate identity with every submitted item; empty labels are not consumed. */
export function planGlyphBatch<T extends GlyphBoundingBox & { id: string; rowIndex: number; orderIndex: number }>(
  candidates: T[], labels: Map<string, { char: string }>, batchText: string,
) {
  const sorted = [...candidates].sort((a, b) => a.rowIndex - b.rowIndex || a.orderIndex - b.orderIndex);
  const chars = batchText.trim() ? Array.from(batchText) : null;
  return sorted.flatMap((candidate, index) => {
    const char = (chars ? chars[index] ?? '' : labels.get(candidate.id)?.char ?? '').trim();
    if (!char) return [];
    const { x, y, width, height } = candidate;
    return [{ candidateId: candidate.id, char, bbox: { x, y, width, height } }];
  });
}
