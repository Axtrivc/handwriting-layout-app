/** Source-keyed decode cache with bounded concurrency and removable queued work. */
export class ImageCache<T> {
  private entries = new Map<string, { value?: T; pending: Promise<T | null> }>();
  private queue: Array<() => void> = [];
  private active = 0;
  private decode: (source: string) => Promise<T>;
  private concurrency: number;

  constructor(decode: (source: string) => Promise<T>, concurrency = 4) {
    this.decode = decode;
    this.concurrency = Math.max(1, concurrency);
  }

  retain(sources: Set<string>) {
    for (const source of this.entries.keys()) if (!sources.has(source)) this.entries.delete(source);
  }

  snapshot(sources: Map<string, string>): Map<string, T> {
    const result = new Map<string, T>();
    for (const [key, source] of sources) {
      const value = this.entries.get(source)?.value;
      if (value !== undefined) result.set(key, value);
    }
    return result;
  }

  load(source: string): Promise<T | null> {
    const cached = this.entries.get(source);
    if (cached) return cached.pending;
    let complete!: (value: T | null) => void;
    const entry: { value?: T; pending: Promise<T | null> } = {
      pending: new Promise(resolve => { complete = resolve; }),
    };
    this.entries.set(source, entry);
    this.queue.push(() => {
      if (this.entries.get(source) !== entry) { complete(null); return; }
      this.active++;
      void Promise.resolve().then(() => this.decode(source)).then(value => {
        if (this.entries.get(source) !== entry) { complete(null); return; }
        entry.value = value;
        complete(value);
      }).catch(() => {
        if (this.entries.get(source) === entry) this.entries.delete(source);
        complete(null);
      }).finally(() => { this.active--; this.pump(); });
    });
    this.pump();
    return entry.pending;
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length) this.queue.shift()!();
  }
}
