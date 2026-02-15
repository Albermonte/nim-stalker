import type { Core, EventObject } from 'cytoscape';

export interface CyEventHandlers {
  onTapNode: (evt: EventObject) => void | Promise<void>;
  onTapEdge: (evt: EventObject) => void | Promise<void>;
  onTapBackground: (evt: EventObject) => void | Promise<void>;
  onDblTapNode: (evt: EventObject) => void | Promise<void>;
  onMouseOverNode: (evt: EventObject) => void | Promise<void>;
  onMouseOutNode: (evt: EventObject) => void | Promise<void>;
  onMouseOverEdge: (evt: EventObject) => void | Promise<void>;
  onMouseOutEdge: (evt: EventObject) => void | Promise<void>;
  onGrabNode: (evt: EventObject) => void | Promise<void>;
  onDragNode: (evt: EventObject) => void | Promise<void>;
  onFreeNode: (evt: EventObject) => void | Promise<void>;
}

interface Binding {
  event: string;
  selector?: string;
  handler: (evt: EventObject) => void | Promise<void>;
}

/**
 * Register all GraphCanvas Cytoscape handlers in one place and return a full cleanup.
 * This keeps on/off pairs aligned and prevents listener accumulation on re-renders.
 */
export function bindCyEvents(cy: Core, handlers: CyEventHandlers): () => void {
  const bindings: Binding[] = [
    { event: 'tap', selector: 'node', handler: handlers.onTapNode },
    { event: 'tap', selector: 'edge', handler: handlers.onTapEdge },
    { event: 'tap', handler: handlers.onTapBackground },
    { event: 'dbltap', selector: 'node', handler: handlers.onDblTapNode },
    { event: 'mouseover', selector: 'node', handler: handlers.onMouseOverNode },
    { event: 'mouseout', selector: 'node', handler: handlers.onMouseOutNode },
    { event: 'mouseover', selector: 'edge', handler: handlers.onMouseOverEdge },
    { event: 'mouseout', selector: 'edge', handler: handlers.onMouseOutEdge },
    { event: 'grab', selector: 'node', handler: handlers.onGrabNode },
    { event: 'drag', selector: 'node', handler: handlers.onDragNode },
    { event: 'free', selector: 'node', handler: handlers.onFreeNode },
  ];

  for (const binding of bindings) {
    if (binding.selector) {
      (cy.on as any)(binding.event, binding.selector, binding.handler);
    } else {
      (cy.on as any)(binding.event, binding.handler);
    }
  }

  return () => {
    for (const binding of bindings) {
      if (binding.selector) {
        (cy.off as any)(binding.event, binding.selector, binding.handler);
      } else {
        (cy.off as any)(binding.event, binding.handler);
      }
    }
  };
}
