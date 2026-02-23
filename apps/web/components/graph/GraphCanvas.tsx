'use client';

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape, { Core } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { type CytoscapeNode, type CytoscapeEdge, type NodeData } from '@nim-stalker/shared';
import { useGraphStore } from '@/store/graph-store';
import { NodeContextMenu } from './NodeContextMenu';
import { bindCyEvents } from './graph-events';
import {
  getExclusiveNeighbors,
  moveNeighborsByDelta,
  shouldEnableCompoundDrag,
} from './drag-utils';
import {
  computeTinyPathPositions,
  getLayoutOptions,
  getPathLayoutOptions,
  getIncrementalLayoutOptions,
  getIncrementalOptionsForMode,
} from '@/lib/layout-configs';
import { formatNimiq } from '@/lib/format-utils';
import { ensureLayoutRegistered } from '@/lib/layout-loader';
import { computeDirectedFlowPositions, computeIncrementalDirectedFlow } from '@/lib/layout-directed-flow';
import { computeBiFlowPositions } from '@/lib/layout-biflow';
import { identiconManager } from '@/lib/identicon-manager';
import { computeGraphHash, saveLayoutPositions, getLayoutPositions } from '@/lib/layout-cache';
import { registerUiExtensions, attachUiExtensions } from '@/lib/cytoscape-ui-extensions';
import { CYTOSCAPE_UI_EXTENSION_MODULES } from '@/lib/cytoscape-ui-extension-modules';
import { getConnectedTxActivity } from './tooltip-utils';

// Register default layout statically (always needed)
cytoscape.use(fcose);
registerUiExtensions(cytoscape, CYTOSCAPE_UI_EXTENSION_MODULES);

// NQ stylesheet - colorful, rounded, playful
// Using 'any' for style objects because TypeScript types don't include all valid Cytoscape.js properties
const stylesheet: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      'background-opacity': 0,
      'background-image': 'data(identicon)',
      'background-fit': 'contain',
      'background-clip': 'none',
      'background-width': '100%',
      'background-height': '100%',
      'background-position-x': '50%',
      'background-position-y': '50%',
      'background-image-smoothing': 'yes',
      label: 'data(label)',
      color: '#000000',
      'text-outline-color': '#FFFFFF',
      'text-outline-width': 2,
      'font-size': '11px',
      'font-weight': 'bold',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 8,
      width: 64,
      height: 64,
      shape: 'ellipse',
    } as any,
  },
  {
    selector: 'node:selected',
    style: {
      'overlay-padding': 8,
      'overlay-color': '#FF69B4',
      'overlay-opacity': 0.2,
      'overlay-shape': 'ellipse',
    },
  },
  {
    selector: 'node.path-start',
    style: {
      'overlay-padding': 8,
      'overlay-color': '#8B8BF5',
      'overlay-opacity': 0.3,
      'overlay-shape': 'ellipse',
    },
  },
  {
    selector: 'node.path-end',
    style: {
      'overlay-padding': 8,
      'overlay-color': '#FF69B4',
      'overlay-opacity': 0.3,
      'overlay-shape': 'ellipse',
    },
  },
  {
    selector: 'node.path-intermediate',
    style: {
      'overlay-padding': 8,
      'overlay-color': '#FACC15',
      'overlay-opacity': 0.3,
      'overlay-shape': 'ellipse',
    },
  },
  {
    selector: 'edge',
    style: {
      // Dynamic width based on transaction count: 1 tx → 3px, 300+ tx → 15px
      width: 'mapData(txCount, 1, 300, 3, 15)' as any,
      'line-color': 'rgba(107, 114, 128, 0.3)',
      'target-arrow-color': 'rgba(107, 114, 128, 0.3)',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'arrow-scale': 1.2,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#FF69B4', // NQ pink
      'target-arrow-color': '#FF69B4',
      'line-style': 'solid',
      // Inherits dynamic width from base edge selector
    },
  },
  {
    selector: 'edge.outgoing-from-selected',
    style: {
      'line-color': '#FF69B4', // NQ pink for outgoing
      'target-arrow-color': '#FF69B4',
      // Inherits dynamic width from base edge selector
    },
  },
  {
    selector: 'edge.incoming-to-selected',
    style: {
      'line-color': '#22C55E', // Green for incoming
      'target-arrow-color': '#22C55E',
      // Inherits dynamic width from base edge selector
    },
  },
  {
    selector: 'edge.dimmed',
    style: {
      opacity: 0.2,
    },
  },
  {
    selector: 'edge.path-edge',
    style: {
      'line-color': '#8B8BF5', // Periwinkle for path
      'target-arrow-color': '#8B8BF5',
      // Inherits dynamic width from base edge selector
    },
  },
];


