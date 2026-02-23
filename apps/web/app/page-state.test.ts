import { describe, expect, test } from 'bun:test';
import { shouldResetHomeGraphState } from './home-state';

describe('shouldResetHomeGraphState', () => {
  test('returns true when stale graph data exists', () => {
    const shouldReset = shouldResetHomeGraphState({
      nodes: new Map([['node-1', {}]]),
      edges: new Map(),
      skipInitialLoad: true,
      pathView: { active: false },
    });

    expect(shouldReset).toBe(true);
  });

  test('returns false for clean home state', () => {
    const shouldReset = shouldResetHomeGraphState({
      nodes: new Map(),
      edges: new Map(),
      skipInitialLoad: false,
      pathView: { active: false },
    });

    expect(shouldReset).toBe(false);
  });
});
