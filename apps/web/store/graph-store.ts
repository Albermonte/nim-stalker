import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { toast } from 'sonner';
import {
  IndexStatus,
  type CytoscapeNode,
  type CytoscapeEdge,
  type Direction,
  type FilterState,
  type NodeData,
  type IndexingJob,
} from '@nim-stalker/shared';
import { api, JobWebSocket } from '@/lib/api';
import { formatNimiqAddress, truncateAddress } from '@/lib/format-utils';

/** Layout mode for the graph visualization */
export type LayoutMode =
  | 'fcose' | 'cola'
  | 'elk-layered-down' | 'elk-layered-right'
  | 'elk-stress'
  | 'dagre-tb' | 'dagre-lr'
  | 'directed-flow';

interface GraphState {
  nodes: Map<string, CytoscapeNode>;
  edges: Map<string, CytoscapeEdge>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  filters: FilterState;
  loading: boolean;
  error: string | null;
  lastExpandedNodeId: string | null;
  inFlightRequests: Set<string>;
  pathMode: {
    active: boolean;
    from: string | null;
    to: string | null;
    maxHops: number;
    directed: boolean;
  };
  pathView: {
    active: boolean;
    pathNodeIds: Set<string>;
    pathNodeOrder: string[];  // Ordered array of node IDs for start/intermediate/end styling
    pathEdgeIds: Set<string>;
    savedNodes: Map<string, CytoscapeNode> | null;
    savedEdges: Map<string, CytoscapeEdge> | null;
    stats: {
      nodeCount: number;
      edgeCount: number;
      maxHops: number;
      shortestPath: number;
      directed: boolean;
    } | null;
  };
  /** Layout mode for graph visualization */
  layoutMode: LayoutMode;
  /** Addresses currently being indexed (for overlay feedback) */
  indexingAddresses: Set<string>;
  /** When true, loadInitialData() is skipped (deep link pages set this) */
  skipInitialLoad: boolean;
}

interface GraphActions {
  addNodes: (nodes: CytoscapeNode[]) => void;
  addEdges: (edges: CytoscapeEdge[]) => void;
  addGraphData: (nodes: CytoscapeNode[], edges: CytoscapeEdge[]) => void;
  updateNode: (id: string, data: Partial<CytoscapeNode['data']>) => void;
  removeNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setFilters: (filters: Partial<FilterState>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  indexNode: (id: string) => Promise<void>;
  expandNode: (id: string, direction: Direction) => Promise<void>;
  searchAddress: (address: string) => Promise<void>;
  addAddress: (address: string) => Promise<void>;
  findPath: (from: string, to: string, maxHops?: number) => Promise<void>;
  setPathMode: (active: boolean, from?: string) => void;
  setPathModeMaxHops: (maxHops: number) => void;
  setPathModeDirected: (directed: boolean) => void;
  clearGraph: () => void;
  getCytoscapeElements: () => { nodes: CytoscapeNode[]; edges: CytoscapeEdge[] };
  enterPathView: (pathNodes: CytoscapeNode[], pathEdges: CytoscapeEdge[], stats?: { nodeCount: number; edgeCount: number; maxHops: number; shortestPath: number; directed: boolean }) => void;
  exitPathView: () => void;
  clearLastExpanded: () => void;
  loadInitialData: () => Promise<void>;
  expandAllNodes: () => Promise<void>;
  /** Set layout mode */
  setLayoutMode: (mode: LayoutMode) => void;
  /** Set skipInitialLoad flag (used by deep link pages) */
  setSkipInitialLoad: (skip: boolean) => void;
}

const initialState: GraphState = {
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
  layoutMode: 'fcose',
  indexingAddresses: new Set(),
  skipInitialLoad: false,
};

const POLL_INTERVAL_MS = 2000;

// Shared WebSocket connection for job status updates
let jobWs: JobWebSocket | null = null;
const jobListeners = new Map<string, (job: IndexingJob) => void>();

function getJobWebSocket(): JobWebSocket {
  if (jobWs) return jobWs;
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  jobWs = new JobWebSocket(API_URL, {
    onSnapshot: () => {
      // Snapshot is informational; individual listeners track specific addresses
    },
    onJobUpdate: (job) => {
      const listener = jobListeners.get(job.address);
      if (listener) listener(job);
    },
  });
  return jobWs;
}

/**
 * Wait for a job to complete using WebSocket (real-time) with HTTP polling fallback.
 * Returns the final job status, or null if the job was never found.
 */
async function pollJobUntilDone(address: string): Promise<IndexingJob | null> {
  const ws = getJobWebSocket();

  return new Promise<IndexingJob | null>((resolve) => {
    let resolved = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      resolved = true;
      jobListeners.delete(address);
      if (pollTimer) clearTimeout(pollTimer);
    };

    // WebSocket listener for this address
    jobListeners.set(address, (job) => {
      if (resolved) return;
      if (job.status === 'COMPLETE' || job.status === 'ERROR') {
        cleanup();
        resolve(job);
      }
    });

    // Fallback polling in case WebSocket is disconnected
    const poll = async () => {
      if (resolved) return;
      try {
        const { jobs } = await api.getJobs();
        const job = jobs.find((j) => j.address === address);
        if (!job) { cleanup(); resolve(null); return; }
        if (job.status === 'COMPLETE' || job.status === 'ERROR') {
          cleanup();
          resolve(job);
          return;
        }
      } catch {
        // Network error — retry
      }
      if (!resolved) {
        // Poll less frequently when WebSocket is connected
        const interval = ws.connected ? POLL_INTERVAL_MS * 5 : POLL_INTERVAL_MS;
        pollTimer = setTimeout(poll, interval);
      }
    };

    // Start first poll after a delay (give WebSocket a chance)
    pollTimer = setTimeout(poll, ws.connected ? POLL_INTERVAL_MS * 5 : POLL_INTERVAL_MS);
  });
}

