/** Per-page pre-edit snapshots. The current value is supplied when undoing/redoing. */
export class HistoryStore<T> {
  private pages = new Map<string, { past: T[]; future: T[] }>();
  private get(pageId: string) {
    let history = this.pages.get(pageId);
    if (!history) {
      history = { past: [], future: [] };
      this.pages.set(pageId, history);
    }
    return history;
  }
  push(pageId: string, before: T) {
    const h = this.get(pageId);
    h.past.push(structuredClone(before));
    if (h.past.length > 30) h.past.shift();
    h.future = [];
  }
  undo(pageId: string, current: T): T | null {
    const h = this.get(pageId);
    if (!h.past.length) return null;
    h.future.push(structuredClone(current));
    return structuredClone(h.past.pop()!);
  }
  redo(pageId: string, current: T): T | null {
    const h = this.get(pageId);
    if (!h.future.length) return null;
    h.past.push(structuredClone(current));
    return structuredClone(h.future.pop()!);
  }
  canUndo(pageId: string) { return !!this.pages.get(pageId)?.past.length; }
  canRedo(pageId: string) { return !!this.pages.get(pageId)?.future.length; }
  mapSnapshots(pageId: string, transform: (snapshot: T) => T) {
    const h = this.pages.get(pageId);
    if (!h) return;
    h.past = h.past.map(transform);
    h.future = h.future.map(transform);
  }
  clear() { this.pages.clear(); }
}
