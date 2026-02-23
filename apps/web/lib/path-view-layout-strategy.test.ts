import { describe, expect, test } from 'bun:test';
import { getPathViewLayoutStrategy } from './path-view-layout-strategy';

describe('path-view-layout-strategy', () => {
  test('returns tiny when path view has exactly 2 nodes with path order', () => {
    const strategy = getPathViewLayoutStrategy({
      pathViewActive: true,
      nodeCount: 2,
      pathNodeOrderLength: 2,
      layoutMode: 'fcose',
    });

    expect(strategy).toBe('tiny');
  });

  test('returns path-fcose for path view fcose layouts with >2 nodes', () => {
    const strategy = getPathViewLayoutStrategy({
      pathViewActive: true,
      nodeCount: 5,
      pathNodeOrderLength: 5,
      layoutMode: 'fcose',
    });

    expect(strategy).toBe('path-fcose');
  });

  test('returns mode-layout for non-fcose path view layouts with >2 nodes', () => {
    const strategy = getPathViewLayoutStrategy({
      pathViewActive: true,
      nodeCount: 5,
      pathNodeOrderLength: 5,
      layoutMode: 'cola',
    });

    expect(strategy).toBe('mode-layout');
  });

  test('returns mode-layout when not in path view', () => {
    const strategy = getPathViewLayoutStrategy({
      pathViewActive: false,
      nodeCount: 2,
      pathNodeOrderLength: 2,
      layoutMode: 'fcose',
    });

    expect(strategy).toBe('mode-layout');
  });
});
