/**
 * Directed Flow Layout Algorithm
 *
 * BFS-based preset layout that pushes nodes outward along transaction direction.
 * Uses per-parent radial placement: each parent positions its own children in
 * an arc/circle around itself, with arc size adapting to child count.
 * Stronger connections (higher txCount) are placed closer to their parent.
 */

export interface DirectedFlowConfig {
  /** Base distance between depth tiers (default 250) */
  tierSpacing: number;
  /** Minimum spacing within a tier (default 70) */
  nodeSpacing: number;
  /** Collision avoidance threshold (default 55) */
  minNodeDistance: number;
  /** Number of collision avoidance passes (default 3) */
  collisionPasses: number;
}

const DEFAULTS: DirectedFlowConfig = {
  tierSpacing: 350,
  nodeSpacing: 100,
  minNodeDistance: 90,
  collisionPasses: 5,
};

interface NodeInfo {
  id: string;
  depth: number;
  parent: string | null;
  parentAngle: number;
}

interface EdgeInput {
  source: string;
  target: string;
  txCount?: number;
}

/**
 * Adaptive tier spacing: gentle shrink as node count grows.
 * 350px at ≤20 nodes → ~210px at 200+ nodes (never below 60% of base).
 */
function computeAdaptiveTierSpacing(totalNodes: number, base: number): number {
  const t = Math.min(1, Math.max(0, (totalNodes - 20) / 180));
  return base * (1 - t * 0.4);
}

/**
 * Adaptive spread: sigmoid that approaches full circle for many children.
 * 3 children ~90°, 8 ~140°, 15 ~200°, 30 ~300°, 50+ ~340°.
 */
function computeSpread(childCount: number): number {
  if (childCount <= 1) return 0;
  const maxSpread = 2 * Math.PI * 0.95; // ~342°, leave gap at seam
  const halfPoint = 12;
  const k = 0.2;
  return Math.max(
    Math.PI * 0.4,
    maxSpread / (1 + Math.exp(-k * (childCount - halfPoint))),
  );
}

/**
 * Build a weight lookup from edges. Normalizes txCount to 0..1 range per parent.
 * Returns Map<"source->target", normalizedWeight>.
 */
function buildWeightMap(
  edges: EdgeInput[],
  nodeIds: Set<string>,
): Map<string, number> {
  const weights = new Map<string, number>();

  // Group txCount by source
  const bySource = new Map<string, Array<{ target: string; count: number }>>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (!bySource.has(edge.source)) bySource.set(edge.source, []);
    bySource.get(edge.source)!.push({ target: edge.target, count: edge.txCount ?? 1 });
  }

  for (const [source, targets] of bySource) {
    const maxCount = Math.max(...targets.map((t) => t.count));
    const minCount = Math.min(...targets.map((t) => t.count));
    const range = maxCount - minCount;
    for (const { target, count } of targets) {
      const normalized = range > 0 ? (count - minCount) / range : 0.5;
      weights.set(`${source}->${target}`, normalized);
    }
  }

  return weights;
}

/**
 * Compute positions for a directed-flow layout.
 *
 * Algorithm:
 * 1. Build directed adjacency (source → targets)
 * 2. Find root nodes (no incoming edges; fallback: highest out/in ratio)
 * 3. BFS following outgoing edges assigns depth + parent
 * 4. Per-parent radial placement: each parent places its children around itself
 * 5. Weight-based distance: stronger connections closer
 * 6. Adaptive spread: more children → wider arc (approaching full circle)
 * 7. Handle disconnected components with offset
 * 8. Multi-pass collision avoidance
 */
