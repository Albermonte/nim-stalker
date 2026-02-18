import neo4j from 'neo4j-driver';
import { readTx, writeTx, runAutoCommit, toNumber } from '../lib/neo4j';
import { getNimiqService, type TransactionData } from './nimiq-rpc';
import { addressCache } from '../lib/address-cache';
import { jobTracker } from '../lib/job-tracker';
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

  // Ensure all addresses exist (chunked)
  for (const batch of chunk(Array.from(uniqueAddresses), BATCH_SIZE)) {
    await writeTx(async (tx) => {
      await tx.run(
        `UNWIND $addresses AS addr MERGE (a:Address {id: addr})`,
        { addresses: batch }
      );
    });
  }

  // Write transactions (chunked, MERGE avoids duplicates)
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
    await writeTx(async (tx) => {
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
 * Update edge aggregates after indexing.
 * Aggregates TRANSACTION relationships into TRANSACTED_WITH summary relationships.
 */
export async function updateEdgeAggregates(address: string) {
  await writeTx(async (tx) => {
    // Outgoing transaction aggregates
    await tx.run(
      `MATCH (a:Address {id: $addr})-[t:TRANSACTION]->(b:Address)
       WITH a, b, count(t) AS cnt, sum(toInteger(t.value)) AS total,
            min(t.timestamp) AS firstTx, max(t.timestamp) AS lastTx
       MERGE (a)-[r:TRANSACTED_WITH]->(b)
       SET r.txCount = cnt, r.totalValue = toString(total),
           r.firstTxAt = firstTx, r.lastTxAt = lastTx`,
      { addr: address }
    );

    // Incoming transaction aggregates
    await tx.run(
      `MATCH (b:Address)-[t:TRANSACTION]->(a:Address {id: $addr})
       WITH a, b, count(t) AS cnt, sum(toInteger(t.value)) AS total,
            min(t.timestamp) AS firstTx, max(t.timestamp) AS lastTx
       MERGE (b)-[r:TRANSACTED_WITH]->(a)
       SET r.txCount = cnt, r.totalValue = toString(total),
           r.firstTxAt = firstTx, r.lastTxAt = lastTx`,
      { addr: address }
    );

    // Store txCount on the Address node
    await tx.run(
      `MATCH (a:Address {id: $addr})
       OPTIONAL MATCH (a)-[t:TRANSACTION]-()
       WITH a, count(DISTINCT t) AS cnt
       SET a.txCount = cnt`,
      { addr: address }
    );
  });
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
 * Run the full indexing pipeline for an address.
 * Fetches transactions from RPC and stores them in Neo4j.
 */
export async function runIndexing(formattedAddr: string, isIncremental: boolean) {
  const nimiq = getNimiqService();

  try {
    // Update status to indexing in DB
    await writeTx(async (tx) => {
      await tx.run(
        `MERGE (a:Address {id: $id})
         ON CREATE SET a.indexStatus = 'INDEXING'
         ON MATCH SET a.indexStatus = 'INDEXING'`,
        { id: formattedAddr }
      );
    });

    // Fetch fresh account data
    let accountData: { type: string; balance: number } | null = null;
    try {
      accountData = await nimiq.getAccount(formattedAddr);
    } catch {
      // Continue with indexing even if account fetch fails
    }

    // Stream-process transactions in batches to avoid RAM spikes
    let totalIndexed = 0;
    let firstTx: Date | null = null;
    let lastTx: Date | null = null;

    const onBatch = async (txs: TransactionData[]) => {
      const result = await writeTransactionBatch(txs);
      totalIndexed += result.count;
      jobTracker.updateProgress(formattedAddr, result.count);
      if (result.firstTx && (!firstTx || result.firstTx < firstTx)) firstTx = result.firstTx;
      if (result.lastTx && (!lastTx || result.lastTx > lastTx)) lastTx = result.lastTx;
    };

    try {
      if (isIncremental) {
        const checkHashesExist = async (hashes: string[]): Promise<Set<string>> => {
          return readTx(async (tx) => {
            const result = await tx.run(
              `UNWIND $hashes AS h
               OPTIONAL MATCH (:Address {id: $id})-[t:TRANSACTION {hash: h}]-()
               WITH h, t WHERE t IS NOT NULL
               RETURN h AS hash`,
              { id: formattedAddr, hashes }
            );
            return new Set(result.records.map((r) => r.get('hash') as string));
          });
        };

        const existingCount = await readTx(async (tx) => {
          const result = await tx.run(
            `MATCH (:Address {id: $id})-[t:TRANSACTION]-()
             RETURN count(t) AS cnt`,
            { id: formattedAddr }
          );
          return toNumber(result.records[0]?.get('cnt')) || 0;
        });
        console.log(`[index] Incremental mode for ${formattedAddr}: ~${existingCount} existing txs`);
        await nimiq.getNewTransactionsWithDbCheck(formattedAddr, checkHashesExist, onBatch);

        const oldestHashResult = await readTx(async (tx) => {
          const result = await tx.run(
            `CALL {
               MATCH (a:Address {id: $id})-[t:TRANSACTION]->()
               RETURN t.hash AS hash, t.timestamp AS ts
               UNION ALL
               MATCH (a:Address {id: $id})<-[t:TRANSACTION]-()
               RETURN t.hash AS hash, t.timestamp AS ts
             }
             RETURN hash
             ORDER BY ts ASC
             LIMIT 1`,
            { id: formattedAddr }
          );
          return result.records.length > 0 ? result.records[0].get('hash') as string : null;
        });

        if (oldestHashResult) {
          const recoveredCount = await nimiq.getRemainingTransactionsWithDbCheck(formattedAddr, oldestHashResult, checkHashesExist, onBatch);
          if (recoveredCount > 0) {
            console.log(`[index] Recovered ${recoveredCount} older transactions for ${formattedAddr}`);
          }
        }
      } else {
        console.log(`[index] Full index mode for ${formattedAddr}`);
        await nimiq.getAllTransactions(formattedAddr, onBatch);
      }
    } catch {
      // If transaction fetch fails, treat as no transactions
    }

    if (totalIndexed === 0) {
      await writeTx(async (tx) => {
        await tx.run(
          `MATCH (a:Address {id: $id})
           SET a.indexStatus = 'COMPLETE', a.indexedAt = $now, a.txCount = 0
           ${accountData ? ', a.type = $type, a.balance = $balance' : ''}`,
          {
            id: formattedAddr,
            now: new Date().toISOString(),
            ...(accountData && {
              type: mapAccountType(accountData.type),
              balance: accountData.balance.toString(),
            }),
          }
        );
      });
      jobTracker.completeJob(formattedAddr, 0);
      return;
    }

    // Update address with index status and fresh account data
    await writeTx(async (tx) => {
      await tx.run(
        `MATCH (a:Address {id: $id})
         SET a.indexStatus = 'COMPLETE', a.indexedAt = $now,
             a.firstSeenAt = $firstSeenAt, a.lastSeenAt = $lastSeenAt
             ${accountData ? ', a.type = $type, a.balance = $balance' : ''}`,
        {
          id: formattedAddr,
          now: new Date().toISOString(),
          firstSeenAt: firstTx?.toISOString() || null,
          lastSeenAt: lastTx?.toISOString() || null,
          ...(accountData && {
            type: mapAccountType(accountData.type),
            balance: accountData.balance.toString(),
          }),
        }
      );
    });

    // Update edge aggregates
    await updateEdgeAggregates(formattedAddr);

    // Invalidate cache
    addressCache.invalidate(formattedAddr);

    jobTracker.completeJob(formattedAddr, totalIndexed);
  } catch (error) {
    console.error('[index] Background indexing failed:', {
      address: formattedAddr,
      error: error instanceof Error ? error.message : error,
    });
    // Mark as error in DB
    await writeTx(async (tx) => {
      await tx.run(
        `MATCH (a:Address {id: $id}) SET a.indexStatus = 'ERROR'`,
        { id: formattedAddr }
      );
    }).catch(() => {});
    jobTracker.failJob(formattedAddr, error instanceof Error ? error.message : 'Unknown error');
    throw error;
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

/**
 * Get the current index status of an address from Neo4j.
 */
export async function getIndexStatus(address: string): Promise<string | null> {
  return readTx(async (tx) => {
    const result = await tx.run(
      `MATCH (a:Address {id: $id}) RETURN a.indexStatus AS status`,
      { id: address }
    );
    return result.records.length > 0 ? result.records[0].get('status') as string | null : null;
  });
}

/**
 * Wait for an address that is currently being indexed to finish.
 * Polls Neo4j every second until status changes from INDEXING.
 */
async function waitForIndexing(address: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const status = await getIndexStatus(address);
    if (status !== 'INDEXING') return;
  }
}

/**
 * Ensure an address is fully indexed. If not, triggers indexing and waits for completion.
 * If indexing is already in progress (by another request), waits for it to finish.
 */
export async function ensureAddressIndexed(address: string): Promise<void> {
  const status = await getIndexStatus(address);

  // Already indexed
  if (status === 'COMPLETE') return;

  // Currently being indexed by another request — wait for it
  if (status === 'INDEXING' || jobTracker.hasJob(address)) {
    console.log(`[ensureIndexed] Waiting for in-progress indexing: ${address}`);
    await waitForIndexing(address);
    return;
  }

  // Not indexed (PENDING, ERROR, or not in DB) — run indexing and wait
  console.log(`[ensureIndexed] Indexing address: ${address} (status: ${status ?? 'not found'})`);
  const isIncremental = false;
  jobTracker.startJob(address, isIncremental);
  await runIndexing(address, isIncremental);
}
