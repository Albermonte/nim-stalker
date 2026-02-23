'use client';

import { useEffect } from 'react';
import { GraphShell } from '@/components/GraphShell';
import { useGraphStore } from '@/store/graph-store';
import { api } from '@/lib/api';
import { HOME_REFRESH_INTERVAL_MS } from '@/lib/home-refresh';
import { shouldResetHomeGraphState } from './home-state';

export default function Home() {
  useEffect(() => {
    let active = true;

    const refreshHome = (allowReset: boolean) => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.hidden) return;

      const state = useGraphStore.getState();

      // Always refresh home data from source when entering `/`.
      api.invalidateCache('/graph/latest');
      api.invalidateCache('/transactions/recent');

      if (allowReset && shouldResetHomeGraphState(state)) {
        state.clearGraph();
      }

      void state.reloadHomeGraph();
    };

    refreshHome(true);

    const interval = window.setInterval(() => {
      refreshHome(false);
    }, HOME_REFRESH_INTERVAL_MS);

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refreshHome(false);
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, []);

  return <GraphShell />;
}
