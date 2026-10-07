import type { Store } from './types';

/** Per-process store of in-flight counts per key. Synchronous, so the limiter's hot path never touches a promise. */
export class MemoryStore implements Store {
  readonly counts = new Map<string, number>();

  /** @returns the new count, or `false` when `key` is already at `limit` */
  acquire(key: string, limit: number): number | false {
    const next = this.get(key) + 1;
    if (next > limit) return false;
    this.counts.set(key, next);
    return next;
  }

  /** @returns the remaining count; unknown keys stay at 0 */
  release(key: string): number {
    const next = this.get(key) - 1;
    if (next > 0) this.counts.set(key, next);
    else this.counts.delete(key);
    return Math.max(next, 0);
  }

  get(key: string): number {
    return this.counts.get(key) || 0;
  }

  resetKey(key: string): void {
    this.counts.delete(key);
  }

  resetAll(): void {
    this.counts.clear();
  }

  /** Plain-object copy of every non-zero count. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  /** Keys with at least one request in flight. */
  get size(): number {
    return this.counts.size;
  }
}