export function computeDirectedFlowPositions(
  nodes: Array<{ id: string }>,
  edges: EdgeInput[],
  config?: Partial<DirectedFlowConfig>,
): Map<string, { x: number; y: number }> {
  const cfg = { ...DEFAULTS, ...config };
  const positions = new Map<string, { x: number; y: number }>();

  if (nodes.length === 0) return positions;

  // Single node: place at origin
  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: 0, y: 0 });
    return positions;
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const adaptiveTierSpacing = computeAdaptiveTierSpacing(nodes.length, cfg.tierSpacing);

  // Build directed adjacency
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const outgoingCount = new Map<string, number>();

  for (const id of nodeIds) {
    outgoing.set(id, []);
    incomingCount.set(id, 0);
    outgoingCount.set(id, 0);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)!.push(edge.target);
    outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  // Build weight map for distance computation
  const weightMap = buildWeightMap(edges, nodeIds);

  // Find roots: nodes with no incoming edges
  let roots = Array.from(nodeIds).filter((id) => incomingCount.get(id) === 0);

  // Fallback: if all nodes have incoming (pure cycle), pick highest out/in ratio
  if (roots.length === 0) {
    let bestId = nodes[0].id;
    let bestRatio = -1;
    for (const id of nodeIds) {
      const outDeg = outgoingCount.get(id) ?? 0;
      const inDeg = incomingCount.get(id) ?? 0;
      const ratio = inDeg === 0 ? outDeg + 1 : outDeg / inDeg;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = id;
      }
    }
    roots = [bestId];
  }

  // BFS from all roots, following outgoing edges
  // Track parent→children mapping for per-parent placement
  const visited = new Set<string>();
  const nodeInfos = new Map<string, NodeInfo>();
  const childrenOf = new Map<string, string[]>(); // parent → [child ids] in BFS order

  function bfs(startIds: string[], baseAngle: number) {
    const queue: Array<{ id: string; depth: number; parentId: string | null; angle: number }> = [];

    for (let i = 0; i < startIds.length; i++) {
      const id = startIds[i];
      if (visited.has(id)) continue;
      visited.add(id);
      const angle = startIds.length === 1
        ? baseAngle
        : baseAngle + ((2 * Math.PI) / startIds.length) * i;
      const info: NodeInfo = { id, depth: 0, parent: null, parentAngle: angle };
      nodeInfos.set(id, info);
      queue.push({ id, depth: 0, parentId: null, angle });
    }

    let head = 0;
    while (head < queue.length) {
      const { id, depth, angle } = queue[head++];
      const targets = outgoing.get(id) ?? [];
      const unvisitedTargets = targets.filter((t) => !visited.has(t));

      if (unvisitedTargets.length > 0) {
        if (!childrenOf.has(id)) childrenOf.set(id, []);
      }

      for (let i = 0; i < unvisitedTargets.length; i++) {
        const targetId = unvisitedTargets[i];
        visited.add(targetId);
        childrenOf.get(id)!.push(targetId);

        // Preliminary angle (will be refined in placement phase)
        const spread = computeSpread(unvisitedTargets.length);
        const childAngle = unvisitedTargets.length === 1
          ? angle
          : angle - spread / 2 + (spread / (unvisitedTargets.length - 1)) * i;

        const info: NodeInfo = {
          id: targetId,
          depth: depth + 1,
          parent: id,
          parentAngle: childAngle,
        };
        nodeInfos.set(targetId, info);
        queue.push({ id: targetId, depth: depth + 1, parentId: id, angle: childAngle });
      }
    }
  }

  // Run BFS from roots
  bfs(roots, 0);

  // Handle disconnected components: nodes not yet visited
  const unvisited = Array.from(nodeIds).filter((id) => !visited.has(id));
  if (unvisited.length > 0) {
    const components: string[][] = [];
    const compVisited = new Set<string>();

    // Build undirected adjacency for component detection
    const undirected = new Map<string, Set<string>>();
    for (const id of unvisited) undirected.set(id, new Set());
    for (const edge of edges) {
      if (!undirected.has(edge.source) || !undirected.has(edge.target)) continue;
      undirected.get(edge.source)!.add(edge.target);
      undirected.get(edge.target)!.add(edge.source);
    }

    for (const id of unvisited) {
      if (compVisited.has(id)) continue;
      const comp: string[] = [];
      const q = [id];
      compVisited.add(id);
      while (q.length > 0) {
        const cur = q.pop()!;
        comp.push(cur);
        for (const neighbor of undirected.get(cur) ?? []) {
          if (!compVisited.has(neighbor)) {
            compVisited.add(neighbor);
            q.push(neighbor);
          }
        }
      }
      components.push(comp);
    }

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      let compRoot = comp[0];
      let maxOut = 0;
      for (const id of comp) {
        const out = outgoingCount.get(id) ?? 0;
        if (out > maxOut) {
          maxOut = out;
          compRoot = id;
        }
      }
      const offsetAngle = Math.PI + ((2 * Math.PI) / (components.length + 1)) * (i + 1);
      bfs([compRoot], offsetAngle);
    }

    // Any still unvisited (isolated nodes with no edges at all)
    for (const id of nodeIds) {
      if (!visited.has(id)) {
        visited.add(id);
        nodeInfos.set(id, { id, depth: 0, parent: null, parentAngle: 0 });
      }
    }
  }

  // === Per-parent radial placement ===
  // Place roots first, then iterate BFS order placing children around their parent

  // Place roots
  const rootInfos = Array.from(nodeInfos.values()).filter((n) => n.depth === 0);
  if (rootInfos.length === 1) {
    positions.set(rootInfos[0].id, { x: 0, y: 0 });
  } else {
    const rootRadius = Math.max(cfg.nodeSpacing, rootInfos.length * cfg.nodeSpacing / (2 * Math.PI));
    for (let i = 0; i < rootInfos.length; i++) {
      const angle = (2 * Math.PI / rootInfos.length) * i - Math.PI / 2;
      positions.set(rootInfos[i].id, {
        x: Math.cos(angle) * rootRadius,
        y: Math.sin(angle) * rootRadius,
      });
    }
  }

  // BFS-order placement: process parents level by level
  // Collect all parents sorted by depth
  const parentsByDepth = Array.from(childrenOf.keys())
    .map((id) => ({ id, depth: nodeInfos.get(id)!.depth }))
    .sort((a, b) => a.depth - b.depth);

  for (const { id: parentId } of parentsByDepth) {
    const parentPos = positions.get(parentId);
    if (!parentPos) continue;

    const children = childrenOf.get(parentId) ?? [];
    if (children.length === 0) continue;

    const parentInfo = nodeInfos.get(parentId)!;
    const baseAngle = parentInfo.parentAngle;

    // Sort children by weight (strongest connection first → inner rings)
    const sortedChildren = [...children].sort((a, b) => {
      const wa = weightMap.get(`${parentId}->${a}`) ?? 0.5;
      const wb = weightMap.get(`${parentId}->${b}`) ?? 0.5;
      return wb - wa; // highest weight first
    });

    const spread = computeSpread(sortedChildren.length);

    // Determine how many children fit per ring at base radius
    // Arc length at radius r with spread s = r * s
    // Max children per ring = floor(r * s / nodeSpacing)
    const baseRadius = adaptiveTierSpacing;
    const ringGap = cfg.nodeSpacing * 1.1; // gap between concentric rings

    // Split children into rings
    const rings: string[][] = [];
    let remaining = [...sortedChildren]; // strongest first → inner rings
    let ringRadius = baseRadius;

    while (remaining.length > 0) {
      const circumferenceArc = ringRadius * spread;
      const capacity = Math.max(1, Math.floor(circumferenceArc / cfg.nodeSpacing));
      const ringChildren = remaining.splice(0, capacity);
      rings.push(ringChildren);
      ringRadius += ringGap;
    }

    // Place each ring
    let currentRadius = baseRadius;
    for (const ringChildren of rings) {
      const ringSpread = computeSpread(ringChildren.length);
      const orderedRing = interleaveFromCenter(ringChildren);

      for (let i = 0; i < orderedRing.length; i++) {
        const childId = orderedRing[i];

        let angle: number;
        if (orderedRing.length === 1) {
          angle = baseAngle;
        } else {
          angle = baseAngle - ringSpread / 2 + (ringSpread / (orderedRing.length - 1)) * i;
        }

        positions.set(childId, {
          x: parentPos.x + Math.cos(angle) * currentRadius,
          y: parentPos.y + Math.sin(angle) * currentRadius,
        });
      }
      currentRadius += ringGap;
    }
  }

  // Place any remaining unpositioned nodes (isolated, no edges)
  for (const info of nodeInfos.values()) {
    if (!positions.has(info.id)) {
      positions.set(info.id, { x: 0, y: 0 });
    }
  }

  // Multi-pass collision avoidance
  for (let pass = 0; pass < cfg.collisionPasses; pass++) {
    const damping = 1.0 - pass * 0.2; // 1.0, 0.8, 0.6
    pushApart(positions, cfg.minNodeDistance, damping);
  }

  return positions;
}

