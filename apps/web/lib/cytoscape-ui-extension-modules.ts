import navigator from 'cytoscape-navigator';
import autopanOnDrag from 'cytoscape-autopan-on-drag';
import noOverlap from 'cytoscape-no-overlap';
import layers from 'cytoscape-layers';
import cytoscapePopper from 'cytoscape-popper';
import type { UiExtensionModules } from './cytoscape-ui-extensions';

export const CYTOSCAPE_UI_EXTENSION_MODULES: UiExtensionModules = {
  layers,
  navigator,
  autopanOnDrag,
  noOverlap,
  popper: cytoscapePopper as UiExtensionModules['popper'],
};
