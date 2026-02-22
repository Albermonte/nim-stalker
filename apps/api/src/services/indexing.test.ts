import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const runMock = mock(async () => ({ records: [] }));
const writeTxMock = mock(async (work: (tx: { run: typeof runMock }) => Promise<unknown>) => {
  return work({ run: runMock });
});
const readTxMock = mock(async () => 0);
const runAutoCommitMock = mock(async () => ({ records: [] }));

function makeIds(count: number, offset: number): string[] {
  return Array.from({ length: count }, (_, i) => `NQ${String(offset + i).padStart(8, '0')}`);
}

mock.module('../lib/neo4j', () => ({
  writeTx: writeTxMock,
  readTx: readTxMock,
  runAutoCommit: runAutoCommitMock,
  toNumber: (value: unknown) => Number(value ?? 0),
}));

import { rebuildAllEdgeAggregates, updateEdgeAggregatesForPairs } from './indexing';

describe('updateEdgeAggregatesForPairs', () => {
  const originalUpdateAddressTxCount = process.env.UPDATE_ADDRESS_TXCOUNT_ON_PAIR_UPDATE;

  beforeEach(() => {
    runMock.mockClear();
    writeTxMock.mockClear();
    readTxMock.mockClear();
    runAutoCommitMock.mockClear();
    process.env.UPDATE_ADDRESS_TXCOUNT_ON_PAIR_UPDATE = 'true';
  });

  afterEach(() => {
    if (originalUpdateAddressTxCount == null) {
      delete process.env.UPDATE_ADDRESS_TXCOUNT_ON_PAIR_UPDATE;
    } else {
      process.env.UPDATE_ADDRESS_TXCOUNT_ON_PAIR_UPDATE = originalUpdateAddressTxCount;
    }
  });

  test('updates Address.txCount from TRANSACTED_WITH aggregates without DISTINCT aggregation', async () => {
    await updateEdgeAggregatesForPairs([{ from: 'NQ01', to: 'NQ02' }]);

    const queries = runMock.mock.calls.map((call) => String(call[0]));
    const txCountQuery = queries.find((query) => query.includes('SET a.txCount ='));

    expect(txCountQuery).toBeDefined();
    expect(txCountQuery).toContain('OPTIONAL MATCH (a)-[out:TRANSACTED_WITH]->()');
    expect(txCountQuery).toContain('OPTIONAL MATCH (a)<-[inc:TRANSACTED_WITH]-()');
    expect(txCountQuery).toContain('OPTIONAL MATCH (a)-[self:TRANSACTED_WITH]->(a)');
    expect(txCountQuery).toContain('WITH a, outgoing, incoming, coalesce(sum(self.txCount), 0) AS selfTx');
    expect(txCountQuery).toContain('outgoing + incoming - selfTx AS cnt');
    expect(txCountQuery).not.toContain('count(DISTINCT t)');
  });

  test('skips Address.txCount update when UPDATE_ADDRESS_TXCOUNT_ON_PAIR_UPDATE=false', async () => {
    process.env.UPDATE_ADDRESS_TXCOUNT_ON_PAIR_UPDATE = 'false';
    await updateEdgeAggregatesForPairs([{ from: 'NQ01', to: 'NQ02' }]);

    const queries = runMock.mock.calls.map((call) => String(call[0]));
    const txCountQuery = queries.find((query) => query.includes('SET a.txCount ='));
    expect(txCountQuery).toBeUndefined();
  });
});

describe('rebuildAllEdgeAggregates', () => {
  beforeEach(() => {
    readTxMock.mockReset();
    runAutoCommitMock.mockReset();
    runAutoCommitMock.mockResolvedValue({ records: [] });
    process.env.REBUILD_PHASE1_CHUNK_SIZE = '1000';
    process.env.REBUILD_PHASE1_ROWS_PER_TX = '250';
    process.env.REBUILD_PHASE2_CHUNK_SIZE = '1000';
    process.env.REBUILD_PHASE2_ROWS_PER_TX = '250';
    process.env.REBUILD_CHUNK_RETRY_ATTEMPTS = '3';
    process.env.REBUILD_CHUNK_RETRY_BASE_DELAY_MS = '0';
    process.env.REBUILD_CHUNK_RETRY_MAX_DELAY_MS = '0';
    process.env.REBUILD_STRATEGY = 'keyset';
  });

  test('retries retriable Neo4j errors for a chunk and continues rebuild', async () => {
    readTxMock
      .mockResolvedValueOnce(1000) // total count
      .mockResolvedValueOnce(makeIds(1000, 0)) // phase1 page 1
      .mockResolvedValueOnce([]) // phase1 end
      .mockResolvedValueOnce(makeIds(1000, 0)) // phase2 page 1
      .mockResolvedValueOnce([]); // phase2 end

    const transient = Object.assign(new Error('Connection lost. Server did not respond in time'), {
      code: 'ServiceUnavailable',
      retriable: true,
    });
    runAutoCommitMock.mockRejectedValueOnce(transient);

    await expect(rebuildAllEdgeAggregates()).resolves.toBeUndefined();
    expect(runAutoCommitMock).toHaveBeenCalledTimes(3);
  });

  test('honors rebuild chunk sizing and rows-per-transaction tuning from env', async () => {
    readTxMock
      .mockResolvedValueOnce(2500) // total count
      .mockResolvedValueOnce(makeIds(1000, 0))
      .mockResolvedValueOnce(makeIds(1000, 1000))
      .mockResolvedValueOnce(makeIds(500, 2000))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(makeIds(1000, 0))
      .mockResolvedValueOnce(makeIds(1000, 1000))
      .mockResolvedValueOnce(makeIds(500, 2000))
      .mockResolvedValueOnce([]);

    process.env.REBUILD_PHASE1_CHUNK_SIZE = '1000';
    process.env.REBUILD_PHASE1_ROWS_PER_TX = '111';
    process.env.REBUILD_PHASE2_CHUNK_SIZE = '1000';
    process.env.REBUILD_PHASE2_ROWS_PER_TX = '222';

    await expect(rebuildAllEdgeAggregates()).resolves.toBeUndefined();

    expect(runAutoCommitMock).toHaveBeenCalledTimes(6);
    expect(String(runAutoCommitMock.mock.calls[0]?.[0])).toContain('IN TRANSACTIONS OF 111 ROWS');
    expect(String(runAutoCommitMock.mock.calls[3]?.[0])).toContain('IN TRANSACTIONS OF 222 ROWS');
  });

  test('uses keyset pagination and subtracts self-transfers in rebuild phase 2', async () => {
    readTxMock
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(makeIds(1000, 0))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(makeIds(1000, 0))
      .mockResolvedValueOnce([]);

    await expect(rebuildAllEdgeAggregates()).resolves.toBeUndefined();

    const phase1Query = String(runAutoCommitMock.mock.calls[0]?.[0]);
    const phase2Query = String(runAutoCommitMock.mock.calls[1]?.[0]);

    expect(phase1Query).toContain('UNWIND $ids AS addrId');
    expect(phase1Query).not.toContain('SKIP $skip');
    expect(phase2Query).toContain('OPTIONAL MATCH (a)-[self:TRANSACTION]->(a)');
    expect(phase2Query).toContain('outgoing + incoming - selfTx AS cnt');
  });
});
