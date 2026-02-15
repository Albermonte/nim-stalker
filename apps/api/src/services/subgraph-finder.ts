import { readTx, toNumber, toBigIntString, toISOString } from '../lib/neo4j';
import type { SubgraphResponse, CytoscapeNode, CytoscapeEdge } from '@nim-stalker/shared';
import { truncateAddress } from '../lib/address-utils';
import { getAddressLabelService } from '../lib/address-labels';

/**
 * Finds all nodes and edges that lie on ANY path between two addresses
 * within a configurable max hops.
 *
 * Uses Neo4j's native allShortestPaths + distance-bounded subgraph extraction.
 */
export class SubgraphFinder {
  private defaultMaxHops: number;

  constructor(defaultMaxHops: number = 3) {
    this.defaultMaxHops = defaultMaxHops;
  }

  /**
   * Find all nodes and edges on any path between two addresses within maxHops
   * @param directed - If true, only follow outgoing edges from source toward target
   */
  async findSubgraph(
    fromAddress: string,
    toAddress: string,
    maxHops?: number,
    directed?: boolean
  ): Promise<SubgraphResponse> {
    const hops = maxHops ?? this.defaultMaxHops;
    const isDirected = directed ?? false;

    // Use relationship direction based on directed flag
    const relPattern = isDirected
      ? `[:TRANSACTED_WITH*1..${hops}]`
      : `[:TRANSACTED_WITH*1..${hops}]`;
    const pathPattern = isDirected
      ? `(start)-${relPattern}->(end)`
      : `(start)-${relPattern}-(end)`;

    return readTx(async (tx) => {
      // Find all shortest paths, which gives us the subgraph of nodes/edges on valid paths
      const result = await tx.run(
        `MATCH (start:Address {id: $from}), (end:Address {id: $to}),
              path = allShortestPaths(${pathPattern})
         RETURN path
         LIMIT 10000`,
        { from: fromAddress, to: toAddress }
      );

      if (result.records.length === 0) {
        return { found: false };
      }

      // Collect unique nodes and edges from all paths
      const nodeMap = new Map<string, any>();
      const edgeSet = new Map<string, { fromId: string; toId: string; props: any }>();
      let shortestPath = Infinity;

      for (const record of result.records) {
        const path = record.get('path');
        const pathLength = path.segments.length;
        if (pathLength < shortestPath) shortestPath = pathLength;

        // Collect start node
        const startNode = path.start;
        const startId = startNode.properties.id as string;
        if (!nodeMap.has(startId)) {
          nodeMap.set(startId, startNode.properties);
        }

        for (const segment of path.segments) {
          const endNode = segment.end;
          const endId = endNode.properties.id as string;
          if (!nodeMap.has(endId)) {
            nodeMap.set(endId, endNode.properties);
          }

          const rel = segment.relationship;
          // Use relationship direction, not traversal direction
          const relStartIsSegStart = rel.start.equals(segment.start.identity);
          const relStartId = relStartIsSegStart ? segment.start.properties.id as string : segment.end.properties.id as string;
          const relEndId = relStartIsSegStart ? segment.end.properties.id as string : segment.start.properties.id as string;
          const edgeKey = `${relStartId}-${relEndId}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.set(edgeKey, {
              fromId: relStartId,
              toId: relEndId,
              props: rel.properties,
            });
          }
        }
      }

      // Build nodes from collected properties (txCount read from stored property)
      const nodeIds = Array.from(nodeMap.keys());

      const labelService = getAddressLabelService();
      const nodes: CytoscapeNode[] = nodeIds.map((id) => {
        const props = nodeMap.get(id)!;
        return {
          data: {
            id,
            label: labelService.getLabel(id) || (props.label as string) || truncateAddress(id),
            icon: labelService.getIcon(id) || undefined,
            type: (props.type as string) || 'UNKNOWN',
            balance: toBigIntString(props.balance),
            indexStatus: (props.indexStatus as string) || 'PENDING',
            txCount: toNumber(props.txCount),
          },
        };
      });

      const edges: CytoscapeEdge[] = Array.from(edgeSet.values()).map((edge) => ({
        data: {
          id: `${edge.fromId}-${edge.toId}`,
          source: edge.fromId,
          target: edge.toId,
          txCount: toNumber(edge.props.txCount),
          totalValue: toBigIntString(edge.props.totalValue),
          firstTxAt: toISOString(edge.props.firstTxAt)!,
          lastTxAt: toISOString(edge.props.lastTxAt)!,
        },
      }));

      return {
        found: true,
        subgraph: { nodes, edges },
        stats: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          maxHops: hops,
          shortestPath,
          directed: isDirected,
        },
      };
    });
  }
}

// Singleton instance
let subgraphFinder: SubgraphFinder | null = null;

export function getSubgraphFinder(): SubgraphFinder {
  if (!subgraphFinder) {
    subgraphFinder = new SubgraphFinder();
  }
  return subgraphFinder;
}
