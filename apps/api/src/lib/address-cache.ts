/**
 * In-memory LRU cache for address data with TTL-based expiration.
 * Reduces database queries for frequently accessed addresses.
 * Bounded to MAX_ENTRIES to prevent unbounded memory growth.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_ENTRIES = 50_000;

class AddressCache {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly ttlMs = 300_000; // 5 minutes TTL

  /**
   * Get a cached value by key.
   * Returns null if not found or expired.
   * Refreshes LRU position on hit.
   */
  get<T>(id: string): T | null {
    const entry = this.cache.get(id);
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) this.cache.delete(id);
      return null;
    }
    // LRU refresh: delete and re-insert to move to end (most recently used)
    this.cache.delete(id);
    this.cache.set(id, entry);
    return entry.data as T;
  }

  /**
   * Set a cached value with automatic TTL.
   * Evicts oldest entries if cache exceeds MAX_ENTRIES.
   */
  set<T>(id: string, data: T): void {
    // If already exists, delete first to refresh position
    if (this.cache.has(id)) {
      this.cache.delete(id);
    }
    this.cache.set(id, { data, expiresAt: Date.now() + this.ttlMs });
    this.evictIfNeeded();
  }

  /**
   * Set multiple entries at once (more efficient for batch operations)
   */
  setMultiple<T>(entries: Array<{ id: string; data: T }>): void {
    const expiresAt = Date.now() + this.ttlMs;
    for (const { id, data } of entries) {
      if (this.cache.has(id)) {
        this.cache.delete(id);
      }
      this.cache.set(id, { data, expiresAt });
    }
    this.evictIfNeeded();
  }

  /**
   * Get multiple values, returning cached hits and missing keys separately.
   * Useful for batch fetching with partial cache coverage.
   */
  getMultiple<T>(ids: string[]): { cached: Map<string, T>; missing: string[] } {
    const cached = new Map<string, T>();
    const missing: string[] = [];
    for (const id of ids) {
      const data = this.get<T>(id);
      if (data !== null) {
        cached.set(id, data);
      } else {
        missing.push(id);
      }
    }
    return { cached, missing };
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(id: string): void {
    this.cache.delete(id);
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size (for monitoring)
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Evict oldest entries (LRU) when cache exceeds max size.
   * Map iteration order is insertion order, so first entries are oldest.
   */
  private evictIfNeeded(): void {
    if (this.cache.size <= MAX_ENTRIES) return;
    const toEvict = this.cache.size - MAX_ENTRIES;
    let evicted = 0;
    for (const key of this.cache.keys()) {
      if (evicted >= toEvict) break;
      this.cache.delete(key);
      evicted++;
    }
  }
}

export const addressCache = new AddressCache();
