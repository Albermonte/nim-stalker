'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { GraphShell } from '@/components/GraphShell';
import { useGraphStore } from '@/store/graph-store';
import { getAddressSlugFromHash, isAddressSlug, urlSlugToAddress } from '@/lib/url-utils';

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

export default function Home() {
  useEffect(() => {
    const state = useGraphStore.getState();
    const slug = getAddressSlugFromHash(window.location.hash);
    if (!slug) {
      if (shouldResetHomeGraphState(state)) {
        state.clearGraph();
      }
      return;
    }

    if (!isAddressSlug(slug)) {
      toast.error('Invalid address in URL');
      window.history.replaceState(null, '', '/');
      return;
    }

    const { setSkipInitialLoad, searchAddress } = state;
    setSkipInitialLoad(true);
    void searchAddress(urlSlugToAddress(slug));
  }, []);

  return <GraphShell />;
}
