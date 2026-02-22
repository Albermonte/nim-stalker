import { describe, expect, test, mock } from 'bun:test';
import {
  MAX_COMPOUND_DRAG_NEIGHBORS,
  moveNeighborsByDelta,
  shouldEnableCompoundDrag,
} from './drag-utils';

function createNeighbor(x: number, y: number) {
  let pos = { x, y };
  return {
    position(next?: { x: number; y: number }) {
      if (next) pos = next;
      return pos;
    },
  };
}

describe('drag-utils', () => {
  test('moveNeighborsByDelta updates all neighbors in one batch', () => {
    const n1 = createNeighbor(10, 20);
    const n2 = createNeighbor(-5, 4);
    const batch = mock((fn: () => void) => fn());

    moveNeighborsByDelta(
      { batch } as any,
      {
        length: 2,
        forEach(cb: (neighbor: any) => void) {
          cb(n1);
          cb(n2);
        },
      } as any,
      3,
      -2
    );

    expect(batch).toHaveBeenCalledTimes(1);
    expect(n1.position()).toEqual({ x: 13, y: 18 });
    expect(n2.position()).toEqual({ x: -2, y: 2 });
  });

  test('moveNeighborsByDelta is a no-op when delta is zero', () => {
    const n1 = createNeighbor(1, 2);
    const batch = mock((fn: () => void) => fn());

    moveNeighborsByDelta(
      { batch } as any,
      {
        length: 1,
        forEach(cb: (neighbor: any) => void) {
          cb(n1);
        },
      } as any,
      0,
      0
    );

    expect(batch).not.toHaveBeenCalled();
    expect(n1.position()).toEqual({ x: 1, y: 2 });
  });

  test('shouldEnableCompoundDrag disables oversized neighbor groups', () => {
    expect(shouldEnableCompoundDrag(1)).toBeTrue();
    expect(shouldEnableCompoundDrag(MAX_COMPOUND_DRAG_NEIGHBORS)).toBeTrue();
    expect(shouldEnableCompoundDrag(MAX_COMPOUND_DRAG_NEIGHBORS + 1)).toBeFalse();
    expect(shouldEnableCompoundDrag(0)).toBeFalse();
  });
});
