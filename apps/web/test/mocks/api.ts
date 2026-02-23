/**
 * API client mock for tests
 */

import { mock } from 'bun:test';
import type {
  AddressResponse,
  TransactionResponse,
  GraphResponse,
  PathResponse,
  SubgraphResponse,
} from '@nim-stalker/shared';

export interface MockApiClient {
  getAddress: ReturnType<typeof mock>;
  getTransactions: ReturnType<typeof mock>;
  expandGraph: ReturnType<typeof mock>;
  findPath: ReturnType<typeof mock>;
  findSubgraph: ReturnType<typeof mock>;
  getNodes: ReturnType<typeof mock>;
  getLatestBlocksGraph: ReturnType<typeof mock>;
}

/**
 * Create a mock API client
 */
export function createMockApiClient(): MockApiClient {
  return {
    getAddress: mock(() => Promise.resolve(null)),
    getTransactions: mock(() => Promise.resolve({ transactions: [], total: 0 })),
    expandGraph: mock(() => Promise.resolve({ nodes: [], edges: [] })),
    findPath: mock(() => Promise.resolve({ found: false })),
    findSubgraph: mock(() => Promise.resolve({ found: false })),
    getNodes: mock(() => Promise.resolve({ nodes: [] })),
    getLatestBlocksGraph: mock(() => Promise.resolve({ nodes: [], edges: [] })),
  };
}

/**
 * Create mock address response
 */
export function createMockAddressResponse(
  id: string,
  overrides: Partial<AddressResponse> = {}
): AddressResponse {
  return {
    id,
    type: 'BASIC',
    balance: '0',
    label: null,
    txCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

/**
 * Create mock graph response
 */
export function createMockGraphResponse(
  nodeCount = 0,
  edgeCount = 0
): GraphResponse {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    data: {
      id: `node-${i}`,
      label: `Node ${i}`,
      type: 'BASIC' as const,
      balance: '0',
      txCount: 0,
    },
  }));

  const edges = Array.from({ length: Math.min(edgeCount, nodeCount - 1) }, (_, i) => ({
    data: {
      id: `edge-${i}`,
      source: `node-${i}`,
      target: `node-${i + 1}`,
      txCount: 1,
      totalValue: '100',
      firstTxAt: new Date().toISOString(),
      lastTxAt: new Date().toISOString(),
    },
  }));

  return { nodes, edges };
}

/**
 * Create mock path response (found)
 */
export function createMockPathResponse(
  nodeIds: string[],
  depth: number
): PathResponse {
  const nodes = nodeIds.map((id) => ({
    data: {
      id,
      label: id,
      type: 'BASIC' as const,
      balance: '0',
      txCount: 0,
    },
  }));

  const edges = nodeIds.slice(0, -1).map((id, i) => ({
    data: {
      id: `edge-${i}`,
      source: id,
      target: nodeIds[i + 1],
      txCount: 1,
      totalValue: '100',
      firstTxAt: new Date().toISOString(),
      lastTxAt: new Date().toISOString(),
    },
  }));

  return {
    found: true,
    path: { nodes, edges },
    depth,
  };
}

/**
 * Create mock subgraph response (found)
 */
export function createMockSubgraphResponse(
  nodeIds: string[],
  edgeCount: number,
  maxHops: number,
  shortestPath: number,
  directed = false
): SubgraphResponse {
  const nodes = nodeIds.map((id) => ({
    data: {
      id,
      label: id,
      type: 'BASIC' as const,
      balance: '0',
      txCount: 0,
    },
  }));

  const edges = Array.from({ length: Math.min(edgeCount, nodeIds.length - 1) }, (_, i) => ({
    data: {
      id: `edge-${i}`,
      source: nodeIds[i % nodeIds.length],
      target: nodeIds[(i + 1) % nodeIds.length],
      txCount: 1,
      totalValue: '100',
      firstTxAt: new Date().toISOString(),
      lastTxAt: new Date().toISOString(),
    },
  }));

  return {
    found: true,
    subgraph: { nodes, edges },
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      maxHops,
      shortestPath,
      directed,
    },
  };
}
