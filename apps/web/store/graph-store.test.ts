import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { IndexStatus, type CytoscapeNode, type CytoscapeEdge } from '@nim-stalker/shared';

// Mock sonner before importing the store
mock.module('sonner', () => ({
  toast: {
    error: mock(() => {}),
    success: mock(() => {}),
  },
}));

// Mock the API module
const mockApi = {
  indexAddress: mock(() => Promise.resolve({ status: 'INDEXING', address: 'TEST' })),
  getJobs: mock(() => Promise.resolve({ jobs: [{ address: 'TEST', status: 'COMPLETE', startedAt: new Date().toISOString(), indexed: 10, incremental: false }] })),
  getAddress: mock(() =>
    Promise.resolve({
      id: 'NQ42 TEST ADDR',
      type: 'BASIC',
      balance: '1000000',
      indexStatus: 'COMPLETE',
      txCount: 10,
    })
  ),
  expandGraph: mock(() =>
    Promise.resolve({
      nodes: [
        { data: { id: 'NODE1', type: 'BASIC', balance: '1000', indexStatus: 'COMPLETE' } },
      ],
      edges: [],
    })
  ),
  findSubgraph: mock(() =>
    Promise.resolve({
      found: true,
      subgraph: {
        nodes: [
          { data: { id: 'A', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
          { data: { id: 'B', type: 'BASIC', balance: '200', indexStatus: 'COMPLETE' } },
        ],
        edges: [{ data: { id: 'A->B', source: 'A', target: 'B', txCount: 5, totalValue: '1000' } }],
      },
      stats: { nodeCount: 2, edgeCount: 1, maxHops: 3, shortestPath: 1, directed: false },
    })
  ),
  getLatestBlocksGraph: mock(() =>
    Promise.resolve({
      nodes: [
        { data: { id: 'BLOCK_ADDR1', type: 'BASIC', balance: '0', indexStatus: 'PENDING' } },
      ],
      edges: [],
    })
  ),
};

mock.module('@/lib/api', () => ({
  api: mockApi,
}));

mock.module('@/lib/format-utils', () => ({
  formatNimiqAddress: (addr: string) => addr.toUpperCase().replace(/\s+/g, ' ').trim(),
}));

// Import the store after mocking
import { useGraphStore } from './graph-store';

describe('graph-store', () => {
  beforeEach(() => {
    // Reset store to initial state
    useGraphStore.setState({
      nodes: new Map(),
      edges: new Map(),
      selectedNodeId: null,
      selectedEdgeId: null,
      filters: {},
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
        pathNodeOrder: [],
        pathEdgeIds: new Set(),
        savedNodes: null,
        savedEdges: null,
        stats: null,
      },
    });

    // Reset mocks
    mockApi.indexAddress.mockClear();
    mockApi.getJobs.mockClear();
    mockApi.getAddress.mockClear();
    mockApi.expandGraph.mockClear();
    mockApi.findSubgraph.mockClear();
    mockApi.getLatestBlocksGraph.mockClear();

    // Default: getJobs returns completed job
    mockApi.getJobs.mockImplementation(() =>
      Promise.resolve({ jobs: [{ address: 'TEST', status: 'COMPLETE', startedAt: new Date().toISOString(), indexed: 10, incremental: false }] })
    );
  });

  describe('addNodes', () => {
    test('adds nodes to the store', () => {
      const { addNodes } = useGraphStore.getState();
      const nodes: CytoscapeNode[] = [
        { data: { id: 'A', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
        { data: { id: 'B', type: 'BASIC', balance: '200', indexStatus: 'PENDING' } },
      ];

      addNodes(nodes);

      const state = useGraphStore.getState();
      expect(state.nodes.size).toBe(2);
      expect(state.nodes.get('A')?.data.balance).toBe('100');
      expect(state.nodes.get('B')?.data.balance).toBe('200');
    });

    test('overwrites existing nodes with same id', () => {
      const { addNodes } = useGraphStore.getState();

      addNodes([{ data: { id: 'A', type: 'BASIC', balance: '100', indexStatus: 'PENDING' } }]);
      addNodes([{ data: { id: 'A', type: 'BASIC', balance: '999', indexStatus: 'COMPLETE' } }]);

      const state = useGraphStore.getState();
      expect(state.nodes.size).toBe(1);
      expect(state.nodes.get('A')?.data.balance).toBe('999');
    });
  });

  describe('addEdges', () => {
    test('adds edges to the store', () => {
      const { addEdges } = useGraphStore.getState();
      const edges: CytoscapeEdge[] = [
        { data: { id: 'E1', source: 'A', target: 'B', txCount: 5, totalValue: '1000' } },
        { data: { id: 'E2', source: 'B', target: 'C', txCount: 3, totalValue: '500' } },
      ];

      addEdges(edges);

      const state = useGraphStore.getState();
      expect(state.edges.size).toBe(2);
      expect(state.edges.get('E1')?.data.txCount).toBe(5);
    });
  });

  describe('updateNode', () => {
    test('partially updates node data', () => {
      const { addNodes, updateNode } = useGraphStore.getState();

      addNodes([{ data: { id: 'A', type: 'BASIC', balance: '100', indexStatus: 'PENDING' } }]);
      updateNode('A', { balance: '999', indexStatus: 'COMPLETE' });

      const state = useGraphStore.getState();
      const node = state.nodes.get('A');
      expect(node?.data.balance).toBe('999');
      expect(node?.data.indexStatus).toBe('COMPLETE');
      expect(node?.data.type).toBe('BASIC'); // Unchanged
    });

    test('does nothing for non-existent node', () => {
      const { updateNode } = useGraphStore.getState();

      updateNode('NONEXISTENT', { balance: '999' });

      const state = useGraphStore.getState();
      expect(state.nodes.size).toBe(0);
    });
  });

  describe('removeNode', () => {
    test('removes node and connected edges', () => {
      const { addNodes, addEdges, removeNode } = useGraphStore.getState();

      addNodes([
        { data: { id: 'A', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
        { data: { id: 'B', type: 'BASIC', balance: '200', indexStatus: 'COMPLETE' } },
        { data: { id: 'C', type: 'BASIC', balance: '300', indexStatus: 'COMPLETE' } },
      ]);

      addEdges([
        { data: { id: 'A->B', source: 'A', target: 'B', txCount: 1, totalValue: '10' } },
        { data: { id: 'B->C', source: 'B', target: 'C', txCount: 2, totalValue: '20' } },
      ]);

      removeNode('B');

      const state = useGraphStore.getState();
      expect(state.nodes.size).toBe(2);
      expect(state.nodes.has('B')).toBe(false);
      expect(state.edges.size).toBe(0); // Both edges connected to B
    });

    test('clears selection if removed node was selected', () => {
      const { addNodes, selectNode, removeNode } = useGraphStore.getState();

      addNodes([{ data: { id: 'A', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } }]);
      selectNode('A');
      expect(useGraphStore.getState().selectedNodeId).toBe('A');

      removeNode('A');

      expect(useGraphStore.getState().selectedNodeId).toBeNull();
    });
  });

  describe('selectNode', () => {
    test('selects a node and clears edge selection', () => {
      const { selectNode, selectEdge } = useGraphStore.getState();

      selectEdge('EDGE1');
      expect(useGraphStore.getState().selectedEdgeId).toBe('EDGE1');

      selectNode('NODE1');

      const state = useGraphStore.getState();
      expect(state.selectedNodeId).toBe('NODE1');
      expect(state.selectedEdgeId).toBeNull();
    });

    test('handles path mode selection', () => {
      useGraphStore.setState({
        ...useGraphStore.getState(),
        pathMode: { active: true, from: null, to: null, maxHops: 3, directed: false },
      });

      const { selectNode } = useGraphStore.getState();

      // First selection sets 'from'
      selectNode('A');
      expect(useGraphStore.getState().pathMode.from).toBe('A');
      expect(useGraphStore.getState().pathMode.to).toBeNull();

      // Second selection sets 'to'
      selectNode('B');
      expect(useGraphStore.getState().pathMode.from).toBe('A');
      expect(useGraphStore.getState().pathMode.to).toBe('B');
    });

    test('does not set to if same as from', () => {
      useGraphStore.setState({
        ...useGraphStore.getState(),
        pathMode: { active: true, from: 'A', to: null, maxHops: 3, directed: false },
      });

      const { selectNode } = useGraphStore.getState();
      selectNode('A');

      expect(useGraphStore.getState().pathMode.to).toBeNull();
    });
  });

  describe('selectEdge', () => {
    test('selects an edge and clears node selection', () => {
      const { selectNode, selectEdge } = useGraphStore.getState();

      selectNode('NODE1');
      expect(useGraphStore.getState().selectedNodeId).toBe('NODE1');

      selectEdge('EDGE1');

      const state = useGraphStore.getState();
      expect(state.selectedEdgeId).toBe('EDGE1');
      expect(state.selectedNodeId).toBeNull();
    });
  });

  describe('setFilters', () => {
    test('merges filter updates', () => {
      const { setFilters } = useGraphStore.getState();

      setFilters({ minTimestamp: 1000 });
      setFilters({ maxTimestamp: 2000 });

      const state = useGraphStore.getState();
      expect(state.filters.minTimestamp).toBe(1000);
      expect(state.filters.maxTimestamp).toBe(2000);
    });
  });

  describe('clearGraph', () => {
    test('resets all graph state', () => {
      const { addNodes, addEdges, selectNode, setFilters, clearGraph } = useGraphStore.getState();

      addNodes([{ data: { id: 'A', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } }]);
      addEdges([{ data: { id: 'E1', source: 'A', target: 'B', txCount: 1, totalValue: '10' } }]);
      selectNode('A');
      setFilters({ minTimestamp: 1000 });

      clearGraph();

      const state = useGraphStore.getState();
      expect(state.nodes.size).toBe(0);
      expect(state.edges.size).toBe(0);
      expect(state.selectedNodeId).toBeNull();
      expect(state.lastExpandedNodeId).toBeNull();
      expect(state.pathMode.active).toBe(false);
      expect(state.pathView.active).toBe(false);
    });
  });

  describe('getCytoscapeElements', () => {
    test('returns nodes and edges as arrays', () => {
      const { addNodes, addEdges, getCytoscapeElements } = useGraphStore.getState();

      addNodes([
        { data: { id: 'A', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
        { data: { id: 'B', type: 'BASIC', balance: '200', indexStatus: 'COMPLETE' } },
      ]);
      addEdges([
        { data: { id: 'E1', source: 'A', target: 'B', txCount: 5, totalValue: '1000' } },
      ]);

      const elements = getCytoscapeElements();

      expect(elements.nodes).toHaveLength(2);
      expect(elements.edges).toHaveLength(1);
      expect(elements.nodes[0].data.id).toBeDefined();
    });
  });

  describe('pathMode', () => {
    test('setPathMode activates path mode', () => {
      const { setPathMode } = useGraphStore.getState();

      setPathMode(true, 'START_NODE');

      const state = useGraphStore.getState();
      expect(state.pathMode.active).toBe(true);
      expect(state.pathMode.from).toBe('START_NODE');
      expect(state.pathMode.to).toBeNull();
    });

    test('setPathMode deactivates path mode', () => {
      useGraphStore.setState({
        ...useGraphStore.getState(),
        pathMode: { active: true, from: 'A', to: 'B', maxHops: 3, directed: false },
      });

      const { setPathMode } = useGraphStore.getState();
      setPathMode(false);

      const state = useGraphStore.getState();
      expect(state.pathMode.active).toBe(false);
      expect(state.pathMode.from).toBeNull();
    });

    test('setPathModeMaxHops updates max hops', () => {
      const { setPathModeMaxHops } = useGraphStore.getState();

      setPathModeMaxHops(5);

      expect(useGraphStore.getState().pathMode.maxHops).toBe(5);
    });

    test('setPathModeDirected updates directed flag', () => {
      const { setPathModeDirected } = useGraphStore.getState();

      setPathModeDirected(true);

      expect(useGraphStore.getState().pathMode.directed).toBe(true);
    });
  });

  describe('pathView', () => {
    test('enterPathView saves current graph and shows path', () => {
      const { addNodes, addEdges, enterPathView } = useGraphStore.getState();

      // Add some initial nodes
      addNodes([
        { data: { id: 'X', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
        { data: { id: 'Y', type: 'BASIC', balance: '200', indexStatus: 'COMPLETE' } },
      ]);
      addEdges([
        { data: { id: 'X->Y', source: 'X', target: 'Y', txCount: 1, totalValue: '50' } },
      ]);

      // Enter path view with different nodes
      const pathNodes: CytoscapeNode[] = [
        { data: { id: 'A', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
        { data: { id: 'B', type: 'BASIC', balance: '200', indexStatus: 'COMPLETE' } },
      ];
      const pathEdges: CytoscapeEdge[] = [
        { data: { id: 'A->B', source: 'A', target: 'B', txCount: 5, totalValue: '1000' } },
      ];
      const stats = { nodeCount: 2, edgeCount: 1, maxHops: 3, shortestPath: 1, directed: false };

      enterPathView(pathNodes, pathEdges, stats);

      const state = useGraphStore.getState();
      expect(state.pathView.active).toBe(true);
      expect(state.nodes.size).toBe(2);
      expect(state.nodes.has('A')).toBe(true);
      expect(state.nodes.has('X')).toBe(false); // Original nodes replaced
      expect(state.pathView.savedNodes?.size).toBe(2);
      expect(state.pathView.savedNodes?.has('X')).toBe(true); // But saved
      expect(state.pathView.pathNodeOrder).toEqual(['A', 'B']);
      expect(state.pathView.stats).toEqual(stats);
    });

    test('exitPathView restores original graph', () => {
      const { addNodes, addEdges, enterPathView, exitPathView } = useGraphStore.getState();

      // Add initial nodes
      addNodes([
        { data: { id: 'X', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
      ]);

      // Enter path view
      enterPathView(
        [{ data: { id: 'A', type: 'BASIC', balance: '50', indexStatus: 'COMPLETE' } }],
        []
      );

      expect(useGraphStore.getState().nodes.has('X')).toBe(false);
      expect(useGraphStore.getState().nodes.has('A')).toBe(true);

      // Exit path view
      exitPathView();

      const state = useGraphStore.getState();
      expect(state.pathView.active).toBe(false);
      expect(state.nodes.has('X')).toBe(true); // Restored
      expect(state.nodes.has('A')).toBe(false);
    });

    test('exitPathView does nothing if not in path view', () => {
      const { addNodes, exitPathView } = useGraphStore.getState();

      addNodes([
        { data: { id: 'X', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
      ]);

      exitPathView();

      // Should not change anything
      expect(useGraphStore.getState().nodes.has('X')).toBe(true);
    });
  });

  describe('inFlightRequests', () => {
    test('prevents duplicate concurrent indexNode calls', async () => {
      const { addNodes, indexNode } = useGraphStore.getState();

      // Add a node that needs indexing
      addNodes([
        { data: { id: 'TEST', type: 'BASIC', balance: '0', indexStatus: IndexStatus.PENDING } },
      ]);

      // Make the API call slow but still return the fire-and-forget response
      mockApi.indexAddress.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ status: 'INDEXING', address: 'TEST' }), 100))
      );

      // Start two concurrent index requests
      const promise1 = indexNode('TEST');
      const promise2 = indexNode('TEST');

      await Promise.all([promise1, promise2]);

      // Should only call API once
      expect(mockApi.indexAddress).toHaveBeenCalledTimes(1);
    });
  });

  describe('async actions', () => {
    test('indexNode updates node status through lifecycle', async () => {
      const { addNodes, indexNode } = useGraphStore.getState();

      addNodes([
        { data: { id: 'TEST', type: 'UNKNOWN', balance: '0', indexStatus: IndexStatus.PENDING } },
      ]);

      await indexNode('TEST');

      const state = useGraphStore.getState();
      const node = state.nodes.get('TEST');
      expect(node?.data.indexStatus).toBe('COMPLETE');
      expect(node?.data.type).toBe('BASIC');
    });

    test('indexNode skips non-PENDING nodes', async () => {
      const { addNodes, indexNode } = useGraphStore.getState();

      addNodes([
        { data: { id: 'TEST', type: 'BASIC', balance: '1000', indexStatus: IndexStatus.COMPLETE } },
      ]);

      await indexNode('TEST');

      // Should not call API
      expect(mockApi.indexAddress).not.toHaveBeenCalled();
    });

    test('expandNode adds new nodes and edges', async () => {
      const { addNodes, expandNode } = useGraphStore.getState();

      addNodes([
        { data: { id: 'CENTER', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
      ]);

      await expandNode('CENTER', 'both');

      const state = useGraphStore.getState();
      expect(state.nodes.has('NODE1')).toBe(true);
      expect(state.lastExpandedNodeId).toBe('CENTER');
    });

    test('findPath enters path view on success', async () => {
      const { findPath } = useGraphStore.getState();

      await findPath('A', 'B');

      const state = useGraphStore.getState();
      expect(state.pathView.active).toBe(true);
      expect(state.nodes.size).toBe(2);
      expect(state.edges.size).toBe(1);
    });

    test('findPath shows error when no path found', async () => {
      mockApi.findSubgraph.mockImplementation(() =>
        Promise.resolve({ found: false })
      );

      const { findPath } = useGraphStore.getState();
      await findPath('A', 'Z');

      const state = useGraphStore.getState();
      expect(state.error).toBe('No path found between these addresses');
      expect(state.pathView.active).toBe(false);
    });

    test('loadInitialData fetches latest blocks', async () => {
      const { loadInitialData } = useGraphStore.getState();

      await loadInitialData();

      const state = useGraphStore.getState();
      expect(state.nodes.has('BLOCK_ADDR1')).toBe(true);
      expect(mockApi.getLatestBlocksGraph).toHaveBeenCalledWith(10);
    });

    test('loadInitialData skips if data already exists', async () => {
      const { addNodes, loadInitialData } = useGraphStore.getState();

      addNodes([
        { data: { id: 'EXISTING', type: 'BASIC', balance: '100', indexStatus: 'COMPLETE' } },
      ]);

      await loadInitialData();

      expect(mockApi.getLatestBlocksGraph).not.toHaveBeenCalled();
    });
  });

  describe('clearLastExpanded', () => {
    test('clears lastExpandedNodeId', () => {
      useGraphStore.setState({
        ...useGraphStore.getState(),
        lastExpandedNodeId: 'SOME_NODE',
      });

      const { clearLastExpanded } = useGraphStore.getState();
      clearLastExpanded();

      expect(useGraphStore.getState().lastExpandedNodeId).toBeNull();
    });
  });
});
