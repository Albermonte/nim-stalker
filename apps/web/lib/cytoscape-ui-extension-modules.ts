import navigator from 'cytoscape-navigator';
import autopanOnDrag from 'cytoscape-autopan-on-drag';
import noOverlap from 'cytoscape-no-overlap';
import layers from 'cytoscape-layers';
import overlays, { renderBar } from 'cytoscape-overlays';
import cytoscapePopper from 'cytoscape-popper';
import type { UiExtensionModules, OverlaysApiLike } from './cytoscape-ui-extensions';

export const CYTOSCAPE_UI_EXTENSION_MODULES: UiExtensionModules = {
  layers,
  navigator,
  autopanOnDrag,
  noOverlap,
  overlays,
  popper: cytoscapePopper as UiExtensionModules['popper'],
};

export const CYTOSCAPE_OVERLAYS_API: OverlaysApiLike = {
  renderBar,
};
