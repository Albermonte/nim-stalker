/**
 * Layout position cache — stores computed node positions keyed by layout mode
 * and graph fingerprint. Enables instant layout switching when toggling between
 * previously-computed layouts.
 *
 * Structure: Map<layoutMode, Map<graphHash, Map<nodeId, {x, y}>>>
 * Max 10 cached layouts per mode, LRU eviction (oldest entry removed first).
 */

const MAX_ENTRIES_PER_MODE = 10

// FNV-1a 64-bit offset basis and prime as BigInts
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x00000100000001B3n
const MASK_64 = 0xFFFFFFFFFFFFFFFFn

/**
 * Compute an FNV-1a 64-bit hash over sorted node IDs and edge source/target pairs.
 * Returns the hash as a 16-character hex string.
 */
export function computeGraphHash(nodeIds: string[], edgeKeys: string[]): string {
  const sortedNodes = [...nodeIds].sort()
  const sortedEdges = [...edgeKeys].sort()
  const input = sortedNodes.join('\0') + '\x01' + sortedEdges.join('\0')

  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK_64
  }

  return hash.toString(16).padStart(16, '0')
}

// Map<layoutMode, Map<graphHash, Map<nodeId, {x, y}>>>
const cache = new Map<string, Map<string, Map<string, { x: number; y: number }>>>()

/**
 * Save computed layout positions for a given mode and graph hash.
 * Evicts the oldest entry when the per-mode cache exceeds MAX_ENTRIES_PER_MODE.
 */
export function saveLayoutPositions(
  mode: string,
  hash: string,
  positions: Map<string, { x: number; y: number }>,
): void {
  let modeCache = cache.get(mode)
  if (!modeCache) {
    modeCache = new Map()
    cache.set(mode, modeCache)
  }

  // If this hash already exists, delete it so it moves to the end (most recent)
  if (modeCache.has(hash)) {
    modeCache.delete(hash)
  }

  // Evict oldest entry if at capacity
  if (modeCache.size >= MAX_ENTRIES_PER_MODE) {
    const oldestKey = modeCache.keys().next().value
    if (oldestKey !== undefined) {
      modeCache.delete(oldestKey)
    }
  }

  // Store a copy of the positions map
  modeCache.set(hash, new Map(positions))
}

/**
 * Retrieve cached layout positions for a given mode and graph hash.
 * Returns null if no cached positions exist. Moves the entry to the
 * end of the map on access (LRU behavior).
 */
export function getLayoutPositions(
  mode: string,
  hash: string,
): Map<string, { x: number; y: number }> | null {
  const modeCache = cache.get(mode)
  if (!modeCache) return null

  const positions = modeCache.get(hash)
  if (!positions) return null

  // Move to end for LRU freshness
  modeCache.delete(hash)
  modeCache.set(hash, positions)

  return new Map(positions)
}

/**
 * Clear all cached layout positions across all modes.
 */
export function clearLayoutCache(): void {
  cache.clear()
}
