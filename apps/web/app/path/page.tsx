'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useGraphStore } from '@/store/graph-store';
import { formatNimiqAddress } from '@/lib/format-utils';
import { isAddressSlug, urlSlugToAddress } from '@/lib/url-utils';
import { GraphShell } from '@/components/GraphShell';

function PathPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const maxHopsParam = searchParams.get('maxHops');
    const directedParam = searchParams.get('directed');

    if (!from || !to) {
      toast.error('Missing path parameters: from and to are required');
      router.replace('/');
      return;
    }

    if (!isAddressSlug(from) || !isAddressSlug(to)) {
      toast.error('Invalid address format in path URL');
      router.replace('/');
      return;
    }

    const fromAddress = formatNimiqAddress(urlSlugToAddress(from));
    const toAddress = formatNimiqAddress(urlSlugToAddress(to));
    const maxHops = maxHopsParam ? Number(maxHopsParam) : 3;
    const directed = directedParam === 'true';

    const { setSkipInitialLoad, setPathModeMaxHops, setPathModeDirected, findPath } = useGraphStore.getState();
    setSkipInitialLoad(true);
    setPathModeMaxHops(maxHops);
    setPathModeDirected(directed);
    findPath(fromAddress, toAddress, maxHops);
  }, [searchParams, router]);

  return <GraphShell />;
}

export default function PathPage() {
  return (
    <Suspense>
      <PathPageInner />
    </Suspense>
  );
}
