'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { GraphShell } from '@/components/GraphShell';
import { api } from '@/lib/api';
import { formatNimiqAddress, truncateAddress } from '@/lib/format-utils';
import { isTxHash, safeDecodeURIComponent } from '@/lib/url-utils';
import { useGraphStore } from '@/store/graph-store';
import { AddressType, type CytoscapeEdge, type CytoscapeNode } from '@nim-stalker/shared';

export default function TxHashPage() {
  const { hash } = useParams<{ hash: string }>();
  const router = useRouter();
  const lastHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hash) return;

    const decodedHash = safeDecodeURIComponent(hash);
    if (!decodedHash) {
      toast.error('Invalid transaction hash');
      router.replace('/');
      return;
    }

    if (lastHashRef.current === decodedHash) return;
    lastHashRef.current = decodedHash;

    if (!isTxHash(decodedHash)) {
      toast.error('Invalid transaction hash');
      router.replace('/');
      return;
    }

    void handleTxHash(decodedHash);
  }, [hash, router]);

  return <GraphShell />;
}

async function handleTxHash(hash: string) {
  const { setSkipInitialLoad, setLoading, setError, addGraphData, clearGraph } = useGraphStore.getState();
  setSkipInitialLoad(true);
  setLoading(true);

  try {
    const tx = await api.getTransaction(hash);

    if (!tx) {
      toast.error('Transaction not found. It may not have been indexed yet.');
      setLoading(false);
      return;
    }

    clearGraph();

    const fromFormatted = formatNimiqAddress(tx.from);
    const toFormatted = formatNimiqAddress(tx.to);

    const nodes: CytoscapeNode[] = [
      {
        data: {
          id: fromFormatted,
          label: truncateAddress(fromFormatted),
          type: AddressType.BASIC,
          balance: '0',
        },
      },
      {
        data: {
          id: toFormatted,
          label: truncateAddress(toFormatted),
          type: AddressType.BASIC,
          balance: '0',
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
