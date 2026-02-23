export function shouldUseTwoNodePresetLayout(input: {
  pathViewActive: boolean;
  nodeCount: number;
  edgeCount: number;
}): boolean {
  return !input.pathViewActive && input.nodeCount === 2 && input.edgeCount === 1;
}
