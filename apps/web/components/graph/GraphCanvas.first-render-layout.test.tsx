import React from 'react';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { render, waitFor } from '@/test/helpers/render';

let capturedCyInit: ((cy: any) => void) | null = null;

const layoutFactoryMock = mock(() => {});
const layoutRunMock = mock(() => {});
const loadInitialDataMock = mock(async () => {});
const refreshBalancesMock = mock(async () => {});
const clearLastExpandedMock = mock(() => {});
const ensureLayoutRegisteredMock = mock(async () => {});

function createStoreState() {
  const nodeA = {
    data: {
      id: 'A',
      label: 'A',
      type: 'basic',
      balance: 0,
      txCount: 1,
    },
  };
  const nodeB = {
    data: {
      id: 'B',
      label: 'B',
      type: 'basic',
      balance: 0,
      txCount: 1,
    },
  };
  const edge = {
    data: {
      id: 'A-B',
      source: 'A',
      target: 'B',
      txCount: 1,
    },
  };

  return {
    nodes: new Map([
      ['A', nodeA],
      ['B', nodeB],
    ]),
    edges: new Map([['A-B', edge]]),
    selectedNodeId: null,
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
      pathNodeIds: new Set<string>(),
      pathNodeOrder: [],
      pathEdgeIds: new Set<string>(),
      savedNodes: null,
      savedEdges: null,
      stats: null,
    },
    layoutMode: 'fcose' as const,
    lastExpandedNodeId: null,
    selectNode: mock(() => {}),
    selectEdge: mock(() => {}),
    expandNode: mock(async () => {}),
    findPath: mock(async () => {}),
    clearLastExpanded: clearLastExpandedMock,
    loadInitialData: loadInitialDataMock,
    refreshBalancesForAddresses: refreshBalancesMock,
  };
}

let storeState = createStoreState();

const useGraphStore = ((selector: (state: ReturnType<typeof createStoreState>) => unknown) =>
  selector(storeState)) as any;
useGraphStore.getState = () => storeState;

mock.module('@/store/graph-store', () => ({
  useGraphStore,
}));

mock.module('react-cytoscapejs', () => ({
  default: ({ cy }: { cy?: (instance: any) => void }) => {
    capturedCyInit = cy ?? null;
    return <div data-testid="mock-cy" />;
  },
}));

mock.module('@/lib/cytoscape-ui-extensions', () => ({
  registerUiExtensions: () => {},
  attachUiExtensions: () => () => {},
}));

mock.module('@/lib/cytoscape-ui-extension-modules', () => ({
  CYTOSCAPE_UI_EXTENSION_MODULES: {},
}));

mock.module('@/lib/identicon-manager', () => ({
  identiconManager: {
    getIdenticonDataUri: () => '',
    setNodeUpdateCallback: () => {},
    generateForViewport: () => {},
  },
}));

mock.module('@/lib/layout-loader', () => ({
  ensureLayoutRegistered: ensureLayoutRegisteredMock,
}));

mock.module('@/lib/layout-cache', () => ({
  computeGraphHash: () => 'hash',
  getLayoutPositions: () => null,
  saveLayoutPositions: () => {},
}));

mock.module('./NodeContextMenu', () => ({
  NodeContextMenu: () => null,
}));

import { GraphCanvas } from './GraphCanvas';

function createNode(id: string, position?: { x: number; y: number }) {
  let currentPosition = position ?? { x: 0, y: 0 };

  return {
    id: () => id,
    position: (next?: { x: number; y: number }) => {
      if (next) {
        currentPosition = { ...next };
      }
      return currentPosition;
    },
    scratch: () => undefined,
    boundingBox: () => ({
      x1: currentPosition.x - 10,
      y1: currentPosition.y - 10,
      x2: currentPosition.x + 10,
      y2: currentPosition.y + 10,
    }),
  };
}

function createEdge(edgeData: { id: string; source: string; target: string; txCount?: number }) {
  return {
    id: () => edgeData.id,
    source: () => ({ id: () => edgeData.source }),
    target: () => ({ id: () => edgeData.target }),
    data: (key?: string) => {
      if (!key) return edgeData;
      if (key === 'source') return edgeData.source;
      if (key === 'target') return edgeData.target;
      if (key === 'txCount') return edgeData.txCount;
      return undefined;
    },
    addClass: () => undefined,
    removeClass: () => undefined,
  };
}

function createCollection<T extends { id: () => string }>(items: T[]) {
  const arr = [...items] as any;
  arr.removeClass = () => arr;
  arr.addClass = () => arr;
  arr.union = () => arr;
  arr.not = () => arr;
  arr.layout = () => ({
    on: () => {},
    run: () => {},
    stop: () => {},
  });
  arr.boundingBox = () => ({ x1: -500, y1: -500, x2: 500, y2: 500, w: 1000, h: 1000 });
  return arr;
}

function createFakeCy() {
  const nodeItems: Array<ReturnType<typeof createNode>> = [];
  const edgeItems: Array<ReturnType<typeof createEdge>> = [];
  let layoutStopHandler: (() => void) | null = null;

  const cy = {
    nodes: () => createCollection(nodeItems),
    edges: () => createCollection(edgeItems),
    add: (elements: any[]) => {
      for (const element of elements) {
        if (element.group === 'nodes') {
          nodeItems.push(createNode(element.data.id, element.position));
        }
        if (element.group === 'edges') {
          edgeItems.push(createEdge(element.data));
        }
      }
    },
    remove: () => {},
    getElementById: (id: string) => {
      const ids = id.split(',').filter(Boolean);
      const nodes = nodeItems.filter((n) => ids.includes(n.id()));
      const edges = edgeItems.filter((e) => ids.includes(e.id()));
      return createCollection([...nodes, ...edges]);
    },
    layout: (options: Record<string, unknown>) => {
      layoutFactoryMock(options);
      return {
        on: (eventName: string, handler: () => void) => {
          if (eventName === 'layoutstop') {
            layoutStopHandler = handler;
          }
        },
        run: () => {
          layoutRunMock();
          layoutStopHandler?.();
        },
        stop: () => {},
      };
    },
    batch: (fn: () => void) => fn(),
    on: () => {},
    off: () => {},
    extent: () => ({ x1: -500, y1: -500, x2: 500, y2: 500 }),
    fit: () => {},
    resize: () => {},
    container: () => ({
      style: { cursor: 'default' },
      clientWidth: 1200,
      clientHeight: 800,
    }),
  };

  return cy;
}

describe('GraphCanvas first-render layout', () => {
  beforeEach(() => {
    capturedCyInit = null;
    storeState = createStoreState();
    layoutFactoryMock.mockClear();
    layoutRunMock.mockClear();
    loadInitialDataMock.mockClear();
    refreshBalancesMock.mockClear();
    clearLastExpandedMock.mockClear();
    ensureLayoutRegisteredMock.mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  test('runs initial layout once Cytoscape initializes even when data is preloaded', async () => {
    render(<GraphCanvas />);

    expect(layoutFactoryMock).toHaveBeenCalledTimes(0);
    expect(typeof capturedCyInit).toBe('function');

    const cy = createFakeCy();
    capturedCyInit?.(cy);

    await waitFor(() => {
      expect(layoutFactoryMock).toHaveBeenCalledTimes(1);
      expect(layoutRunMock).toHaveBeenCalledTimes(1);
    });
  });
});
