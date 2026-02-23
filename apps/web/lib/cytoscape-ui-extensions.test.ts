import { describe, test, expect, mock } from 'bun:test';
import {
  attachUiExtensions,
  registerUiExtensions,
  resetUiExtensionRegistrationForTests,
} from './cytoscape-ui-extensions';

describe('cytoscape-ui-extensions', () => {
  test('registerUiExtensions registers modules only once', () => {
    resetUiExtensionRegistrationForTests();

    const use = mock(() => {});
    const fakeCytoscape = { use } as any;

    const modules = {
      layers: Symbol('layers'),
      navigator: Symbol('navigator'),
      autopanOnDrag: Symbol('autopan'),
      noOverlap: Symbol('no-overlap'),
      popper: mock(() => Symbol('popper')),
    };

    registerUiExtensions(fakeCytoscape, modules as any);
    registerUiExtensions(fakeCytoscape, modules as any);

    expect(modules.popper).toHaveBeenCalledTimes(1);
    expect(use).toHaveBeenCalledTimes(5);
  });

  test('attachUiExtensions wires navigator and autopan without drag-blocking no-overlap', () => {
    const destroyNavigator = mock(() => {});
    const removeCyListeners = mock(() => {});
    const cancelRender = mock(() => {});
    const noOverlap = mock(() => {});
    const on = mock(() => {});
    const off = mock(() => {});
    const disableAutopan = mock(() => {});

    const nodes = { length: 3, noOverlap } as any;
    const nav = {
      _removeCyListeners: removeCyListeners,
      _onRenderHandler: { cancel: cancelRender },
      overlayTimeout: setTimeout(() => {}, 5_000),
      destroy: destroyNavigator,
    };
    const cy = {
      navigator: mock(() => nav),
      autopanOnDrag: mock(() => ({ enable: mock(() => {}), disable: disableAutopan })),
      nodes: mock(() => nodes),
      on,
      off,
    } as any;

    const cleanup = attachUiExtensions(cy);

    expect(cy.navigator).toHaveBeenCalledTimes(1);
    expect(cy.autopanOnDrag).toHaveBeenCalledTimes(1);
    expect(noOverlap).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();

    cleanup();
    cleanup();

    expect(destroyNavigator).toHaveBeenCalledTimes(1);
    expect(removeCyListeners).toHaveBeenCalledTimes(1);
    expect(cancelRender).toHaveBeenCalledTimes(1);
    expect(disableAutopan).toHaveBeenCalledTimes(1);
    expect(nav.overlayTimeout).toBe(false);
    expect(off).not.toHaveBeenCalled();
  });

  test('attachUiExtensions is safe when extension methods are unavailable', () => {
    const cleanup = attachUiExtensions({} as any);
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  test('cleanup swallows navigator teardown failures', () => {
    const cy = {
      navigator: mock(() => ({
        _removeCyListeners: mock(() => {
          throw new Error('remove failed');
        }),
        _onRenderHandler: {
          cancel: mock(() => {
            throw new Error('cancel failed');
          }),
        },
        destroy: mock(() => {
          throw new Error('destroy failed');
        }),
      })),
      autopanOnDrag: mock(() => ({
        enable: mock(() => {}),
        disable: mock(() => {
          throw new Error('disable failed');
        }),
      })),
    } as any;

    const cleanup = attachUiExtensions(cy);
    expect(() => cleanup()).not.toThrow();
  });
});
