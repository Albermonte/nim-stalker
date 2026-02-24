import cytoscape from 'cytoscape';

// Using "any" for style objects because TypeScript types don't include all valid Cytoscape.js properties
export const graphStylesheet: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      'background-opacity': 0,
      'background-image': 'data(identicon)',
      'background-fit': 'contain',
      'background-clip': 'none',
      'background-width': '100%',
      'background-height': '100%',
      'background-position-x': '50%',
      'background-position-y': '50%',
      'background-image-smoothing': 'yes',
      label: 'data(label)',
      color: '#000000',
      'text-outline-color': '#FFFFFF',
      'text-outline-width': 1,
      'font-size': '12px',
      'font-family': 'Roboto Flex, Arial, sans-serif',
      'font-weight': '900',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 8,
      width: 64,
      height: 64,
      shape: 'ellipse',
    } as any,
  },
  {
    selector: 'node:selected',
    style: {
      'overlay-padding': 8,
      'overlay-color': '#FF69B4',
      'overlay-opacity': 0.2,
      'overlay-shape': 'ellipse',
    },
  },
  {
    selector: 'node.path-start',
    style: {
      'overlay-padding': 8,
      'overlay-color': '#8B8BF5',
      'overlay-opacity': 0.3,
      'overlay-shape': 'ellipse',
    },
  },
  {
    selector: 'node.path-end',
    style: {
      'overlay-padding': 8,
      'overlay-color': '#FF69B4',
      'overlay-opacity': 0.3,
      'overlay-shape': 'ellipse',
    },
  },
  {
    selector: 'edge',
    style: {
      // Dynamic width based on transaction count: 1 tx → 3px, 300+ tx → 15px
      width: 'mapData(txCount, 1, 300, 3, 15)' as any,
      'line-color': 'rgba(107, 114, 128, 0.3)',
      'target-arrow-color': 'rgba(107, 114, 128, 0.3)',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'arrow-scale': 1.2,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#FF69B4', // NQ pink
      'target-arrow-color': '#FF69B4',
      'line-style': 'solid',
      // Inherits dynamic width from base edge selector
    },
  },
  {
    selector: 'edge.outgoing-from-selected',
    style: {
      'line-color': '#FF69B4', // NQ pink for outgoing
      'target-arrow-color': '#FF69B4',
      // Inherits dynamic width from base edge selector
    },
  },
  {
    selector: 'edge.incoming-to-selected',
    style: {
      'line-color': '#22C55E', // Green for incoming
      'target-arrow-color': '#22C55E',
      // Inherits dynamic width from base edge selector
    },
  },
  {
    selector: 'edge.dimmed',
    style: {
      opacity: 0.2,
    },
  },
  {
    selector: 'edge.path-outgoing',
    style: {
      'line-color': '#FF69B4', // Pink for outgoing
      'target-arrow-color': '#FF69B4',
      // Inherits dynamic width from base edge selector
    },
  },
  {
    selector: 'edge.path-incoming',
    style: {
      'line-color': '#22C55E', // Green for incoming
      'target-arrow-color': '#22C55E',
      // Inherits dynamic width from base edge selector
    },
  },
  {
    selector: 'edge.path-outgoing.outgoing-from-selected, edge.path-incoming.outgoing-from-selected',
    style: {
      'line-color': '#FF69B4',
      'target-arrow-color': '#FF69B4',
    },
  },
  {
    selector: 'edge.path-outgoing.incoming-to-selected, edge.path-incoming.incoming-to-selected',
    style: {
      'line-color': '#22C55E',
      'target-arrow-color': '#22C55E',
    },
  },
];
