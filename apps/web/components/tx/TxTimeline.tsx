'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape, { type Core } from 'cytoscape';
import type { Direction } from '@nim-stalker/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDate, formatNimiq } from '@/lib/format-utils';
import { addressToUrlSlug, buildAddressHashUrl } from '@/lib/url-utils';
import { computeTxTimelinePositions } from '@/lib/tx-timeline-layout';

type TxRow = {
  hash: string;
  from: string;
  to: string;
  value: string;
  fee: string;
  blockNumber: number;
  timestamp: string;
  data?: string;
};

const stylesheet: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      color: '#000000',
      'text-outline-color': '#FFFFFF',
      'text-outline-width': 2,
      'font-size': '10px',
      'font-weight': 'bold',
      'text-valign': 'center',
      'text-halign': 'center',
      shape: 'round-rectangle',
      width: 160,
      height: 46,
      'background-color': '#FAF4F0',
      'border-width': 2,
      'border-color': '#000000',
      'overlay-padding': 6,
      'overlay-opacity': 0,
    } as any,
  },
  {
    selector: 'node.incoming',
    style: {
      'background-color': '#22C55E',
    },
  },
  {
    selector: 'node.outgoing',
    style: {
      'background-color': '#FF69B4',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'overlay-color': '#FFC900',
      'overlay-opacity': 0.25,
      'overlay-shape': 'round-rectangle',
    },
  },
];

function formatTxLabel(tx: TxRow, focusAddress: string): string {
  const incoming = tx.to === focusAddress;
  const sign = incoming ? '+' : '-';
  return `${sign}${formatNimiq(tx.value)}`;
}

export function TxTimeline(props: { address: string; direction: Direction; limit: number }) {
  const { address, direction, limit } = props;
  const router = useRouter();
  const [cyInstance, setCyInstance] = useState<Core | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const runIdRef = useRef(0);

  const runLoad = useCallback(async () => {
    const runId = ++runIdRef.current;
    const safeSet = (fn: () => void) => {
      if (runId !== runIdRef.current) return;
      fn();
    };

    safeSet(() => {
      setError(null);
      setPhase('loading');
      setTxs([]);
    });

    try {
      const collected: TxRow[] = [];
      const pageSize = 100;
      let page = 1;
      while (collected.length < limit) {
        const res = await api.getTransactions(address, { page, pageSize, direction });
        collected.push(...(res.data as TxRow[]));
        if (!res.hasMore || res.data.length === 0) break;
        page += 1;
      }

      safeSet(() => {
        setTxs(collected.slice(0, limit));
        setPhase('ready');
      });
    } catch (err) {
      safeSet(() => {
        setError(err instanceof Error ? err.message : 'Failed to load transactions');
        setPhase('error');
      });
    }
  }, [address, direction, limit]);

  useEffect(() => {
    void runLoad();
    // Cancel previous load when address changes.
    return () => {
      runIdRef.current += 1;
    };
  }, [runLoad]);

  const elements = useMemo(() => {
    const positions = computeTxTimelinePositions(
      txs.map((t) => ({ hash: t.hash, from: t.from, to: t.to })),
      address,
    );

    return txs.map((tx) => {
      const incoming = tx.to === address;
      const pos = positions.get(tx.hash) ?? { x: 0, y: 0 };
      return {
        group: 'nodes' as const,
        data: {
          id: tx.hash,
          label: formatTxLabel(tx, address),
          from: tx.from,
          to: tx.to,
          value: tx.value,
          fee: tx.fee,
          blockNumber: tx.blockNumber,
          timestamp: tx.timestamp,
        },
        position: pos,
        classes: incoming ? 'incoming' : 'outgoing',
      };
    });
  }, [txs, address]);

  useEffect(() => {
    if (!cyInstance) return;

    const handleTap = (evt: any) => {
      const node = evt.target;
      if (!node?.id) return;
      const hash = node.id();
      router.push(`/${encodeURIComponent(hash)}`);
    };

    cyInstance.on('tap', 'node', handleTap);
    return () => {
      cyInstance.off('tap', 'node', handleTap);
    };
  }, [cyInstance, router]);

  useEffect(() => {
    if (!cyInstance) return;
    if (elements.length === 0) return;
    // Fit after render; preset layout doesn't always auto-fit reliably across updates.
    cyInstance.fit(cyInstance.elements(), 120);
  }, [cyInstance, elements]);

  const handleBack = () => {
    window.location.href = buildAddressHashUrl(address);
  };

  const handleCopyLink = async () => {
    try {
      const slug = addressToUrlSlug(address);
      const url = `${window.location.origin}/tx?addr=${encodeURIComponent(slug)}&direction=${encodeURIComponent(direction)}&limit=${encodeURIComponent(String(limit))}`;
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-nq-cream">
      <aside className="sidebar w-80 flex flex-col border-r-3 border-nq-black">
        <div className="p-4 border-b-3 border-nq-black bg-nq-periwinkle text-nq-white">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className="text-nq-yellow">✦</span>
            TX TIMELINE
          </h1>
          <p className="text-sm uppercase tracking-wider opacity-90">Two-lane history for one address</p>
        </div>

        <div className="flex-1 overflow-y-auto bg-nq-cream p-4 space-y-4">
          <div className="nq-card">
            <div className="nq-label">Address</div>
            <div className="text-xs font-mono break-all">{address}</div>
            <div className="mt-3 flex gap-2">
              <button onClick={handleBack} className="nq-btn-white text-xs flex-1">
                Back to Graph
              </button>
              <button onClick={handleCopyLink} className="nq-btn-periwinkle text-xs flex-1">
                Copy Link
              </button>
            </div>
          </div>

          <div className="nq-card-yellow">
            <div className="nq-label">Mode</div>
            <div className="text-xs uppercase tracking-wide opacity-80">
              {direction} · limit {limit}
            </div>
            {phase === 'loading' && (
              <div className="mt-2 text-xs font-bold uppercase tracking-wide text-nq-periwinkle">
                Loading…
              </div>
            )}
            {phase === 'ready' && (
              <div className="mt-2 text-xs font-bold uppercase tracking-wide text-green-700">
                {txs.length.toLocaleString()} tx loaded
              </div>
            )}
          </div>

          {phase === 'error' && (
            <div className="nq-card-pink">
              <div className="font-bold uppercase tracking-wide">Error</div>
              <div className="text-xs mt-2 opacity-90 break-words">{error}</div>
              <div className="mt-3 space-y-2">
                <button onClick={() => void runLoad()} className="nq-btn-white w-full text-xs">
                  Retry
                </button>
              </div>
            </div>
          )}

          {phase === 'ready' && txs.length > 0 && (
            <div className="nq-card">
              <div className="nq-label mb-2">Newest</div>
              <div className="text-xs font-mono break-all">{txs[0].hash}</div>
              <div className="text-[10px] opacity-70 mt-1">
                {formatDate(txs[0].timestamp)} · block {txs[0].blockNumber.toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 relative">
        <CytoscapeComponent
          elements={elements as any}
          cy={(cy) => setCyInstance(cy)}
          layout={{ name: 'preset', fit: true, padding: 120 } as any}
          stylesheet={stylesheet as any}
          style={{ width: '100%', height: '100%' }}
          className="bg-nq-cream"
          userPanningEnabled
          userZoomingEnabled
          minZoom={0.1}
          maxZoom={3}
        />
      </div>
    </main>
  );
}

