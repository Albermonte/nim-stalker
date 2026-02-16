import type {
  GraphResponse,
  PathResponse,
  SubgraphResponse,
  IndexingJob,
  Direction,
  FilterState,
} from '@nim-stalker/shared';
import { getApiBaseUrl } from './api-url';

const API_URL = getApiBaseUrl();

/**
 * Build URLSearchParams from an object, filtering out null/undefined values
 */
function buildParams(params: Record<string, string | number | boolean | undefined | null>): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      searchParams.set(key, String(value));
    }
  }
  return searchParams;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/** Per-endpoint TTL configuration */
const ENDPOINT_TTL: Record<string, number> = {
  '/graph/': 60_000,      // Graph data: 60s
  '/graph/latest': 5_000, // Latest blocks: 5s
  '/jobs': 2_000,         // Jobs: 2s
  '/address/': 30_000,    // Address data: 30s (default)
};
const MAX_CACHE_ENTRIES = 2_000;
const CACHE_SWEEP_EVERY_WRITES = 50;

function getTtlForEndpoint(endpoint: string): number {
  for (const [prefix, ttl] of Object.entries(ENDPOINT_TTL)) {
    if (endpoint.startsWith(prefix)) return ttl;
  }
  return 30_000; // Default 30s
}

function getTtlForCacheKey(cacheKey: string): number {
  if (cacheKey.startsWith('address:')) return ENDPOINT_TTL['/address/'];
  if (cacheKey.startsWith('GET:') || cacheKey.startsWith('POST:')) {
    const endpoint = cacheKey.slice(4);
    return getTtlForEndpoint(endpoint);
  }
  return getTtlForEndpoint(cacheKey);
}

export class ApiClient {
  private baseUrl: string;
  private cache = new Map<string, CacheEntry<unknown>>();
  private cacheWrites = 0;
  /** In-flight request deduplication: concurrent requests for the same key share a single Promise */
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getCached<T>(key: string, ttlMs?: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const ttl = ttlMs ?? getTtlForCacheKey(key);
    if (Date.now() - entry.timestamp > ttl) {
      this.cache.delete(key);
      return null;
    }
    // LRU refresh on hit
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, { data, timestamp: Date.now() });
    this.cacheWrites += 1;

