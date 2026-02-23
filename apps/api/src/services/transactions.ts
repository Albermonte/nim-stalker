import neo4j from 'neo4j-driver';
import type { PaginatedResponse, TransactionResponse } from '@nim-stalker/shared';
import { readTx, toBigIntString, toISOString, toNumber } from '../lib/neo4j';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface RecentTransactionsOptions {
  page?: number;
  pageSize?: number;
}

export function clampRecentTransactionsOptions(
  options: RecentTransactionsOptions = {}
): Required<RecentTransactionsOptions> {
  const page = options.page && options.page > 0 ? options.page : DEFAULT_PAGE;
  const requestedPageSize = options.pageSize && options.pageSize > 0
    ? options.pageSize
    : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
  return { page, pageSize };
}

function safeNumber(value: unknown, fallback: number = 0): number {
  try {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    return toNumber(value as any);
  } catch {
    return fallback;
  }
}

function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
}

function safeIsoTimestamp(value: unknown): string {
  try {
    return toISOString(value as any) ?? new Date(0).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

export async function getRecentTransactions(
  options: RecentTransactionsOptions = {}
): Promise<PaginatedResponse<TransactionResponse>> {
  const { page, pageSize } = clampRecentTransactionsOptions(options);
  const skip = (page - 1) * pageSize;

  return readTx(async (tx) => {
    const txResult = await tx.run(
      `MATCH ()-[t:TRANSACTION]-()
       RETURN startNode(t).id AS fromAddr, endNode(t).id AS toAddr,
              t.hash AS hash, t.value AS value, t.fee AS fee,
              t.blockNumber AS blockNumber, t.timestamp AS timestamp, t.data AS data
       ORDER BY t.blockNumber DESC
       SKIP $skip LIMIT $limit`,
      {
        skip: neo4j.int(skip),
        limit: neo4j.int(pageSize + 1),
      },
    );

    const hasMore = txResult.records.length > pageSize;
    const pageRecords = hasMore ? txResult.records.slice(0, pageSize) : txResult.records;
    const data = pageRecords.map((record) => {
      const hash = safeString(record.get('hash'));
      const from = safeString(record.get('fromAddr'));
      const to = safeString(record.get('toAddr'));
      const blockNumber = safeNumber(record.get('blockNumber'));
      const timestamp = safeIsoTimestamp(record.get('timestamp'));

      const entry: TransactionResponse = {
        hash,
        from,
        to,
        value: toBigIntString(record.get('value')),
        fee: toBigIntString(record.get('fee')),
        blockNumber,
        timestamp,
      };

      const rawData = record.get('data');
      if (typeof rawData === 'string' && rawData.length > 0) {
        entry.data = rawData;
      }

      return entry;
    });

    // Keep this endpoint fast: avoid an expensive global count in the hot path.
    const total = skip + data.length + (hasMore ? 1 : 0);

    return {
      data,
      total,
      page,
      pageSize,
      hasMore,
    };
  });
}
