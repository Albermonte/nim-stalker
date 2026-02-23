'use client';

import { memo } from 'react';
import { useGraphStore } from '@/store/graph-store';
import { formatNimiqAddress, formatNimiq, getNimiqWatchUrl, formatDate } from '@/lib/format-utils';

const TYPE_BADGE_STYLES: Record<string, string> = {
  BASIC: 'nq-tag',
  HTLC: 'nq-tag-pink',
  VESTING: 'nq-tag-yellow',
  STAKING: 'nq-tag-periwinkle',
};

function DetailsPanelInner() {
  const { selectedNodeId, selectedEdgeId, nodes, edges, expandNode, loading } = useGraphStore();

  const selectedNode = selectedNodeId ? nodes.get(selectedNodeId) : null;
  const selectedEdge = selectedEdgeId ? edges.get(selectedEdgeId) : null;

  if (!selectedNode && !selectedEdge) {
    return (
      <div className="p-4 flex-1">
        <div className="nq-card h-full">
          <h2 className="nq-section-title mb-3 flex items-center gap-2">
            <span className="text-nq-pink">✦</span> Details
          </h2>
          <p className="text-xs uppercase tracking-wide opacity-60">
            Select a node or edge to view details.
          </p>
        </div>
      </div>
    );
  }

  if (selectedNode) {
    const { data } = selectedNode;
    return (
      <div className="p-4 flex-1 overflow-auto">
        <div className="nq-card">
          <h2 className="nq-section-title mb-4 flex items-center gap-2">
            <span className="text-nq-pink">✦</span> Node Details
          </h2>

          <div className="space-y-4">
            <div>
              <label className="nq-label">Address</label>
              <a
                href={getNimiqWatchUrl(formatNimiqAddress(data.id))}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono break-all cursor-pointer no-underline block p-2 rounded bg-nq-cream border-2 border-nq-black hover:bg-nq-pink hover:text-nq-white transition-colors"
              >
                {formatNimiqAddress(data.id)}
              </a>
            </div>

            {data.label && (
              <div>
                <label className="nq-label">Label</label>
                <p className="text-sm font-bold">{data.label}</p>
              </div>
            )}

            <div>
              <label className="nq-label">Type</label>
              <span className={TYPE_BADGE_STYLES[data.type] ?? 'nq-tag'}>
                {data.type}
              </span>
            </div>

            <div>
              <label className="nq-label">Balance</label>
              <p className="text-sm font-bold font-mono">{formatNimiq(data.balance)}</p>
            </div>

            <div className="nq-divider"></div>

            <div className="space-y-2">
              <button
                onClick={() => expandNode(data.id, 'both')}
                disabled={loading}
                className="nq-btn-pink w-full text-xs py-2"
              >
                Expand All
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => expandNode(data.id, 'incoming')}
                  disabled={loading}
                  className="nq-btn-outline flex-1 text-xs py-1"
                >
                  Incoming
                </button>
                <button
                  onClick={() => expandNode(data.id, 'outgoing')}
                  disabled={loading}
                  className="nq-btn-outline flex-1 text-xs py-1"
                >
                  Outgoing
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedEdge) {
    const { data } = selectedEdge;
    return (
      <div className="p-4 flex-1 overflow-auto">
        <div className="nq-card">
          <h2 className="nq-section-title mb-4 flex items-center gap-2">
            <span className="text-nq-pink">✦</span> Edge Details
          </h2>

          <div className="space-y-4">
            <div>
              <label className="nq-label">From</label>
              <a
                href={getNimiqWatchUrl(formatNimiqAddress(data.source))}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono break-all cursor-pointer no-underline block p-2 rounded bg-nq-cream border-2 border-nq-black hover:bg-nq-pink hover:text-nq-white transition-colors"
              >
                {formatNimiqAddress(data.source)}
              </a>
            </div>

            <div>
              <label className="nq-label">To</label>
              <a
                href={getNimiqWatchUrl(formatNimiqAddress(data.target))}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono break-all cursor-pointer no-underline block p-2 rounded bg-nq-cream border-2 border-nq-black hover:bg-nq-pink hover:text-nq-white transition-colors"
              >
                {formatNimiqAddress(data.target)}
              </a>
            </div>

            <div className="nq-divider"></div>

            <div>
              <label className="nq-label">Transaction Count</label>
              <p className="text-lg font-bold font-mono">{data.txCount.toLocaleString()}</p>
            </div>

            <div>
              <label className="nq-label">Total Value</label>
              <p className="text-sm font-bold font-mono">{formatNimiq(data.totalValue)}</p>
            </div>

            <div className="nq-divider"></div>

            <div>
              <label className="nq-label">First Transaction</label>
              <p className="text-sm font-mono">{formatDate(data.firstTxAt)}</p>
            </div>

            <div>
              <label className="nq-label">Last Transaction</label>
              <p className="text-sm font-mono">{formatDate(data.lastTxAt)}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export const DetailsPanel = memo(DetailsPanelInner);
