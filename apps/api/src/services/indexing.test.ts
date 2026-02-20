import { beforeEach, describe, expect, mock, test } from 'bun:test';

const runMock = mock(async () => ({ records: [] }));
const writeTxMock = mock(async (work: (tx: { run: typeof runMock }) => Promise<unknown>) => {
  return work({ run: runMock });
});

mock.module('../lib/neo4j', () => ({
  writeTx: writeTxMock,
  readTx: mock(async () => 0),
  runAutoCommit: mock(async () => ({ records: [] })),
  toNumber: (value: unknown) => Number(value ?? 0),
}));

import { updateEdgeAggregatesForPairs } from './indexing';

describe('updateEdgeAggregatesForPairs', () => {
  beforeEach(() => {
    runMock.mockClear();
    writeTxMock.mockClear();
  });

  test('updates Address.txCount without DISTINCT aggregation', async () => {
    await updateEdgeAggregatesForPairs([{ from: 'NQ01', to: 'NQ02' }]);

    const queries = runMock.mock.calls.map((call) => String(call[0]));
    const txCountQuery = queries.find((query) => query.includes('SET a.txCount ='));

    expect(txCountQuery).toBeDefined();
    expect(txCountQuery).toContain('OPTIONAL MATCH (a)-[out:TRANSACTION]->()');
    expect(txCountQuery).toContain('OPTIONAL MATCH (a)<-[inc:TRANSACTION]-()');
    expect(txCountQuery).toContain('OPTIONAL MATCH (a)-[self:TRANSACTION]->(a)');
    expect(txCountQuery).toContain('outgoing + incoming - count(self) AS cnt');
    expect(txCountQuery).not.toContain('count(DISTINCT t)');
  });
});
