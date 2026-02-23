import neo4j from 'neo4j-driver';
import { readTx, toNumber, toBigIntString, toISOString } from '../lib/neo4j';
import type { PathResponse, CytoscapeNode, CytoscapeEdge } from '@nim-stalker/shared';
import { truncateAddress } from '../lib/address-utils';
import { getAddressLabelService } from '../lib/address-labels';

export class PathFinder {
  private maxDepth: number;

  constructor(maxDepth: number = 6) {
    this.maxDepth = maxDepth;
  }

  /**
   * Find shortest path between two addresses using Neo4j's native shortestPath
   */
  async findPath(
    fromAddress: string,
    toAddress: string,
    maxDepth?: number
  ): Promise<PathResponse> {
    const depth = maxDepth ?? this.maxDepth;

    return readTx(async (tx) => {
      const result = await tx.run(
        `MATCH (start:Address {id: $from}), (end:Address {id: $to}),
              path = shortestPath((start)-[:TRANSACTED_WITH*1..${depth}]-(end))
         RETURN path`,
        { from: fromAddress, to: toAddress }
      );

      if (result.records.length === 0) {
        return { found: false };
      }

      const path = result.records[0].get('path');
      const segments = path.segments;

      // Extract node IDs from path
      const pathNodeIds: string[] = [path.start.properties.id as string];
      for (const segment of segments) {
        pathNodeIds.push(segment.end.properties.id as string);
      }

      // Extract edge data from relationships
      const edges: CytoscapeEdge[] = segments.map((segment: any) => {
        const rel = segment.relationship;
        // Use relationship direction, not traversal direction
        const relStartIsSegStart = rel.start.equals(segment.start.identity);
        const fromId = relStartIsSegStart ? segment.start.properties.id as string : segment.end.properties.id as string;
        const toId = relStartIsSegStart ? segment.end.properties.id as string : segment.start.properties.id as string;
        return {
          data: {
            id: `${fromId}-${toId}`,
            source: fromId,
            target: toId,
            txCount: toNumber(rel.properties.txCount),
            totalValue: toBigIntString(rel.properties.totalValue),
            firstTxAt: toISOString(rel.properties.firstTxAt)!,
            lastTxAt: toISOString(rel.properties.lastTxAt)!,
          },
        };
      });

      // Build node details from the path nodes (txCount read from stored property)
      const labelService = getAddressLabelService();
      const nodes: CytoscapeNode[] = [];
      const visited = new Set<string>();

      // Collect all nodes from path (start + each segment end)
      const allPathNodes = [path.start, ...segments.map((s: any) => s.end)];
      for (const node of allPathNodes) {
        const id = node.properties.id as string;
        if (visited.has(id)) continue;
        visited.add(id);

        nodes.push({
          data: {
            id,
            label: labelService.getLabel(id) || (node.properties.label as string) || truncateAddress(id),
            icon: labelService.getIcon(id) || undefined,
            type: (node.properties.type as string) || 'UNKNOWN',
            balance: toBigIntString(node.properties.balance),
            txCount: toNumber(node.properties.txCount),
          },
        });
      }

      return {
        found: true,
        path: { nodes, edges },
        depth: segments.length,
      };
    });
  }
}

// Singleton instance
let pathFinder: PathFinder | null = null;

export function getPathFinder(): PathFinder {
  if (!pathFinder) {
    pathFinder = new PathFinder();
  }
  return pathFinder;
}
