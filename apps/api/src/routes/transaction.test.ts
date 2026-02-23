import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

process.env.NODE_ENV = 'test';
process.env.NEO4J_URI = 'bolt://localhost:7687';
process.env.NEO4J_USER = 'neo4j';
process.env.NEO4J_PASSWORD = 'test_password';
process.env.NIMIQ_RPC_URL = 'http://localhost:8648';
process.env.PORT = '3001';

const mockRun = mock(() => Promise.resolve({ records: [] }));
const mockGetTransactionByHash = mock(async () => null);
const mockGetBlockNumber = mock(async () => 0);
const mockGetBlockByNumber = mock(async () => ({
  hash: 'block-hash',
  number: 0,
  timestamp: 0,
  transactions: [],
}));

mock.module('../lib/neo4j', () => ({
  readTx: mock(async (work: (tx: { run: typeof mockRun }) => Promise<unknown>) => {
    return work({ run: mockRun });
  }),
  toNumber: (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0)),
  toBigIntString: (value: unknown) => String(value ?? '0'),
  toISOString: (value: unknown) => (value == null ? null : String(value)),
}));

mock.module('../services/nimiq-rpc', () => ({
  getNimiqService: () => ({
    getTransactionByHash: mockGetTransactionByHash,
    getBlockNumber: mockGetBlockNumber,
    getBlockByNumber: mockGetBlockByNumber,
  }),
}));

import { transactionRoutes } from './transaction';

const app = new Elysia().use(transactionRoutes);

describe('GET /transactions/recent', () => {
  beforeEach(() => {
    mockRun.mockClear();
    mockGetTransactionByHash.mockClear();
    mockGetBlockNumber.mockClear();
    mockGetBlockByNumber.mockClear();
  });

  test('returns paginated recent transactions', async () => {
    mockRun.mockImplementation((query: string) => {
      if (query.includes('ORDER BY t.blockNumber DESC')) {
        return Promise.resolve({
          records: [
            {
              get: (key: string) =>
                ({
                  hash: 'a'.repeat(64),
                  fromAddr: 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA',
                  toAddr: 'NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB',
                  value: '100000',
                  fee: '1000',
                  blockNumber: 42,
                  timestamp: '2024-01-01T00:00:00.000Z',
                  data: null,
                })[key] ?? null,
            },
            {
              get: (key: string) =>
                ({
                  hash: 'b'.repeat(64),
                  fromAddr: 'NQ33 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCCC',
                  toAddr: 'NQ44 DDDD DDDD DDDD DDDD DDDD DDDD DDDD DDDD',
                  value: '200000',
                  fee: '1200',
                  blockNumber: 41,
                  timestamp: '2023-12-31T23:59:00.000Z',
                  data: 'hello',
                })[key] ?? null,
            },
          ],
        });
      }

      return Promise.resolve({ records: [] });
    });

    const response = await app.handle(
      new Request('http://localhost/transactions/recent?page=1&pageSize=50')
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(false);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        hash: 'a'.repeat(64),
        blockNumber: 42,
      }),
    );
  });

  test('caps page size to 200', async () => {
    const capturedParams: Array<Record<string, unknown> | undefined> = [];

    mockRun.mockImplementation((_query: string, params?: Record<string, unknown>) => {
      capturedParams.push(params);
      return Promise.resolve({
        records: [
          {
            get: (_key: string) => 0,
          },
        ],
      });
    });

    const response = await app.handle(
      new Request('http://localhost/transactions/recent?page=1&pageSize=500')
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pageSize).toBe(200);
    expect(capturedParams.length).toBeGreaterThan(0);
  });

  test('rejects invalid page and pageSize values', async () => {
    const badPage = await app.handle(
      new Request('http://localhost/transactions/recent?page=0&pageSize=50')
    );
    expect(badPage.status).toBe(400);

    const badPageSize = await app.handle(
      new Request('http://localhost/transactions/recent?page=1&pageSize=0')
    );
    expect(badPageSize.status).toBe(400);
  });

  test('falls back to RPC when Neo4j recent lookup times out', async () => {
    mockRun.mockImplementation(() => new Promise(() => {}));

    mockGetBlockNumber.mockImplementation(async () => 1234);
    mockGetBlockByNumber.mockImplementation(async (blockNumber: number) => {
      if (blockNumber === 1234) {
        return {
          hash: 'block-1234',
          number: 1234,
          timestamp: 1700000000000,
          transactions: [
            {
              hash: 'f'.repeat(64),
              blockNumber: 1234,
              timestamp: 1700000000000,
              from: 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA',
              to: 'NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB',
              value: 123,
              fee: 1,
              senderData: '',
              recipientData: '',
            },
          ],
        };
      }

      return {
        hash: `block-${blockNumber}`,
        number: blockNumber,
        timestamp: 1700000000000,
        transactions: [],
      };
    });

    const response = await app.handle(
      new Request('http://localhost/transactions/recent?page=1&pageSize=1')
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        hash: 'f'.repeat(64),
        blockNumber: 1234,
      }),
    );
  });
});
