import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { toast } from 'sonner';
import {
  type CytoscapeNode,
  type CytoscapeEdge,
  type Direction,
  type FilterState,
  type NodeData,
} from '@nim-stalker/shared';
import { api } from '@/lib/api';
import { formatNimiqAddress, truncateAddress } from '@/lib/format-utils';

/** Layout mode for the graph visualization */
export type LayoutMode =
  | 'fcose' | 'cola'
  | 'fcose-weighted'
  | 'elk-layered-down' | 'elk-layered-right'
  | 'elk-stress'
  | 'dagre-tb' | 'dagre-lr'
  | 'directed-flow'
  | 'biflow-lr' | 'biflow-tb'
  | 'concentric-volume';

const LIVE_BALANCE_BATCH_SIZE = 100;
export const MAX_COMBINED_PATHS = 10;
let latestHomeReloadRequestId = 0;

export interface PathRequestMetadata {
  from: string;
  to: string;
  maxHops: number;
  directed: boolean;
  requestKey: string;
}

interface PathSequenceRequest {
  fromAddress: string;
  toAddress: string;
  maxHops: number;
  directed: boolean;
  requestKey: string;
}

function buildPathRequestKey(from: string, to: string, maxHops: number, directed: boolean): string {
  return `${from}|${to}|${maxHops}|${directed}`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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
    from: string | null;
    to: string | null;
    paths: PathRequestMetadata[];
    startNodeIds: Set<string>;
    endNodeIds: Set<string>;
    pathNodeIds: Set<string>;
    pathNodeOrder: string[];  // Ordered array for layout behavior (not canonical endpoints)
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
  /** When true, loadInitialData() is skipped (deep link pages set this) */
  skipInitialLoad: boolean;
  /** Addresses already synced via live balance endpoint in this session */
  balanceSyncedIds: Set<string>;
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
  expandNode: (id: string, direction: Direction) => Promise<void>;
  searchAddress: (address: string) => Promise<void>;
  addAddress: (address: string) => Promise<void>;
  findPath: (from: string, to: string, maxHops?: number) => Promise<void>;
  setPathMode: (active: boolean, from?: string) => void;
  setPathModeFrom: (from: string | null) => void;
  setPathModeTo: (to: string | null) => void;
  setPathModeMaxHops: (maxHops: number) => void;
  setPathModeDirected: (directed: boolean) => void;
  loadPathSequence: (requests: PathSequenceRequest[]) => Promise<void>;
  clearGraph: () => void;
  getCytoscapeElements: () => { nodes: CytoscapeNode[]; edges: CytoscapeEdge[] };
  enterPathView: (
    pathNodes: CytoscapeNode[],
    pathEdges: CytoscapeEdge[],
    stats?: { nodeCount: number; edgeCount: number; maxHops: number; shortestPath: number; directed: boolean },
    endpoints?: { from?: string | null; to?: string | null },
    request?: PathRequestMetadata,
    replace?: boolean
  ) => void;
  exitPathView: () => void;
  clearLastExpanded: () => void;
  loadInitialData: () => Promise<void>;
  reloadHomeGraph: () => Promise<void>;
  expandAllNodes: () => Promise<void>;
  refreshBalancesForAddresses: (addresses: string[], options?: { force?: boolean }) => Promise<void>;
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
    from: null,
    to: null,
    paths: [],
    startNodeIds: new Set(),
    endNodeIds: new Set(),
    pathNodeIds: new Set(),
    pathNodeOrder: [],
    pathEdgeIds: new Set(),
    savedNodes: null,
    savedEdges: null,
    stats: null,
  },
  layoutMode: 'fcose',
  skipInitialLoad: false,
  balanceSyncedIds: new Set(),
};

