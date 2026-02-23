export function shouldUseTwoNodePresetLayout(input: {
  pathViewActive: boolean;
  nodeCount: number;
}): boolean {
  return !input.pathViewActive && input.nodeCount === 2;
}
