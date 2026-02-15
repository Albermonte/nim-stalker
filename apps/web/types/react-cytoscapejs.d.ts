declare module 'react-cytoscapejs' {
  import { Core, ElementDefinition, StylesheetStyle, LayoutOptions } from 'cytoscape';
  import { ComponentType, CSSProperties } from 'react';

  interface CytoscapeComponentProps {
    id?: string;
    cy?: (cy: Core) => void;
    style?: CSSProperties;
    elements: ElementDefinition[];
    layout?: LayoutOptions;
    stylesheet?: StylesheetStyle[];
    className?: string;
    zoom?: number;
    pan?: { x: number; y: number };
    minZoom?: number;
    maxZoom?: number;
    zoomingEnabled?: boolean;
    userZoomingEnabled?: boolean;
    panningEnabled?: boolean;
    userPanningEnabled?: boolean;
    boxSelectionEnabled?: boolean;
    autoungrabify?: boolean;
    autounselectify?: boolean;
    wheelSensitivity?: number;
  }

  const CytoscapeComponent: ComponentType<CytoscapeComponentProps>;
  export default CytoscapeComponent;
}
