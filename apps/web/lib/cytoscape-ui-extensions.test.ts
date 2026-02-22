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
    const noOverlap = mock(() => {});
    const on = mock(() => {});
    const off = mock(() => {});

    const nodes = { length: 3, noOverlap } as any;
    const cy = {
      navigator: mock(() => ({ destroy: destroyNavigator })),
      autopanOnDrag: mock(() => ({ enable: mock(() => {}) })),
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

    expect(destroyNavigator).toHaveBeenCalledTimes(1);
    expect(off).not.toHaveBeenCalled();
  });

  test('attachUiExtensions is safe when extension methods are unavailable', () => {
    const cleanup = attachUiExtensions({} as any);
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });
});