// Tooltip component for node hover
interface NodeTooltipProps {
  visible: boolean;
  nodeId: string | null;
  x: number;
  y: number;
  nodesMap: Map<string, CytoscapeNode>;
  edgesMap: Map<string, CytoscapeEdge>;
}

function NodeTooltip({ visible, nodeId, x, y, nodesMap, edgesMap }: NodeTooltipProps) {
  if (!visible || !nodeId) return null;

  const nodeData = nodesMap.get(nodeId)?.data;
  if (!nodeData) return null;

  return (
    <div
      className="absolute nq-card py-2 px-3 text-xs z-50 pointer-events-none whitespace-nowrap"
      style={{
        left: x,
        top: y - 50,
        transform: 'translateX(-50%)',
      }}
    >
      {renderTooltipContent(nodeData, nodeId, edgesMap)}
    </div>
  );
}

function renderTooltipContent(
  nodeData: NodeData,
  nodeId: string,
  edgesMap: Map<string, CytoscapeEdge>
): JSX.Element {
  if (nodeData.txCount !== undefined) {
    return (
      <span className="font-bold uppercase tracking-wide text-green-600">
        {nodeData.txCount.toLocaleString()} TX
      </span>
    );
  }

  const recentActivity = getConnectedTxActivity(nodeId, edgesMap);
  if (recentActivity) {
    return (
      <span className="font-bold uppercase tracking-wide text-nq-periwinkle">
        {formatNimiq(recentActivity.totalValue)} · {recentActivity.txCount.toLocaleString()} TX
      </span>
    );
  }

  return (
    <span className="font-bold uppercase tracking-wide text-nq-periwinkle">
      No transactions
    </span>
  );
}

// Tooltip component for edge hover
interface EdgeTooltipProps {
  visible: boolean;
  edgeId: string | null;
  x: number;
  y: number;
  edgesMap: Map<string, CytoscapeEdge>;
}

function EdgeTooltip({ visible, edgeId, x, y, edgesMap }: EdgeTooltipProps) {
  if (!visible || !edgeId) return null;

  const edgeData = edgesMap.get(edgeId)?.data;
  if (!edgeData) return null;

  const txCount = edgeData.txCount ?? 0;

  return (
    <div
      className="absolute nq-card py-2 px-3 text-xs z-50 pointer-events-none whitespace-nowrap"
      style={{
        left: x,
        top: y - 30,
        transform: 'translateX(-50%)',
      }}
    >
      <span className="font-bold uppercase tracking-wide">
        {txCount.toLocaleString()} TX
      </span>
    </div>
  );
}

