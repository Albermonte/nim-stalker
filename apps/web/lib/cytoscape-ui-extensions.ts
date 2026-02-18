import { type Core } from 'cytoscape';
import { computePosition, flip, limitShift, shift } from '@floating-ui/dom';

type CytoscapeLike = {
  use: (extension: any) => void;
};

type PopperModule = {
  (factory: (ref: any, content: HTMLElement, opts?: Record<string, unknown>) => { update(): void }): unknown;
};

export interface UiExtensionModules {
  layers: unknown;
  navigator: unknown;
  autopanOnDrag: unknown;
  noOverlap: unknown;
  popper: PopperModule;
}

export interface UiExtensionAttachOptions {
  navigatorContainer?: string;
}

let registered = false;

export function createFloatingUiPopperFactory() {
  return function floatingUiPopperFactory(ref: any, content: HTMLElement, opts: Record<string, unknown> = {}) {
    const popperOptions = {
      middleware: [flip(), shift({ limiter: limitShift() })],
      ...opts,
    };

    const update = () => {
      computePosition(ref, content, popperOptions as any).then(({ x, y }) => {
        Object.assign(content.style, {
          position: 'absolute',
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    };

    update();

    return { update };
  };
}

function applyNoOverlap(cy: Core): void {
  if (typeof (cy as any).nodes !== 'function') return;
  const nodes = cy.nodes() as any;
  if (nodes.length > 1 && typeof nodes.noOverlap === 'function') {
    nodes.noOverlap({ padding: 12 });
  }
}

export function registerUiExtensions(cytoscapeModule: CytoscapeLike, modules: UiExtensionModules): void {
  if (registered) return;

  cytoscapeModule.use(modules.layers);
  cytoscapeModule.use(modules.navigator);
  cytoscapeModule.use(modules.autopanOnDrag);
  cytoscapeModule.use(modules.noOverlap);
  cytoscapeModule.use(modules.popper(createFloatingUiPopperFactory()));

  registered = true;
}

export function attachUiExtensions(
  cy: Core,
  options: UiExtensionAttachOptions = {}
): () => void {
  const cleanupFns: Array<() => void> = [];

  const navigatorFactory = (cy as any).navigator;
  if (typeof navigatorFactory === 'function') {
    const nav = navigatorFactory.call(cy, {
      container: options.navigatorContainer ?? false,
      viewLiveFramerate: 15,
      thumbnailEventFramerate: 20,
      thumbnailLiveFramerate: false,
      rerenderDelay: 120,
      removeCustomContainer: false,
    });

    if (nav && typeof nav.destroy === 'function') {
      cleanupFns.push(() => nav.destroy());
    }
  }

  const autopanFactory = (cy as any).autopanOnDrag;
  if (typeof autopanFactory === 'function') {
    const autopan = autopanFactory.call(cy, {
      enabled: true,
      selector: 'node',
      speed: 1.5,
    });

    if (autopan && typeof autopan.enable === 'function') {
      autopan.enable();
    }

    if (autopan && typeof autopan.disable === 'function') {
      cleanupFns.push(() => autopan.disable());
    }
  }

  const reapplyNoOverlap = () => applyNoOverlap(cy);
  reapplyNoOverlap();
  if (typeof (cy as any).on === 'function' && typeof (cy as any).off === 'function') {
    cy.on('add', 'node', reapplyNoOverlap);
    cleanupFns.push(() => cy.off('add', 'node', reapplyNoOverlap));
  }

  return () => {
    for (let i = cleanupFns.length - 1; i >= 0; i -= 1) {
      cleanupFns[i]();
    }
  };
}

export function resetUiExtensionRegistrationForTests(): void {
  registered = false;
}
