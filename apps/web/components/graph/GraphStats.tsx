'use client';

import { useMemo } from 'react';
import { useGraphStore } from '@/store/graph-store';
import { formatNimiq } from '@/lib/format-utils';

function safeBigInt(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function GraphStats() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);

  const stats = useMemo(() => {
    const nodeCount = nodes.size;
    const edgeCount = edges.size;
    let totalTxCount = 0;
    let totalValue = 0n;

    for (const edge of edges.values()) {
      totalTxCount += Number.isFinite(edge.data.txCount) ? edge.data.txCount : 0;
      totalValue += safeBigInt(edge.data.totalValue);
    }

    return { nodeCount, edgeCount, totalTxCount, totalValue };
  }, [nodes, edges]);

  if (stats.nodeCount === 0 && stats.edgeCount === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-4 right-4 z-30 nq-card py-2 px-3 text-xs">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="nq-label">Nodes</span>
        <span className="font-bold font-mono text-right">{stats.nodeCount}</span>
        <span className="nq-label">Edges</span>
        <span className="font-bold font-mono text-right">{stats.edgeCount}</span>
        <span className="nq-label">TX Count</span>
        <span className="font-bold font-mono text-right">{stats.totalTxCount.toLocaleString()}</span>
        <span className="nq-label">Volume</span>
        <span className="font-bold font-mono text-right">{formatNimiq(stats.totalValue)}</span>
      </div>
    </div>
  );
}