/**
 * Interleave items from center outward.
 * [A, B, C, D, E] (sorted strongest first) →
 * [D, B, A, C, E] (A at center, B/C next to it, D/E at edges)
 */
function interleaveFromCenter<T>(items: T[]): T[] {
  if (items.length <= 2) return items;
  const result: T[] = new Array(items.length);
  const mid = Math.floor(items.length / 2);

  for (let i = 0; i < items.length; i++) {
    let targetIdx: number;
    if (i === 0) {
      targetIdx = mid;
    } else if (i % 2 === 1) {
      targetIdx = mid - Math.ceil(i / 2);
    } else {
      targetIdx = mid + Math.floor(i / 2);
    }
    // Clamp to valid range
    targetIdx = Math.max(0, Math.min(items.length - 1, targetIdx));
    result[targetIdx] = items[i];
  }

  // Fill any gaps (shouldn't happen, but safety)
  let fillIdx = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === undefined) {
      while (fillIdx < items.length && result.includes(items[fillIdx])) fillIdx++;
      if (fillIdx < items.length) result[i] = items[fillIdx++];
    }
  }

  return result;
}

/**
 * Place children around a parent in multiple concentric rings.
 * Children are pre-sorted by weight (strongest first → inner ring).
 * Returns a Map of childId → position.
 */
