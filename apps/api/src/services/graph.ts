import { readTx, toNumber, toBigIntString, toISOString } from '../lib/neo4j';
import type { Direction, FilterState, GraphResponse } from '@nim-stalker/shared';
import { truncateAddress } from '../lib/address-utils';
import { getAddressLabelService } from '../lib/address-labels';

interface ExpandOptions {
  addresses: string[];
  direction: Direction;
  filters?: FilterState;
}

export class GraphService {
  /**
   * Expand graph from given addresses in specified direction
   */
  async expand(options: ExpandOptions): Promise<GraphResponse> {
    const { addresses, direction, filters } = options;
    const limit = filters?.limit ?? 100;

    // Build direction clause for TRANSACTED_WITH
    let matchClause: string;
    if (direction === 'outgoing') {
      matchClause = 'MATCH (a)-[r:TRANSACTED_WITH]->(b) WHERE a.id IN $addresses';
    } else if (direction === 'incoming') {
      matchClause = 'MATCH (a)<-[r:TRANSACTED_WITH]-(b) WHERE a.id IN $addresses';
    } else {
      matchClause = 'MATCH (a)-[r:TRANSACTED_WITH]-(b) WHERE a.id IN $addresses';
    }

    // Build filter conditions
    const conditions: string[] = [];
    const params: Record<string, unknown> = { addresses, limit: neo4jInt(limit) };

    if (filters?.minTimestamp) {
      conditions.push('r.lastTxAt >= $minTimestamp');
      params.minTimestamp = new Date(filters.minTimestamp).toISOString();
    }
    if (filters?.maxTimestamp) {
      conditions.push('r.firstTxAt <= $maxTimestamp');
      params.maxTimestamp = new Date(filters.maxTimestamp).toISOString();
    }
    if (filters?.minValue) {
      conditions.push('r.totalValue >= $minValue');
      params.minValue = filters.minValue.toString();
    }
    if (filters?.maxValue) {
      conditions.push('r.totalValue <= $maxValue');
      params.maxValue = filters.maxValue.toString();
    }

    const whereExtra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

    // For directed queries, use bound variables; for 'both', use startNode/endNode to preserve direction
    const returnClause = direction === 'both'
      ? 'RETURN startNode(r).id AS fromId, endNode(r).id AS toId'
      : direction === 'outgoing'
        ? 'RETURN a.id AS fromId, b.id AS toId'
        : 'RETURN b.id AS fromId, a.id AS toId';

    // Single query: fetch edges with node data inline (eliminates extra DB round-trip)
    // For 'both' direction, use startNode/endNode to get both a and b regardless of direction
    const nodeReturnClause = direction === 'both'
      ? 'startNode(r) AS fromNode, endNode(r) AS toNode'
      : direction === 'outgoing'
        ? 'a AS fromNode, b AS toNode'
        : 'b AS fromNode, a AS toNode';

    const { edgeRecords, seedNodeRecords } = await readTx(async (tx) => {
      const result = await tx.run(
        `${matchClause}${whereExtra}
         RETURN ${nodeReturnClause},
                r.txCount AS txCount, r.totalValue AS totalValue,
                r.firstTxAt AS firstTxAt, r.lastTxAt AS lastTxAt
         ORDER BY r.txCount DESC
         LIMIT $limit`,
        params
      );

      // Also fetch seed nodes that might not appear in edges (isolated nodes)
      const seedResult = await tx.run(
        `MATCH (a:Address) WHERE a.id IN $addresses
         RETURN a.id AS id, a.label AS label, a.type AS type,
                a.balance AS balance, a.txCount AS txCount`,
        { addresses }
      );

      return { edgeRecords: result.records, seedNodeRecords: seedResult.records };
    });

    // Collect nodes from edge results (dedup by id)
    const nodeMap = new Map<string, {
      id: string; label: string | null; type: string;
      balance: string; txCount: number;
    }>();

    // Add seed nodes first
    for (const rec of seedNodeRecords) {
      const id = rec.get('id') as string;
      nodeMap.set(id, {
        id,
        label: rec.get('label') as string | null,
        type: (rec.get('type') as string) || 'UNKNOWN',
        balance: toBigIntString(rec.get('balance')),
        txCount: toNumber(rec.get('txCount')),
      });
    }

    const edges: Array<{
      fromId: string; toId: string; txCount: number;
      totalValue: string; firstTxAt: string; lastTxAt: string;
    }> = [];

    for (const rec of edgeRecords) {
      const fromNode = rec.get('fromNode');
      const toNode = rec.get('toNode');
      const fromProps = fromNode.properties;
      const toProps = toNode.properties;
      const fromId = fromProps.id as string;
      const toId = toProps.id as string;

      // Add nodes if not already present
      if (!nodeMap.has(fromId)) {
        nodeMap.set(fromId, {
          id: fromId,
          label: fromProps.label as string | null,
          type: (fromProps.type as string) || 'UNKNOWN',
          balance: toBigIntString(fromProps.balance),
          txCount: toNumber(fromProps.txCount),
        });
      }
      if (!nodeMap.has(toId)) {
        nodeMap.set(toId, {
          id: toId,
          label: toProps.label as string | null,
          type: (toProps.type as string) || 'UNKNOWN',
          balance: toBigIntString(toProps.balance),
          txCount: toNumber(toProps.txCount),
        });
      }

      edges.push({
        fromId,
        toId,
        txCount: toNumber(rec.get('txCount')),
        totalValue: toBigIntString(rec.get('totalValue')),
        firstTxAt: toISOString(rec.get('firstTxAt'))!,
        lastTxAt: toISOString(rec.get('lastTxAt'))!,
      });
    }

    const labelService = getAddressLabelService();
    const nodes = Array.from(nodeMap.values()).map((details) => ({
      data: {
        id: details.id,
        label: labelService.getLabel(details.id) || details.label || truncateAddress(details.id),
        icon: labelService.getIcon(details.id) || undefined,
        type: details.type,
        balance: details.balance,
        txCount: details.txCount,
      },
    }));

    const formattedEdges = edges.map((edge) => ({
      data: {
        id: `${edge.fromId}-${edge.toId}`,
        source: edge.fromId,
        target: edge.toId,
        txCount: edge.txCount,
        totalValue: edge.totalValue,
        firstTxAt: edge.firstTxAt,
        lastTxAt: edge.lastTxAt,
      },
    }));

    return { nodes, edges: formattedEdges };
  }

