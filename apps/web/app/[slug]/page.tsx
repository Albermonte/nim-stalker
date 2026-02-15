'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useGraphStore } from '@/store/graph-store';
import { api } from '@/lib/api';
import { formatNimiqAddress, truncateAddress } from '@/lib/format-utils';
import { isAddressSlug, isTxHashSlug, urlSlugToAddress } from '@/lib/url-utils';
import { GraphShell } from '@/components/GraphShell';
import { AddressType, IndexStatus, type CytoscapeNode, type CytoscapeEdge } from '@nim-stalker/shared';

export default function SlugPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || !slug) return;
    initializedRef.current = true;

    const decodedSlug = decodeURIComponent(slug);

    if (isAddressSlug(decodedSlug)) {
      const address = urlSlugToAddress(decodedSlug);
      const { setSkipInitialLoad, searchAddress } = useGraphStore.getState();
      setSkipInitialLoad(true);
      searchAddress(address);
    } else if (isTxHashSlug(decodedSlug)) {
      handleTxHash(decodedSlug);
    } else {
      toast.error('Invalid address or transaction hash');
      router.replace('/');
    }
  }, [slug, router]);

  return <GraphShell />;
}

async function handleTxHash(hash: string) {
  const { setSkipInitialLoad, setLoading, setError, addGraphData } = useGraphStore.getState();
  setSkipInitialLoad(true);
  setLoading(true);

  try {
    const tx = await api.getTransaction(hash);

    if (!tx) {
      toast.error('Transaction not found. It may not have been indexed yet.');
      setLoading(false);
      return;
    }

    const fromFormatted = formatNimiqAddress(tx.from);
    const toFormatted = formatNimiqAddress(tx.to);

    const nodes: CytoscapeNode[] = [
      {
        data: {
          id: fromFormatted,
          label: truncateAddress(fromFormatted),
          type: AddressType.BASIC,
          balance: '0',
          indexStatus: IndexStatus.PENDING,
        },
      },
      {
        data: {
          id: toFormatted,
          label: truncateAddress(toFormatted),
          type: AddressType.BASIC,
          balance: '0',
          indexStatus: IndexStatus.PENDING,
        },
      },
    ];

    const edges: CytoscapeEdge[] = [
      {
        data: {
          id: `${fromFormatted}->${toFormatted}`,
          source: fromFormatted,
          target: toFormatted,
          txCount: 1,
          totalValue: tx.value,
          firstTxAt: tx.timestamp,
          lastTxAt: tx.timestamp,
        },
      },
    ];

    addGraphData(nodes, edges);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to load transaction');
  } finally {
    setLoading(false);
  }
}
