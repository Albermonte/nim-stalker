import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { validAddresses } from '../test/fixtures/addresses';
import { formatAddress } from '../lib/address-utils';
import { _resetSensitiveRateLimiter } from '../lib/security';

process.env.NODE_ENV = 'test';
process.env.NEO4J_URI = 'bolt://localhost:7687';
process.env.NEO4J_USER = 'neo4j';
process.env.NEO4J_PASSWORD = 'test_password';
process.env.NIMIQ_RPC_URL = 'http://localhost:8648';
process.env.PORT = '3001';

// Mock neo4j module
const mockRun = mock(() => Promise.resolve({ records: [] }));

mock.module('../lib/neo4j', () => ({
  readTx: mock(async (work: (tx: any) => Promise<any>) => work({ run: mockRun })),
  writeTx: mock(async (work: (tx: any) => Promise<any>) => work({ run: mockRun })),
  toNumber: (v: any) => typeof v === 'number' ? v : Number(v || 0),
  toBigIntString: (v: any) => String(v || '0'),
  toISOString: (v: any) => v ? String(v) : null,
}));

// Mock nimiq-rpc module
const mockGetAccount = mock(() => Promise.resolve({ address: validAddresses.basic, balance: 0, type: 'BASIC' }));
const mockGetTransactionsByAddress = mock(() => Promise.resolve([]));

mock.module('../services/nimiq-rpc', () => ({
  getNimiqService: () => ({
    getAccount: mockGetAccount,
    getTransactionsByAddress: mockGetTransactionsByAddress,
  }),
}));

// Mock address-cache
mock.module('../lib/address-cache', () => ({
  addressCache: {
    get: mock(() => null),
    set: mock(() => {}),
    invalidate: mock(() => {}),
  },
}));

// Mock job-tracker
const mockStartJob = mock(() => {});
const mockHasJob = mock(() => false);
const mockCompleteJob = mock(() => {});
const mockFailJob = mock(() => {});
const mockUpdateProgress = mock(() => {});
const mockGetJobs = mock(() => []);

mock.module('../lib/job-tracker', () => ({
  jobTracker: {
    startJob: mockStartJob,
    hasJob: mockHasJob,
    completeJob: mockCompleteJob,
    failJob: mockFailJob,
    updateProgress: mockUpdateProgress,
    getJobs: mockGetJobs,
  },
}));

import { addressRoutes } from './address';
import { Elysia } from 'elysia';

const app = new Elysia().use(addressRoutes);

describe('GET /address/:addr/transactions', () => {
  beforeEach(() => {
    mockRun.mockClear();
  });

  test('returns paginated transactions and query has no NULLS LAST', async () => {
    const capturedQueries: string[] = [];
    mockRun.mockImplementation((query: string) => {
      capturedQueries.push(query);
      // Count query returns total
      if (query.includes('count(t)')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => key === 'total' ? 1 : null,
          }],
          reduce: undefined,
        });
      }
      // Data query returns transaction records
      return Promise.resolve({
        records: [{
          get: (key: string) => {
            const data: Record<string, unknown> = {
              hash: 'abc123',
              fromId: validAddresses.basic,
              toId: validAddresses.basic,
              value: '100000',
              fee: '1000',
              blockNumber: 42,
              timestamp: '2024-01-01T00:00:00.000Z',
              data: null,
              total: 1,
            };
            return data[key] ?? null;
          },
        }],
      });
    });

    const response = await app.handle(
      new Request(`http://localhost/address/${encodeURIComponent(validAddresses.basic)}/transactions?direction=both`)
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('pageSize');
    expect(body).toHaveProperty('hasMore');

    // Verify no Cypher query contains NULLS LAST
    for (const query of capturedQueries) {
      expect(query).not.toContain('NULLS LAST');
    }
  });
});

describe('POST /address/:addr/index', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = 'secret-key';
    process.env.SENSITIVE_RATE_LIMIT_PER_WINDOW = '100';
    process.env.SENSITIVE_RATE_LIMIT_MAIN_ORIGIN_PER_WINDOW = '1000';

    mockRun.mockClear();
    mockGetAccount.mockClear();
    mockGetTransactionsByAddress.mockClear();
    mockStartJob.mockClear();
    mockHasJob.mockClear();
    mockCompleteJob.mockClear();
    mockFailJob.mockClear();
    mockUpdateProgress.mockClear();
    // Default: writeTx succeeds
    mockRun.mockImplementation(() => Promise.resolve({ records: [] }));
    mockHasJob.mockImplementation(() => false);
    _resetSensitiveRateLimiter();
  });

  test('returns INDEXING status immediately (fire-and-forget)', async () => {
    const response = await app.handle(
      new Request(`http://localhost/address/${encodeURIComponent(validAddresses.basic)}/index`, {
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('INDEXING');
    expect(body.address).toBe(formatAddress(validAddresses.basic));
  });

  test('registers job via jobTracker.startJob', async () => {
    await app.handle(
      new Request(`http://localhost/address/${encodeURIComponent(validAddresses.basic)}/index`, {
        method: 'POST',
      })
    );

    expect(mockStartJob).toHaveBeenCalledTimes(1);
    expect(mockStartJob).toHaveBeenCalledWith(formatAddress(validAddresses.basic), false);
  });

  test('returns 409 when job already in progress', async () => {
    mockHasJob.mockImplementation(() => true);

    const response = await app.handle(
      new Request(`http://localhost/address/${encodeURIComponent(validAddresses.basic)}/index`, {
        method: 'POST',
      })
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('Indexing already in progress');
  });

  test('returns 400 for invalid address', async () => {
    const response = await app.handle(
      new Request('http://localhost/address/invalid-address/index', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 401 in production for non-main origin without API key', async () => {
    process.env.NODE_ENV = 'production';

    const response = await app.handle(
      new Request(`http://localhost/address/${encodeURIComponent(validAddresses.basic)}/index`, {
        method: 'POST',
        headers: {
          origin: 'https://example.com',
          'x-forwarded-for': '198.51.100.10',
        },
      })
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  test('allows production request from localhost origin without API key', async () => {
    process.env.NODE_ENV = 'production';

    const response = await app.handle(
      new Request(`http://localhost/address/${encodeURIComponent(validAddresses.basic)}/index`, {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'x-forwarded-for': '198.51.100.11',
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('INDEXING');
  });
});