    // Opportunistic sweep to keep stale entries from accumulating.
    if (this.cacheWrites % CACHE_SWEEP_EVERY_WRITES === 0) {
      this.pruneExpiredEntries();
    }
    this.evictIfNeeded();
  }

  private pruneExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      const ttl = getTtlForCacheKey(key);
      if (now - entry.timestamp > ttl) {
        this.cache.delete(key);
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= MAX_CACHE_ENTRIES) return;
    const toEvict = this.cache.size - MAX_CACHE_ENTRIES;
    let evicted = 0;
    for (const key of this.cache.keys()) {
      this.cache.delete(key);
      evicted += 1;
      if (evicted >= toEvict) break;
    }
  }

  invalidateCache(pattern: string): void {
    for (const key of Array.from(this.cache.keys())) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  private async fetch<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    // Dedup concurrent GET requests (not mutations)
    const method = options?.method?.toUpperCase() ?? 'GET';
    const cacheKey = `${method}:${endpoint}`;

    if (method === 'GET') {
      const existing = this.inFlight.get(cacheKey);
      if (existing) return existing as Promise<T>;
    }

    const promise = (async () => {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `API error: ${response.status}`);
      }

      return response.json() as Promise<T>;
    })();

    if (method === 'GET') {
      this.inFlight.set(cacheKey, promise);
      // Attach both fulfill/reject handlers so cleanup does not create an
      // unhandled rejection chain when the request itself fails.
      void promise.then(
        () => {
          this.inFlight.delete(cacheKey);
        },
        () => {
          this.inFlight.delete(cacheKey);
        },
      );
    }

    return promise;
  }

  async getAddress(address: string) {
    type AddressResponse = {
      id: string;
      type: string;
      label?: string;
      icon?: string;
      balance: string;
      firstSeenAt?: string;
      lastSeenAt?: string;
      indexStatus: string;
      indexedAt?: string;
      txCount?: number;
    };

    const cacheKey = `address:${address}`;
    const cached = this.getCached<AddressResponse>(cacheKey);
    if (cached) return cached;

    const result = await this.fetch<AddressResponse>(`/address/${encodeURIComponent(address)}`);
    this.setCache(cacheKey, result);
    return result;
  }

  async getTransactions(
    address: string,
    options?: {
      page?: number;
      pageSize?: number;
      direction?: Direction;
      minTimestamp?: number;
      maxTimestamp?: number;
      minValue?: string;
      maxValue?: string;
    }
  ) {
    const params = buildParams({
      page: options?.page,
      pageSize: options?.pageSize,
      direction: options?.direction,
      minTimestamp: options?.minTimestamp,
      maxTimestamp: options?.maxTimestamp,
      minValue: options?.minValue,
      maxValue: options?.maxValue,
    });
    const query = params.toString();
    return this.fetch<{
      data: Array<{
        hash: string;
        from: string;
        to: string;
        value: string;
        fee: string;
        blockNumber: number;
        timestamp: string;
        data?: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
      hasMore: boolean;
    }>(`/address/${encodeURIComponent(address)}/transactions${query ? `?${query}` : ''}`);
  }

  async indexAddress(address: string) {
    const result = await this.fetch<{ status: string; address: string }>(
      `/address/${encodeURIComponent(address)}/index`,
      { method: 'POST' }
    );
    // Clear cached data for this address since indexing was triggered
    this.invalidateCache(address);
    return result;
  }

  async getJobs(): Promise<{ jobs: IndexingJob[] }> {
    return this.fetch('/jobs');
  }

  async expandGraph(
    addresses: string[],
    direction: Direction = 'both',
    filters?: FilterState
  ): Promise<GraphResponse> {
    return this.fetch<GraphResponse>('/graph/expand', {
      method: 'POST',
      body: JSON.stringify({
        addresses,
        direction,
        filters: filters
          ? {
              minTimestamp: filters.minTimestamp,
              maxTimestamp: filters.maxTimestamp,
              minValue: filters.minValue?.toString(),
              maxValue: filters.maxValue?.toString(),
              limit: filters.limit,
            }
          : undefined,
      }),
    });
  }

  async findPath(
    from: string,
    to: string,
    maxDepth?: number
  ): Promise<PathResponse> {
    const params = buildParams({ from, to, maxDepth });
    return this.fetch<PathResponse>(`/graph/path?${params.toString()}`);
  }

  async findSubgraph(
    from: string,
    to: string,
    maxHops?: number,
    directed?: boolean
  ): Promise<SubgraphResponse> {
    const params = buildParams({ from, to, maxHops, directed });
    return this.fetch<SubgraphResponse>(`/graph/subgraph?${params.toString()}`);
  }

  async getNodes(ids: string[]): Promise<{ nodes: GraphResponse['nodes'] }> {
    return this.fetch<{ nodes: GraphResponse['nodes'] }>(
      `/graph/nodes?ids=${encodeURIComponent(ids.join(','))}`
    );
  }

  async getTransaction(hash: string): Promise<{
    hash: string;
    from: string;
    to: string;
    value: string;
    fee: string;
    blockNumber: number;
    timestamp: string;
    data: string | null;
  } | null> {
    try {
      return await this.fetch(`/transaction/${encodeURIComponent(hash)}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return null;
      throw err;
    }
  }

  async getLatestBlocksGraph(count: number = 10): Promise<GraphResponse> {
    return this.fetch<GraphResponse>(`/graph/latest-blocks?count=${count}`);
  }
}

export const api = new ApiClient(API_URL);

/**
 * WebSocket client for real-time job status updates.
 * Falls back to HTTP polling if WebSocket fails to connect.
 */
type JobMessage =
  | { type: 'snapshot'; jobs: IndexingJob[] }
  | { type: 'job-update'; job: IndexingJob };

export class JobWebSocket {
  private ws: WebSocket | null = null;
  private reconnectMs = 1000;
  private maxReconnectMs = 30000;
  private disposed = false;
  private onUpdate: ((jobs: IndexingJob[]) => void) | null = null;
  private onJobChange: ((job: IndexingJob) => void) | null = null;

  constructor(
    private baseUrl: string,
    handlers: {
      onSnapshot: (jobs: IndexingJob[]) => void;
      onJobUpdate: (job: IndexingJob) => void;
    },
  ) {
    this.onUpdate = handlers.onSnapshot;
    this.onJobChange = handlers.onJobUpdate;
    this.connect();
  }

  private connect(): void {
    if (this.disposed) return;

    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/jobs/ws';
    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectMs = 1000; // Reset backoff on successful connection
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as JobMessage;
        if (msg.type === 'snapshot') {
          this.onUpdate?.(msg.jobs);
        } else if (msg.type === 'job-update') {
          this.onJobChange?.(msg.job);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    setTimeout(() => this.connect(), this.reconnectMs);
    this.reconnectMs = Math.min(this.reconnectMs * 2, this.maxReconnectMs);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  dispose(): void {
    this.disposed = true;
    this.ws?.close();
    this.ws = null;
    this.onUpdate = null;
    this.onJobChange = null;
  }
}
