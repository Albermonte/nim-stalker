import { describe, test, expect } from 'bun:test';
import type { CytoscapeEdge } from '@nim-stalker/shared';
import { getConnectedTxActivity } from './tooltip-utils';

function edge(
  id: string,
  source: string,
  target: string,
  txCount: number,
  totalValue: string
): CytoscapeEdge {
  return {
    data: {
      id,
      source,
      target,
      txCount,
      totalValue,
      firstTxAt: '2025-01-01T00:00:00.000Z',
      lastTxAt: '2025-01-01T00:00:00.000Z',
    },
  };
}

describe('tooltip-utils', () => {
  describe('getConnectedTxActivity', () => {
    test('sums tx count and total value for incoming and outgoing edges', () => {
      const edgesMap = new Map<string, CytoscapeEdge>([
        ['A->B', edge('A->B', 'A', 'B', 2, '150000')],
        ['C->A', edge('C->A', 'C', 'A', 3, '350000')],
        ['D->E', edge('D->E', 'D', 'E', 10, '999999')],
      ]);

      expect(getConnectedTxActivity('A', edgesMap)).toEqual({
        txCount: 5,
        totalValue: BigInt(500000),
      });
    });

    test('returns null when node has no connected edges', () => {
      const edgesMap = new Map<string, CytoscapeEdge>([
        ['D->E', edge('D->E', 'D', 'E', 1, '100000')],
      ]);

      expect(getConnectedTxActivity('A', edgesMap)).toBeNull();
    });
  });
});
