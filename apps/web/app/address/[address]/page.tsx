'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useGraphStore } from '@/store/graph-store';
import { isAddressSlug, safeDecodeURIComponent, urlSlugToAddress } from '@/lib/url-utils';
import { GraphShell } from '@/components/GraphShell';

export default function AddressPage() {
  const { address } = useParams<{ address: string }>();
  const router = useRouter();
  const lastAddressRef = useRef<string | null>(null);

  useEffect(() => {
    if (!address) return;

    const decodedAddress = safeDecodeURIComponent(address);
    if (!decodedAddress) {
      toast.error('Invalid address');
      router.replace('/');
      return;
    }

    if (lastAddressRef.current === decodedAddress) return;
    lastAddressRef.current = decodedAddress;

    if (!isAddressSlug(decodedAddress)) {
      toast.error('Invalid address');
      router.replace('/');
      return;
    }

    const normalizedAddress = urlSlugToAddress(decodedAddress);
    const { setSkipInitialLoad, searchAddress } = useGraphStore.getState();
    setSkipInitialLoad(true);
    void searchAddress(normalizedAddress);
  }, [address, router]);

  return <GraphShell />;
}
