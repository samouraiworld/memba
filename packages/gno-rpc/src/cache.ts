/**
 * In-memory TTL cache for ABCI query results.
 *
 * - Proposal bodies: infinite TTL (immutable once created)
 * - Vote tallies / proposal status: 60s
 * - Treasury balances: 30s
 * - Default: 60s
 *
 * Simple Map-based with expiry timestamps. No LRU eviction needed
 * for a local MCP server — memory is bounded by the number of
 * unique queries in a session.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Date.now() + ttlMs, or Infinity for permanent
}

export class QueryCache {
  private store = new Map<string, CacheEntry<string | null>>();
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Get a cached value, or undefined if expired/missing.
   */
  get(key: string): string | null | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Store a value with a TTL in milliseconds.
   * Use Infinity for permanent caching.
   */
  set(key: string, value: string | null, ttlMs: number): void {
    // Evict oldest entries if at capacity
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: ttlMs === Infinity ? Infinity : Date.now() + ttlMs,
    });
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Remove a specific key.
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Number of entries (including potentially expired ones).
   */
  get size(): number {
    return this.store.size;
  }
}

// ── Cache TTL presets ──────────────────────────────────────────

/** Proposal body/metadata — immutable once created. */
export const TTL_PROPOSAL = Infinity;

/** Vote tallies, proposal status — changes with each vote. */
export const TTL_VOTES = 60_000;

/** Treasury balances — changes with transactions. */
export const TTL_TREASURY = 30_000;

/** DAO overview / member list. */
export const TTL_DAO_OVERVIEW = 60_000;

/** Default TTL for misc queries. */
export const TTL_DEFAULT = 60_000;

/**
 * Build a cache key from query parameters.
 */
export function cacheKey(queryType: string, ...parts: string[]): string {
  // Encode parts to avoid collision when parts contain the delimiter
  const encoded = parts.map((p) => encodeURIComponent(p));
  return `${queryType}:${encoded.join(":")}`;
}
