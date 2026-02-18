export type BiFlowOrientation = 'LR' | 'TB';

export function computeBiFlowPositions(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string; txCount?: number }>,
  focusId: string,
  orientation: BiFlowOrientation,
  config?: {
    tierSpacing?: number;
    nodeSpacing?: number;
    minNodeDistance?: number;
    collisionPasses?: number;
    parkingOffset?: number;
  },
): Map<string, { x: number; y: number }> {
  const cfg = {
    tierSpacing: 360,
    nodeSpacing: 120,
    minNodeDistance: 95,
    collisionPasses: 4,
    parkingOffset: 1200,
    ...config,
  };

  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const safeFocusId = nodeIds.has(focusId) ? focusId : nodes[0].id;

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }

  const edgesInGraph: Array<{ source: string; target: string; txCount: number }> = [];
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    outgoing.get(e.source)!.push(e.target);
    incoming.get(e.target)!.push(e.source);
    const txCount = typeof e.txCount === 'number' && Number.isFinite(e.txCount) && e.txCount > 0 ? e.txCount : 1;
    edgesInGraph.push({ source: e.source, target: e.target, txCount });
  }

  const bfsDepths = (startId: string, adjacency: Map<string, string[]>): Map<string, number> => {
    const depths = new Map<string, number>();
    const queue: string[] = [startId];
    depths.set(startId, 0);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curDepth = depths.get(cur)!;
      for (const next of adjacency.get(cur) ?? []) {
        if (depths.has(next)) continue;
        depths.set(next, curDepth + 1);
        queue.push(next);
      }
    }

    return depths;
  };

  const outDepth = bfsDepths(safeFocusId, outgoing);
  const inDepth = bfsDepths(safeFocusId, incoming);

  // Weight per node = Σ log10(1+txCount) over incident edges.
  const weightByNode = new Map<string, number>();
  for (const id of nodeIds) weightByNode.set(id, 0);
  for (const e of edgesInGraph) {
    const w = Math.log10(1 + e.txCount);
    weightByNode.set(e.source, (weightByNode.get(e.source) ?? 0) + w);
    weightByNode.set(e.target, (weightByNode.get(e.target) ?? 0) + w);
  }

  const tiers = new Map<number, string[]>();
  const disconnected: string[] = [];

  for (const id of nodeIds) {
    if (id === safeFocusId) {
      tiers.set(0, [id]);
      continue;
    }

    const out = outDepth.get(id);
    const inn = inDepth.get(id);

    // Tie-break: prefer outgoing side on equal depth.
    if (out != null && out > 0 && (inn == null || out <= inn)) {
      const tier = out;
      if (!tiers.has(tier)) tiers.set(tier, []);
      tiers.get(tier)!.push(id);
    } else if (inn != null && inn > 0 && (out == null || inn < out)) {
      const tier = -inn;
      if (!tiers.has(tier)) tiers.set(tier, []);
      tiers.get(tier)!.push(id);
    } else {
      disconnected.push(id);
    }
  }

  const sortTier = (ids: string[]) => {
    return ids.sort((a, b) => {
      const wa = weightByNode.get(a) ?? 0;
      const wb = weightByNode.get(b) ?? 0;
      if (wb !== wa) return wb - wa;
      return a.localeCompare(b);
    });
  };

  // Place connected tiers in ascending order so incoming (negative) comes first.
  const sortedTiers = Array.from(tiers.keys()).sort((a, b) => a - b);
  for (const tier of sortedTiers) {
    const ids = sortTier(tiers.get(tier)!);
    const mid = (ids.length - 1) / 2;

    for (let i = 0; i < ids.length; i++) {
      const centeredIndex = i - mid;
      const primary = tier * cfg.tierSpacing;
      const secondary = centeredIndex * cfg.nodeSpacing;

      if (orientation === 'LR') {
        positions.set(ids[i], { x: primary, y: secondary });
      } else {
        positions.set(ids[i], { x: secondary, y: primary });
      }
    }
  }

  // Park disconnected nodes in a bottom strip (positive y).
  if (disconnected.length > 0) {
    const ids = sortTier(disconnected);
    const mid = (ids.length - 1) / 2;
    for (let i = 0; i < ids.length; i++) {
      const centeredIndex = i - mid;
      positions.set(ids[i], {
        x: centeredIndex * cfg.nodeSpacing,
        y: cfg.parkingOffset,
      });
    }
  }

  for (let pass = 0; pass < cfg.collisionPasses; pass++) {
    const damping = 1.0 - pass * 0.2;
    pushApart(positions, cfg.minNodeDistance, damping);
  }

  return positions;
}

/**
 * Spatial-hash push-apart — O(n) average case.
 * Divides space into cells of size `minDist`; each node only checks the 9
 * neighbouring cells instead of all other nodes, reducing O(n²) to O(n).
 */
function pushApart(
  positions: Map<string, { x: number; y: number }>,
  minDist: number,
  damping: number = 1.0,
): void {
  const ids = Array.from(positions.keys());
  if (ids.length < 2) return;

  const cellSize = minDist;
  const minDistSq = minDist * minDist;

  const grid = new Map<string, string[]>();
  const cellKey = (cx: number, cy: number) => `${cx},${cy}`;
  const toCell = (v: number) => Math.floor(v / cellSize);

  for (const id of ids) {
    const pos = positions.get(id)!;
    const key = cellKey(toCell(pos.x), toCell(pos.y));
    const cell = grid.get(key) ?? [];
    cell.push(id);
    grid.set(key, cell);
  }

  for (const id of ids) {
    const a = positions.get(id)!;
    const cx = toCell(a.x);
    const cy = toCell(a.y);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbours = grid.get(cellKey(cx + dx, cy + dy));
        if (!neighbours) continue;
        for (const otherId of neighbours) {
          if (otherId <= id) continue;
          const b = positions.get(otherId)!;
          const diffX = b.x - a.x;
          const diffY = b.y - a.y;
          const distSq = diffX * diffX + diffY * diffY;

          if (distSq < minDistSq && distSq > 0) {
            const dist = Math.sqrt(distSq);
            const overlap = ((minDist - dist) / 2) * damping;
            const nx = diffX / dist;
            const ny = diffY / dist;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
          } else if (distSq === 0) {
            a.x -= (minDist / 2) * damping;
            b.x += (minDist / 2) * damping;
          }
        }
      }
    }
  }
}
