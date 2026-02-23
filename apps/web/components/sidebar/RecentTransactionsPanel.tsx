'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate, formatNimiq, truncateAddress } from '@/lib/format-utils';
import { buildTxRoute } from '@/lib/url-utils';

type RecentTx = {
  hash: string;
  from: string;
  to: string;
  value: string;
  fee: string;
  blockNumber: number;
  timestamp: string;
  data?: string;
};

const HOME_RECENT_LIMIT = 50;
const POLL_INTERVAL_MS = 10_000;

export function RecentTransactionsPanel() {
  const [txs, setTxs] = useState<RecentTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;

      try {
        if (active) {
          setLoading(true);
          setError(null);
        }

        api.invalidateCache('/transactions/recent');

        const recentResult = await api.getRecentTransactions({ page: 1, pageSize: HOME_RECENT_LIMIT });

        if (!active) return;
        setTxs(recentResult.data as RecentTx[]);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to refresh recent transactions');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, []);

  return (
    <div className="p-4 border-b-3 border-nq-black">
      <div className="nq-card-yellow">
        <h2 className="nq-section-title mb-3 flex items-center gap-2">
          <span>✦</span> Recent Transactions
        </h2>

        {loading && (
          <p className="text-xs uppercase tracking-wide opacity-70">
            Refreshing latest feed...
          </p>
        )}

        {error && (
          <p className="text-xs uppercase tracking-wide text-red-700">
            {error}
          </p>
        )}

        {!loading && !error && txs.length === 0 && (
          <p className="text-xs uppercase tracking-wide opacity-70">
            No recent transactions available.
          </p>
        )}

        {!error && txs.length > 0 && (
          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {txs.map((tx) => (
              <Link
                key={tx.hash}
                href={buildTxRoute(tx.hash)}
                className="block rounded-md border-2 border-nq-black bg-nq-white px-2 py-2 text-xs hover:bg-nq-pink hover:text-nq-white transition-colors"
              >
                <div className="font-bold uppercase tracking-wide break-all">{tx.hash.slice(0, 14)}...</div>
                <div className="mt-1 font-mono">{formatNimiq(tx.value)}</div>
                <div className="mt-1 opacity-80">
                  {truncateAddress(tx.from)} → {truncateAddress(tx.to)}
                </div>
                <div className="mt-1 opacity-70">
                  {formatDate(tx.timestamp)} · block {tx.blockNumber.toLocaleString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
