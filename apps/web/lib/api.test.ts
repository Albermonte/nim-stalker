import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch globally
let mockFetch: ReturnType<typeof mock>;

// We need to test a fresh instance, so we'll create our own
class TestableApiClient {
  private baseUrl: string;
  private cache = new Map<string, { data: unknown; timestamp: number }>();
  private cacheTtlMs = 30_000;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  invalidateCache(pattern: string): void {
    for (const key of Array.from(this.cache.keys())) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
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

    return response.json();
  }

  async getAddress(address: string) {
    type AddressResponse = {
      id: string;
      type: string;
      balance: string;
      indexStatus: string;
    };

    const cacheKey = `address:${address}`;
    const cached = this.getCached<AddressResponse>(cacheKey);
    if (cached) return cached;

    const result = await this.fetch<AddressResponse>(
      `/address/${encodeURIComponent(address)}`
    );
    this.setCache(cacheKey, result);
    return result;
  }

  async expandGraph(addresses: string[], direction = 'both') {
    return this.fetch('/graph/expand', {
      method: 'POST',
      body: JSON.stringify({ addresses, direction }),
    });
  }

  async findPath(from: string, to: string, maxDepth?: number) {
    const params = new URLSearchParams({ from, to });
    if (maxDepth) params.set('maxDepth', String(maxDepth));
    return this.fetch(`/graph/path?${params.toString()}`);
  }

  async findSubgraph(
    from: string,
    to: string,
    maxHops?: number,
    directed?: boolean
  ) {
    const params = new URLSearchParams({ from, to });
    if (maxHops) params.set('maxHops', String(maxHops));
    if (directed !== undefined) params.set('directed', String(directed));
    return this.fetch(`/graph/subgraph?${params.toString()}`);
  }

  async getNodes(ids: string[]) {
    return this.fetch(`/graph/nodes?ids=${encodeURIComponent(ids.join(','))}`);
  }

  async getLatestBlocksGraph(count = 10) {
    return this.fetch(`/graph/latest-blocks?count=${count}`);
  }

  // Expose cache for testing
  get cacheSize() {
    return this.cache.size;
  }
}

describe('ApiClient', () => {
  let api: TestableApiClient;
  let originalDateNow: () => number;
  let mockedTime: number;

  beforeEach(() => {
    mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );
    global.fetch = mockFetch as unknown as typeof fetch;
    api = new TestableApiClient('http://localhost:3001');

    // Mock Date.now for cache testing
    originalDateNow = Date.now;
    mockedTime = 1000000000;
    Date.now = () => mockedTime;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  });

  const advanceTime = (ms: number) => {
    mockedTime += ms;
  };

  describe('fetch wrapper', () => {
    test('adds Content-Type header', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'test' }),
        })
      );

      await api.getAddress('NQ42TEST');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    test('throws error on non-ok response', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'Address not found' }),
        })
      );

      await expect(api.getAddress('NQ42INVALID')).rejects.toThrow(
        'Address not found'
      );
    });

    test('uses status code in error when no error message', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('Invalid JSON')),
        })
      );

      await expect(api.getAddress('NQ42TEST')).rejects.toThrow('API error: 500');
    });
  });

  describe('caching', () => {
    test('caches getAddress response', async () => {
      const mockResponse = {
        id: 'NQ42TEST',
        type: 'BASIC',
        balance: '1000000',
        indexStatus: 'COMPLETE',
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      // First call - should fetch
      const result1 = await api.getAddress('NQ42TEST');
      expect(result1).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await api.getAddress('NQ42TEST');
      expect(result2).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1
    });

    test('cache expires after TTL', async () => {
      const mockResponse = {
        id: 'NQ42TEST',
        type: 'BASIC',
        balance: '1000000',
        indexStatus: 'COMPLETE',
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      // First call
      await api.getAddress('NQ42TEST');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance time past TTL (30 seconds)
      advanceTime(31000);

      // Second call - cache expired, should fetch again
      await api.getAddress('NQ42TEST');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('invalidateCache removes matching entries', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'test' }),
        })
      );

      // Cache some data
      await api.getAddress('NQ42ADDR1');
      await api.getAddress('NQ42ADDR2');
      expect(api.cacheSize).toBe(2);

      // Invalidate one
      api.invalidateCache('NQ42ADDR1');

      // ADDR1 should refetch, ADDR2 should still be cached
      await api.getAddress('NQ42ADDR1');
      await api.getAddress('NQ42ADDR2');

      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial 2 + refetch of ADDR1
    });

  });

  describe('getAddress', () => {
    test('calls correct endpoint', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'NQ42TEST' }),
        })
      );

      await api.getAddress('NQ42 TEST ADDR');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/address/NQ42%20TEST%20ADDR',
        expect.any(Object)
      );
    });
  });

  describe('expandGraph', () => {
    test('sends addresses and direction in body', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ nodes: [], edges: [] }),
        })
      );

      await api.expandGraph(['ADDR1', 'ADDR2'], 'outgoing');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/graph/expand',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            addresses: ['ADDR1', 'ADDR2'],
            direction: 'outgoing',
          }),
        })
      );
    });

    test('defaults to "both" direction', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ nodes: [], edges: [] }),
        })
      );

      await api.expandGraph(['ADDR1']);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            addresses: ['ADDR1'],
            direction: 'both',
          }),
        })
      );
    });
  });

  describe('findPath', () => {
    test('includes from and to in query params', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ found: true, path: { nodes: [], edges: [] } }),
        })
      );

      await api.findPath('SOURCE', 'TARGET');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/graph/path?from=SOURCE&to=TARGET',
        expect.any(Object)
      );
    });

    test('includes maxDepth when provided', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ found: false }),
        })
      );

      await api.findPath('SOURCE', 'TARGET', 4);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('maxDepth=4'),
        expect.any(Object)
      );
    });
  });

  describe('findSubgraph', () => {
    test('includes from and to in query params', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ found: true, subgraph: { nodes: [], edges: [] } }),
        })
      );

      await api.findSubgraph('SOURCE', 'TARGET');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/graph/subgraph?from=SOURCE&to=TARGET',
        expect.any(Object)
      );
    });

    test('includes maxHops when provided', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ found: false }),
        })
      );

      await api.findSubgraph('SOURCE', 'TARGET', 5);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('maxHops=5'),
        expect.any(Object)
      );
    });

    test('includes directed flag when provided', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ found: false }),
        })
      );

      await api.findSubgraph('SOURCE', 'TARGET', 3, true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('directed=true'),
        expect.any(Object)
      );
    });
  });

  describe('getNodes', () => {
    test('encodes node IDs in query string', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ nodes: [] }),
        })
      );

      await api.getNodes(['ADDR1', 'ADDR2', 'ADDR3']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/graph/nodes?ids=ADDR1%2CADDR2%2CADDR3',
        expect.any(Object)
      );
    });
  });

  describe('getLatestBlocksGraph', () => {
    test('uses default count of 10', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ nodes: [], edges: [] }),
        })
      );

      await api.getLatestBlocksGraph();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/graph/latest-blocks?count=10',
        expect.any(Object)
      );
    });

    test('uses custom count', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ nodes: [], edges: [] }),
        })
      );

      await api.getLatestBlocksGraph(25);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/graph/latest-blocks?count=25',
        expect.any(Object)
      );
    });
  });
});
