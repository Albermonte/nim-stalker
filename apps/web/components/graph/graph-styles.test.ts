import { describe, expect, test } from 'bun:test';
import cytoscape, { type EdgeSingular } from 'cytoscape';
import { graphStylesheet } from './graph-styles';

const EDGE_ID = 'A-B';
const PINK = [255, 105, 180] as const;
const GREEN = [34, 197, 94] as const;

function createEdgeWithClasses(classes: string): { edge: EdgeSingular; destroy: () => void } {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    style: graphStylesheet,
    elements: [
      { data: { id: 'A' } },
      { data: { id: 'B' } },
      { data: { id: EDGE_ID, source: 'A', target: 'B', txCount: 10 } },
    ],
  });

  const edge = cy.getElementById(EDGE_ID);
  if (classes.length > 0) {
    edge.addClass(classes);
  }

  return {
    edge,
    destroy: () => cy.destroy(),
  };
}

function getRgbValue(edge: EdgeSingular, key: 'line-color' | 'target-arrow-color'): number[] {
  const value = edge.pstyle(key).value;
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${key} to resolve to an RGB array`);
  }

  return value as number[];
}

describe('graphStylesheet edge precedence', () => {
  test('uses outgoing pink when path-incoming and outgoing-from-selected overlap', () => {
    const { edge, destroy } = createEdgeWithClasses('path-incoming outgoing-from-selected');

    try {
      expect(getRgbValue(edge, 'line-color')).toEqual(PINK);
      expect(getRgbValue(edge, 'target-arrow-color')).toEqual(PINK);
    } finally {
      destroy();
    }
  });

  test('uses incoming green when path-outgoing and incoming-to-selected overlap', () => {
    const { edge, destroy } = createEdgeWithClasses('path-outgoing incoming-to-selected');

    try {
      expect(getRgbValue(edge, 'line-color')).toEqual(GREEN);
      expect(getRgbValue(edge, 'target-arrow-color')).toEqual(GREEN);
    } finally {
      destroy();
    }
  });

  test('keeps path-outgoing pink when no selected-node class is present', () => {
    const { edge, destroy } = createEdgeWithClasses('path-outgoing');

    try {
      expect(getRgbValue(edge, 'line-color')).toEqual(PINK);
      expect(getRgbValue(edge, 'target-arrow-color')).toEqual(PINK);
    } finally {
      destroy();
    }
  });

  test('keeps path-incoming green when no selected-node class is present', () => {
    const { edge, destroy } = createEdgeWithClasses('path-incoming');

    try {
      expect(getRgbValue(edge, 'line-color')).toEqual(GREEN);
      expect(getRgbValue(edge, 'target-arrow-color')).toEqual(GREEN);
    } finally {
      destroy();
    }
  });

  test('keeps dimmed opacity while selected-node precedence controls color', () => {
    const { edge, destroy } = createEdgeWithClasses('path-outgoing incoming-to-selected dimmed');

    try {
      expect(getRgbValue(edge, 'line-color')).toEqual(GREEN);
      expect(getRgbValue(edge, 'target-arrow-color')).toEqual(GREEN);
      expect(edge.pstyle('opacity').value).toBeCloseTo(0.2, 5);
    } finally {
      destroy();
    }
  });
});