function placeChildrenMultiRing(
  sortedChildren: string[],
  parentPos: { x: number; y: number },
  baseAngle: number,
  baseRadius: number,
  nodeSpacing: number,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (sortedChildren.length === 0) return result;

  const ringGap = nodeSpacing * 1.1;
  const spread = computeSpread(sortedChildren.length);

  // Split into rings based on capacity at each radius
  const rings: string[][] = [];
  let remaining = [...sortedChildren];
  let ringRadius = baseRadius;

  while (remaining.length > 0) {
    const circumferenceArc = ringRadius * spread;
    const capacity = Math.max(1, Math.floor(circumferenceArc / nodeSpacing));
    rings.push(remaining.splice(0, capacity));
    ringRadius += ringGap;
  }

  // Place each ring
  let currentRadius = baseRadius;
  for (const ringChildren of rings) {
    const ringSpread = computeSpread(ringChildren.length);
    const ordered = interleaveFromCenter(ringChildren);

    for (let i = 0; i < ordered.length; i++) {
      let angle: number;
      if (ordered.length === 1) {
        angle = baseAngle;
      } else {
        angle = baseAngle - ringSpread / 2 + (ringSpread / (ordered.length - 1)) * i;
      }
      result.set(ordered[i], {
        x: parentPos.x + Math.cos(angle) * currentRadius,
        y: parentPos.y + Math.sin(angle) * currentRadius,
      });
    }
    currentRadius += ringGap;
  }

  return result;
}