export const useGraphStore = create<GraphState & GraphActions>()(
  immer((set, get) => ({
    ...initialState,

    addNodes: (nodes) => {
      const currentNodes = get().nodes;
      let hasNew = false;
      for (const node of nodes) {
        if (!currentNodes.has(node.data.id)) { hasNew = true; break; }
      }
      if (!hasNew && nodes.length <= currentNodes.size) return;
      const newMap = new Map(currentNodes);
      for (const node of nodes) {
        newMap.set(node.data.id, node);
      }
      set({ nodes: newMap });
    },

    addEdges: (edges) => {
      const currentEdges = get().edges;
      let hasNew = false;
      for (const edge of edges) {
        if (!currentEdges.has(edge.data.id)) { hasNew = true; break; }
      }
      if (!hasNew && edges.length <= currentEdges.size) return;
      const newMap = new Map(currentEdges);
      for (const edge of edges) {
        newMap.set(edge.data.id, edge);
      }
      set({ edges: newMap });
    },

    addGraphData: (nodes, edges) => {
      const state = get();
      let hasNewNodes = false;
      let hasNewEdges = false;
      for (const node of nodes) {
        if (!state.nodes.has(node.data.id)) { hasNewNodes = true; break; }
      }
      for (const edge of edges) {
        if (!state.edges.has(edge.data.id)) { hasNewEdges = true; break; }
      }
      if (!hasNewNodes && !hasNewEdges) return;
      const newNodes = hasNewNodes ? new Map(state.nodes) : state.nodes;
      if (hasNewNodes) {
        for (const node of nodes) { newNodes.set(node.data.id, node); }
      }
      const newEdges = hasNewEdges ? new Map(state.edges) : state.edges;
      if (hasNewEdges) {
        for (const edge of edges) { newEdges.set(edge.data.id, edge); }
      }
      set({ nodes: newNodes, edges: newEdges });
    },

    updateNode: (id, data) => {
      const currentNodes = get().nodes;
      const existingNode = currentNodes.get(id);
      if (!existingNode) return;

      const newMap = new Map(currentNodes);
      newMap.set(id, {
        ...existingNode,
        data: { ...existingNode.data, ...data },
      });
      set({ nodes: newMap });
    },

    removeNode: (id) => {
      const state = get();
      const newNodes = new Map(state.nodes);
      newNodes.delete(id);

      // Remove edges connected to this node
      const newEdges = new Map(state.edges);
      for (const [edgeId, edge] of Array.from(state.edges.entries())) {
        if (edge.data.source === id || edge.data.target === id) {
          newEdges.delete(edgeId);
        }
      }

      set({
        nodes: newNodes,
        edges: newEdges,
        selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      });
    },

    selectNode: (id) => {
      set((state) => {
        state.selectedNodeId = id;
        state.selectedEdgeId = null;

        // Handle path mode
        if (state.pathMode.active && id) {
          if (!state.pathMode.from) {
            state.pathMode.from = id;
          } else if (!state.pathMode.to && id !== state.pathMode.from) {
            state.pathMode.to = id;
          }
        }
      });
    },

    selectEdge: (id) =>
      set((state) => {
        state.selectedEdgeId = id;
        state.selectedNodeId = null;
      }),

    setFilters: (filters) =>
      set((state) => {
        state.filters = { ...state.filters, ...filters };
      }),

    setLoading: (loading) =>
      set((state) => {
        state.loading = loading;
      }),

    setError: (error) => {
      if (error) {
        toast.error(error);
      }
      set((state) => {
        state.error = error;
      });
    },

    indexNode: async (id) => {
      const requestKey = `index:${id}`;
      const { nodes, updateNode, setError, inFlightRequests } = get();

      // Skip if already in progress
      if (inFlightRequests.has(requestKey)) {
        return;
      }

      const node = nodes.get(id);

      // Only index if the node exists and is PENDING
      if (!node || node.data.indexStatus !== IndexStatus.PENDING) return;

      // Mark request as in-flight and track indexing address
      const newInFlight = new Set(inFlightRequests);
      newInFlight.add(requestKey);
      const newIndexing = new Set(get().indexingAddresses);
      newIndexing.add(id);
      set({ inFlightRequests: newInFlight, indexingAddresses: newIndexing });

      // Mark as indexing
      updateNode(id, { indexStatus: IndexStatus.INDEXING });

      try {
        // Trigger background indexing (returns immediately)
        await api.indexAddress(id);

        // Poll until done
        const job = await pollJobUntilDone(id);

        if (job?.status === 'ERROR') {
          throw new Error(job.error || 'Indexing failed');
        }

        // Fetch updated address data (includes txCount)
        const addressData = await api.getAddress(id);

        // Update node with fresh data
        updateNode(id, {
          type: addressData.type as NodeData['type'],
          balance: addressData.balance,
          indexStatus: addressData.indexStatus as NodeData['indexStatus'],
          txCount: addressData.txCount,
        });
      } catch (err) {
        updateNode(id, { indexStatus: IndexStatus.ERROR });
        setError(err instanceof Error ? err.message : 'Failed to index address');
      } finally {
        // Remove from in-flight and indexing tracking
        const current = get().inFlightRequests;
        const newSet = new Set(current);
        newSet.delete(requestKey);
        const currentIndexing = new Set(get().indexingAddresses);
        currentIndexing.delete(id);
        set({ inFlightRequests: newSet, indexingAddresses: currentIndexing });
      }
    },

    expandNode: async (id, direction) => {
      const requestKey = `expand:${id}:${direction}`;
      const { filters, addGraphData, setLoading, setError, inFlightRequests } = get();

      // Skip if already in progress
      if (inFlightRequests.has(requestKey)) {
        return;
      }

      // Mark request as in-flight
      set({ inFlightRequests: new Set(inFlightRequests).add(requestKey) });

      setLoading(true);
      setError(null);

      try {
        const result = await api.expandGraph([id], direction, filters);
        // Set lastExpandedNodeId before adding nodes so layout knows where to position them
        set({ lastExpandedNodeId: id });
        addGraphData(result.nodes, result.edges);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to expand node');
      } finally {
        setLoading(false);
        // Remove from in-flight
        const current = get().inFlightRequests;
        const newSet = new Set(current);
        newSet.delete(requestKey);
        set({ inFlightRequests: newSet });
      }
    },

    searchAddress: async (address) => {
      const requestKey = `search:${address}`;
      const { filters, addGraphData, setLoading, setError, selectNode, clearGraph, inFlightRequests } = get();

      // Skip if already in progress
      if (inFlightRequests.has(requestKey)) {
        return;
      }

      // Prevent loadInitialData from racing with this search
      set({ skipInitialLoad: true });

      // Mark request as in-flight
      set({ inFlightRequests: new Set(inFlightRequests).add(requestKey) });

      setLoading(true);
      setError(null);

      // Track indexing address for overlay feedback
      const formattedAddress = formatNimiqAddress(address);
      const newIndexing = new Set(get().indexingAddresses);
      newIndexing.add(formattedAddress);
      set({ indexingAddresses: newIndexing });

      try {
        // Trigger background indexing (returns immediately)
        await api.indexAddress(address);

        // Poll until indexing completes
        const job = await pollJobUntilDone(formattedAddress);

        if (job?.status === 'ERROR') {
          throw new Error(job.error || 'Indexing failed');
        }

        // Then expand from it
        const result = await api.expandGraph([address], 'both', filters);

        // Clear existing graph before adding new results
        clearGraph();

        addGraphData(result.nodes, result.edges);

        // Select the searched node (use formatted address to match backend IDs)
        if (result.nodes.length > 0) {
          const searchedNode = result.nodes.find((n) => n.data.id === formattedAddress);
          if (searchedNode) {
            selectNode(searchedNode.data.id);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to search address');
      } finally {
        setLoading(false);
        // Remove from in-flight and indexing tracking
        const current = get().inFlightRequests;
        const newSet = new Set(current);
        newSet.delete(requestKey);
        const currentIndexing = new Set(get().indexingAddresses);
        currentIndexing.delete(formattedAddress);
        set({ inFlightRequests: newSet, indexingAddresses: currentIndexing });
      }
    },

    addAddress: async (address) => {
      const requestKey = `add:${address}`;
      const { nodes, addNodes, setLoading, setError, inFlightRequests } = get();

      // Format address to match backend format (NQ42 XXXX XXXX ...)
      const formattedAddress = formatNimiqAddress(address);

      // Check if already in graph - just select it
      if (nodes.has(formattedAddress)) {
        set({ selectedNodeId: formattedAddress });
        return;
      }

      // Skip if already in progress
      if (inFlightRequests.has(requestKey)) {
        return;
      }

      // Mark request as in-flight
      set({ inFlightRequests: new Set(inFlightRequests).add(requestKey) });

      setLoading(true);
      setError(null);

      try {
        // Fetch address info from API (creates PENDING entry if needed)
        const addressData = await api.getAddress(formattedAddress);

        // Create node and add to graph
        const node: CytoscapeNode = {
          data: {
            id: addressData.id,
            label: addressData.label || truncateAddress(addressData.id),
            icon: addressData.icon,
            type: addressData.type as NodeData['type'],
            balance: addressData.balance,
            indexStatus: addressData.indexStatus as NodeData['indexStatus'],
            txCount: addressData.txCount,
          },
        };

        addNodes([node]);
        set({ selectedNodeId: formattedAddress });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add address');
      } finally {
        setLoading(false);
        // Remove from in-flight
        const current = get().inFlightRequests;
        const newSet = new Set(current);
        newSet.delete(requestKey);
        set({ inFlightRequests: newSet });
      }
    },

    findPath: async (from, to, maxHops) => {
      const hops = maxHops ?? get().pathMode.maxHops;
      const directed = get().pathMode.directed;
      const requestKey = `path:${from}-${to}-${hops}-${directed}`;
      const { setLoading, setError, enterPathView, inFlightRequests } = get();

      // Skip if already in progress
      if (inFlightRequests.has(requestKey)) {
        return;
      }

      // Mark request as in-flight
      set({ inFlightRequests: new Set(inFlightRequests).add(requestKey) });

      setLoading(true);
      setError(null);

      try {
        // Use the subgraph API to find all paths
        const result = await api.findSubgraph(from, to, hops, directed);

        if (!result.found) {
          setError('No path found between these addresses');
          return;
        }

        if (result.subgraph) {
          // Enter path view mode with subgraph data and stats
          enterPathView(result.subgraph.nodes, result.subgraph.edges, result.stats);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to find path');
      } finally {
        setLoading(false);
        // Reset path mode
        set((state) => {
          state.pathMode = { active: false, from: null, to: null, maxHops: state.pathMode.maxHops, directed: state.pathMode.directed };
        });
        // Remove from in-flight
        const current = get().inFlightRequests;
        const newSet = new Set(current);
        newSet.delete(requestKey);
        set({ inFlightRequests: newSet });
      }
    },

    setPathMode: (active, from) =>
      set((state) => {
        state.pathMode = {
          active,
          from: from || null,
          to: null,
          maxHops: state.pathMode.maxHops,
          directed: state.pathMode.directed,
        };
      }),

    setPathModeMaxHops: (maxHops) =>
      set((state) => {
        state.pathMode.maxHops = maxHops;
      }),

    setPathModeDirected: (directed) =>
      set((state) => {
        state.pathMode.directed = directed;
      }),

    clearGraph: () => {
      set({
        nodes: new Map(),
        edges: new Map(),
        selectedNodeId: null,
        selectedEdgeId: null,
        lastExpandedNodeId: null,
        skipInitialLoad: false,
        pathMode: { active: false, from: null, to: null, maxHops: 3, directed: false },
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
    },

    enterPathView: (pathNodes, pathEdges, stats) => {
      const state = get();

      // Save current graph state
      const savedNodes = new Map(state.nodes);
      const savedEdges = new Map(state.edges);

      // Create new maps with only path elements
      const pathNodesMap = new Map<string, CytoscapeNode>();
      const pathEdgesMap = new Map<string, CytoscapeEdge>();
      const pathNodeIds = new Set<string>();
      const pathEdgeIds = new Set<string>();

      // Preserve the order of path nodes (backend returns them in order)
      const pathNodeOrder: string[] = [];

      for (const node of pathNodes) {
        pathNodesMap.set(node.data.id, node);
        pathNodeIds.add(node.data.id);
        pathNodeOrder.push(node.data.id);
      }

      for (const edge of pathEdges) {
        pathEdgesMap.set(edge.data.id, edge);
        pathEdgeIds.add(edge.data.id);
      }

      set({
        nodes: pathNodesMap,
        edges: pathEdgesMap,
        selectedNodeId: null,
        selectedEdgeId: null,
        pathView: {
          active: true,
          pathNodeIds,
          pathNodeOrder,
          pathEdgeIds,
          savedNodes,
          savedEdges,
          stats: stats || null,
        },
      });
    },

    exitPathView: () => {
      const state = get();

      if (!state.pathView.active || !state.pathView.savedNodes || !state.pathView.savedEdges) {
        return;
      }

      // Restore the saved graph state
      set({
        nodes: state.pathView.savedNodes,
        edges: state.pathView.savedEdges,
        selectedNodeId: null,
        selectedEdgeId: null,
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
    },

    clearLastExpanded: () => set({ lastExpandedNodeId: null }),

    expandAllNodes: async () => {
      const requestKey = 'expand-all';
      const { nodes, filters, addGraphData, setLoading, setError, inFlightRequests, indexNode } = get();

      if (nodes.size === 0 || inFlightRequests.has(requestKey)) return;

      set({ inFlightRequests: new Set(inFlightRequests).add(requestKey) });
      setLoading(true);
      setError(null);

      try {
        // Phase 1: Index any PENDING nodes first
        const pendingIds = Array.from(nodes.values())
          .filter(n => n.data.indexStatus === IndexStatus.PENDING)
          .map(n => n.data.id);

        if (pendingIds.length > 0) {
          await Promise.all(pendingIds.map(id => indexNode(id)));
        }

        // Phase 2: Expand all nodes
        const allIds = Array.from(nodes.keys());
        const BATCH_SIZE = 50;
        const allNodes: CytoscapeNode[] = [];
        const allEdges: CytoscapeEdge[] = [];

        for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
          const batch = allIds.slice(i, i + BATCH_SIZE);
          const result = await api.expandGraph(batch, 'both', filters);
          allNodes.push(...result.nodes);
          allEdges.push(...result.edges);
        }

        set({ lastExpandedNodeId: null });
        addGraphData(allNodes, allEdges);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to expand all nodes');
      } finally {
        setLoading(false);
        const current = get().inFlightRequests;
        const newSet = new Set(current);
        newSet.delete(requestKey);
        set({ inFlightRequests: newSet });
      }
    },

    setLayoutMode: (mode) => set({ layoutMode: mode }),

    setSkipInitialLoad: (skip) => set({ skipInitialLoad: skip }),

    loadInitialData: async () => {
      const { nodes, skipInitialLoad, addGraphData, setLoading, setError } = get();

      // Don't reload if we already have data or deep link is handling init
      if (nodes.size > 0 || skipInitialLoad) return;

      setLoading(true);
      setError(null);

      try {
        const result = await api.getLatestBlocksGraph(10);
        // Re-check: a deep link page may have set skipInitialLoad or entered
        // path view while we were fetching — don't clobber their data
        const current = get();
        if (current.skipInitialLoad || current.pathView.active || current.nodes.size > 0) return;
        addGraphData(result.nodes, result.edges);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load initial data');
      } finally {
        setLoading(false);
      }
    },

    getCytoscapeElements: () => {
      const state = get();
      return {
        nodes: Array.from(state.nodes.values()),
        edges: Array.from(state.edges.values()),
      };
    },
  }))
);
