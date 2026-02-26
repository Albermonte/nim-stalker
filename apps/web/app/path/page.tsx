'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useGraphStore } from '@/store/graph-store';
import { GraphShell } from '@/components/GraphShell';
import { isPathRequestSetAlreadyActive, parsePathRequests } from './path-state';

function PathPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const lastRequestKeyRef = useRef<string | null>(null);
  const searchParamsKey = searchParams.toString();

  useEffect(() => {
    const parsed = parsePathRequests(new URLSearchParams(searchParamsKey));
    if (!parsed.ok) {
      if (parsed.reason === 'missing_params') {
        toast.error('Missing path parameters: from and to are required');
      } else {
        toast.error('Invalid address format in path URL');
      }
      router.replace('/');
      return;
    }

    const requests = parsed.value;
    const requestSetKey = requests.map((request) => request.requestKey).join('||');
    const state = useGraphStore.getState();

    if (isPathRequestSetAlreadyActive(state.pathView, requests)) {
      lastRequestKeyRef.current = requestSetKey;
      return;
    }

    if (lastRequestKeyRef.current === requestSetKey) {
      return;
    }
    lastRequestKeyRef.current = requestSetKey;

    const { setSkipInitialLoad, setPathModeMaxHops, setPathModeDirected, loadPathSequence } = state;
    setSkipInitialLoad(true);
    if (requests[0]) {
      setPathModeMaxHops(requests[0].maxHops);
      setPathModeDirected(requests[0].directed);
    }
    void loadPathSequence(requests);
  }, [router, searchParamsKey]);

  return <GraphShell />;
}

export default function PathPage() {
  return (
    <Suspense>
      <PathPageInner />
    </Suspense>
  );
}
