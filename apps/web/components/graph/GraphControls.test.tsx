import React from 'react';
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { render, waitFor } from '@testing-library/react';

if (!globalThis.window || !globalThis.document) {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
}

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
      from: 'A',
      to: 'B',
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
const replaceMock = mock(() => {});

mock.module('@/store/graph-store', () => ({
  useGraphStore: () => mockStore,
}));

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: mock(() => {}),
    replace: replaceMock,
    refresh: mock(() => {}),
    back: mock(() => {}),
    forward: mock(() => {}),
    prefetch: mock(() => Promise.resolve()),
  }),
}));

import { GraphControls } from './GraphControls';

describe('GraphControls', () => {
  beforeEach(() => {
    mockStore = createStoreState();
    replaceMock.mockClear();
  });

  test('renders layout selector in path view', () => {
    const html = renderToStaticMarkup(<GraphControls />);

    expect(html).toContain('All Paths');
    expect(html).toContain('Layout: fCoSE');
    expect(html).toContain('Exit Path View');
  });

  test('syncs URL using canonical path endpoints through Next router', async () => {
    mockStore.pathView.pathNodeOrder = ['A', 'B', 'D', 'C'];
    mockStore.pathView.from = 'A';
    mockStore.pathView.to = 'D';

    render(<GraphControls />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expect(replaceMock.mock.calls[0]?.[0]).toBe('/path?from=A&to=D&maxHops=3&directed=false');
  });
});
