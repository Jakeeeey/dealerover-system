interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class SimpleMemoryCache {
  private store = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs: number = 30 * 60 * 1000): void {
    this.store.set(key, {
      data,
      expiry: Date.now() + ttlMs,
    });
  }

  clear(): void {
    this.store.clear();
  }
}

const globalForCache = global as unknown as { dealeroverCache?: SimpleMemoryCache };
export const dealeroverCache = globalForCache.dealeroverCache ?? new SimpleMemoryCache();
if (process.env.NODE_ENV !== "production") globalForCache.dealeroverCache = dealeroverCache;
