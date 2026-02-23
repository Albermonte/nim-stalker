'use client';

import { useEffect } from 'react';
import { GraphShell } from '@/components/GraphShell';
import { useGraphStore } from '@/store/graph-store';
import { api } from '@/lib/api';
import { shouldResetHomeGraphState } from './home-state';

export default function Home() {
  useEffect(() => {
    const state = useGraphStore.getState();

    // Always refresh home data from source when entering `/`.
    api.invalidateCache('/graph/latest');
    api.invalidateCache('/transactions/recent');

    if (shouldResetHomeGraphState(state)) {
      state.clearGraph();
    }

    void state.reloadHomeGraph();
  }, []);

  return <GraphShell />;
}