export const useGraphStore = create<GraphState & GraphActions>()(
  immer((set, get) => ({
    ...initialState,

    addNodes: (nodes) => {
      if (nodes.length === 0) return;
      const newMap = new Map(get().nodes);
      for (const node of nodes) {
        newMap.set(node.data.id, node);
      }
      set({ nodes: newMap });
    },

    addEdges: (edges) => {
      if (edges.length === 0) return;
      const newMap = new Map(get().edges);
      for (const edge of edges) {
        newMap.set(edge.data.id, edge);
      }
      set({ edges: newMap });
    },

    addGraphData: (nodes, edges) => {
      if (nodes.length === 0 && edges.length === 0) return;

      const state = get();
      const newNodes = new Map(state.nodes);
      const newEdges = new Map(state.edges);

      for (const node of nodes) {
        newNodes.set(node.data.id, node);
      }

      for (const edge of edges) {
        newEdges.set(edge.data.id, edge);
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
      const newBalanceSyncedIds = new Set(state.balanceSyncedIds);
      newBalanceSyncedIds.delete(id);

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
        balanceSyncedIds: newBalanceSyncedIds,
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

      const formattedAddress = formatNimiqAddress(address);

      try {
        // Expand from the address (data comes from batch/live indexing)
        const result = await api.expandGraph([address], 'both', filters);

        // Clear existing graph before adding new results
        clearGraph();

        // Anchor deterministic layouts (e.g. BiFlow) on initial render
        set({ lastExpandedNodeId: formattedAddress });

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
        // Remove from in-flight
        const current = get().inFlightRequests;
        const newSet = new Set(current);
        newSet.delete(requestKey);
        set({ inFlightRequests: newSet });
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
        // Fetch address metadata from API and add it as a node
        const addressData = await api.getAddress(formattedAddress);

        // Create node and add to graph
        const node: CytoscapeNode = {
          data: {
            id: addressData.id,
            label: addressData.label || truncateAddress(addressData.id),
            icon: addressData.icon,
            type: addressData.type as NodeData['type'],
            balance: addressData.balance,
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

    refreshBalancesForAddresses: async (addresses, options) => {
      if (addresses.length === 0) return;

      const force = options?.force === true;
      const state = get();
      const uniqueAddresses = Array.from(new Set(addresses.map(formatNimiqAddress)));
      const candidates = uniqueAddresses.filter((id) => {
        if (!state.nodes.has(id)) return false;
        return force || !state.balanceSyncedIds.has(id);
      });

      if (candidates.length === 0) return;

      const batches = chunkArray(candidates, LIVE_BALANCE_BATCH_SIZE);

      for (const batch of batches) {
        try {
          const result = await api.getLiveBalances(batch);

          if (result.balances.length > 0) {
            const current = get();
            const newNodes = new Map(current.nodes);
            const newBalanceSyncedIds = new Set(current.balanceSyncedIds);

            for (const entry of result.balances) {
              const existing = newNodes.get(entry.id);
              if (!existing) continue;

              newNodes.set(entry.id, {
                ...existing,
                data: {
                  ...existing.data,
                  balance: entry.balance,
                  type: entry.type as NodeData['type'],
                },
              });
              newBalanceSyncedIds.add(entry.id);
            }

            set({
              nodes: newNodes,
              balanceSyncedIds: newBalanceSyncedIds,
            });
          }

          if (result.failed.length > 0) {
            console.warn('[graph-store] Failed to refresh live balances', {
              failed: result.failed,
            });
          }
        } catch (err) {
          console.warn('[graph-store] Failed to fetch live balances', {
            error: err instanceof Error ? err.message : String(err),
            batchSize: batch.length,
          });
        }
      }
    },

    findPath: async (from, to, maxHops) => {
      const hops = maxHops ?? get().pathMode.maxHops;
      const directed = get().pathMode.directed;
      const requestKey = `path:${from}-${to}-${hops}-${directed}`;
      const canonicalRequestKey = buildPathRequestKey(from, to, hops, directed);
      const { setLoading, setError, enterPathView, inFlightRequests } = get();
      const state = get();

      if (
        state.pathView.active &&
        state.pathView.paths.length >= MAX_COMBINED_PATHS &&
        !state.pathView.paths.some((entry) => entry.requestKey === canonicalRequestKey)
      ) {
        setError(`You can combine up to ${MAX_COMBINED_PATHS} paths`);
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
        // Use the subgraph API to find all paths
        const result = await api.findSubgraph(from, to, hops, directed);

        if (!result.found) {
          setError('No path found between these addresses');
          return;
        }

        if (result.subgraph) {
          // Enter path view mode with subgraph data and stats
          enterPathView(
            result.subgraph.nodes,
            result.subgraph.edges,
            result.stats,
            { from, to },
            {
              from,
              to,
              maxHops: hops,
              directed,
              requestKey: canonicalRequestKey,
            },
          );
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

    setPathModeFrom: (from) =>
      set((state) => {
        state.pathMode.from = from;
        if (from && state.pathMode.to === from) {
          state.pathMode.to = null;
        }
      }),

    setPathModeTo: (to) =>
      set((state) => {
        if (to && state.pathMode.from === to) {
          state.pathMode.to = null;
          return;
        }
        state.pathMode.to = to;
      }),

    setPathModeMaxHops: (maxHops) =>
      set((state) => {
        state.pathMode.maxHops = maxHops;
      }),

    setPathModeDirected: (directed) =>
      set((state) => {
        state.pathMode.directed = directed;
      }),

    loadPathSequence: async (requests) => {
      if (requests.length === 0) return;

      const { setLoading, setError, enterPathView } = get();
      setLoading(true);
      setError(null);

      try {
        for (let index = 0; index < requests.length; index += 1) {
          const request = requests[index];
          const current = get();
          const shouldReplace = index === 0;
          const pathAlreadyPresent = current.pathView.paths.some(
            (entry) => entry.requestKey === request.requestKey,
          );

          if (
            !shouldReplace &&
            !pathAlreadyPresent &&
            current.pathView.paths.length >= MAX_COMBINED_PATHS
          ) {
            toast.error(`You can combine up to ${MAX_COMBINED_PATHS} paths`);
            break;
          }

          try {
            const result = await api.findSubgraph(
              request.fromAddress,
              request.toAddress,
              request.maxHops,
              request.directed,
            );

            if (!result.found || !result.subgraph) {
              if (shouldReplace) {
                setError('No path found between these addresses');
                break;
              }
              toast.error(`No path found for ${request.fromAddress} → ${request.toAddress}`);
              continue;
            }

            enterPathView(
              result.subgraph.nodes,
              result.subgraph.edges,
              result.stats,
              { from: request.fromAddress, to: request.toAddress },
              {
                from: request.fromAddress,
                to: request.toAddress,
                maxHops: request.maxHops,
                directed: request.directed,
                requestKey: request.requestKey,
              },
              shouldReplace,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to find path';
            if (shouldReplace) {
              setError(message);
              break;
            }
            toast.error(message);
          }
        }
      } finally {
        setLoading(false);
        set((state) => {
          state.pathMode = {
            active: false,
            from: null,
            to: null,
            maxHops: state.pathMode.maxHops,
            directed: state.pathMode.directed,
          };
        });
      }
    },

    clearGraph: () => {
      set({
        nodes: new Map(),
        edges: new Map(),
        selectedNodeId: null,
        selectedEdgeId: null,
        lastExpandedNodeId: null,
        skipInitialLoad: false,
        balanceSyncedIds: new Set(),
        pathMode: { active: false, from: null, to: null, maxHops: 3, directed: false },
        pathView: {
          active: false,
          from: null,
          to: null,
          paths: [],
          startNodeIds: new Set(),
          endNodeIds: new Set(),
          pathNodeIds: new Set(),
          pathNodeOrder: [],
          pathEdgeIds: new Set(),
          savedNodes: null,
          savedEdges: null,
          stats: null,
        },
      });
    },

    enterPathView: (pathNodes, pathEdges, stats, endpoints, request, replace = false) => {
      const state = get();
      const shouldReplace = replace || !state.pathView.active;

      const nextPathNodesMap = new Map<string, CytoscapeNode>();
      const nextPathEdgesMap = new Map<string, CytoscapeEdge>();
      const nextPathNodeIds = new Set<string>();
      const nextPathEdgeIds = new Set<string>();
      const nextPathNodeOrder: string[] = [];

      for (const node of pathNodes) {
        nextPathNodesMap.set(node.data.id, node);
        nextPathNodeIds.add(node.data.id);
        nextPathNodeOrder.push(node.data.id);
      }

      for (const edge of pathEdges) {
        nextPathEdgesMap.set(edge.data.id, edge);
        nextPathEdgeIds.add(edge.data.id);
      }

      const resolvedFrom = endpoints?.from ?? nextPathNodeOrder[0] ?? null;
      const resolvedTo = endpoints?.to ?? nextPathNodeOrder[nextPathNodeOrder.length - 1] ?? null;
      const resolvedMaxHops = request?.maxHops ?? stats?.maxHops ?? state.pathMode.maxHops;
      const resolvedDirected = request?.directed ?? stats?.directed ?? state.pathMode.directed;
      const resolvedRequestKey = request?.requestKey ??
        (resolvedFrom && resolvedTo
          ? buildPathRequestKey(resolvedFrom, resolvedTo, resolvedMaxHops, resolvedDirected)
          : null);

      const requestEntry = resolvedFrom && resolvedTo && resolvedRequestKey
        ? {
            from: resolvedFrom,
            to: resolvedTo,
            maxHops: resolvedMaxHops,
            directed: resolvedDirected,
            requestKey: resolvedRequestKey,
          }
        : null;

      if (shouldReplace) {
        // Save current non-path graph state. When replacing while already in
        // path view, preserve the original saved graph instead of the
        // currently displayed path graph.
        const savedNodes = state.pathView.active && state.pathView.savedNodes
          ? state.pathView.savedNodes
          : new Map(state.nodes);
        const savedEdges = state.pathView.active && state.pathView.savedEdges
          ? state.pathView.savedEdges
          : new Map(state.edges);

        const startNodeIds = new Set<string>();
        const endNodeIds = new Set<string>();
        const paths: PathRequestMetadata[] = [];

        if (requestEntry) {
          startNodeIds.add(requestEntry.from);
          endNodeIds.add(requestEntry.to);
          paths.push(requestEntry);
        }

        set({
          nodes: nextPathNodesMap,
          edges: nextPathEdgesMap,
          selectedNodeId: null,
          selectedEdgeId: null,
          pathView: {
            active: true,
            from: resolvedFrom,
            to: resolvedTo,
            paths,
            startNodeIds,
            endNodeIds,
            pathNodeIds: nextPathNodeIds,
            pathNodeOrder: nextPathNodeOrder,
            pathEdgeIds: nextPathEdgeIds,
            savedNodes,
            savedEdges,
            stats: stats || null,
          },
        });
        return;
      }

      // Append mode
      const mergedNodesMap = new Map(state.nodes);
      const mergedEdgesMap = new Map(state.edges);

      for (const [nodeId, node] of nextPathNodesMap.entries()) {
        mergedNodesMap.set(nodeId, node);
      }
      for (const [edgeId, edge] of nextPathEdgesMap.entries()) {
        mergedEdgesMap.set(edgeId, edge);
      }

      const mergedPathNodeIds = new Set(state.pathView.pathNodeIds);
      nextPathNodeIds.forEach((nodeId) => mergedPathNodeIds.add(nodeId));

      const mergedPathEdgeIds = new Set(state.pathView.pathEdgeIds);
      nextPathEdgeIds.forEach((edgeId) => mergedPathEdgeIds.add(edgeId));

      const mergedPathNodeOrder = [...state.pathView.pathNodeOrder];
      const seenPathNodes = new Set(mergedPathNodeOrder);
      for (const nodeId of nextPathNodeOrder) {
        if (seenPathNodes.has(nodeId)) continue;
        seenPathNodes.add(nodeId);
        mergedPathNodeOrder.push(nodeId);
      }

      const nextPaths = [...state.pathView.paths];
      if (requestEntry && !nextPaths.some((entry) => entry.requestKey === requestEntry.requestKey)) {
        nextPaths.push(requestEntry);
      }

      const mergedStartNodeIds = new Set(state.pathView.startNodeIds);
      if (requestEntry) {
        mergedStartNodeIds.add(requestEntry.from);
      }

      const mergedEndNodeIds = new Set(state.pathView.endNodeIds);
      if (requestEntry) {
        mergedEndNodeIds.add(requestEntry.to);
      }

      const nextStats = {
        nodeCount: mergedPathNodeIds.size,
        edgeCount: mergedPathEdgeIds.size,
        maxHops: nextPaths.length > 0 ? Math.max(...nextPaths.map((entry) => entry.maxHops)) : (stats?.maxHops ?? 0),
        shortestPath: Math.min(
          state.pathView.stats?.shortestPath ?? Number.POSITIVE_INFINITY,
          stats?.shortestPath ?? Number.POSITIVE_INFINITY,
        ),
        directed: nextPaths.length > 0 ? nextPaths.every((entry) => entry.directed) : false,
      };

      set({
        nodes: mergedNodesMap,
        edges: mergedEdgesMap,
        selectedNodeId: null,
        selectedEdgeId: null,
        pathView: {
          active: true,
          from: state.pathView.from ?? resolvedFrom,
          to: state.pathView.to ?? resolvedTo,
          paths: nextPaths,
          startNodeIds: mergedStartNodeIds,
          endNodeIds: mergedEndNodeIds,
          pathNodeIds: mergedPathNodeIds,
          pathNodeOrder: mergedPathNodeOrder,
          pathEdgeIds: mergedPathEdgeIds,
          savedNodes: state.pathView.savedNodes,
          savedEdges: state.pathView.savedEdges,
          stats: {
            ...nextStats,
            shortestPath: Number.isFinite(nextStats.shortestPath) ? nextStats.shortestPath : 0,
          },
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
          from: null,
          to: null,
          paths: [],
          startNodeIds: new Set(),
          endNodeIds: new Set(),
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
      const { nodes, filters, addGraphData, setLoading, setError, inFlightRequests } = get();

      if (nodes.size === 0 || inFlightRequests.has(requestKey)) return;

      set({ inFlightRequests: new Set(inFlightRequests).add(requestKey) });
      setLoading(true);
      setError(null);

      try {
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

    reloadHomeGraph: async () => {
      const { setLoading, setError } = get();
      const requestId = ++latestHomeReloadRequestId;
      const shouldApplyHomeReload = () =>
        requestId === latestHomeReloadRequestId &&
        !get().skipInitialLoad &&
        !get().pathView.active;

      setLoading(true);
      setError(null);

      try {
        const result = await api.getLatestBlocksGraph(10);
        if (!shouldApplyHomeReload()) {
          return;
        }
        const nextNodes = new Map<string, CytoscapeNode>();
        const nextEdges = new Map<string, CytoscapeEdge>();

        for (const node of result.nodes) {
          nextNodes.set(node.data.id, node);
        }
        for (const edge of result.edges) {
          nextEdges.set(edge.data.id, edge);
        }

        set((state) => {
          if (
            requestId !== latestHomeReloadRequestId ||
            state.skipInitialLoad ||
            state.pathView.active
          ) {
            return;
          }
          state.nodes = nextNodes;
          state.edges = nextEdges;
          state.selectedNodeId = state.selectedNodeId && nextNodes.has(state.selectedNodeId)
            ? state.selectedNodeId
            : null;
          state.selectedEdgeId = state.selectedEdgeId && nextEdges.has(state.selectedEdgeId)
            ? state.selectedEdgeId
            : null;
          state.skipInitialLoad = false;
          state.pathMode = {
            active: false,
            from: null,
            to: null,
            maxHops: state.pathMode.maxHops,
            directed: state.pathMode.directed,
          };
          state.pathView = {
            active: false,
            from: null,
            to: null,
            paths: [],
            startNodeIds: new Set(),
            endNodeIds: new Set(),
            pathNodeIds: new Set(),
            pathNodeOrder: [],
            pathEdgeIds: new Set(),
            savedNodes: null,
            savedEdges: null,
            stats: null,
          };
        });
      } catch (err) {
        if (shouldApplyHomeReload()) {
          setError(err instanceof Error ? err.message : 'Failed to reload home graph');
        }
      } finally {
        if (shouldApplyHomeReload()) {
          setLoading(false);
        }
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
