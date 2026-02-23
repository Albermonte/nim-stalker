import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock data
const mockFromId = 'NQ42 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA';
const mockToId = 'NQ42 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB';

const mockExpandEdgeRecord = {
  get(key: string) {
    const mockNode = (id: string) => ({
      properties: {
        id,
        label: null,
        type: 'BASIC',
        balance: '50000',
        txCount: 10,
      },
    });

    const data: Record<string, unknown> = {
      fromNode: mockNode(mockFromId),
      toNode: mockNode(mockToId),
      txCount: 5,
      totalValue: '100000',
      firstTxAt: '2024-01-01T00:00:00.000Z',
      lastTxAt: '2024-06-01T00:00:00.000Z',
    };
    return data[key];
  },
};

const mockSeedNodeRecord = {
  get(key: string) {
    const data: Record<string, unknown> = {
      id: mockFromId,
      label: null,
      type: 'BASIC',
      balance: '50000',
      txCount: 10,
    };
    return data[key];
  },
};

const mockNodeRecord = {
  get(key: string) {
    const data: Record<string, unknown> = {
      id: mockFromId,
      label: null,
      type: 'BASIC',
      balance: '50000',
      txCount: 10,
    };
    return data[key];
  },
};

const mockEdgeRecord = {
  get(key: string) {
    const data: Record<string, unknown> = {
      fromId: mockFromId,
      toId: mockToId,
      txCount: 5,
      totalValue: '100000',
      firstTxAt: '2024-01-01T00:00:00.000Z',
      lastTxAt: '2024-06-01T00:00:00.000Z',
    };
    return data[key];
  },
};

const mockRun = mock((query: string) => {
  if (query.includes('AS fromNode') && query.includes('AS toNode')) {
    return Promise.resolve({ records: [mockExpandEdgeRecord] });
  }
  if (query.includes('RETURN a.id AS id')) {
    return Promise.resolve({ records: [mockSeedNodeRecord] });
  }
  if (query.includes('RETURN a.id AS fromId')) {
    return Promise.resolve({ records: [mockEdgeRecord] });
  }
  return Promise.resolve({ records: [mockNodeRecord] });
});

mock.module('../lib/neo4j', () => ({
  readTx: mock(async (work: (tx: any) => Promise<any>) => {
    return work({ run: mockRun });
  }),
  writeTx: mock(async (work: (tx: any) => Promise<any>) => {
    return work({ run: mockRun });
  }),
  toNumber: (v: any) => typeof v === 'number' ? v : Number(v || 0),
  toBigIntString: (v: any) => String(v || '0'),
  toISOString: (v: any) => v ? String(v) : null,
}));

mock.module('./transaction-utils', () => ({
  batchCountTransactions: mock(() => Promise.resolve(new Map([
    [mockFromId, 10],
    [mockToId, 5],
  ]))),
}));

import { GraphService } from './graph';

describe('GraphService', () => {
  let service: GraphService;

  beforeEach(() => {
    service = new GraphService();
    mockRun.mockClear();
  });

  describe('expand', () => {
    test('returns valid nodes and edges arrays', async () => {
      const result = await service.expand({
        addresses: [mockFromId],
        direction: 'both',
      });

      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);
    });

    test('nodes contain expected data fields', async () => {
      const result = await service.expand({
        addresses: [mockFromId],
        direction: 'both',
      });

      expect(result.nodes.length).toBeGreaterThan(0);
      const node = result.nodes[0];
      expect(node.data).toHaveProperty('id');
      expect(node.data).toHaveProperty('label');
      expect(node.data).toHaveProperty('type');
      expect(node.data).toHaveProperty('balance');
      expect(node.data).toHaveProperty('txCount');
    });

    test('edges contain expected data fields', async () => {
      const result = await service.expand({
        addresses: [mockFromId],
        direction: 'both',
      });

      expect(result.edges.length).toBe(1);
      const edge = result.edges[0];
      expect(edge.data).toHaveProperty('id');
      expect(edge.data).toHaveProperty('source');
      expect(edge.data).toHaveProperty('target');
      expect(edge.data).toHaveProperty('txCount');
      expect(edge.data).toHaveProperty('totalValue');
      expect(edge.data).toHaveProperty('firstTxAt');
      expect(edge.data).toHaveProperty('lastTxAt');
    });

    test('edges map source/target from fromId/toId', async () => {
      const result = await service.expand({
        addresses: [mockFromId],
        direction: 'both',
      });

      const edge = result.edges[0];
      expect(edge.data.source).toBe(mockFromId);
      expect(edge.data.target).toBe(mockToId);
    });

    test('serializes totalValue to string', async () => {
      const result = await service.expand({
        addresses: [mockFromId],
        direction: 'both',
      });

      const edge = result.edges[0];
      expect(typeof edge.data.totalValue).toBe('string');
      expect(edge.data.totalValue).toBe('100000');
    });

    test('serializes dates to ISO strings', async () => {
      const result = await service.expand({
        addresses: [mockFromId],
        direction: 'both',
      });

      const edge = result.edges[0];
      expect(typeof edge.data.firstTxAt).toBe('string');
      expect(typeof edge.data.lastTxAt).toBe('string');
    });

    test('collects node IDs from both edge endpoints', async () => {
      const result = await service.expand({
        addresses: [mockFromId],
        direction: 'both',
      });

      const nodeIds = result.nodes.map((n) => n.data.id);
      expect(nodeIds).toContain(mockFromId);
      expect(nodeIds).toContain(mockToId);
    });

    test('returns empty edges when no edges found', async () => {
      mockRun.mockImplementationOnce(() => Promise.resolve({ records: [] }));

      const result = await service.expand({
        addresses: [mockFromId],
        direction: 'both',
      });

      expect(result.edges).toEqual([]);
      expect(result.nodes.length).toBe(1); // just the seed address
    });

    test('propagates error when readTx throws', async () => {
      mockRun.mockImplementationOnce(() => {
        throw new Error('Neo4j connection failed');
      });

      await expect(
        service.expand({
          addresses: [mockFromId],
          direction: 'both',
        })
      ).rejects.toThrow('Neo4j connection failed');
    });
  });

  describe('getNodes', () => {
    test('returns formatted node data', async () => {
      const nodes = await service.getNodes([mockFromId]);

      expect(nodes.length).toBe(1);
      expect(nodes[0].data.id).toBe(mockFromId);
      expect(nodes[0].data.type).toBe('BASIC');
      expect(typeof nodes[0].data.balance).toBe('string');
    });
  });

  describe('getEdges', () => {
    test('returns formatted edge data', async () => {
      const edges = await service.getEdges([mockFromId, mockToId]);

      expect(edges.length).toBe(1);
      expect(edges[0].data.source).toBe(mockFromId);
      expect(edges[0].data.target).toBe(mockToId);
      expect(typeof edges[0].data.totalValue).toBe('string');
    });
  });
});
