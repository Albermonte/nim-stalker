import { describe, expect, test } from 'bun:test';
import { shouldUseTwoNodePresetLayout } from './initial-layout-strategy';

describe('initial-layout-strategy', () => {
  test('uses two-node preset for non-path graph with exactly one edge', () => {
    expect(shouldUseTwoNodePresetLayout({
      pathViewActive: false,
      nodeCount: 2,
      edgeCount: 1,
    })).toBe(true);
  });

  test('does not use two-node preset while path view is active', () => {
    expect(shouldUseTwoNodePresetLayout({
      pathViewActive: true,
      nodeCount: 2,
      edgeCount: 1,
    })).toBe(false);
  });

  test('does not use two-node preset for other graph sizes', () => {
    expect(shouldUseTwoNodePresetLayout({
      pathViewActive: false,
      nodeCount: 1,
      edgeCount: 0,
    })).toBe(false);

    expect(shouldUseTwoNodePresetLayout({
      pathViewActive: false,
      nodeCount: 3,
      edgeCount: 2,
    })).toBe(false);
  });
});
