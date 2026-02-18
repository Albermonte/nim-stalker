import { describe, test, expect } from 'bun:test';
import { computeBiFlowPositions } from './layout-biflow';

describe('layout-biflow', () => {
  test('places incoming nodes left and outgoing nodes right (LR)', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const edges = [
      { source: 'B', target: 'A', txCount: 1 },
      { source: 'A', target: 'C', txCount: 1 },
    ];

    const pos = computeBiFlowPositions(nodes, edges, 'A', 'LR');

    expect(pos.get('A')?.x).toBe(0);
    expect((pos.get('B')?.x ?? 0) < 0).toBe(true);
    expect((pos.get('C')?.x ?? 0) > 0).toBe(true);
  });

  test('places incoming nodes above and outgoing nodes below (TB)', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const edges = [
      { source: 'B', target: 'A', txCount: 1 },
      { source: 'A', target: 'C', txCount: 1 },
    ];

    const pos = computeBiFlowPositions(nodes, edges, 'A', 'TB');

    expect(pos.get('A')?.y).toBe(0);
    expect((pos.get('B')?.y ?? 0) < 0).toBe(true);
    expect((pos.get('C')?.y ?? 0) > 0).toBe(true);
  });

  test('orders nodes deterministically by weight then id', () => {
    const nodes = [{ id: 'A' }, { id: 'D' }, { id: 'E' }];
    const edges = [
      { source: 'A', target: 'D', txCount: 1 },
      { source: 'A', target: 'E', txCount: 1 },
    ];

    const pos = computeBiFlowPositions(nodes, edges, 'A', 'LR', {
      tierSpacing: 200,
      nodeSpacing: 100,
      collisionPasses: 0,
    });

    // D and E have equal weight; id tiebreak should place D before E,
    // meaning D has smaller y (higher up) than E.
    expect((pos.get('D')?.y ?? 0) < (pos.get('E')?.y ?? 0)).toBe(true);
  });
});

