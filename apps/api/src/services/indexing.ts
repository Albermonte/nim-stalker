import neo4j from 'neo4j-driver';
import { writeTx, runAutoCommit, toNumber } from '../lib/neo4j';
import { type TransactionData } from './nimiq-rpc';
import { AddressType } from '@nim-stalker/shared';

const BATCH_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

interface BatchWriteResult {
  count: number;
  firstTx: Date | null;
  lastTx: Date | null;
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

/**
 * Write a batch of transactions to Neo4j.
 * Filters valid txs, ensures addresses exist, and writes TRANSACTION relationships.
 */
export async function writeTransactionBatch(txs: TransactionData[]): Promise<BatchWriteResult> {
  const validTxs = txs.filter((tx) => tx.from && tx.to);
  if (validTxs.length === 0) return { count: 0, firstTx: null, lastTx: null };

  let firstTx: Date | null = null;
  let lastTx: Date | null = null;
  const uniqueAddresses = new Set<string>();

  for (const tx of validTxs) {
    uniqueAddresses.add(tx.from);
    uniqueAddresses.add(tx.to);
    const ts = new Date(tx.timestamp);
    if (!firstTx || ts < firstTx) firstTx = ts;
    if (!lastTx || ts > lastTx) lastTx = ts;
  }

  // Write addresses + transactions in a single transaction per chunk
  const mappedTxs = validTxs.map((tx) => ({
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
    await writeTx(async (tx) => {
      // Ensure addresses exist, then write transactions — single session
      await tx.run(
        `UNWIND $addresses AS addr MERGE (a:Address {id: addr})`,
        { addresses: batchAddresses }
      );
      await tx.run(
        `UNWIND $txs AS item
         MATCH (from:Address {id: item.fromId})
         MATCH (to:Address {id: item.toId})
         MERGE (from)-[t:TRANSACTION {hash: item.hash}]->(to)
         ON CREATE SET t.value = item.value, t.fee = item.fee,
                       t.blockNumber = item.blockNumber, t.timestamp = item.timestamp,
                       t.data = item.data`,
        { txs: batch }
      );
    });
  }

  return { count: validTxs.length, firstTx, lastTx };
}

/**
 * Update edge aggregates for specific address pairs.
 * Used by the blockchain indexer after processing a batch of transactions.
 * More efficient than updateEdgeAggregates() which scans all edges for a single address.
 */
export async function updateEdgeAggregatesForPairs(
  pairs: Array<{ from: string; to: string }>
): Promise<void> {
  if (pairs.length === 0) return;

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
  for (const batch of chunk(uniquePairs, BATCH_SIZE)) {
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

  // Update txCount on affected address nodes
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
         OPTIONAL MATCH (a)-[t:TRANSACTION]-()
         WITH a, count(DISTINCT t) AS cnt
         SET a.txCount = cnt`,
        { addresses: batch }
      );
    });
  }
}

/**
 * Recompute TRANSACTED_WITH and Address.txCount from raw TRANSACTION edges.
 * Intended for full backfill completion when per-batch aggregate updates are deferred.
 */
export async function rebuildAllEdgeAggregates(): Promise<void> {
  // Batched: uses CALL {} IN TRANSACTIONS to avoid loading entire graph in one tx.
  // Requires auto-commit mode (cannot run inside executeWrite).
  await runAutoCommit(
    `MATCH (a:Address)-[t:TRANSACTION]->(b:Address)
     WITH a, b, count(t) AS cnt, sum(toInteger(t.value)) AS total,
          min(t.timestamp) AS firstTx, max(t.timestamp) AS lastTx
     CALL {
       WITH a, b, cnt, total, firstTx, lastTx
       MERGE (a)-[r:TRANSACTED_WITH]->(b)
       SET r.txCount = cnt, r.totalValue = toString(total),
           r.firstTxAt = firstTx, r.lastTxAt = lastTx
     } IN TRANSACTIONS OF 10000 ROWS`
  );

  await runAutoCommit(
    `MATCH (a:Address)
     OPTIONAL MATCH (a)-[t:TRANSACTION]-()
     WITH a, count(DISTINCT t) AS cnt
     CALL {
       WITH a, cnt
       SET a.txCount = cnt
     } IN TRANSACTIONS OF 10000 ROWS`
  );
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