export function GraphCanvas() {
  const cyRef = useRef<Core | null>(null);
  const [cyInstance, setCyInstance] = useState<Core | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevNodeCountRef = useRef<number>(0);
  const prevLayoutModeRef = useRef<string | null>(null);
  const prevPathViewActiveRef = useRef<boolean>(false);

  // Layout cancellation: stop previous layout before starting a new one
  const runningLayoutRef = useRef<cytoscape.Layouts | null>(null);
  // Layout debounce: batch rapid expansions into a single layout run
  const layoutDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation counter: incremented each time a layout is requested, so async
  // callbacks (ensureLayoutRegistered) can detect if they've been superseded
  const layoutGenerationRef = useRef<number>(0);

  // Refs for compound drag behavior
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const exclusiveNeighborsRef = useRef<cytoscape.NodeCollection | null>(null);

  // Tooltip state and refs
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    nodeId: string | null;
  }>({ visible: false, x: 0, y: 0, nodeId: null });

  // Edge tooltip state and refs
  const edgeHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    edgeId: string | null;
  }>({ visible: false, x: 0, y: 0, edgeId: null });

  // Subscribe to Maps - new Map references trigger re-renders since we create new Maps on updates
  const nodesMap = useGraphStore((state) => state.nodes);
  const edgesMap = useGraphStore((state) => state.edges);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const pathMode = useGraphStore((state) => state.pathMode);
  const pathView = useGraphStore((state) => state.pathView);
  const findPath = useGraphStore((state) => state.findPath);
  const clearLastExpanded = useGraphStore((state) => state.clearLastExpanded);
  const loadInitialData = useGraphStore((state) => state.loadInitialData);
  const layoutMode = useGraphStore((state) => state.layoutMode);
  // Memoize array conversion to avoid creating new arrays every render
  const nodes = useMemo(() => Array.from(nodesMap.values()), [nodesMap]);
  const edges = useMemo(() => Array.from(edgesMap.values()), [edgesMap]);

  // Create Cytoscape elements format with identicons
  // Must spread data objects to avoid "Cannot assign to read only property" errors
  // since Zustand/Immer freezes state objects and Cytoscape mutates them internally
  const cytoscapeElements = useMemo(() => [
    ...nodes.map((n) => ({
      data: {
        ...n.data,
        type: n.data.type,
        // Pass cy ref so PNG conversion can update nodes when complete
        identicon: n.data.icon || identiconManager.getIdenticonDataUri(n.data.id),
      }
    })),
    ...edges.map((e) => ({ data: { ...e.data } })),
  ], [nodes, edges]);

  const handleCyInit = useCallback((cy: Core) => {
    cyRef.current = cy;
    setCyInstance((prev) => (prev === cy ? prev : cy));
  }, []);

  // Register Cytoscape interaction handlers once per cy instance.
  useEffect(() => {
    const cy = cyInstance;
    if (!cy) return;

    const cleanupUiExtensions = attachUiExtensions(cy, {
      navigatorContainer: '#nq-graph-navigator',
    });

    const cleanupEvents = bindCyEvents(cy, {
      onTapNode: (evt) => {
        useGraphStore.getState().selectNode(evt.target.id());
      },
      onTapEdge: (evt) => {
        useGraphStore.getState().selectEdge(evt.target.id());
      },
      onTapBackground: (evt) => {
        if (evt.target === cy) {
          const state = useGraphStore.getState();
          state.selectNode(null);
          state.selectEdge(null);
        }
      },
      onDblTapNode: async (evt) => {
        const nodeId = evt.target.id();
        await useGraphStore.getState().expandNode(nodeId, 'both');
      },
      onMouseOverNode: (evt) => {
        const container = cy.container();
        if (container) container.style.cursor = 'pointer';

        const node = evt.target;
        const nodeId = node.id();

        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
        if (edgeHoverTimeoutRef.current) {
          clearTimeout(edgeHoverTimeoutRef.current);
          edgeHoverTimeoutRef.current = null;
        }
        setEdgeTooltip((prev) => ({ ...prev, visible: false }));

        hoverTimeoutRef.current = setTimeout(() => {
          const pos = node.renderedPosition();
          setTooltip({
            visible: true,
            x: pos.x,
            y: pos.y,
            nodeId,
          });
        }, 300);
      },
      onMouseOutNode: () => {
        const container = cy.container();
        if (container) container.style.cursor = 'default';

        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
        setTooltip((prev) => ({ ...prev, visible: false }));
      },
      onMouseOverEdge: (evt) => {
        const container = cy.container();
        if (container) container.style.cursor = 'pointer';

        const edge = evt.target;
        const edgeId = edge.id();

        if (edgeHoverTimeoutRef.current) {
          clearTimeout(edgeHoverTimeoutRef.current);
        }
        setTooltip((prev) => ({ ...prev, visible: false }));

        edgeHoverTimeoutRef.current = setTimeout(() => {
          const midpoint = edge.renderedMidpoint();
          setEdgeTooltip({
            visible: true,
            x: midpoint.x,
            y: midpoint.y,
            edgeId,
          });
        }, 250);
      },
      onMouseOutEdge: () => {
        const container = cy.container();
        if (container) container.style.cursor = 'default';

        if (edgeHoverTimeoutRef.current) {
          clearTimeout(edgeHoverTimeoutRef.current);
          edgeHoverTimeoutRef.current = null;
        }
        setEdgeTooltip((prev) => ({ ...prev, visible: false }));
      },
      onGrabNode: (evt) => {
        const node = evt.target;
        const exclusiveNeighbors = getExclusiveNeighbors(cy, node.id());

        if (!shouldEnableCompoundDrag(exclusiveNeighbors.length)) {
          dragStartPosRef.current = null;
          exclusiveNeighborsRef.current = null;
          return;
        }

        const pos = node.position();
        dragStartPosRef.current = { x: pos.x, y: pos.y };
        exclusiveNeighborsRef.current = exclusiveNeighbors;
      },
      onDragNode: (evt) => {
        if (!dragStartPosRef.current || !exclusiveNeighborsRef.current) return;

        const node = evt.target;
        const currentPos = node.position();
        const deltaX = currentPos.x - dragStartPosRef.current.x;
        const deltaY = currentPos.y - dragStartPosRef.current.y;

        moveNeighborsByDelta(cy, exclusiveNeighborsRef.current, deltaX, deltaY);
        dragStartPosRef.current = { x: currentPos.x, y: currentPos.y };
      },
      onFreeNode: () => {
        dragStartPosRef.current = null;
        exclusiveNeighborsRef.current = null;
      },
    });

    return () => {
      cleanupEvents();
      cleanupUiExtensions();
    };
  }, [cyInstance]);

  // Load initial data on mount
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Wire up identicon manager: update Cytoscape nodes when PNG conversions complete
  useEffect(() => {
    identiconManager.setNodeUpdateCallback((address, pngDataUri) => {
      const cy = cyRef.current;
      if (!cy) return;
      const node = cy.getElementById(address);
      if (node.length > 0) {
        node.data('identicon', pngDataUri);
      }
    });

    return () => {
      identiconManager.setNodeUpdateCallback(null);
    };
  }, []);

  // Viewport-aware identicon generation: only convert PNGs for visible nodes
  useEffect(() => {
    const cy = cyInstance;
    if (!cy) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleViewport = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const ext = cy.extent();
        const visibleIds = cy.nodes().filter((n) => {
          const bb = n.boundingBox();
          return bb.x1 <= ext.x2 && bb.x2 >= ext.x1 && bb.y1 <= ext.y2 && bb.y2 >= ext.y1;
        }).map((n) => n.id());
        identiconManager.generateForViewport(visibleIds);
      }, 200);
    };

    cy.on('viewport', handleViewport);
    return () => {
      cy.off('viewport', handleViewport);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [cyInstance]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (edgeHoverTimeoutRef.current) {
        clearTimeout(edgeHoverTimeoutRef.current);
      }
      if (layoutDebounceRef.current) {
        clearTimeout(layoutDebounceRef.current);
      }
      if (runningLayoutRef.current) {
        runningLayoutRef.current.stop();
        runningLayoutRef.current = null;
      }
    };
  }, []);

  // Sync elements with Cytoscape instance when they change
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Get current element IDs in Cytoscape (also used for fixedNodeConstraint)
    const existingNodeIds = new Set(cy.nodes().map((n) => n.id()));
    const existingEdgeIds = new Set(cy.edges().map((e) => e.id()));

    // Get new element IDs from state
    const newNodeIds = new Set(nodes.map((n) => n.data.id));
    const newEdgeIds = new Set(edges.map((e) => e.data.id));

    // Find elements to add
    const nodesToAdd = nodes.filter((n) => !existingNodeIds.has(n.data.id));
    const edgesToAdd = edges.filter((e) => !existingEdgeIds.has(e.data.id));

    // Find elements to remove
    const nodeIdsToRemove = Array.from(existingNodeIds).filter((id) => !newNodeIds.has(id));
    const edgeIdsToRemove = Array.from(existingEdgeIds).filter((id) => !newEdgeIds.has(id));

    // Apply changes
    if (nodeIdsToRemove.length > 0 || edgeIdsToRemove.length > 0) {
      cy.remove(cy.getElementById(nodeIdsToRemove.join(',')));
      cy.remove(cy.getElementById(edgeIdsToRemove.join(',')));
    }

    // Read lastExpandedNodeId from store state (not a dependency) to avoid
    // double-firing the effect when expandNode sets it separately from addGraphData
    const lastExpandedNodeId = useGraphStore.getState().lastExpandedNodeId;

    // Position new nodes around the expanded node before adding them
    // Calculate offset direction: away from the center of mass of existing nodes
    let offsetX = 0;
    let offsetY = 0;

    if (lastExpandedNodeId && existingNodeIds.size > 1) {
      // Calculate center of mass of existing nodes (excluding the expanded node)
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      cy.nodes().forEach((node) => {
        if (node.id() !== lastExpandedNodeId) {
          const pos = node.position();
          sumX += pos.x;
          sumY += pos.y;
          count++;
        }
      });

      if (count > 0) {
        const centerX = sumX / count;
        const centerY = sumY / count;

        // Get expanded node position
        const expandedNode = cy.getElementById(lastExpandedNodeId);
        if (expandedNode.length > 0) {
          const expandedPos = expandedNode.position();

          // Vector from center of mass to expanded node
          const vecX = expandedPos.x - centerX;
          const vecY = expandedPos.y - centerY;
          const magnitude = Math.sqrt(vecX * vecX + vecY * vecY);

          if (magnitude > 0) {
            // Normalize and scale to push new nodes away from existing cluster
            offsetX = (vecX / magnitude) * 400;
            offsetY = (vecY / magnitude) * 400;
          }
        }
      }
    }

    const nodesToAddWithPosition = nodesToAdd.map((n, index) => {
      const nodeData = {
        group: 'nodes' as const,
        data: {
          ...n.data,
          // Pass cy ref so PNG conversion can update nodes when complete
          identicon: n.data.icon || identiconManager.getIdenticonDataUri(n.data.id),
        },
        position: undefined as { x: number; y: number } | undefined,
      };

      // If we have an expanded node source, position new nodes in a circle around it
      // with an offset away from the existing cluster
      if (lastExpandedNodeId) {
        const sourceNode = cy.getElementById(lastExpandedNodeId);
        if (sourceNode.length > 0) {
          const sourcePos = sourceNode.position();
          const radius = 300; // Larger radius for better initial spacing
          const angle = (2 * Math.PI * index) / nodesToAdd.length;
          nodeData.position = {
            x: sourcePos.x + offsetX + radius * Math.cos(angle),
            y: sourcePos.y + offsetY + radius * Math.sin(angle),
          };
        }
      }

      return nodeData;
    });

    if (nodesToAddWithPosition.length > 0 || edgesToAdd.length > 0) {
      cy.add([
        ...nodesToAddWithPosition,
        ...edgesToAdd.map((e) => ({ group: 'edges' as const, data: { ...e.data } })),
      ]);
    }

    // Check if we need to relayout
    const currentNodeCount = cy.nodes().length;
    const nodeCountChanged = currentNodeCount !== prevNodeCountRef.current;

    // Detect layout mode change
    const layoutModeChanged = prevLayoutModeRef.current !== null &&
                              prevLayoutModeRef.current !== layoutMode;
    prevLayoutModeRef.current = layoutMode;

    // Detect path view activation — always force layout when entering path view
    const pathViewJustActivated = pathView.active && !prevPathViewActiveRef.current;
    prevPathViewActiveRef.current = pathView.active;

    // Guard: only trigger layout when there are actual changes requiring repositioning.
    // Note: CytoscapeComponent may add elements via props before this effect runs,
    // so hasNewElements can be false even when nodeCountChanged is true (initial load).
    const hasNewElements = nodesToAdd.length > 0 || edgesToAdd.length > 0;
    const needsLayout = hasNewElements || layoutModeChanged || nodeCountChanged || pathViewJustActivated;
    if (!needsLayout || currentNodeCount === 0) {
      prevNodeCountRef.current = currentNodeCount;
      // Still clear expanded ref if set, even though no layout runs
      if (lastExpandedNodeId) clearLastExpanded();
      // Fall through to path view styling below (don't return early)
    } else if (needsLayout && currentNodeCount > 0) {
      // Cancel any pending debounced layout
      if (layoutDebounceRef.current) {
        clearTimeout(layoutDebounceRef.current);
        layoutDebounceRef.current = null;
      }

      // Capture a generation token so async callbacks can detect staleness
      const layoutGeneration = ++layoutGenerationRef.current;

      // Helper: stop previous layout before starting a new one
      const stopPreviousLayout = () => {
        if (runningLayoutRef.current) {
          runningLayoutRef.current.stop();
          runningLayoutRef.current = null;
        }
      };

      // Helper: save current node positions to layout cache
      const savePositionsToCache = () => {
        const nodeIds = cy.nodes().map((n) => n.id());
        const edgeKeys = cy.edges().map((e) => `${e.source().id()}-${e.target().id()}`);
        const hash = computeGraphHash(nodeIds, edgeKeys);
        const positions = new Map<string, { x: number; y: number }>();
        cy.nodes().forEach((n) => { positions.set(n.id(), { ...n.position() }); });
        saveLayoutPositions(layoutMode, hash, positions);
      };

      // Helper: track a layout and run it (with staleness guard)
      const trackAndRun = (layout: cytoscape.Layouts) => {
        // If a newer layout request has been made, don't start this one
        if (layoutGeneration !== layoutGenerationRef.current) return;
        stopPreviousLayout();
        runningLayoutRef.current = layout;
        layout.on('layoutstop', () => {
          if (runningLayoutRef.current === layout) {
            runningLayoutRef.current = null;
          }
          savePositionsToCache();
        });
        layout.run();
      };

      const executeLayout = () => {
        // Re-check staleness: a newer effect invocation may have superseded this one
        if (layoutGeneration !== layoutGenerationRef.current) return;

        // Stop any layout that started from a previous debounce cycle
        stopPreviousLayout();

        // Check layout cache: if we have cached positions for this graph + mode, apply instantly
        if (layoutModeChanged && !pathView.active) {
          const nodeIds = cy.nodes().map((n) => n.id());
          const edgeKeys = cy.edges().map((e) => `${e.source().id()}-${e.target().id()}`);
          const hash = computeGraphHash(nodeIds, edgeKeys);
          const cached = getLayoutPositions(layoutMode, hash);
          if (cached) {
            cy.batch(() => {
              cy.nodes().forEach((n) => {
                const pos = cached.get(n.id());
                if (pos) n.position(pos);
              });
            });

            // Keep camera behavior consistent with normal layout runs:
            // when a cached layout is applied, still fit if that layout mode expects fit.
            const cachedLayoutOpts = getLayoutOptions(layoutMode, cy.nodes().length) as {
              fit?: boolean;
              padding?: number;
            };
            if (cachedLayoutOpts.fit !== false) {
              const padding = typeof cachedLayoutOpts.padding === 'number' ? cachedLayoutOpts.padding : 30;
              cy.fit(cy.elements(), padding);
            }
            return;
          }
        }

        // Re-read node count at execution time (not capture time) for accurate adaptive config
        const freshNodeCount = cy.nodes().length;

        if (pathView.active) {
          // Path view: for tiny 2-node paths, force deterministic vertical positions.
          if (freshNodeCount === 2 && pathView.pathNodeOrder.length >= 2) {
            const positions = computeTinyPathPositions(pathView.pathNodeOrder);
            cy.nodes().forEach((n) => {
              const pos = positions.get(n.id());
              if (pos) n.scratch('_tinyPathPos', pos);
            });
            const layout = cy.layout({
              name: 'preset',
              fit: true,
              padding: 140,
              animate: true,
              animationDuration: 300,
              positions: (node: any) => node.scratch('_tinyPathPos') || node.position(),
            } as any);
            trackAndRun(layout);
            return;
          }

          // Larger path views still use tuned fCoSE.
          const layout = cy.layout(getPathLayoutOptions() as any);
          trackAndRun(layout);
        } else if (layoutMode.startsWith('biflow-')) {
          // BiFlow: deterministic directed tiers around a focus node.
          // Always run full layout (incremental fCoSE would destroy tier structure).
          const selectedFromStore = useGraphStore.getState().selectedNodeId;

          // Pick focus: last expanded → selected → hub
          let focusId =
            (lastExpandedNodeId && cy.getElementById(lastExpandedNodeId).length > 0 ? lastExpandedNodeId : null)
            ?? (selectedFromStore && cy.getElementById(selectedFromStore).length > 0 ? selectedFromStore : null);

          if (!focusId) {
            const incidentSum = new Map<string, number>();
            cy.edges().forEach((e) => {
              const raw = e.data('txCount') as unknown;
              const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0;
              const txCount = Number.isFinite(n) && n > 0 ? n : 1;
              const s = e.source().id();
              const t = e.target().id();
              incidentSum.set(s, (incidentSum.get(s) ?? 0) + txCount);
              incidentSum.set(t, (incidentSum.get(t) ?? 0) + txCount);
            });

            let bestId = cy.nodes()[0]?.id() ?? '';
            let bestScore = -Infinity;
            for (const [id, score] of incidentSum) {
              if (score > bestScore) {
                bestScore = score;
                bestId = id;
              }
            }
            focusId = bestId;
          }

          const allCyNodes = cy.nodes().map((n) => ({ id: n.id() }));
          const allCyEdges = cy.edges().map((e) => ({
            source: e.source().id(),
            target: e.target().id(),
            txCount: e.data('txCount') as number | undefined,
          }));

          const orientation = layoutMode === 'biflow-lr' ? 'LR' : 'TB';
          const positions = computeBiFlowPositions(allCyNodes, allCyEdges, focusId, orientation);
          cy.nodes().forEach((n) => {
            const pos = positions.get(n.id());
            if (pos) n.scratch('_biflowPos', pos);
          });

          const layout = cy.layout(getLayoutOptions(layoutMode, freshNodeCount) as any);
          trackAndRun(layout);
        } else if (layoutMode === 'concentric-volume') {
          const layout = cy.layout(getLayoutOptions('concentric-volume', freshNodeCount) as any);
          trackAndRun(layout);
        } else if (existingNodeIds.size > 0 && nodesToAdd.length > 0 && layoutMode === 'directed-flow' && lastExpandedNodeId) {
          // Directed-flow incremental: compute positions for new nodes using directed BFS
          const newNodeIdSet = new Set(nodesToAdd.map(n => n.data.id));
          const allCyNodes = cy.nodes().map((n) => ({ id: n.id() }));
          const allCyEdges = cy.edges().map((e) => ({
            source: e.source().id(),
            target: e.target().id(),
            txCount: e.data('txCount') as number | undefined,
          }));
          const existingPos = new Map<string, { x: number; y: number }>();
          cy.nodes().forEach((n) => {
            if (!newNodeIdSet.has(n.id())) {
              existingPos.set(n.id(), { ...n.position() });
            }
          });

          const positions = computeIncrementalDirectedFlow(
            allCyNodes, allCyEdges, existingPos, newNodeIdSet, lastExpandedNodeId,
          );

          // Set scratch data and run preset layout on new nodes only
          cy.nodes().forEach((n) => {
            const pos = positions.get(n.id());
            if (pos) n.scratch('_directedFlowPos', pos);
          });

          const incrementalOpts = getIncrementalOptionsForMode('directed-flow');
          if (incrementalOpts) {
            const newNodes = cy.nodes().filter((n) => newNodeIdSet.has(n.id()));
            const layout = newNodes.layout(incrementalOpts as any);
            trackAndRun(layout);
          }
        } else if (
          existingNodeIds.size > 0
          && nodesToAdd.length > 0
          && !layoutMode.startsWith('elk-')
          && !layoutMode.startsWith('dagre-')
          && !layoutMode.startsWith('biflow-')
        ) {
          // Incremental expansion: always use fCoSE for subset layout regardless of active layout mode.
          // fCoSE is statically registered and handles fixedNodeConstraint + subset layouts safely.
          // Hierarchical layouts (ELK/Dagre) need full graph structure, so they fall through to full re-layout.
          cy.nodes().forEach((node) => {
            if (existingNodeIds.has(node.id())) {
              node.lock();
            }
          });

          const newNodeIds = new Set(nodesToAdd.map(n => n.data.id));
          const newNodes = cy.nodes().filter((node) => newNodeIds.has(node.id()));
          const expandedNode = lastExpandedNodeId ? cy.getElementById(lastExpandedNodeId) : null;

          if (expandedNode && expandedNode.length > 0) {
            const expandedPos = expandedNode.position();
            const connectedExistingNodes = expandedNode.neighborhood('node').filter(
              (n: cytoscape.NodeSingular) => existingNodeIds.has(n.id()) && n.id() !== lastExpandedNodeId
            );

            let directionX = 0;
            let directionY = 0;

            if (connectedExistingNodes.length > 0) {
              let centroidX = 0;
              let centroidY = 0;
              connectedExistingNodes.forEach((n: cytoscape.NodeSingular) => {
                const pos = n.position();
                centroidX += pos.x;
                centroidY += pos.y;
              });
              centroidX /= connectedExistingNodes.length;
              centroidY /= connectedExistingNodes.length;

              directionX = expandedPos.x - centroidX;
              directionY = expandedPos.y - centroidY;

              const magnitude = Math.sqrt(directionX * directionX + directionY * directionY);
              if (magnitude > 0) {
                directionX /= magnitude;
                directionY /= magnitude;
              }
            } else {
              directionX = 1;
              directionY = 0;
            }

            // Estimate local density using bounding box area instead of O(n²) distance checks
            const bbox = cy.nodes().boundingBox();
            const bboxArea = Math.max(bbox.w * bbox.h, 1);
            const avgDensity = cy.nodes().length / bboxArea;
            // Scale to approximate neighbor count equivalent (comparable to old densityRadius=400 circle area)
            const maxNeighborCount = Math.round(avgDensity * Math.PI * 400 * 400);

            const newNodeCount = newNodes.length;
            const baseDistance = 900 + Math.sqrt(newNodeCount) * 150;
            const offsetDistance = baseDistance + (maxNeighborCount * 100);

            const newExpandedX = expandedPos.x + (directionX * offsetDistance);
            const newExpandedY = expandedPos.y + (directionY * offsetDistance);

            expandedNode.unlock();
            expandedNode.position({ x: newExpandedX, y: newExpandedY });

            const angleStep = (2 * Math.PI) / Math.max(newNodeCount, 1);
            const spreadRadius = Math.max(200, 100 + Math.sqrt(newNodeCount) * 50);

            newNodes.forEach((node: cytoscape.NodeSingular, index: number) => {
              const angle = index * angleStep;
              node.position({
                x: newExpandedX + Math.cos(angle) * spreadRadius,
                y: newExpandedY + Math.sin(angle) * spreadRadius,
              });
            });
          }

          const relevantEdges = cy.edges().filter((edge) => {
            return newNodeIds.has(edge.source().id()) || newNodeIds.has(edge.target().id());
          });

          const expandedNodeCollection = expandedNode ? cy.collection().union(expandedNode) : cy.collection();
          const elementsToLayout = newNodes.union(expandedNodeCollection).union(relevantEdges);

          const fixedConstraints: Array<{ nodeId: string; position: { x: number; y: number } }> = [];
          if (expandedNode && expandedNode.length > 0) {
            const pos = expandedNode.position();
            fixedConstraints.push({
              nodeId: lastExpandedNodeId!,
              position: { x: pos.x, y: pos.y },
            });
          }
          const layoutOptions = {
            ...getIncrementalLayoutOptions(),
            fixedNodeConstraint: fixedConstraints.length > 0 ? fixedConstraints : undefined,
          };

          const layout = elementsToLayout.layout(layoutOptions as any);

          layout.on('layoutstop', () => {
            cy.nodes().forEach((node) => {
              node.unlock();
            });
          });

          trackAndRun(layout);
        } else if (layoutMode === 'directed-flow') {
          // Directed-flow full layout: compute positions, set scratch, run preset
          const allCyNodes = cy.nodes().map((n) => ({ id: n.id() }));
          const allCyEdges = cy.edges().map((e) => ({
            source: e.source().id(),
            target: e.target().id(),
            txCount: e.data('txCount') as number | undefined,
          }));
          const positions = computeDirectedFlowPositions(allCyNodes, allCyEdges);
          cy.nodes().forEach((n) => {
            const pos = positions.get(n.id());
            if (pos) n.scratch('_directedFlowPos', pos);
          });
          const layout = cy.layout(getLayoutOptions('directed-flow', freshNodeCount) as any);
          trackAndRun(layout);
        } else {
          // All other layouts (including fcose first-time): use config registry
          // Dynamically load layout engine if needed, then run
          const runLayout = async () => {
            try {
              await ensureLayoutRegistered(layoutMode);
              // After async load, check if this layout request is still current
              if (layoutGeneration !== layoutGenerationRef.current) return;
              const layout = cy.layout(getLayoutOptions(layoutMode, freshNodeCount) as any);
              trackAndRun(layout);
            } catch (err) {
              if (layoutGeneration !== layoutGenerationRef.current) return;
              console.warn(`Layout "${layoutMode}" failed, falling back to fcose:`, err);
              const fallback = cy.layout(getLayoutOptions('fcose', freshNodeCount) as any);
              trackAndRun(fallback);
            }
          };
          runLayout();
        }
      };

      // Debounce layout runs — longer for physics-based layouts (Cola)
      // which are expensive, shorter for deterministic layouts.
      const debounceMs = layoutMode === 'cola' ? 300 : 150;
      layoutDebounceRef.current = setTimeout(executeLayout, debounceMs);

      // Clear the expanded node reference after layout
      clearLastExpanded();
    }

    // Apply path view styling
    if (pathView.active && pathView.pathNodeOrder.length > 0) {
      // Clear previous path classes
      cy.nodes().removeClass('path-start path-end path-intermediate');
      cy.edges().removeClass('path-edge');

      // Use ordered array for proper start/intermediate/end detection
      const pathOrder = pathView.pathNodeOrder;
      if (pathOrder.length >= 2) {
        // First node is start (periwinkle)
        cy.getElementById(pathOrder[0]).addClass('path-start');
        // Last node is end (pink)
        cy.getElementById(pathOrder[pathOrder.length - 1]).addClass('path-end');

        // All nodes in between are intermediate (yellow)
        for (let i = 1; i < pathOrder.length - 1; i++) {
          cy.getElementById(pathOrder[i]).addClass('path-intermediate');
        }
      }

      // Style path edges
      pathView.pathEdgeIds.forEach((edgeId) => {
        cy.getElementById(edgeId).addClass('path-edge');
      });
    }

    // Stabilize 2-node path views on initial load: force deterministic vertical positions.
    if (pathView.active && pathView.pathNodeOrder.length >= 2 && cy.nodes().length === 2) {
      const positions = computeTinyPathPositions(pathView.pathNodeOrder);
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          const pos = positions.get(n.id());
          if (pos) n.position(pos);
        });
      });
      cy.fit(cy.nodes(), 140);
    }

    prevNodeCountRef.current = currentNodeCount;
  }, [nodes, edges, pathView.active, pathView.pathNodeOrder, pathView.pathEdgeIds, clearLastExpanded, layoutMode]);

  // Highlight edges connected to selected node with direction-based colors
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      // Clear previous highlighting
      cy.edges().removeClass('outgoing-from-selected incoming-to-selected dimmed');

      if (selectedNodeId) {
        // Use selector API instead of .filter() for better performance
        const escapedId = selectedNodeId.replace(/"/g, '\\"');
        const outgoingEdges = cy.edges(`[source = "${escapedId}"]`);
        outgoingEdges.addClass('outgoing-from-selected');

        const incomingEdges = cy.edges(`[target = "${escapedId}"]`);
        incomingEdges.addClass('incoming-to-selected');

        const connectedEdges = outgoingEdges.union(incomingEdges);
        cy.edges().not(connectedEdges).addClass('dimmed');
      }
    });
  }, [selectedNodeId, edges]);

  // Handle path mode completion
  useEffect(() => {
    if (pathMode.active && pathMode.from && pathMode.to) {
      findPath(pathMode.from, pathMode.to);
    }
  }, [pathMode.active, pathMode.from, pathMode.to, findPath]);

  return (
    <div ref={containerRef} className="graph-container w-full h-full relative">
      <CytoscapeComponent
        elements={cytoscapeElements}
        stylesheet={stylesheet}
        style={{ width: '100%', height: '100%' }}
        cy={handleCyInit}
      />
      <div
        id="nq-graph-navigator"
        className="absolute bottom-4 left-4 z-30 h-32 w-32 bg-nq-white border-2 border-nq-black shadow-[4px_4px_0_0_#000000] overflow-hidden pointer-events-auto"
      />
      <NodeContextMenu cyRef={cyRef} containerRef={containerRef} />

      {/* Tooltip - NQ style */}
      <NodeTooltip
        visible={tooltip.visible}
        nodeId={tooltip.nodeId}
        x={tooltip.x}
        y={tooltip.y}
        nodesMap={nodesMap}
        edgesMap={edgesMap}
      />
      <EdgeTooltip
        visible={edgeTooltip.visible}
        edgeId={edgeTooltip.edgeId}
        x={edgeTooltip.x}
        y={edgeTooltip.y}
        edgesMap={edgesMap}
      />
    </div>
  );
}
