import { describe, test, expect } from 'bun:test';
import { computeTinyPathPositions, findLayoutCategory, getLayoutLabel, getLayoutOptions } from './layout-configs';

describe('layout-configs additional layouts', () => {
  test('fcose-weighted uses fcose with a functional idealEdgeLength', () => {
    const options = getLayoutOptions('fcose-weighted' as any, 80) as any;
    expect(options.name).toBe('fcose');
    expect(typeof options.idealEdgeLength).toBe('function');
  });

  test('concentric-volume uses concentric layout with concentric function', () => {
    const options = getLayoutOptions('concentric-volume' as any, 80) as any;
    expect(options.name).toBe('concentric');
    expect(typeof options.concentric).toBe('function');
  });

  test('biflow layouts use preset positions from scratch', () => {
    const lr = getLayoutOptions('biflow-lr' as any, 80) as any;
    const tb = getLayoutOptions('biflow-tb' as any, 80) as any;

    expect(lr.name).toBe('preset');
    expect(tb.name).toBe('preset');
    expect(typeof lr.positions).toBe('function');
    expect(typeof tb.positions).toBe('function');
  });

  test('new layouts are discoverable via getLayoutLabel/findLayoutCategory', () => {
    // getLayoutLabel falls back to mode string when missing from categories
    expect(getLayoutLabel('fcose-weighted' as any)).toBe('fCoSE Weighted');
    expect(getLayoutLabel('biflow-lr' as any)).toBe('BiFlow ↔');
    expect(getLayoutLabel('concentric-volume' as any)).toBe('Concentric (Volume)');

    expect(findLayoutCategory('biflow-lr' as any)?.id).toBe('flow');
  });

  test('computeTinyPathPositions returns deterministic vertical positions for 2-node path', () => {
    const positions = computeTinyPathPositions(['A', 'B']);

    expect(positions.get('A')).toEqual({ x: 0, y: -210 });
    expect(positions.get('B')).toEqual({ x: 0, y: 210 });
  });

  test('computeTinyPathPositions returns empty map for fewer than 2 nodes', () => {
    expect(computeTinyPathPositions([]).size).toBe(0);
    expect(computeTinyPathPositions(['A']).size).toBe(0);
  });
});
