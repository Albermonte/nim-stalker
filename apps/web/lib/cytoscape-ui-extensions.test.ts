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
      overlays: Symbol('overlays'),
      popper: mock(() => Symbol('popper')),
    };

    registerUiExtensions(fakeCytoscape, modules as any);
    registerUiExtensions(fakeCytoscape, modules as any);

    expect(modules.popper).toHaveBeenCalledTimes(1);
    expect(use).toHaveBeenCalledTimes(6);
  });

  test('attachUiExtensions wires navigator, autopan, no-overlap and overlays', () => {
    const destroyNavigator = mock(() => {});
    const removeOverlays = mock(() => {});
    const noOverlap = mock(() => {});
    const on = mock(() => {});
    const off = mock(() => {});

    const nodes = { length: 3, noOverlap } as any;
    const cy = {
      navigator: mock(() => ({ destroy: destroyNavigator })),
      autopanOnDrag: mock(() => ({ enable: mock(() => {}) })),
      overlays: mock(() => ({ remove: removeOverlays })),
      nodes: mock(() => nodes),
      on,
      off,
    } as any;

    const overlaysApi = {
      renderBar: mock(() => Symbol('bar-vis')),
    } as any;

    const cleanup = attachUiExtensions(cy, overlaysApi);

    expect(cy.navigator).toHaveBeenCalledTimes(1);
    expect(cy.autopanOnDrag).toHaveBeenCalledTimes(1);
    expect(cy.overlays).toHaveBeenCalledTimes(1);
    expect(overlaysApi.renderBar).toHaveBeenCalledTimes(1);
    expect(noOverlap).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith('add', 'node', expect.any(Function));

    cleanup();

    expect(destroyNavigator).toHaveBeenCalledTimes(1);
    expect(removeOverlays).toHaveBeenCalledTimes(1);
    expect(off).toHaveBeenCalledWith('add', 'node', expect.any(Function));
  });

  test('attachUiExtensions is safe when extension methods are unavailable', () => {
    const cleanup = attachUiExtensions({} as any, {} as any);
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });
});
