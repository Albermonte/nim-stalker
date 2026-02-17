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
    ],
  },
  {
    id: 'other',
    label: 'Other',
    layouts: [
      { id: 'elk-stress', label: 'ELK Stress', description: 'Stress minimization' },
    ],
  },
];

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
