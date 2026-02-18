import { Elysia, t } from 'elysia';
import neo4j from 'neo4j-driver';
import { readTx, writeTx, toNumber, toBigIntString, toISOString } from '../lib/neo4j';
import { getNimiqService } from '../services/nimiq-rpc';
import { isValidNimiqAddress, formatAddress } from '../lib/address-utils';
import { getAddressLabelService } from '../lib/address-labels';
import { addressCache } from '../lib/address-cache';
import { AddressType } from '@nim-stalker/shared';
import { mapAccountType } from '../services/indexing';

export const addressRoutes = new Elysia({ prefix: '/address' })
  // GET /address/:addr - Get address metadata
  .get(
    '/:addr',
    async ({ params, set }) => {
      const { addr } = params;

      if (!isValidNimiqAddress(addr)) {
        set.status = 400;
        return { error: 'Invalid Nimiq address format' };
      }

      const formattedAddr = formatAddress(addr);

      try {
        // Check cache first
        const cached = addressCache.get<any>(formattedAddr);
        if (cached) return cached;

        // Check if address exists in DB
        let address = await readTx(async (tx) => {
          const result = await tx.run(
            `MATCH (a:Address {id: $id}) RETURN a`,
            { id: formattedAddr }
          );
          return result.records.length > 0 ? result.records[0].get('a').properties : null;
        });

        // If not in DB, fetch from RPC and create
        if (!address) {
          const nimiq = getNimiqService();
          let type = AddressType.UNKNOWN;
          let balance = '0';

          try {
            const account = await nimiq.getAccount(formattedAddr);
            type = mapAccountType(account?.type);
            balance = (account?.balance || 0).toString();
          } catch {
            // If RPC fails, continue with defaults
          }

          address = await writeTx(async (tx) => {
            const result = await tx.run(
              `MERGE (a:Address {id: $id})
               ON CREATE SET a.type = $type, a.balance = $balance, a.indexStatus = 'PENDING'
               RETURN a`,
              { id: formattedAddr, type, balance }
            );
            return result.records[0].get('a').properties;
          });
        }

        const labelService = getAddressLabelService();
        const response = {
          id: address.id,
          type: address.type || 'UNKNOWN',
          label: labelService.getLabel(address.id) || address.label || null,
          icon: labelService.getIcon(address.id) || undefined,
          balance: toBigIntString(address.balance),
          firstSeenAt: toISOString(address.firstSeenAt),
          lastSeenAt: toISOString(address.lastSeenAt),
          indexStatus: address.indexStatus || 'PENDING',
          indexedAt: toISOString(address.indexedAt),
          txCount: toNumber(address.txCount),
        };

        if (address.indexStatus === 'COMPLETE') {
          addressCache.set(formattedAddr, response);
        }

        return response;
      } catch (error) {
        console.error('[GET /address/:addr] Failed to fetch address:', {
          address: formattedAddr,
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to fetch address' };
      }
    },
    {
      params: t.Object({
        addr: t.String(),
      }),
    }
  )
  // GET /address/:addr/transactions - Get paginated transactions
  .get(
    '/:addr/transactions',
    async ({ params, query, set }) => {
      const { addr } = params;
      const page = query.page ?? 1;
      const pageSize = Math.min(query.pageSize ?? 50, 100);
      const direction = query.direction ?? 'both';

      if (!isValidNimiqAddress(addr)) {
        set.status = 400;
        return { error: 'Invalid Nimiq address format' };
      }

      const formattedAddr = formatAddress(addr);

      try {
        // Build direction match
        // "both" uses undirected match anchored on Address.id (single index lookup,
        // traverses both directions in one pass — faster than UNION which materializes everything)
        let matchClause: string;
        if (direction === 'incoming') {
          matchClause = 'MATCH (from:Address)-[t:TRANSACTION]->(to:Address {id: $addr})';
        } else if (direction === 'outgoing') {
          matchClause = 'MATCH (from:Address {id: $addr})-[t:TRANSACTION]->(to:Address)';
        } else {
          matchClause = 'MATCH (:Address {id: $addr})-[t:TRANSACTION]-(other:Address)';
        }

        // "both" needs startNode/endNode to preserve relationship direction
        const returnFromTo = direction === 'both'
          ? 'startNode(t).id AS fromId, endNode(t).id AS toId'
          : 'from.id AS fromId, to.id AS toId';

        // Build filter conditions
        const conditions: string[] = [];
        const params: Record<string, unknown> = {
          addr: formattedAddr,
          skip: neo4j.int((page - 1) * pageSize),
          limit: neo4j.int(pageSize),
        };

        if (query.minTimestamp) {
          conditions.push('t.timestamp >= $minTimestamp');
          params.minTimestamp = new Date(query.minTimestamp).toISOString();
        }
        if (query.maxTimestamp) {
          conditions.push('t.timestamp <= $maxTimestamp');
          params.maxTimestamp = new Date(query.maxTimestamp).toISOString();
        }
        if (query.minValue) {
          conditions.push('t.value >= $minValue');
          params.minValue = query.minValue;
        }
        if (query.maxValue) {
          conditions.push('t.value <= $maxValue');
          params.maxValue = query.maxValue;
        }

        const whereExtra = conditions.length > 0
          ? ' WHERE ' + conditions.join(' AND ')
          : '';

        // Fast path: when no filters and direction=both, read stored txCount from the Address node
        // instead of scanning all relationships. Run count + data in a single session.
        const hasFilters = conditions.length > 0;
        const canUseStoredCount = !hasFilters && direction === 'both';

        const { totalResult, txResult } = await readTx(async (tx) => {
          // Count: use stored property when possible (O(1) vs O(n) relationship scan)
          let total: number;
          if (canUseStoredCount) {
            const countResult = await tx.run(
              `MATCH (a:Address {id: $addr}) RETURN a.txCount AS total`,
              { addr: formattedAddr }
            );
            const stored = countResult.records[0]?.get('total');
            // Fall back to relationship count if txCount not yet populated
            if (stored != null) {
              total = toNumber(stored);
            } else {
              const fallback = await tx.run(
                `MATCH (:Address {id: $addr})-[t:TRANSACTION]-() RETURN count(t) AS total`,
                { addr: formattedAddr }
              );
              total = toNumber(fallback.records[0]?.get('total'));
            }
          } else {
            const countResult = await tx.run(
              `${matchClause}${whereExtra} RETURN count(t) AS total`,
              params
            );
            total = toNumber(countResult.records[0]?.get('total'));
          }

          const dataResult = await tx.run(
            `${matchClause}${whereExtra}
             RETURN t.hash AS hash, ${returnFromTo},
                    t.value AS value, t.fee AS fee, t.blockNumber AS blockNumber,
                    t.timestamp AS timestamp, t.data AS data
             ORDER BY t.timestamp DESC
             SKIP $skip LIMIT $limit`,
            params
          );

          return { totalResult: total, txResult: dataResult.records };
        });

        return {
          data: txResult.map((rec) => ({
            hash: rec.get('hash') as string,
            from: rec.get('fromId') as string,
            to: rec.get('toId') as string,
            value: toBigIntString(rec.get('value')),
            fee: toBigIntString(rec.get('fee')),
            blockNumber: toNumber(rec.get('blockNumber')),
            timestamp: toISOString(rec.get('timestamp'))!,
            data: rec.get('data') as string | null,
          })),
          total: totalResult,
          page,
          pageSize,
          hasMore: page * pageSize < totalResult,
        };
      } catch (error) {
        console.error('[GET /address/:addr/transactions] Failed to fetch transactions:', {
          address: formattedAddr,
          page,
          pageSize,
          direction,
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to fetch transactions' };
      }
    },
    {
      params: t.Object({
        addr: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.Number({ minimum: 1 })),
        pageSize: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
        direction: t.Optional(t.Union([
          t.Literal('incoming'),
          t.Literal('outgoing'),
          t.Literal('both'),
        ])),
        minTimestamp: t.Optional(t.Number()),
        maxTimestamp: t.Optional(t.Number()),
        minValue: t.Optional(t.String()),
        maxValue: t.Optional(t.String()),
      }),
    }
  );
