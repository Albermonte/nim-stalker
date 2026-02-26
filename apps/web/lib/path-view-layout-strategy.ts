import type { LayoutMode } from '@/store/graph-store';

export type PathViewLayoutStrategy = 'tiny' | 'path-fcose' | 'mode-layout';

interface PathViewLayoutStrategyInput {
  pathViewActive: boolean;
  nodeCount: number;
  pathNodeOrderLength: number;
  pathCount: number;
  layoutMode: LayoutMode;
}

export function getPathViewLayoutStrategy(
  input: PathViewLayoutStrategyInput
): PathViewLayoutStrategy {
  const { pathViewActive, nodeCount, pathNodeOrderLength, pathCount, layoutMode } = input;

  if (!pathViewActive) {
    return 'mode-layout';
  }

  if (pathCount <= 1 && nodeCount === 2 && pathNodeOrderLength >= 2) {
    return 'tiny';
  }

  if (layoutMode === 'fcose') {
    return 'path-fcose';
  }

  return 'mode-layout';
}
