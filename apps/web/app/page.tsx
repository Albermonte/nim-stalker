'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { GraphShell } from '@/components/GraphShell';
import { useGraphStore } from '@/store/graph-store';
import { getAddressSlugFromHash, isAddressSlug, urlSlugToAddress } from '@/lib/url-utils';

export default function Home() {
  useEffect(() => {
    const slug = getAddressSlugFromHash(window.location.hash);
    if (!slug) return;

    if (!isAddressSlug(slug)) {
      toast.error('Invalid address in URL');
      window.history.replaceState(null, '', '/');
      return;
    }

    const { setSkipInitialLoad, searchAddress } = useGraphStore.getState();
    setSkipInitialLoad(true);
    void searchAddress(urlSlugToAddress(slug));
  }, []);

  return <GraphShell />;
}
