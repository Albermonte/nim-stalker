'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { formatNimiqAddress } from '@/lib/format-utils';
import { isAddressSlug, urlSlugToAddress } from '@/lib/url-utils';
import type { Direction } from '@nim-stalker/shared';

function TxTimelineLoading() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-pulse text-nq-pink text-lg">Loading timeline...</div>
    </div>
  );
}

const TxTimeline = dynamic(
  () => import('@/components/tx/TxTimeline').then((mod) => mod.TxTimeline),
  { ssr: false, loading: () => <TxTimelineLoading /> }
);

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

function TxPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initializedRef = useRef(false);

  const addr = searchParams.get('addr');
  const direction = parseDirection(searchParams.get('direction'));
  const limit = parseLimit(searchParams.get('limit'));

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (!addr) {
      toast.error('Missing parameter: addr');
      router.replace('/');
      return;
    }

    if (!isAddressSlug(addr)) {
      toast.error('Invalid address format');
      router.replace('/');
      return;
    }
  }, [addr, router]);

  if (!addr || !isAddressSlug(addr)) return null;

  const formattedAddress = formatNimiqAddress(urlSlugToAddress(addr));

  return (
    <TxTimeline
      address={formattedAddress}
      direction={direction}
      limit={limit}
    />
  );
}

export default function TxPage() {
  return (
    <Suspense>
      <TxPageInner />
    </Suspense>
  );
}

