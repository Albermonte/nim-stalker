'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useGraphStore } from '@/store/graph-store';
import { GraphShell } from '@/components/GraphShell';
import { isPathRequestAlreadyActive, parsePathRequest } from './path-state';

function PathPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const lastRequestKeyRef = useRef<string | null>(null);
  const searchParamsKey = searchParams.toString();

  useEffect(() => {
    const parsed = parsePathRequest(new URLSearchParams(searchParamsKey));
    if (!parsed.ok) {
      if (parsed.reason === 'missing_params') {
        toast.error('Missing path parameters: from and to are required');
      } else {
        toast.error('Invalid address format in path URL');
      }
      router.replace('/');
      return;
    }

    const request = parsed.value;
    const state = useGraphStore.getState();

    if (isPathRequestAlreadyActive(state.pathView, request)) {
      lastRequestKeyRef.current = request.requestKey;
      return;
    }

    if (lastRequestKeyRef.current === request.requestKey) {
      return;
    }
    lastRequestKeyRef.current = request.requestKey;

    const { setSkipInitialLoad, setPathModeMaxHops, setPathModeDirected, findPath } = state;
    setSkipInitialLoad(true);
    setPathModeMaxHops(request.maxHops);
    setPathModeDirected(request.directed);
    void findPath(request.fromAddress, request.toAddress, request.maxHops);
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
