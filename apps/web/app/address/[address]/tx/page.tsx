'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { formatNimiqAddress } from '@/lib/format-utils';
import { isAddressSlug, safeDecodeURIComponent, urlSlugToAddress } from '@/lib/url-utils';
import type { Direction } from '@nim-stalker/shared';
import { TxTimeline } from '@/components/tx/TxTimeline';

const ALLOWED_DIRECTIONS: Direction[] = ['incoming', 'outgoing', 'both'];
const ALLOWED_LIMITS = new Set([50, 100, 200, 500]);

function parseDirection(raw: string | null): Direction {
  if (!raw) return 'both';
  const value = raw.toLowerCase();
  return (ALLOWED_DIRECTIONS as string[]).includes(value) ? (value as Direction) : 'both';
}

function parseLimit(raw: string | null): number {
  if (!raw) return 200;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return ALLOWED_LIMITS.has(n) ? n : 200;
}

function AddressTxPageInner() {
  const params = useParams<{ address: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const lastAddressRef = useRef<string | null>(null);
  const addressSlug = params.address;
  const decodedAddressSlug = useMemo(
    () => (addressSlug ? safeDecodeURIComponent(addressSlug) : null),
    [addressSlug],
  );

  const direction = useMemo(() => parseDirection(searchParams.get('direction')), [searchParams]);
  const limit = useMemo(() => parseLimit(searchParams.get('limit')), [searchParams]);
  const formattedAddress = useMemo(() => {
    if (!decodedAddressSlug || !isAddressSlug(decodedAddressSlug)) return null;
    return formatNimiqAddress(urlSlugToAddress(decodedAddressSlug));
  }, [decodedAddressSlug]);

  useEffect(() => {
    if (!addressSlug) return;
    if (!decodedAddressSlug) {
      toast.error('Invalid address format');
      router.replace('/');
      return;
    }
    if (lastAddressRef.current === decodedAddressSlug) return;
    lastAddressRef.current = decodedAddressSlug;

    if (!isAddressSlug(decodedAddressSlug)) {
      toast.error('Invalid address format');
      router.replace('/');
    }
  }, [addressSlug, decodedAddressSlug, router]);

  if (!formattedAddress) return null;

  return (
    <TxTimeline
      address={formattedAddress}
      direction={direction}
      limit={limit}
    />
  );
}

export default function AddressTxPage() {
  return (
    <Suspense>
      <AddressTxPageInner />
    </Suspense>
  );
}
