/**
 * Test fixtures for graph structures
 */

// Simple linear path: A -> B -> C
export const linearPath = {
  nodes: ['A', 'B', 'C'],
  edges: [
    { id: 'e1', from: 'A', to: 'B', txCount: 5, totalValue: 1000n },
    { id: 'e2', from: 'B', to: 'C', txCount: 3, totalValue: 500n },
  ],
};

// Diamond graph: A -> B -> D, A -> C -> D
export const diamondGraph = {
  nodes: ['A', 'B', 'C', 'D'],
  edges: [
    { id: 'e1', from: 'A', to: 'B', txCount: 10, totalValue: 2000n },
    { id: 'e2', from: 'A', to: 'C', txCount: 8, totalValue: 1500n },
    { id: 'e3', from: 'B', to: 'D', txCount: 6, totalValue: 1000n },
    { id: 'e4', from: 'C', to: 'D', txCount: 4, totalValue: 800n },
  ],
};

// Complex graph with multiple paths
export const complexGraph = {
  nodes: ['A', 'B', 'C', 'D', 'E', 'F'],
  edges: [
    { id: 'e1', from: 'A', to: 'B', txCount: 10, totalValue: 5000n },
    { id: 'e2', from: 'A', to: 'C', txCount: 5, totalValue: 2500n },
    { id: 'e3', from: 'B', to: 'D', txCount: 8, totalValue: 4000n },
    { id: 'e4', from: 'C', to: 'D', txCount: 3, totalValue: 1500n },
    { id: 'e5', from: 'D', to: 'E', txCount: 12, totalValue: 6000n },
    { id: 'e6', from: 'D', to: 'F', txCount: 2, totalValue: 1000n },
    { id: 'e7', from: 'E', to: 'F', txCount: 7, totalValue: 3500n },
    { id: 'e8', from: 'B', to: 'E', txCount: 1, totalValue: 500n },
  ],
};

// Disconnected nodes (no path exists)
export const disconnectedGraph = {
  nodes: ['A', 'B', 'C', 'X', 'Y'],
  edges: [
    { id: 'e1', from: 'A', to: 'B', txCount: 5, totalValue: 1000n },
    { id: 'e2', from: 'B', to: 'C', txCount: 3, totalValue: 500n },
    { id: 'e3', from: 'X', to: 'Y', txCount: 2, totalValue: 200n },
  ],
};

// Single node (edge case)
export const singleNode = {
  nodes: ['A'],
  edges: [],
};

// Self-referencing edge (same source and target)
export const selfLoop = {
  nodes: ['A', 'B'],
  edges: [
    { id: 'e1', from: 'A', to: 'A', txCount: 1, totalValue: 100n },
    { id: 'e2', from: 'A', to: 'B', txCount: 2, totalValue: 200n },
  ],
};

// Helper to create Cytoscape-format nodes
export function createCytoscapeNode(id: string, type = 'BASIC', balance = 0n) {
  return {
    data: {
      id,
      label: id,
      type,
      balance: balance.toString(),
      indexStatus: 'COMPLETE' as const,
      txCount: 0,
    },
  };
}

// Helper to create Cytoscape-format edges
export function createCytoscapeEdge(
  id: string,
  source: string,
  target: string,
  txCount = 1,
  totalValue = 100n
) {
  return {
    data: {
      id,
      source,
      target,
      txCount,
      totalValue: totalValue.toString(),
      firstTxAt: new Date().toISOString(),
      lastTxAt: new Date().toISOString(),
    },
  };
}

// Mock edge aggregate data (matching Prisma EdgeAggregate model)
export function createMockEdgeAggregate(
  id: string,
  fromId: string,
  toId: string,
  txCount = 1,
  totalValue = 100n
) {
  const now = new Date();
  return {
    id,
    fromId,
    toId,
    txCount,
    totalValue,
    firstTxAt: now,
    lastTxAt: now,
  };
}

// Mock address data (matching Prisma Address model)
export function createMockAddress(
  id: string,
  type = 'BASIC',
  balance = 0n,
  indexStatus = 'COMPLETE'
) {
  return {
    id,
    type,
    balance,
    label: null,
    indexStatus,
    txCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
