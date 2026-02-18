import type { LayoutMode } from '@/store/graph-store';

export interface LayoutCategory {
  id: string;
  label: string;
  layouts: LayoutOption[];
}

export interface LayoutOption {
  id: LayoutMode;
  label: string;
  description: string;
}

export const LAYOUT_CATEGORIES: LayoutCategory[] = [
  {
    id: 'force',
    label: 'Force-Directed',
    layouts: [
      { id: 'fcose', label: 'fCoSE', description: 'Spring-based force simulation' },
      { id: 'fcose-weighted', label: 'fCoSE Weighted', description: 'Strong ties pull closer (txCount log-scale)' },
      { id: 'cola', label: 'Cola', description: 'Constraint-based' },
    ],
  },
  {
    id: 'hierarchical',
    label: 'Hierarchical',
    layouts: [
      { id: 'elk-layered-down', label: 'ELK Layered \u2193', description: 'Top-to-bottom flow' },
      { id: 'elk-layered-right', label: 'ELK Layered \u2192', description: 'Left-to-right flow' },
      { id: 'dagre-tb', label: 'Dagre \u2193', description: 'Lightweight top-down' },
      { id: 'dagre-lr', label: 'Dagre \u2192', description: 'Lightweight left-right' },
    ],
  },
  {
    id: 'flow',
    label: 'Flow',
    layouts: [
      { id: 'directed-flow', label: 'Directed Flow', description: 'Radial outward flow by tx direction' },
      { id: 'biflow-lr', label: 'BiFlow \u2194', description: 'Incoming left, outgoing right from focus' },
      { id: 'biflow-tb', label: 'BiFlow \u2195', description: 'Incoming up, outgoing down from focus' },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    layouts: [
      { id: 'elk-stress', label: 'ELK Stress', description: 'Stress minimization' },
      { id: 'concentric-volume', label: 'Concentric (Volume)', description: 'Hubs in center by \u03a3txCount' },
    ],
  },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function readTxCountFromEdge(edge: any): number {
  try {
    const raw = typeof edge?.data === 'function' ? edge.data('txCount') : edge?.data?.txCount;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

/** Get the Cytoscape layout options object for a given layout mode */
export function getLayoutOptions(mode: LayoutMode, nodeCount?: number): Record<string, unknown> {
  switch (mode) {
    case 'fcose':
      return {
        name: 'fcose',
        quality: 'default',
        randomize: true,
        animate: true,
        animationDuration: 1000,
        fit: true,
        padding: 30,
        nodeDimensionsIncludeLabels: false,
        nodeRepulsion: 4500,
        idealEdgeLength: 50,
        edgeElasticity: 0.45,
        nestingFactor: 0.1,
        gravity: 0.25,
        numIter: 2500,
        tile: true,
      };

    case 'fcose-weighted': {
      const base = getLayoutOptions('fcose', nodeCount) as any;
      return {
        ...base,
        // Heavy-tailed txCount: log-scale to avoid giant edges dominating.
        // t = clamp(log10(1+txCount)/6, 0..1)
        // edgeLen = lerp(320, 90, t)
        idealEdgeLength: (edge: any) => {
          const txCount = readTxCountFromEdge(edge);
          const t = clamp(Math.log10(1 + txCount) / 6, 0, 1);
          return lerp(320, 90, t);
        },
      };
    }

    case 'cola':
      return {
        name: 'cola',
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 120,
        nodeDimensionsIncludeLabels: true,
        nodeSpacing: () => 40,
        edgeLength: 200,
        convergenceThreshold: 0.01,
        avoidOverlap: true,
        handleDisconnected: true,
        infinite: false,
      };

    case 'elk-layered-down':
      return {
        name: 'elk',
        elk: {
          algorithm: 'layered',
          'elk.direction': 'DOWN',
          'spacing.nodeNode': '80',
          'spacing.edgeNode': '40',
          'spacing.edgeEdge': '20',
          'layered.spacing.nodeNodeBetweenLayers': '100',
        },
        fit: true,
        padding: 120,
        animate: true,
        animationDuration: 500,
      };

    case 'elk-layered-right':
      return {
        name: 'elk',
        elk: {
          algorithm: 'layered',
          'elk.direction': 'RIGHT',
          'spacing.nodeNode': '80',
          'spacing.edgeNode': '40',
          'spacing.edgeEdge': '20',
          'layered.spacing.nodeNodeBetweenLayers': '100',
        },
        fit: true,
        padding: 120,
        animate: true,
        animationDuration: 500,
      };

    case 'elk-stress':
      return {
        name: 'elk',
        elk: {
          algorithm: 'stress',
          'stress.desiredEdgeLength': '200',
          'spacing.nodeNode': '80',
        },
        fit: true,
        padding: 120,
        animate: true,
        animationDuration: 500,
      };

    case 'concentric-volume':
      return {
        name: 'concentric',
        fit: true,
        padding: 120,
        animate: true,
        animationDuration: 500,
        avoidOverlap: true,
        minNodeSpacing: 40,
        concentric: (node: any) => {
          try {
            const edges = typeof node?.connectedEdges === 'function' ? node.connectedEdges() : null;
            if (!edges) return 0;
            let sum = 0;
            edges.forEach((e: any) => { sum += readTxCountFromEdge(e); });
            return Math.log10(1 + sum);
          } catch {
            return 0;
          }
        },
        levelWidth: () => 0.5,
      };

    case 'dagre-tb':
      return {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 80,
        edgeSep: 40,
        rankSep: 100,
        fit: true,
        padding: 120,
        animate: true,
        animationDuration: 500,
      };

    case 'dagre-lr':
      return {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 80,
        edgeSep: 40,
        rankSep: 100,
        fit: true,
        padding: 120,
        animate: true,
        animationDuration: 500,
      };

    case 'biflow-lr':
    case 'biflow-tb':
      return {
        name: 'preset',
        fit: true,
        padding: 120,
        animate: true,
        animationDuration: 500,
        positions: (node: any) => {
          return node.scratch('_biflowPos') || node.position();
        },
      };

    case 'directed-flow':
      return {
        name: 'preset',
        fit: true,
        padding: 120,
        animate: true,
        animationDuration: 500,
        positions: (node: any) => {
          return node.scratch('_directedFlowPos') || { x: 0, y: 0 };
        },
      };

    default:
      return getLayoutOptions('fcose');
  }
}

/** Get fcose layout options tuned for path view */
export function getPathLayoutOptions(): Record<string, unknown> {
  return {
    name: 'fcose',
    quality: 'proof',
    randomize: true,
    animate: true,
    animationDuration: 500,
    fit: true,
    padding: 120,
    nodeDimensionsIncludeLabels: true,
    nodeRepulsion: 18000,
    idealEdgeLength: 300,
    edgeElasticity: 0.15,
    nestingFactor: 0.1,
    gravity: 0.03,
    numIter: 3000,
    tile: true,
  };
}

/** Get fcose layout options for incremental expansion */
export function getIncrementalLayoutOptions(): Record<string, unknown> {
  return {
    name: 'fcose',
    quality: 'proof',
    randomize: false,
    animate: true,
    animationDuration: 400,
    fit: false,
    padding: 50,
    nodeDimensionsIncludeLabels: true,
    nodeRepulsion: 20000,
    idealEdgeLength: 300,
    edgeElasticity: 0.2,
    gravity: 0,
    numIter: 1500,
  };
}

/** Get Cola layout options for incremental expansion */
export function getIncrementalColaOptions(): Record<string, unknown> {
  return {
    name: 'cola',
    animate: true,
    animationDuration: 400,
    fit: false,
    padding: 50,
    nodeDimensionsIncludeLabels: true,
    nodeSpacing: () => 40,
    edgeLength: 200,
    convergenceThreshold: 0.01,
    avoidOverlap: true,
    handleDisconnected: true,
    infinite: false,
  };
}

/** Get incremental layout options for any supported layout mode */
export function getIncrementalOptionsForMode(mode: LayoutMode): Record<string, unknown> | null {
  switch (mode) {
    case 'fcose':
      return getIncrementalLayoutOptions();
    case 'cola':
      return getIncrementalColaOptions();
    case 'directed-flow':
      return {
        name: 'preset',
        fit: false,
        animate: true,
        animationDuration: 400,
        positions: (node: any) => {
          return node.scratch('_directedFlowPos') || node.position();
        },
      };
    default:
      return null;
  }
}

/** Find which category a layout mode belongs to */
export function findLayoutCategory(mode: LayoutMode): LayoutCategory | undefined {
  return LAYOUT_CATEGORIES.find((cat) => cat.layouts.some((l) => l.id === mode));
}

/** Find the label for a layout mode */
export function getLayoutLabel(mode: LayoutMode): string {
  for (const cat of LAYOUT_CATEGORIES) {
    const layout = cat.layouts.find((l) => l.id === mode);
    if (layout) return layout.label;
  }
  return mode;
}
