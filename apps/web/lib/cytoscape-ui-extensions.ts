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

type NavigatorLike = {
  destroy?: () => void;
  _removeCyListeners?: () => void;
  _onRenderHandler?: { cancel?: () => void } | null;
  overlayTimeout?: ReturnType<typeof setTimeout> | false | null;
};

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
  const addCleanup = (cleanup: () => void): void => {
    cleanupFns.push(() => {
      try {
        cleanup();
      } catch {
        // Route transitions can race with Cytoscape extension teardown.
      }
    });
  };

  const navigatorFactory = (cy as any).navigator;
  if (typeof navigatorFactory === 'function') {
    const nav = navigatorFactory.call(cy, {
      container: options.navigatorContainer ?? false,
      viewLiveFramerate: 15,
      thumbnailEventFramerate: 20,
      thumbnailLiveFramerate: false,
      rerenderDelay: 120,
      removeCustomContainer: false,
    }) as NavigatorLike;

    if (nav && typeof nav._removeCyListeners === 'function') {
      addCleanup(() => {
        nav._removeCyListeners?.();
      });
    }

    if (nav && nav._onRenderHandler && typeof nav._onRenderHandler.cancel === 'function') {
      addCleanup(() => {
        nav._onRenderHandler?.cancel?.();
      });
    }

    if (nav && nav.overlayTimeout != null && nav.overlayTimeout !== false) {
      addCleanup(() => {
        if (nav.overlayTimeout != null && nav.overlayTimeout !== false) {
          clearTimeout(nav.overlayTimeout);
          nav.overlayTimeout = false;
        }
      });
    }

    if (nav && typeof nav.destroy === 'function') {
      addCleanup(() => {
        nav.destroy?.();
      });
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
      addCleanup(() => {
        autopan.disable();
      });
    }
  }

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (let i = cleanupFns.length - 1; i >= 0; i -= 1) {
      cleanupFns[i]();
    }
  };
}

export function resetUiExtensionRegistrationForTests(): void {
  registered = false;
}
