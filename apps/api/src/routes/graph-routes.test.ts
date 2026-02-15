import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { _resetSensitiveRateLimiter } from '../lib/security';

process.env.NODE_ENV = 'test';
process.env.NEO4J_URI = 'bolt://localhost:7687';
process.env.NEO4J_USER = 'neo4j';
process.env.NEO4J_PASSWORD = 'test_password';
process.env.NIMIQ_RPC_URL = 'http://localhost:8648';
process.env.PORT = '3001';

const mockExpand = mock(async () => ({ nodes: [], edges: [] }));
const mockFindPath = mock(async () => ({ found: false }));
const mockFindSubgraph = mock(async () => ({ found: false }));
const mockEnsureAddressIndexed = mock(async () => {});
const mockGetBlockNumber = mock(async () => 100);
const mockGetBlockByNumber = mock(async () => ({
  hash: 'hash',
  number: 100,
  timestamp: 1_700_000_000,
  transactions: [],
}));

mock.module('../services/graph', () => ({
  getGraphService: () => ({
    expand: mockExpand,
    getNodes: mock(async () => []),
  }),
}));

mock.module('../services/path-finder', () => ({
  getPathFinder: () => ({
    findPath: mockFindPath,
  }),
}));

mock.module('../services/subgraph-finder', () => ({
  getSubgraphFinder: () => ({
    findSubgraph: mockFindSubgraph,
  }),
}));

mock.module('../services/nimiq-rpc', () => ({
  getNimiqService: () => ({
    getBlockNumber: mockGetBlockNumber,
    getBlockByNumber: mockGetBlockByNumber,
  }),
}));

mock.module('../services/indexing', () => ({
  ensureAddressIndexed: mockEnsureAddressIndexed,
}));

mock.module('../lib/address-labels', () => ({
  getAddressLabelService: () => ({
    getLabel: () => null,
    getIcon: () => null,
  }),
}));

import { graphRoutes } from './graph';

const app = new Elysia().use(graphRoutes);
const validFrom = 'NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19';
const validTo = 'NQ09 VF5Y 1PKV MRM4 5LE1 55KV P6R2 GXYJ XYQF';

describe('graph routes', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = 'secret-key';
    process.env.SENSITIVE_RATE_LIMIT_PER_WINDOW = '2';
    process.env.SENSITIVE_RATE_LIMIT_MAIN_ORIGIN_PER_WINDOW = '100';

    mockExpand.mockClear();
    mockFindPath.mockClear();
    mockFindSubgraph.mockClear();
    mockEnsureAddressIndexed.mockClear();
    mockGetBlockNumber.mockClear();
    mockGetBlockByNumber.mockClear();
    _resetSensitiveRateLimiter();
  });

  test('returns 400 for invalid minValue on /graph/expand', async () => {
    const response = await app.handle(
      new Request('http://localhost/graph/expand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          addresses: [validFrom],
          direction: 'both',
          filters: { minValue: '1.5' },
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('minValue');
    expect(mockExpand).not.toHaveBeenCalled();
  });

  test('returns 401 for /graph/subgraph in production without auth from non-main origin', async () => {
    process.env.NODE_ENV = 'production';

    const response = await app.handle(
      new Request(`http://localhost/graph/subgraph?from=${encodeURIComponent(validFrom)}&to=${encodeURIComponent(validTo)}`, {
        headers: {
          origin: 'https://example.com',
          'x-forwarded-for': '198.51.100.2',
        },
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
    expect(mockFindSubgraph).not.toHaveBeenCalled();
  });

  test('returns 429 for /graph/latest-blocks when non-main origin exceeds limit', async () => {
    process.env.NODE_ENV = 'production';

    const headers = {
      origin: 'https://example.com',
      'x-forwarded-for': '198.51.100.10',
      'x-api-key': 'secret-key',
    };

    const first = await app.handle(
      new Request('http://localhost/graph/latest-blocks?count=1', { headers }),
    );
    const second = await app.handle(
      new Request('http://localhost/graph/latest-blocks?count=1', { headers }),
    );
    const third = await app.handle(
      new Request('http://localhost/graph/latest-blocks?count=1', { headers }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    const body = await third.json();
    expect(body.error).toBe('Too Many Requests');
  });
});
