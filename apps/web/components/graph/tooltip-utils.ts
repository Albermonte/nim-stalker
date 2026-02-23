import type { CytoscapeEdge, NodeData } from '@nim-stalker/shared';

export interface ConnectedTxActivity {
  txCount: number;
  totalValue: bigint;
}

export function formatTooltipBalance(balance: string): string {
  try {
    const roundedNim = (BigInt(balance) + 50_000n) / 100_000n;
    return `${roundedNim.toLocaleString()} NIM`;
  } catch {
    return '0 NIM';
  }
}

function safeBigInt(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function getConnectedTxActivity(
  nodeId: string,
  edgesMap: Map<string, CytoscapeEdge>
): ConnectedTxActivity | null {
  let txCount = 0;
  let totalValue = 0n;

  for (const edge of edgesMap.values()) {
    const data = edge.data;
    if (data.source !== nodeId && data.target !== nodeId) continue;

    txCount += Number.isFinite(data.txCount) ? data.txCount : 0;
    totalValue += safeBigInt(data.totalValue);
  }

  if (txCount === 0 && totalValue === 0n) return null;

  return { txCount, totalValue };
}

export function getNodeTxCount(
  nodeData: NodeData,
  nodeId: string,
  edgesMap: Map<string, CytoscapeEdge>
): number {
  if (typeof nodeData.txCount === 'number' && Number.isFinite(nodeData.txCount)) {
    return nodeData.txCount;
  }

  return getConnectedTxActivity(nodeId, edgesMap)?.txCount ?? 0;
}
