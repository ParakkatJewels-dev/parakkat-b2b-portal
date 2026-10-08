/**
 * Tiny in-memory TTL cache for CRS availability reads (Instructions.md
 * §10 — "short-TTL cache, refresh-before-book"). In-memory (not Redis) so it
 * works without a running Redis in dev; per-process, which is fine for a
 * short-lived read cache. The booking path always bypasses this for the
 * refresh-before-book check.
 */
interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}
