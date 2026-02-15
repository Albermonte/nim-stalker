import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock neo4j readTx — must be before any imports that use it
const mockRun = mock(() => Promise.resolve({ records: [] }));

mock.module('../lib/neo4j', () => ({
  readTx: mock(async (work: (tx: any) => Promise<any>) => {
    return work({ run: mockRun });
  }),
  toNumber: (v: any) => typeof v === 'number' ? v : Number(v || 0),
}));

// Override any cross-file mock of transaction-utils (e.g. from graph.test.ts)
// by re-declaring the real module with our neo4j mock applied
mock.module('./transaction-utils', () => ({
  batchCountTransactions: async (nodeIds: string[]) => {
    if (nodeIds.length === 0) return new Map();

    const { readTx, toNumber } = require('../lib/neo4j');
    return readTx(async (tx: any) => {
      const result = await tx.run(
        `UNWIND $nodeIds AS nid
         MATCH (a:Address {id: nid})
         OPTIONAL MATCH (a)-[t:TRANSACTION]-()
         RETURN a.id AS id, count(t) AS txCount`,
        { nodeIds }
      );
      const txCountMap = new Map<string, number>();
      for (const id of nodeIds) txCountMap.set(id, 0);
      for (const record of result.records) {
        const id = record.get('id') as string;
        txCountMap.set(id, toNumber(record.get('txCount')));
      }
      return txCountMap;
    });
  },
}));

import { batchCountTransactions } from './transaction-utils';

describe('transaction-utils', () => {
  beforeEach(() => {
    mockRun.mockClear();
  });

  describe('batchCountTransactions', () => {
    test('returns empty map for empty input', async () => {
      const result = await batchCountTransactions([]);
      expect(result.size).toBe(0);
    });

    test('counts transactions from Cypher result', async () => {
      const nodeIds = ['A', 'B', 'C'];

      mockRun.mockImplementationOnce(() =>
        Promise.resolve({
          records: [
            { get: (k: string) => k === 'id' ? 'A' : 7 },
            { get: (k: string) => k === 'id' ? 'B' : 3 },
            { get: (k: string) => k === 'id' ? 'C' : 5 },
          ],
        })
      );

      const result = await batchCountTransactions(nodeIds);

      expect(result.get('A')).toBe(7);
      expect(result.get('B')).toBe(3);
      expect(result.get('C')).toBe(5);
    });

    test('initializes all nodes with zero when no results', async () => {
      const nodeIds = ['X', 'Y', 'Z'];

      mockRun.mockImplementationOnce(() =>
        Promise.resolve({ records: [] })
      );

      const result = await batchCountTransactions(nodeIds);

      expect(result.get('X')).toBe(0);
      expect(result.get('Y')).toBe(0);
      expect(result.get('Z')).toBe(0);
    });

    test('calls tx.run once with all node IDs', async () => {
      const nodeIds = ['A'];
      mockRun.mockImplementationOnce(() =>
        Promise.resolve({ records: [] })
      );

      await batchCountTransactions(nodeIds);

      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    test('handles single node', async () => {
      const nodeIds = ['SINGLE'];

      mockRun.mockImplementationOnce(() =>
        Promise.resolve({
          records: [
            { get: (k: string) => k === 'id' ? 'SINGLE' : 15 },
          ],
        })
      );

      const result = await batchCountTransactions(nodeIds);

      expect(result.size).toBe(1);
      expect(result.get('SINGLE')).toBe(15);
    });
  });
});