  /**
   * Get nodes by IDs with their details
   */
  async getNodes(ids: string[]): Promise<GraphResponse['nodes']> {
    const nodeDetails = await this.fetchNodeDetails(ids);

    const labelService = getAddressLabelService();
    return nodeDetails.map((addr) => ({
      data: {
        id: addr.id,
        label: labelService.getLabel(addr.id) || addr.label || truncateAddress(addr.id),
        icon: labelService.getIcon(addr.id) || undefined,
        type: addr.type,
        balance: addr.balance,
        txCount: addr.txCount,
      },
    }));
  }

  /**
   * Get edges between given nodes
   */
  async getEdges(nodeIds: string[]): Promise<GraphResponse['edges']> {
    return readTx(async (tx) => {
      const result = await tx.run(
        `MATCH (a:Address)-[r:TRANSACTED_WITH]->(b:Address)
         WHERE a.id IN $nodeIds AND b.id IN $nodeIds
         RETURN a.id AS fromId, b.id AS toId, r.txCount AS txCount,
                r.totalValue AS totalValue, r.firstTxAt AS firstTxAt, r.lastTxAt AS lastTxAt`,
        { nodeIds }
      );

      return result.records.map((rec) => ({
        data: {
          id: `${rec.get('fromId')}-${rec.get('toId')}`,
          source: rec.get('fromId') as string,
          target: rec.get('toId') as string,
          txCount: toNumber(rec.get('txCount')),
          totalValue: toBigIntString(rec.get('totalValue')),
          firstTxAt: toISOString(rec.get('firstTxAt'))!,
          lastTxAt: toISOString(rec.get('lastTxAt'))!,
        },
      }));
    });
  }

  /**
   * Fetch Address node properties from Neo4j
   */
  private async fetchNodeDetails(ids: string[]): Promise<Array<{
    id: string;
    label: string | null;
    type: string;
    balance: string;
    txCount: number;
  }>> {
    return readTx(async (tx) => {
      const result = await tx.run(
        `MATCH (a:Address) WHERE a.id IN $ids
         RETURN a.id AS id, a.label AS label, a.type AS type,
                a.balance AS balance, a.txCount AS txCount`,
        { ids }
      );

      return result.records.map((rec) => ({
        id: rec.get('id') as string,
        label: rec.get('label') as string | null,
        type: (rec.get('type') as string) || 'UNKNOWN',
        balance: toBigIntString(rec.get('balance')),
        txCount: toNumber(rec.get('txCount')),
      }));
    });
  }
}

// Helper to create Neo4j-compatible integer params
import neo4j from 'neo4j-driver';
function neo4jInt(value: number) {
  return neo4j.int(value);
}

// Singleton instance
let graphService: GraphService | null = null;

export function getGraphService(): GraphService {
  if (!graphService) {
    graphService = new GraphService();
  }
  return graphService;
}
