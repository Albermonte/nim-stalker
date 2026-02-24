import { Elysia, t } from 'elysia';
import { getGraphService } from '../services/graph';
import { getPathFinder } from '../services/path-finder';
import { getSubgraphFinder } from '../services/subgraph-finder';
import { getEverythingService } from '../services/everything';
import { getNimiqService } from '../services/nimiq-rpc';
import { isValidNimiqAddress, formatAddress, truncateAddress } from '../lib/address-utils';
import { getAddressLabelService } from '../lib/address-labels';
import { poolAll } from '../lib/concurrency';
import { enforceSensitiveEndpointPolicy } from '../lib/security';

export const graphRoutes = new Elysia({ prefix: '/graph' })
  // POST /graph/expand - Expand graph from address(es)
  .post(
    '/expand',
    async ({ body, set }) => {
      const { addresses, direction, filters } = body;

      // Validate all addresses
      const invalidAddresses = addresses.filter((addr) => !isValidNimiqAddress(addr));
      if (invalidAddresses.length > 0) {
        set.status = 400;
        return { error: 'Invalid address format', invalidAddresses };
      }

      // Format addresses
      const formattedAddresses = addresses.map(formatAddress);

      let minValue: bigint | undefined;
      let maxValue: bigint | undefined;

      if (filters?.minValue != null) {
        if (!/^\d+$/.test(filters.minValue)) {
          set.status = 400;
          return { error: 'Invalid minValue: expected a positive integer string' };
        }
        minValue = BigInt(filters.minValue);
      }

      if (filters?.maxValue != null) {
        if (!/^\d+$/.test(filters.maxValue)) {
          set.status = 400;
          return { error: 'Invalid maxValue: expected a positive integer string' };
        }
        maxValue = BigInt(filters.maxValue);
      }

      if (minValue != null && maxValue != null && minValue > maxValue) {
        set.status = 400;
        return { error: 'Invalid value range: minValue cannot be greater than maxValue' };
      }

      try {
        const graphService = getGraphService();
        const result = await graphService.expand({
          addresses: formattedAddresses,
          direction: direction || 'both',
          filters: filters
            ? {
                minTimestamp: filters.minTimestamp,
                maxTimestamp: filters.maxTimestamp,
                minValue,
                maxValue,
                limit: filters.limit,
              }
            : undefined,
        });

        return result;
      } catch (error) {
        console.error('[POST /graph/expand] Failed to expand graph:', {
          addresses: formattedAddresses,
          direction,
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to expand graph' };
      }
    },
    {
      body: t.Object({
        addresses: t.Array(t.String(), { minItems: 1, maxItems: 50 }),
        direction: t.Optional(
          t.Union([t.Literal('incoming'), t.Literal('outgoing'), t.Literal('both')])
        ),
        filters: t.Optional(
          t.Object({
            minTimestamp: t.Optional(t.Number()),
            maxTimestamp: t.Optional(t.Number()),
            minValue: t.Optional(t.String()),
            maxValue: t.Optional(t.String()),
            limit: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
          })
        ),
      }),
    }
  )
  // GET /graph/path - Find shortest path between two addresses
  .get(
    '/path',
    async ({ query, set }) => {
      const { from, to, maxDepth } = query;

      // Validate addresses
      if (!isValidNimiqAddress(from) || !isValidNimiqAddress(to)) {
        set.status = 400;
        return { error: 'Invalid address format' };
      }

      const fromFormatted = formatAddress(from);
      const toFormatted = formatAddress(to);

      if (fromFormatted === toFormatted) {
        set.status = 400;
        return { error: 'Source and target addresses must be different' };
      }

      try {
        const pathFinder = getPathFinder();
        const result = await pathFinder.findPath(fromFormatted, toFormatted, maxDepth);
        return result;
      } catch (error) {
        console.error('[GET /graph/path] Failed to find path:', {
          from: fromFormatted,
          to: toFormatted,
          maxDepth,
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to find path' };
      }
    },
    {
      query: t.Object({
        from: t.String(),
        to: t.String(),
        maxDepth: t.Optional(t.Number({ minimum: 1, maximum: 10, default: 6 })),
      }),
    }
  )
  // GET /graph/subgraph - Find all nodes and edges on any path between two addresses
  .get(
    '/subgraph',
    async ({ query, set, request }) => {
      const policyError = enforceSensitiveEndpointPolicy(request, set, 'graph-subgraph');
      if (policyError) {
        return policyError;
      }

      const { from, to, maxHops, directed } = query;

      // Validate addresses
      if (!isValidNimiqAddress(from) || !isValidNimiqAddress(to)) {
        set.status = 400;
        return { error: 'Invalid address format' };
      }

      const fromFormatted = formatAddress(from);
      const toFormatted = formatAddress(to);

      if (fromFormatted === toFormatted) {
        set.status = 400;
        return { error: 'Source and target addresses must be different' };
      }

      try {
        const subgraphFinder = getSubgraphFinder();
        const result = await subgraphFinder.findSubgraph(fromFormatted, toFormatted, maxHops, directed);
        return result;
      } catch (error) {
        console.error('[GET /graph/subgraph] Failed to find subgraph:', {
          from: fromFormatted,
          to: toFormatted,
          maxHops,
          directed,
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to find subgraph' };
      }
    },
    {
      query: t.Object({
        from: t.String(),
        to: t.String(),
        maxHops: t.Optional(t.Number({ minimum: 1, maximum: 10, default: 3 })),
        directed: t.Optional(t.Boolean({ default: false })),
      }),
    }
  )
  // GET /graph/nodes - Get node details by IDs
  .get(
    '/nodes',
    async ({ query, set }) => {
      const ids = query.ids?.split(',').map((id) => id.trim()) || [];

      if (ids.length === 0) {
        set.status = 400;
        return { error: 'No node IDs provided' };
      }

      if (ids.length > 100) {
        set.status = 400;
        return { error: 'Too many node IDs (max 100)' };
      }

      // Validate all addresses
      const invalidIds = ids.filter((id) => !isValidNimiqAddress(id));
      if (invalidIds.length > 0) {
        set.status = 400;
        return { error: 'Invalid address format', invalidIds };
      }

      const formattedIds = ids.map(formatAddress);

      try {
        const graphService = getGraphService();
        const nodes = await graphService.getNodes(formattedIds);
        return { nodes };
      } catch (error) {
        console.error('[GET /graph/nodes] Failed to get nodes:', {
          nodeCount: formattedIds.length,
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to get nodes' };
      }
    },
    {
      query: t.Object({
        ids: t.String(),
      }),
    }
  )
  // GET /graph/latest-blocks - Get graph data from latest blocks
  // Retries fetching older blocks if no transactions found (max 6 iterations = 60 blocks)
  .get(
    '/latest-blocks',
    async ({ query, set, request }) => {
      const policyError = enforceSensitiveEndpointPolicy(request, set, 'graph-latest-blocks');
      if (policyError) {
        return policyError;
      }

      const blocksPerBatch = query.count || 10;
      const maxLoops = 6;

      try {
        const nimiqService = getNimiqService();
        const latestBlock = await nimiqService.getBlockNumber();

        const nodeIds = new Set<string>();
        const edgeMap = new Map<string, { from: string; to: string; txCount: number; totalValue: bigint; firstTxAt: number; lastTxAt: number }>();

        let currentStartBlock = latestBlock;
        let loopCount = 0;

        // Loop until we find transactions or hit max loops
        while (edgeMap.size === 0 && loopCount < maxLoops) {
          // Fetch blocks with concurrency limit to avoid overwhelming RPC
          const blockTasks: Array<() => Promise<any>> = [];
          for (let i = 0; i < blocksPerBatch; i++) {
            const blockNum = currentStartBlock - i;
            if (blockNum < 0) break; // Don't go below genesis
            blockTasks.push(() => nimiqService.getBlockByNumber(blockNum));
          }
          const blocks = await poolAll(blockTasks, 5);

          // Aggregate transactions to graph format
          for (const block of blocks) {
            for (const tx of block.transactions) {
              if (!tx.from || !tx.to) continue;

              const fromFormatted = formatAddress(tx.from);
              const toFormatted = formatAddress(tx.to);

              nodeIds.add(fromFormatted);
              nodeIds.add(toFormatted);

              const edgeKey = `${fromFormatted}->${toFormatted}`;
              const existing = edgeMap.get(edgeKey);
              if (existing) {
                existing.txCount++;
                existing.totalValue += BigInt(tx.value);
                existing.firstTxAt = Math.min(existing.firstTxAt, tx.timestamp);
                existing.lastTxAt = Math.max(existing.lastTxAt, tx.timestamp);
              } else {
                edgeMap.set(edgeKey, {
                  from: fromFormatted,
                  to: toFormatted,
                  txCount: 1,
                  totalValue: BigInt(tx.value),
                  firstTxAt: tx.timestamp,
                  lastTxAt: tx.timestamp,
                });
              }
            }
          }

          // Move to next batch of older blocks
          currentStartBlock -= blocksPerBatch;
          loopCount++;
        }

        // Build Cytoscape format response
        const labelService = getAddressLabelService();
        const nodes = Array.from(nodeIds).map((id) => ({
          data: {
            id,
            label: labelService.getLabel(id) || truncateAddress(id),
            icon: labelService.getIcon(id) || undefined,
            type: 'UNKNOWN',
            balance: '0',
            txCount: 0,
          },
        }));

        const edges = Array.from(edgeMap.entries()).map(([key, agg]) => ({
          data: {
            id: key,
            source: agg.from,
            target: agg.to,
            txCount: agg.txCount,
            totalValue: agg.totalValue.toString(),
            firstTxAt: new Date(agg.firstTxAt * 1000).toISOString(),
            lastTxAt: new Date(agg.lastTxAt * 1000).toISOString(),
          },
        }));

        return { nodes, edges };
      } catch (error) {
        console.error('[GET /graph/latest-blocks] Failed to fetch latest blocks:', {
          blocksPerBatch,
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to fetch latest blocks' };
      }
    },
    {
      query: t.Object({
        count: t.Optional(t.Number({ minimum: 1, maximum: 50 })),
      }),
    }
  )
  // GET /graph/everything/count - Get total node and edge counts
  .get(
    '/everything/count',
    async ({ set, request }) => {
      const policyError = enforceSensitiveEndpointPolicy(request, set, 'graph-everything-count');
      if (policyError) {
        return policyError;
      }

      try {
        const service = getEverythingService();
        return await service.getCounts();
      } catch (error) {
        console.error('[GET /graph/everything/count] Failed to get counts:', {
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to get counts' };
      }
    }
  )
  // GET /graph/everything/nodes - Get paginated batch of all nodes
  .get(
    '/everything/nodes',
    async ({ query, set, request }) => {
      const policyError = enforceSensitiveEndpointPolicy(request, set, 'graph-everything-nodes');
      if (policyError) {
        return policyError;
      }

      const skip = query.skip ?? 0;
      const limit = Math.min(query.limit ?? 200, 500);

      try {
        const service = getEverythingService();
        const nodes = await service.getNodeBatch(skip, limit);
        return { nodes };
      } catch (error) {
        console.error('[GET /graph/everything/nodes] Failed to get nodes:', {
          skip,
          limit,
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to get nodes' };
      }
    },
    {
      query: t.Object({
        skip: t.Optional(t.Number({ minimum: 0 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
      }),
    }
  )
  // GET /graph/everything/edges - Get paginated batch of all edges
  .get(
    '/everything/edges',
    async ({ query, set, request }) => {
      const policyError = enforceSensitiveEndpointPolicy(request, set, 'graph-everything-edges');
      if (policyError) {
        return policyError;
      }

      const skip = query.skip ?? 0;
      const limit = Math.min(query.limit ?? 500, 1000);

      try {
        const service = getEverythingService();
        const edges = await service.getEdgeBatch(skip, limit);
        return { edges };
      } catch (error) {
        console.error('[GET /graph/everything/edges] Failed to get edges:', {
          skip,
          limit,
          error: error instanceof Error ? error.message : error,
        });
        set.status = 500;
        return { error: 'Failed to get edges' };
      }
    },
    {
      query: t.Object({
        skip: t.Optional(t.Number({ minimum: 0 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 1000 })),
      }),
    }
  );
