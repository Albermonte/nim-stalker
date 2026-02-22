import React from 'react';
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

function createStoreState() {
  return {
    clearGraph: mock(() => {}),
    loading: false,
    pathMode: {
      active: false,
      from: null,
      to: null,
      maxHops: 3,
      directed: false,
    },
    setPathMode: mock(() => {}),
    setPathModeMaxHops: mock(() => {}),
    setPathModeDirected: mock(() => {}),
    pathView: {
      active: true,
      pathNodeIds: new Set(['A', 'B']),
      pathNodeOrder: ['A', 'B'],
      pathEdgeIds: new Set(['A->B']),
      savedNodes: null,
      savedEdges: null,
      stats: {
        nodeCount: 2,
        edgeCount: 1,
        maxHops: 3,
        shortestPath: 1,
        directed: false,
      },
    },
    exitPathView: mock(() => {}),
    layoutMode: 'fcose',
    setLayoutMode: mock(() => {}),
    expandAllNodes: mock(() => {}),
    nodes: new Map(),
  };
}

let mockStore = createStoreState();

mock.module('@/store/graph-store', () => ({
  useGraphStore: () => mockStore,
}));

import { GraphControls } from './GraphControls';

describe('GraphControls', () => {
  beforeEach(() => {
    mockStore = createStoreState();
  });

  test('renders layout selector in path view', () => {
    const html = renderToStaticMarkup(<GraphControls />);

    expect(html).toContain('All Paths');
    expect(html).toContain('Layout: fCoSE');
    expect(html).toContain('Exit Path View');
  });
});
