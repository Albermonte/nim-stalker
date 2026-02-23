import { Elysia, t } from 'elysia';
import type { PaginatedResponse, TransactionResponse } from '@nim-stalker/shared';
import { readTx, toNumber, toBigIntString, toISOString } from '../lib/neo4j';
import { getNimiqService } from '../services/nimiq-rpc';
import { formatAddress } from '../lib/address-utils';
import { getRecentTransactions } from '../services/transactions';

function parsePositiveInteger(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

const RECENT_TX_DB_TIMEOUT_MS = 1_500;
const RECENT_TX_RPC_SCAN_BLOCKS = 250;
const RECENT_TX_FALLBACK_LOG_THROTTLE_MS = 60_000;

let lastRecentTxFallbackLogAt = 0;

function shouldLogRecentTxFallback(nowMs: number): boolean {
  if (nowMs - lastRecentTxFallbackLogAt < RECENT_TX_FALLBACK_LOG_THROTTLE_MS) {
    return false;
  }
  lastRecentTxFallbackLogAt = nowMs;
  return true;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`recent-transactions timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function toSafeIso(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return new Date(0).toISOString();
  try {
    return new Date(ms).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

async function getRecentTransactionsFromRpc(options: {
  page: number;
  pageSize: number;
}): Promise<PaginatedResponse<TransactionResponse>> {
  const { page, pageSize } = options;
  const skip = (page - 1) * pageSize;
  const required = skip + pageSize + 1;

  const rpc = getNimiqService();
  let blockNumber = await rpc.getBlockNumber();
  let scanned = 0;
  const entries: TransactionResponse[] = [];

  while (blockNumber >= 0 && scanned < RECENT_TX_RPC_SCAN_BLOCKS && entries.length < required) {
    const block = await rpc.getBlockByNumber(blockNumber, true);
    scanned += 1;

    if (Array.isArray(block.transactions) && block.transactions.length > 0) {
      for (const tx of block.transactions) {
        const item: TransactionResponse = {
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: String(tx.value ?? 0),
          fee: String(tx.fee ?? 0),
          blockNumber: tx.blockNumber ?? block.number,
          timestamp: toSafeIso(tx.timestamp),
        };
        const payload = tx.senderData || tx.recipientData;
        if (payload) item.data = payload;
        entries.push(item);
      }
    }

    blockNumber -= 1;
  }

  entries.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber;
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
    return a.hash < b.hash ? 1 : -1;
  });

  const hasMore = entries.length > skip + pageSize;
  const data = entries.slice(skip, skip + pageSize);
  const total = skip + data.length + (hasMore ? 1 : 0);

  return {
    data,
    total,
    page,
    pageSize,
    hasMore,
  };
}

export const transactionRoutes = new Elysia()
  .get('/transactions/recent', async ({ query, set }) => {
    const pageParam = query.page;
    const pageSizeParam = query.pageSize;
    const startedAt = Date.now();

    const page = pageParam == null ? 1 : parsePositiveInteger(pageParam);
    const pageSize = pageSizeParam == null ? 50 : parsePositiveInteger(pageSizeParam);

    if (page == null) {
      set.status = 400;
      return { error: 'Invalid page. Expected a positive integer.' };
    }
    if (pageSize == null) {
      set.status = 400;
      return { error: 'Invalid pageSize. Expected a positive integer.' };
    }

    try {
      const result = await withTimeout(
        getRecentTransactions({ page, pageSize }),
        RECENT_TX_DB_TIMEOUT_MS,
      );
      return result;
    } catch (err) {
      const nowMs = Date.now();
      const dbDurationMs = nowMs - startedAt;
      const dbError = err instanceof Error ? err.message : String(err);
      const logFallback = shouldLogRecentTxFallback(nowMs);
      if (logFallback) {
        console.warn('[GET /transactions/recent] Neo4j lookup failed, falling back to RPC', {
          page,
          pageSize,
          dbDurationMs,
          error: dbError,
        });
      }

      try {
        const fallback = await getRecentTransactionsFromRpc({ page, pageSize });
        if (logFallback) {
          console.warn('[GET /transactions/recent] served from RPC fallback', {
            page,
            pageSize,
            totalDurationMs: Date.now() - startedAt,
            fallbackCount: fallback.data.length,
          });
        }
        return fallback;
      } catch (fallbackErr) {
        const durationMs = Date.now() - startedAt;
        console.error('[GET /transactions/recent] failed', {
          page,
          pageSize,
          durationMs,
          dbError,
          fallbackError: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
        set.status = 500;
        return {
          error: fallbackErr instanceof Error
            ? fallbackErr.message
            : 'Failed to fetch recent transactions',
        };
      }
    }
  })
  .get(
    '/transaction/:hash',
    async ({ params, set }) => {
      const { hash } = params;

      // Validate hash format (64 hex characters)
      if (!/^[a-fA-F0-9]{64}$/.test(hash)) {
        set.status = 400;
        return { error: 'Invalid transaction hash format. Expected 64 hex characters.' };
      }

      try {
        // Try Neo4j first
        const dbResult = await readTx(async (tx) => {
          const res = await tx.run(
            `MATCH (from:Address)-[t:TRANSACTION {hash: $hash}]->(to:Address)
             RETURN from.id AS fromAddr, to.id AS toAddr,
                    t.hash AS hash, t.value AS value, t.fee AS fee,
                    t.blockNumber AS blockNumber, t.timestamp AS timestamp, t.data AS data`,
            { hash },
          );

          if (res.records.length === 0) return null;

          const record = res.records[0];
          return {
            hash: record.get('hash'),
            from: record.get('fromAddr'),
            to: record.get('toAddr'),
            value: toBigIntString(record.get('value')),
            fee: toBigIntString(record.get('fee')),
            blockNumber: toNumber(record.get('blockNumber')),
            timestamp: toISOString(record.get('timestamp')),
            data: record.get('data') ?? null,
          };
        });

        if (dbResult) {
          return dbResult;
        }

        // Not in DB — fetch from RPC node
        const rpc = getNimiqService();
        const rpcTx = await rpc.getTransactionByHash(hash);

        if (!rpcTx) {
          set.status = 404;
          return { error: 'Transaction not found.' };
        }

        return {
          hash: rpcTx.hash,
          from: formatAddress(rpcTx.from),
          to: formatAddress(rpcTx.to),
          value: String(rpcTx.value),
          fee: String(rpcTx.fee),
          blockNumber: rpcTx.blockNumber,
          timestamp: rpcTx.timestamp ? new Date(rpcTx.timestamp * 1000).toISOString() : null,
          data: rpcTx.senderData || rpcTx.recipientData || null,
        };
      } catch (err) {
        set.status = 500;
        return { error: err instanceof Error ? err.message : 'Failed to fetch transaction' };
      }
    },
    {
      params: t.Object({
        hash: t.String(),
      }),
    },
  );
