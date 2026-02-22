import type { Core, NodeCollection } from 'cytoscape';

// Prevent pathological drag cost when a node has very large exclusive fanout.
export const MAX_COMPOUND_DRAG_NEIGHBORS = 150;

/**
 * Return neighbors that are only connected to `nodeId`.
 * Those can be moved with the dragged node as a visual group.
 */
export function getExclusiveNeighbors(cy: Core, nodeId: string): NodeCollection {
  const node = cy.getElementById(nodeId);
  const neighbors = node.neighborhood('node');

  return neighbors.filter((neighbor) => {
    const neighborConnections = neighbor.neighborhood('node');
    return neighborConnections.length === 1 && neighborConnections[0].id() === nodeId;
  });
}

export function shouldEnableCompoundDrag(
  exclusiveNeighborCount: number,
  maxNeighbors: number = MAX_COMPOUND_DRAG_NEIGHBORS
): boolean {
  return exclusiveNeighborCount > 0 && exclusiveNeighborCount <= maxNeighbors;
}

export function moveNeighborsByDelta(
  cy: Core,
  neighbors: NodeCollection,
  deltaX: number,
  deltaY: number
): void {
  if (neighbors.length === 0 || (deltaX === 0 && deltaY === 0)) return;

  cy.batch(() => {
    neighbors.forEach((neighbor) => {
      const neighborPos = neighbor.position();
      neighbor.position({
        x: neighborPos.x + deltaX,
        y: neighborPos.y + deltaY,
      });
    });
  });
}
