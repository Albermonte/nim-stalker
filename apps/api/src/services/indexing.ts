import neo4j from 'neo4j-driver';
import { writeTx, readTx, runAutoCommit, toBigIntString, toNumber } from '../lib/neo4j';
import { type TransactionData } from './nimiq-rpc';
import { AddressType } from '@nim-stalker/shared';

const BATCH_SIZE = 500;
const RETRIABLE_NEO4J_CODES = new Set(['ServiceUnavailable', 'SessionExpired']);

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

interface RebuildTuning {
  phase1ChunkSize: number;
  phase1RowsPerTx: number;
  phase2ChunkSize: number;
  phase2RowsPerTx: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  strategy: 'keyset' | 'apoc';
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseRebuildStrategy(value: string | undefined): 'keyset' | 'apoc' {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'apoc' ? 'apoc' : 'keyset';
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseRebuildTuning(env: NodeJS.ProcessEnv): RebuildTuning {
  return {
    phase1ChunkSize: parsePositiveIntEnv(env.REBUILD_PHASE1_CHUNK_SIZE, 1_000),
    phase1RowsPerTx: parsePositiveIntEnv(env.REBUILD_PHASE1_ROWS_PER_TX, 250),
    phase2ChunkSize: parsePositiveIntEnv(env.REBUILD_PHASE2_CHUNK_SIZE, 1_000),
    phase2RowsPerTx: parsePositiveIntEnv(env.REBUILD_PHASE2_ROWS_PER_TX, 250),
    retryAttempts: parsePositiveIntEnv(env.REBUILD_CHUNK_RETRY_ATTEMPTS, 3),
    retryBaseDelayMs: parseNonNegativeIntEnv(env.REBUILD_CHUNK_RETRY_BASE_DELAY_MS, 2_000),
    retryMaxDelayMs: parsePositiveIntEnv(env.REBUILD_CHUNK_RETRY_MAX_DELAY_MS, 30_000),
    strategy: parseRebuildStrategy(env.REBUILD_STRATEGY),
  };
}

function isRetriableNeo4jError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const withCode = error as { code?: unknown; retriable?: unknown };
  if (withCode.retriable === true) return true;
  return typeof withCode.code === 'string' && RETRIABLE_NEO4J_CODES.has(withCode.code);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runRebuildChunkWithRetry(
  query: string,
  params: Record<string, unknown>,
  context: string,
  tuning: RebuildTuning
): Promise<void> {
  for (let attempt = 1; attempt <= tuning.retryAttempts; attempt++) {
    try {
      await runAutoCommit(query, params);
      return;
    } catch (error) {
      if (!isRetriableNeo4jError(error) || attempt >= tuning.retryAttempts) throw error;
      const delay = Math.min(
        tuning.retryBaseDelayMs * 2 ** (attempt - 1),
        tuning.retryMaxDelayMs
      );
      console.warn(
        `[rebuild] ${context} failed (${getErrorMessage(error)}); retrying in ${(
          delay / 1000
        ).toFixed(1)}s (attempt ${attempt + 1}/${tuning.retryAttempts})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

interface BatchWriteResult {
  // Total valid txs received in this batch (for batch metadata/progress)
  count: number;
  // Number of newly created TRANSACTION edges (dedup-aware)
  insertedCount: number;
  firstTx: Date | null;
  lastTx: Date | null;
  aggregateDeltas: AggregateDelta[];
}

export interface AggregateDelta {
  from: string;
  to: string;
  txCount: number;
  totalValue: string;
  firstTxAt: string;
  lastTxAt: string;
}

const ACCOUNT_TYPE_MAP: Record<string, AddressType> = {
  BASIC: AddressType.BASIC,
  HTLC: AddressType.HTLC,
  VESTING: AddressType.VESTING,
  STAKING: AddressType.STAKING,
};

export function mapAccountType(rpcType: string | undefined): AddressType {
  if (!rpcType) return AddressType.UNKNOWN;
  return ACCOUNT_TYPE_MAP[rpcType.toUpperCase()] ?? AddressType.UNKNOWN;
}

function mergeAggregateDelta(
  target: AggregateDelta,
  incoming: AggregateDelta
): AggregateDelta {
  target.txCount += incoming.txCount;
  target.totalValue = (BigInt(target.totalValue) + BigInt(incoming.totalValue)).toString();
  if (incoming.firstTxAt < target.firstTxAt) target.firstTxAt = incoming.firstTxAt;
  if (incoming.lastTxAt > target.lastTxAt) target.lastTxAt = incoming.lastTxAt;
  return target;
}

/**
 * Write a batch of transactions to Neo4j.
 * Filters valid txs, ensures addresses exist, and writes TRANSACTION relationships.
 */
export async function writeTransactionBatch(txs: TransactionData[]): Promise<BatchWriteResult> {
  const validTxs = txs.filter((tx) => tx.from && tx.to);
  if (validTxs.length === 0) {
    return { count: 0, insertedCount: 0, firstTx: null, lastTx: null, aggregateDeltas: [] };
  }

  // Deduplicate by transaction hash before writing to avoid duplicate rows
  // inflating aggregate deltas in a single batch operation.
  const uniqueByHash = new Map<string, TransactionData>();
  for (const tx of validTxs) {
    if (!uniqueByHash.has(tx.hash)) {
      uniqueByHash.set(tx.hash, tx);
    }
  }
  const dedupedTxs = Array.from(uniqueByHash.values());

  let firstTx: Date | null = null;
  let lastTx: Date | null = null;
  const deltaByPair = new Map<string, AggregateDelta>();
  let createdCount = 0;

  for (const tx of dedupedTxs) {
    const ts = new Date(tx.timestamp);
    if (!firstTx || ts < firstTx) firstTx = ts;
    if (!lastTx || ts > lastTx) lastTx = ts;
  }

  // Write addresses + transactions in a single transaction per chunk
  const mappedTxs = dedupedTxs.map((tx) => ({
    hash: tx.hash,
    fromId: tx.from,
    toId: tx.to,
    value: tx.value.toString(),
    fee: (tx.fee || 0).toString(),
    blockNumber: neo4j.int(tx.blockNumber),
    timestamp: new Date(tx.timestamp).toISOString(),
    data: tx.recipientData || null,
  }));

  for (const batch of chunk(mappedTxs, BATCH_SIZE)) {
    const batchAddresses = Array.from(new Set(batch.flatMap((tx) => [tx.fromId, tx.toId])));
    const opId = crypto.randomUUID();
    const createdPerPair = await writeTx(async (tx) => {
      // Ensure addresses exist, then write transactions — single session
      await tx.run(
        `UNWIND $addresses AS addr MERGE (a:Address {id: addr})`,
        { addresses: batchAddresses }
      );
      const created = await tx.run(
        `UNWIND $txs AS item
         MATCH (from:Address {id: item.fromId})
         MATCH (to:Address {id: item.toId})
         MERGE (from)-[t:TRANSACTION {hash: item.hash}]->(to)
         ON CREATE SET t.value = item.value, t.fee = item.fee,
                       t.blockNumber = item.blockNumber, t.timestamp = item.timestamp,
                       t.data = item.data, t.__opId = $opId
         WITH from.id AS fromId, to.id AS toId, item, t
         WHERE t.__opId = $opId
         WITH fromId, toId,
              count(*) AS txCount,
              sum(toInteger(item.value)) AS totalValue,
              min(item.timestamp) AS firstTxAt,
              max(item.timestamp) AS lastTxAt,
              collect(t) AS createdRels
         FOREACH (rel IN createdRels | REMOVE rel.__opId)
         RETURN fromId, toId,
                txCount,
                totalValue,
                firstTxAt,
                lastTxAt`,
        { txs: batch, opId }
      );

      return created.records.map((record) => ({
        from: String(record.get('fromId')),
        to: String(record.get('toId')),
        txCount: toNumber(record.get('txCount')),
        totalValue: toBigIntString(record.get('totalValue')),
        firstTxAt: String(record.get('firstTxAt')),
        lastTxAt: String(record.get('lastTxAt')),
      }));
    });

    for (const delta of createdPerPair) {
      createdCount += delta.txCount;
      const key = `${delta.from}->${delta.to}`;
      const current = deltaByPair.get(key);
      if (current) {
        mergeAggregateDelta(current, delta);
      } else {
        deltaByPair.set(key, { ...delta });
      }
    }
  }

  return {
    count: dedupedTxs.length,
    insertedCount: createdCount,
    firstTx,
    lastTx,
    aggregateDeltas: Array.from(deltaByPair.values()),
  };
}

/**
 * Incrementally update TRANSACTED_WITH aggregates from newly created
 * TRANSACTION deltas. This avoids expensive re-scans of TRANSACTION edges.
 */
export async function updateEdgeAggregatesFromDeltas(
  deltas: AggregateDelta[]
): Promise<void> {
  if (deltas.length === 0) return;
  const pairChunkSize = parsePositiveIntEnv(process.env.EDGE_AGGREGATE_PAIR_CHUNK_SIZE, 5);

  for (const batch of chunk(deltas, pairChunkSize)) {
    await writeTx(async (tx) => {
      await tx.run(
        `UNWIND $deltas AS delta
         MATCH (a:Address {id: delta.from})
         MATCH (b:Address {id: delta.to})
         MERGE (a)-[r:TRANSACTED_WITH]->(b)
         SET r.txCount = coalesce(r.txCount, 0) + toInteger(delta.txCount),
             r.totalValue = toString(coalesce(toInteger(r.totalValue), 0) + toInteger(delta.totalValue)),
             r.firstTxAt = CASE
               WHEN r.firstTxAt IS NULL OR delta.firstTxAt < r.firstTxAt THEN delta.firstTxAt
               ELSE r.firstTxAt
             END,
             r.lastTxAt = CASE
               WHEN r.lastTxAt IS NULL OR delta.lastTxAt > r.lastTxAt THEN delta.lastTxAt
               ELSE r.lastTxAt
             END`,
        { deltas: batch }
      );
    });
  }

  if (!parseBooleanEnv(process.env.UPDATE_ADDRESS_TXCOUNT_ON_PAIR_UPDATE, false)) {
    return;
  }

  const addressIncrements = new Map<string, number>();
  for (const delta of deltas) {
    addressIncrements.set(delta.from, (addressIncrements.get(delta.from) ?? 0) + delta.txCount);
    addressIncrements.set(delta.to, (addressIncrements.get(delta.to) ?? 0) + delta.txCount);
    if (delta.from === delta.to) {
      addressIncrements.set(delta.from, (addressIncrements.get(delta.from) ?? 0) - delta.txCount);
    }
  }

  const rows = Array.from(addressIncrements.entries())
    .filter(([, increment]) => increment !== 0)
    .map(([address, increment]) => ({ address, increment }));

  if (rows.length === 0) return;

  for (const batch of chunk(rows, BATCH_SIZE)) {
    await writeTx(async (tx) => {
      await tx.run(
        `UNWIND $rows AS row
         MATCH (a:Address {id: row.address})
         SET a.txCount = coalesce(a.txCount, 0) + toInteger(row.increment)`,
        { rows: batch }
      );
    });
  }
}

/**
 * Recompute TRANSACTED_WITH aggregates for specific address pairs by scanning
 * raw TRANSACTION edges. Kept for maintenance tooling and tests.
 */
export async function updateEdgeAggregatesForPairs(
  pairs: Array<{ from: string; to: string }>
): Promise<void> {
  if (pairs.length === 0) return;
  const pairChunkSize = parsePositiveIntEnv(process.env.EDGE_AGGREGATE_PAIR_CHUNK_SIZE, 5);

  // Deduplicate pairs
  const seen = new Set<string>();
  const uniquePairs: Array<{ from: string; to: string }> = [];
  for (const p of pairs) {
    const key = `${p.from}->${p.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePairs.push(p);
    }
  }

  // Update TRANSACTED_WITH for each unique pair
  for (const batch of chunk(uniquePairs, pairChunkSize)) {
    await writeTx(async (tx) => {
      await tx.run(
        `UNWIND $pairs AS pair
         MATCH (a:Address {id: pair.from})-[t:TRANSACTION]->(b:Address {id: pair.to})
         WITH a, b, count(t) AS cnt, sum(toInteger(t.value)) AS total,
              min(t.timestamp) AS firstTx, max(t.timestamp) AS lastTx
         MERGE (a)-[r:TRANSACTED_WITH]->(b)
         SET r.txCount = cnt, r.totalValue = toString(total),
             r.firstTxAt = firstTx, r.lastTxAt = lastTx`,
        { pairs: batch }
      );
    });
  }

  // Optional: update Address.txCount on affected nodes.
  // Disabled by default to keep live/gap-repair updates cheap on high-degree addresses.
  if (!parseBooleanEnv(process.env.UPDATE_ADDRESS_TXCOUNT_ON_PAIR_UPDATE, false)) {
    return;
  }

  // Uses TRANSACTED_WITH aggregates to avoid scanning all raw TRANSACTION edges.
  const allAddresses = new Set<string>();
  for (const p of uniquePairs) {
    allAddresses.add(p.from);
    allAddresses.add(p.to);
  }

  for (const batch of chunk(Array.from(allAddresses), BATCH_SIZE)) {
    await writeTx(async (tx) => {
      await tx.run(
        `UNWIND $addresses AS addr
         MATCH (a:Address {id: addr})
         OPTIONAL MATCH (a)-[out:TRANSACTED_WITH]->()
         WITH a, coalesce(sum(out.txCount), 0) AS outgoing
         OPTIONAL MATCH (a)<-[inc:TRANSACTED_WITH]-()
         WITH a, outgoing, coalesce(sum(inc.txCount), 0) AS incoming
         OPTIONAL MATCH (a)-[self:TRANSACTED_WITH]->(a)
         WITH a, outgoing, incoming, coalesce(sum(self.txCount), 0) AS selfTx
         WITH a, outgoing + incoming - selfTx AS cnt
         SET a.txCount = cnt`,
        { addresses: batch }
      );
    });
  }
}

/**
 * Recompute TRANSACTED_WITH and Address.txCount from raw TRANSACTION edges.
 * Intended for full backfill completion when per-batch aggregate updates are deferred.
 *
 * Uses keyset pagination by Address.id to avoid deep SKIP/OFFSET scans.
 */
export async function rebuildAllEdgeAggregates(): Promise<void> {
  const tuning = parseRebuildTuning(process.env);
  const start = Date.now();

  // Count total addresses for progress logging and loop bound
  const countResult = await readTx(async (tx) => {
    const res = await tx.run('MATCH (a:Address) RETURN count(a) AS total');
    return toNumber(res.records[0]?.get('total'));
  });
  console.log(`[rebuild] ${countResult} addresses to process`);
  if (countResult === 0) return;

  if (tuning.strategy === 'apoc') {
    try {
      await runApocRebuild(tuning);
      const totalElapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[rebuild] Complete in ${totalElapsed}s`);
      return;
    } catch (error) {
      console.warn(`[rebuild] APOC strategy failed (${getErrorMessage(error)}), falling back to keyset strategy`);
    }
  }

  const loadAddressIdsPage = async (
    lastId: string | null,
    limit: number
  ): Promise<string[]> => {
    return await readTx(async (tx) => {
      const res = await tx.run(
        `MATCH (a:Address)
         WHERE $lastId IS NULL OR a.id > $lastId
         RETURN a.id AS id
         ORDER BY a.id
         LIMIT $limit`,
        {
          lastId,
          limit: neo4j.int(limit),
        }
      );
      return res.records.map((record) => String(record.get('id')));
    });
  };

  const phase1Query = `UNWIND $ids AS addrId
       MATCH (a:Address {id: addrId})-[t:TRANSACTION]->(b:Address)
       WITH a, b, count(t) AS cnt, sum(toInteger(t.value)) AS total,
            min(t.timestamp) AS firstTx, max(t.timestamp) AS lastTx
       CALL {
         WITH a, b, cnt, total, firstTx, lastTx
         MERGE (a)-[r:TRANSACTED_WITH]->(b)
         SET r.txCount = cnt, r.totalValue = toString(total),
             r.firstTxAt = firstTx, r.lastTxAt = lastTx
       } IN TRANSACTIONS OF ${tuning.phase1RowsPerTx} ROWS`;

  let processed = 0;
  let cursor: string | null = null;
  while (true) {
    const ids = await loadAddressIdsPage(cursor, tuning.phase1ChunkSize);
    if (ids.length === 0) break;

    await runRebuildChunkWithRetry(
      phase1Query,
      { ids },
      `Phase 1 cursor ${cursor ?? '<start>'} (+${ids.length})`,
      tuning
    );
    processed += ids.length;
    cursor = ids[ids.length - 1];
    const pct = ((processed / countResult) * 100).toFixed(1);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[rebuild] Phase 1/2: TRANSACTED_WITH — ${processed}/${countResult} (${pct}%) — ${elapsed}s`);
  }

  const phase2Query = `UNWIND $ids AS addrId
       MATCH (a:Address {id: addrId})
       OPTIONAL MATCH (a)-[out:TRANSACTION]->()
       WITH a, count(out) AS outgoing
       OPTIONAL MATCH (a)<-[inc:TRANSACTION]-()
       WITH a, outgoing, count(inc) AS incoming
       OPTIONAL MATCH (a)-[self:TRANSACTION]->(a)
       WITH a, outgoing, incoming, count(self) AS selfTx
       WITH a, outgoing + incoming - selfTx AS cnt
       CALL {
         WITH a, cnt
         SET a.txCount = cnt
       } IN TRANSACTIONS OF ${tuning.phase2RowsPerTx} ROWS`;

  const phase2Start = Date.now();
  processed = 0;
  cursor = null;
  while (true) {
    const ids = await loadAddressIdsPage(cursor, tuning.phase2ChunkSize);
    if (ids.length === 0) break;

    await runRebuildChunkWithRetry(
      phase2Query,
      { ids },
      `Phase 2 cursor ${cursor ?? '<start>'} (+${ids.length})`,
      tuning
    );
    processed += ids.length;
    cursor = ids[ids.length - 1];
    const pct = ((processed / countResult) * 100).toFixed(1);
    const elapsed = ((Date.now() - phase2Start) / 1000).toFixed(1);
    console.log(`[rebuild] Phase 2/2: txCount — ${processed}/${countResult} (${pct}%) — ${elapsed}s`);
  }

  const totalElapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[rebuild] Complete in ${totalElapsed}s`);
}

async function runApocRebuild(tuning: RebuildTuning): Promise<void> {
  console.log('[rebuild] Running APOC strategy');

  const phase1 = await runAutoCommit(
    `CALL apoc.periodic.iterate(
       "MATCH (a:Address) RETURN a",
       "MATCH (a)-[t:TRANSACTION]->(b:Address)
        WITH a, b, count(t) AS cnt, sum(toInteger(t.value)) AS total,
             min(t.timestamp) AS firstTx, max(t.timestamp) AS lastTx
        MERGE (a)-[r:TRANSACTED_WITH]->(b)
        SET r.txCount = cnt, r.totalValue = toString(total),
            r.firstTxAt = firstTx, r.lastTxAt = lastTx",
       {batchSize: $phase1BatchSize, parallel: false, retries: $retries}
     )
     YIELD failedBatches, errorMessages
     RETURN failedBatches, errorMessages`,
    {
      phase1BatchSize: neo4j.int(tuning.phase1ChunkSize),
      retries: neo4j.int(Math.max(0, tuning.retryAttempts - 1)),
    }
  );

  const phase1Failed = toNumber(phase1.records[0]?.get('failedBatches'));
  if (phase1Failed > 0) {
    throw new Error(`APOC phase 1 failed batches: ${phase1Failed}`);
  }

  const phase2 = await runAutoCommit(
    `CALL apoc.periodic.iterate(
       "MATCH (a:Address) RETURN a",
       "OPTIONAL MATCH (a)-[out:TRANSACTION]->()
        WITH a, count(out) AS outgoing
        OPTIONAL MATCH (a)<-[inc:TRANSACTION]-()
        WITH a, outgoing, count(inc) AS incoming
        OPTIONAL MATCH (a)-[self:TRANSACTION]->(a)
        WITH a, outgoing, incoming, count(self) AS selfTx
        WITH a, outgoing + incoming - selfTx AS cnt
        SET a.txCount = cnt",
       {batchSize: $phase2BatchSize, parallel: false, retries: $retries}
     )
     YIELD failedBatches, errorMessages
     RETURN failedBatches, errorMessages`,
    {
      phase2BatchSize: neo4j.int(tuning.phase2ChunkSize),
      retries: neo4j.int(Math.max(0, tuning.retryAttempts - 1)),
    }
  );

  const phase2Failed = toNumber(phase2.records[0]?.get('failedBatches'));
  if (phase2Failed > 0) {
    throw new Error(`APOC phase 2 failed batches: ${phase2Failed}`);
  }

  console.log('[rebuild] APOC strategy complete');
}

/**
 * Update balances for a batch of addresses.
 * Used by the live indexer to update address balances after processing a block.
 */
export async function updateAddressBalances(
  entries: Array<{ address: string; balance: string }>
): Promise<void> {
  if (entries.length === 0) return;

  for (const batch of chunk(entries, BATCH_SIZE)) {
    await writeTx(async (tx) => {
      await tx.run(
        `UNWIND $entries AS entry
         MATCH (a:Address {id: entry.address})
         SET a.balance = entry.balance`,
        { entries: batch.map(e => ({ address: e.address, balance: e.balance })) }
      );
    });
  }
}

/**
 * Mark all backfilled addresses (have TRANSACTION relationships but no indexStatus) as COMPLETE.
 * Run after backfill completes and on every startup as self-healing.
 */
export async function markBackfilledAddressesComplete(): Promise<number> {
  // Batched: uses CALL {} IN TRANSACTIONS to avoid a single large write tx
  // when 100K+ addresses need updating after a full backfill.
  const res = await runAutoCommit(
    `MATCH (a:Address)
     WHERE a.indexStatus IS NULL
       AND EXISTS { (a)-[:TRANSACTION]-() }
     WITH a, $now AS now
     CALL {
       WITH a, now
       SET a.indexStatus = 'COMPLETE',
           a.indexedAt = now
     } IN TRANSACTIONS OF 10000 ROWS
     RETURN count(a) AS updated`,
    { now: new Date().toISOString() }
  );
  const result = toNumber(res.records[0]?.get('updated')) || 0;
  if (result > 0) console.log(`[backfill] Marked ${result} addresses as COMPLETE`);
  return result;
}
