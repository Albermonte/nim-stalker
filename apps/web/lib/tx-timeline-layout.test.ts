import { describe, test, expect } from 'bun:test';
import { computeTxTimelinePositions } from './tx-timeline-layout';

describe('tx-timeline-layout', () => {
  test('incoming lane is above outgoing lane', () => {
    const focus = 'FOCUS';
    const txs = [
      { hash: 'in', from: 'X', to: focus },   // incoming
      { hash: 'out', from: focus, to: 'Y' },  // outgoing
    ];

    const pos = computeTxTimelinePositions(txs, focus);

    expect((pos.get('in')?.y ?? 0) < (pos.get('out')?.y ?? 0)).toBe(true);
  });

  test('wraps after perRow (min 8)', () => {
    const focus = 'FOCUS';
    const txs = Array.from({ length: 9 }, (_, i) => ({
      hash: `tx${i}`,
      from: focus,
      to: `T${i}`,
    }));

    const pos = computeTxTimelinePositions(txs, focus);

    // index 0 and 8 are both col=0 in different rows; y delta should equal rowGap (340)
    const y0 = pos.get('tx0')?.y ?? 0;
    const y8 = pos.get('tx8')?.y ?? 0;
    expect(Math.abs(y8 - y0)).toBe(340);
  });
});

