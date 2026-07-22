export interface TtlCacheOptions { now?: () => number }

/** In-memory TTL cache with in-flight coalescing + serve-stale-on-error. Single-instance (devnet). */
export class TtlCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private inflight = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  constructor(opts: TtlCacheOptions = {}) { this.now = opts.now ?? (() => Date.now()); }

  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.store.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value as T;

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const p = (async () => {
      try {
        const value = await loader();
        this.store.set(key, { value, expiresAt: this.now() + ttlMs });
        return value;
      } catch (e) {
        const stale = this.store.get(key);
        if (stale) return stale.value as T;
        throw e;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p as Promise<T>;
  }

  /** Return the cached value if still fresh, else undefined (no load). */
  peek<T>(key: string): T | undefined {
    const c = this.store.get(key);
    return c && c.expiresAt > this.now() ? (c.value as T) : undefined;
  }

  /** Directly store a value with a ttl (used to seed per-item entries from a batch load). */
  set<T>(key: string, ttlMs: number, value: T): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }
}