/** Multi-pass push-apart for overlapping nodes */
function pushApart(
  positions: Map<string, { x: number; y: number }>,
  minDist: number,
  damping: number = 1.0,
): void {
  const ids = Array.from(positions.keys());
  const minDistSq = minDist * minDist;

  for (let i = 0; i < ids.length; i++) {
    const a = positions.get(ids[i])!;
    for (let j = i + 1; j < ids.length; j++) {
      const b = positions.get(ids[j])!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDistSq && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const overlap = ((minDist - dist) / 2) * damping;
        const nx = dx / dist;
        const ny = dy / dist;
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

/**
 * Compute incremental directed flow positions for newly expanded nodes.
 * Uses per-parent radial placement with adaptive spread and weight-based distance.
 */
export function computeIncrementalDirectedFlow(
  allNodes: Array<{ id: string }>,
  allEdges: EdgeInput[],
  existingPositions: Map<string, { x: number; y: number }>,
  newNodeIds: Set<string>,
  expandedNodeId: string,
  config?: Partial<DirectedFlowConfig>,
): Map<string, { x: number; y: number }> {
  const cfg = { ...DEFAULTS, ...config };
  const result = new Map(existingPositions);

  if (newNodeIds.size === 0) return result;

  const expandedPos = existingPositions.get(expandedNodeId);
  if (!expandedPos) return result;

  const nodeIds = new Set(allNodes.map((n) => n.id));
  const totalNodes = allNodes.length;
  const adaptiveTierSpacing = computeAdaptiveTierSpacing(totalNodes, cfg.tierSpacing);

  // Build directed adjacency
  const outgoing = new Map<string, string[]>();
  for (const id of nodeIds) outgoing.set(id, []);
  for (const edge of allEdges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)!.push(edge.target);
  }

  // Build weight map
  const weightMap = buildWeightMap(allEdges, nodeIds);

  // BFS from expanded node, only placing new nodes
  const visited = new Set<string>([expandedNodeId]);
  const childrenOf = new Map<string, string[]>();

  // Calculate base angle: away from center of existing nodes
  let baseAngle = 0;
  if (existingPositions.size > 1) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const [id, pos] of existingPositions) {
      if (id !== expandedNodeId) {
        sumX += pos.x;
        sumY += pos.y;
        count++;
      }
    }
    if (count > 0) {
      const centerX = sumX / count;
      const centerY = sumY / count;
      baseAngle = Math.atan2(expandedPos.y - centerY, expandedPos.x - centerX);
    }
  }

  // Seed BFS with outgoing targets of expanded node that are new
  const outTargets = (outgoing.get(expandedNodeId) ?? []).filter((t) => newNodeIds.has(t));

  // Also collect incoming new nodes (they go behind the expanded node)
  const incomingNew: string[] = [];
  for (const edge of allEdges) {
    if (edge.target === expandedNodeId && newNodeIds.has(edge.source) && !visited.has(edge.source)) {
      incomingNew.push(edge.source);
    }
  }

  // Place outgoing children using multi-ring radial placement
  if (outTargets.length > 0) {
    // Sort by weight
    const sorted = [...outTargets].sort((a, b) => {
      const wa = weightMap.get(`${expandedNodeId}->${a}`) ?? 0.5;
      const wb = weightMap.get(`${expandedNodeId}->${b}`) ?? 0.5;
      return wb - wa;
    });
    childrenOf.set(expandedNodeId, sorted);

    const placed = placeChildrenMultiRing(
      sorted, expandedPos, baseAngle, adaptiveTierSpacing, cfg.nodeSpacing,
    );
    for (const [id, pos] of placed) {
      visited.add(id);
      result.set(id, pos);
    }
  }

  // Place incoming new nodes behind expanded node
  if (incomingNew.length > 0) {
    const behindAngle = baseAngle + Math.PI;
    const placed = placeChildrenMultiRing(
      incomingNew, expandedPos, behindAngle, adaptiveTierSpacing, cfg.nodeSpacing,
    );
    for (const [id, pos] of placed) {
      if (!visited.has(id)) {
        visited.add(id);
        result.set(id, pos);
      }
    }
  }

  // BFS deeper: place children of newly placed nodes
  const queue = [...(childrenOf.get(expandedNodeId) ?? []), ...incomingNew.filter((id) => visited.has(id))];
  let head = 0;
  while (head < queue.length) {
    const parentId = queue[head++];
    const parentPos = result.get(parentId);
    if (!parentPos) continue;

    const targets = (outgoing.get(parentId) ?? []).filter((t) => newNodeIds.has(t) && !visited.has(t));
    if (targets.length === 0) continue;

    const sorted = [...targets].sort((a, b) => {
      const wa = weightMap.get(`${parentId}->${a}`) ?? 0.5;
      const wb = weightMap.get(`${parentId}->${b}`) ?? 0.5;
      return wb - wa;
    });

    const parentAngle = Math.atan2(parentPos.y - expandedPos.y, parentPos.x - expandedPos.x);
    const placed = placeChildrenMultiRing(
      sorted, parentPos, parentAngle, adaptiveTierSpacing, cfg.nodeSpacing,
    );
    for (const [id, pos] of placed) {
      visited.add(id);
      result.set(id, pos);
      queue.push(id);
    }
  }

  // Place any new nodes not reached by BFS (no edge connection to expanded)
  let orphanIndex = 0;
  for (const id of newNodeIds) {
    if (!result.has(id)) {
      const angle = baseAngle + Math.PI * 0.5 + orphanIndex * 0.4;
      result.set(id, {
        x: expandedPos.x + Math.cos(angle) * adaptiveTierSpacing,
        y: expandedPos.y + Math.sin(angle) * adaptiveTierSpacing,
      });
      orphanIndex++;
    }
  }

  // Multi-pass collision avoidance on new nodes only
  const newPositions = new Map<string, { x: number; y: number }>();
  for (const id of newNodeIds) {
    const pos = result.get(id);
    if (pos) newPositions.set(id, pos);
  }
  for (let pass = 0; pass < cfg.collisionPasses; pass++) {
    const damping = 1.0 - pass * 0.2;
    pushApart(newPositions, cfg.minNodeDistance, damping);
  }
  for (const [id, pos] of newPositions) {
    result.set(id, pos);
  }

  return result;
}
