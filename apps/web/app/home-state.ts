type HomeGraphSnapshot = {
  nodes: Map<string, unknown>;
  edges: Map<string, unknown>;
  skipInitialLoad: boolean;
  pathView: { active: boolean };
};

export function shouldResetHomeGraphState(state: HomeGraphSnapshot): boolean {
  return state.nodes.size > 0 ||
    state.edges.size > 0 ||
    state.skipInitialLoad ||
    state.pathView.active;
}
