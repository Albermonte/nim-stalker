import { readTx, toNumber, toBigIntString, toISOString } from '../lib/neo4j';
import { truncateAddress } from '../lib/address-utils';
import { getAddressLabelService } from '../lib/address-labels';
import type { CytoscapeNode, CytoscapeEdge } from '@nim-stalker/shared';
import neo4j from 'neo4j-driver';

export class EverythingService {
  /**
   * Get total counts of nodes and edges in the graph
   */
  async getCounts(): Promise<{ nodeCount: number; edgeCount: number }> {
    return readTx(async (tx) => {
      const nodeResult = await tx.run('MATCH (a:Address) RETURN count(a) AS cnt');
      const edgeResult = await tx.run('MATCH ()-[r:TRANSACTED_WITH]->() RETURN count(r) AS cnt');

      return {
        nodeCount: toNumber(nodeResult.records[0]?.get('cnt')),
        edgeCount: toNumber(edgeResult.records[0]?.get('cnt')),
      };
    });
  }

  /**
   * Get a paginated batch of nodes
   */
  async getNodeBatch(skip: number, limit: number): Promise<CytoscapeNode[]> {
    const records = await readTx(async (tx) => {
      const result = await tx.run(
        `MATCH (a:Address)
         RETURN a.id AS id, a.label AS label, a.type AS type,
                a.balance AS balance, a.txCount AS txCount
         ORDER BY a.id
         SKIP $skip LIMIT $limit`,
        { skip: neo4j.int(skip), limit: neo4j.int(limit) }
      );
      return result.records;
    });

    const labelService = getAddressLabelService();
    return records.map((rec) => {
      const id = rec.get('id') as string;
      return {
        data: {
          id,
          label: labelService.getLabel(id) || (rec.get('label') as string | null) || truncateAddress(id),
          icon: labelService.getIcon(id) || undefined,
          type: (rec.get('type') as string) || 'UNKNOWN',
          balance: toBigIntString(rec.get('balance')),
          txCount: toNumber(rec.get('txCount')),
        },
      };
    });
  }

  /**
   * Get a paginated batch of edges
   */
  async getEdgeBatch(skip: number, limit: number): Promise<CytoscapeEdge[]> {
    const records = await readTx(async (tx) => {
      const result = await tx.run(
        `MATCH (a:Address)-[r:TRANSACTED_WITH]->(b:Address)
         RETURN a.id AS fromId, b.id AS toId,
                r.txCount AS txCount, r.totalValue AS totalValue,
                r.firstTxAt AS firstTxAt, r.lastTxAt AS lastTxAt
         ORDER BY a.id, b.id
         SKIP $skip LIMIT $limit`,
        { skip: neo4j.int(skip), limit: neo4j.int(limit) }
      );
      return result.records;
    });

    return records.map((rec) => {
      const fromId = rec.get('fromId') as string;
      const toId = rec.get('toId') as string;
      return {
        data: {
          id: `${fromId}-${toId}`,
          source: fromId,
          target: toId,
          txCount: toNumber(rec.get('txCount')),
          totalValue: toBigIntString(rec.get('totalValue')),
          firstTxAt: toISOString(rec.get('firstTxAt'))!,
          lastTxAt: toISOString(rec.get('lastTxAt'))!,
        },
      };
    });
  }
}

// Singleton instance
let everythingService: EverythingService | null = null;

export function getEverythingService(): EverythingService {
  if (!everythingService) {
    everythingService = new EverythingService();
  }
  return everythingService;
}
