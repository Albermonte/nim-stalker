/**
 * Zustand store mock helper for tests
 */

import { mock } from 'bun:test';
import type { CytoscapeNode, CytoscapeEdge } from '@nim-stalker/shared';

export interface MockGraphStore {
  // State
  nodes: Map<string, CytoscapeNode>;
  edges: Map<string, CytoscapeEdge>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  loading: boolean;
  error: string | null;
  lastExpandedNodeId: string | null;
  inFlightRequests: Set<string>;

  // Path mode state
  pathMode: {
    active: boolean;
    from: string | null;
    to: string | null;
    maxHops: number;
    directed: boolean;
  };

  // Path view state
  pathView: {
    active: boolean;
    pathNodeIds: Set<string>;
    pathEdgeIds: Set<string>;
    pathNodeOrder: string[];
    savedNodes: Map<string, CytoscapeNode>;
    savedEdges: Map<string, CytoscapeEdge>;
    stats: {
      nodeCount: number;
      edgeCount: number;
      maxHops: number;
      shortestPath: number;
      directed: boolean;
    } | null;
  };

  // Actions (mocked)
  addNodes: ReturnType<typeof mock>;
  addEdges: ReturnType<typeof mock>;
  updateNode: ReturnType<typeof mock>;
  removeNode: ReturnType<typeof mock>;
  setSelectedNode: ReturnType<typeof mock>;
  setSelectedEdge: ReturnType<typeof mock>;
  expandNode: ReturnType<typeof mock>;
  searchAddress: ReturnType<typeof mock>;
  addAddress: ReturnType<typeof mock>;
  clearGraph: ReturnType<typeof mock>;
  clearLastExpanded: ReturnType<typeof mock>;
  loadInitialData: ReturnType<typeof mock>;
  setError: ReturnType<typeof mock>;

  // Path mode actions
  setPathMode: ReturnType<typeof mock>;
  setPathModeMaxHops: ReturnType<typeof mock>;
  setPathModeDirected: ReturnType<typeof mock>;
  enterPathView: ReturnType<typeof mock>;
  exitPathView: ReturnType<typeof mock>;

  // Computed
  getCytoscapeElements: ReturnType<typeof mock>;
}

/**
 * Create a fresh mock store with default values
 */
export function createMockStore(overrides: Partial<MockGraphStore> = {}): MockGraphStore {
  return {
    // Default state
    nodes: new Map(),
    edges: new Map(),
    selectedNodeId: null,
    selectedEdgeId: null,
    loading: false,
    error: null,
    lastExpandedNodeId: null,
    inFlightRequests: new Set(),

    pathMode: {
      active: false,
      from: null,
      to: null,
      maxHops: 3,
      directed: false,
    },

    pathView: {
      active: false,
      pathNodeIds: new Set(),
      pathEdgeIds: new Set(),
      pathNodeOrder: [],
      savedNodes: new Map(),
      savedEdges: new Map(),
      stats: null,
    },

    // Mock actions
    addNodes: mock(() => {}),
    addEdges: mock(() => {}),
    updateNode: mock(() => {}),
    removeNode: mock(() => {}),
    setSelectedNode: mock(() => {}),
    setSelectedEdge: mock(() => {}),
    expandNode: mock(() => Promise.resolve()),
    searchAddress: mock(() => Promise.resolve()),
    addAddress: mock(() => Promise.resolve()),
    clearGraph: mock(() => {}),
    clearLastExpanded: mock(() => {}),
    loadInitialData: mock(() => Promise.resolve()),
    setError: mock(() => {}),

    setPathMode: mock(() => {}),
    setPathModeMaxHops: mock(() => {}),
    setPathModeDirected: mock(() => {}),
    enterPathView: mock(() => {}),
    exitPathView: mock(() => {}),

    getCytoscapeElements: mock(() => ({ nodes: [], edges: [] })),

    // Apply overrides
    ...overrides,
  };
}

/**
 * Create a mock node for testing
 */
export function createMockNode(
  id: string,
  overrides: Partial<CytoscapeNode['data']> = {}
): CytoscapeNode {
  return {
    data: {
      id,
      label: id.slice(0, 12) + '...',
      type: 'BASIC',
      balance: '0',
      txCount: 0,
      ...overrides,
    },
  };
}

/**
 * Create a mock edge for testing
 */
export function createMockEdge(
  id: string,
  source: string,
  target: string,
  overrides: Partial<CytoscapeEdge['data']> = {}
): CytoscapeEdge {
  return {
    data: {
      id,
      source,
      target,
      txCount: 1,
      totalValue: '100',
      firstTxAt: new Date().toISOString(),
      lastTxAt: new Date().toISOString(),
      ...overrides,
    },
  };
}

/**
 * Populate store with test data
 */
export function populateStore(
  store: MockGraphStore,
  nodes: CytoscapeNode[],
  edges: CytoscapeEdge[]
): void {
  store.nodes = new Map(nodes.map((n) => [n.data.id, n]));
  store.edges = new Map(edges.map((e) => [e.data.id, e]));
}
