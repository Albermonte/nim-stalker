import { describe, test, expect } from 'bun:test';
import { AddressType, type CytoscapeEdge, type NodeData } from '@nim-stalker/shared';
import { formatTooltipBalance, getConnectedTxActivity, getNodeTxCount } from './tooltip-utils';

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
  describe('formatTooltipBalance', () => {
    test('formats whole NIM with no decimals using rounding', () => {
      expect(formatTooltipBalance('149999')).toBe('1 NIM');
      expect(formatTooltipBalance('150000')).toBe('2 NIM');
      expect(formatTooltipBalance('50000')).toBe('1 NIM');
    });

    test('handles invalid balance values', () => {
      expect(formatTooltipBalance('invalid')).toBe('0 NIM');
    });
  });

  describe('getNodeTxCount', () => {
    test('uses node txCount when present', () => {
      const nodeData: NodeData = {
        id: 'A',
        type: AddressType.BASIC,
        balance: '100000',
        txCount: 12,
      };
      const edgesMap = new Map<string, CytoscapeEdge>([
        ['A->B', edge('A->B', 'A', 'B', 99, '150000')],
      ]);

      expect(getNodeTxCount(nodeData, 'A', edgesMap)).toBe(12);
    });

    test('falls back to connected edge tx count when node txCount is missing', () => {
      const nodeData: NodeData = {
        id: 'A',
        type: AddressType.BASIC,
        balance: '100000',
      };
      const edgesMap = new Map<string, CytoscapeEdge>([
        ['A->B', edge('A->B', 'A', 'B', 2, '150000')],
        ['C->A', edge('C->A', 'C', 'A', 3, '350000')],
      ]);

      expect(getNodeTxCount(nodeData, 'A', edgesMap)).toBe(5);
    });

    test('returns 0 when tx count is unavailable', () => {
      const nodeData: NodeData = {
        id: 'A',
        type: AddressType.BASIC,
        balance: '100000',
      };
      const edgesMap = new Map<string, CytoscapeEdge>();

      expect(getNodeTxCount(nodeData, 'A', edgesMap)).toBe(0);
    });
  });

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
