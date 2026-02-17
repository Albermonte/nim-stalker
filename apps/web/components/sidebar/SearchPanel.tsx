'use client';

import { useState, useCallback, memo } from 'react';
import { ValidationUtils } from '@nimiq/utils';
import { useGraphStore } from '@/store/graph-store';
import { buildAddressHashUrl } from '@/lib/url-utils';

type ExportFormat = 'json' | 'csv';

/**
 * Validate and clean a Nimiq address input
 * Returns cleaned address or null with error set
 */
function validateAndCleanAddress(
  input: string,
  setError: (error: string | null) => void
): string | null {
  const cleaned = input.replace(/\s/g, '').toUpperCase();

  if (!cleaned) {
    setError('Please enter an address');
    return null;
  }

  if (!ValidationUtils.isValidAddress(cleaned)) {
    setError('Invalid Nimiq address format');
    return null;
  }

  return cleaned;
}

/**
 * Create an Enter key handler that calls the action when not loading
 */
function createKeyDownHandler(
  action: () => void,
  loading: boolean
): (e: React.KeyboardEvent) => void {
  return (e) => {
    if (e.key === 'Enter' && !loading) {
      action();
    }
  };
}

function SearchPanelInner() {
  const [searchAddressInput, setSearchAddressInput] = useState('');
  const [addAddressInput, setAddAddressInput] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const { searchAddress, addAddress, loading, getCytoscapeElements } = useGraphStore();

  const handleExport = useCallback((format: ExportFormat) => {
    const { nodes, edges } = getCytoscapeElements();

    if (nodes.length === 0) {
      setSearchError('No data to export');
      return;
    }

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'json') {
      content = JSON.stringify({ nodes, edges }, null, 2);
      filename = `nim-stalker-${Date.now()}.json`;
      mimeType = 'application/json';
    } else {
      // CSV format - flatten transactions
      const rows = [
        ['Source', 'Target', 'TxCount', 'TotalValue', 'FirstTxAt', 'LastTxAt'].join(','),
        ...edges.map((e) =>
          [
            e.data.source,
            e.data.target,
            e.data.txCount,
            e.data.totalValue,
            e.data.firstTxAt,
            e.data.lastTxAt,
          ].join(',')
        ),
      ];
      content = rows.join('\n');
      filename = `nim-stalker-${Date.now()}.csv`;
      mimeType = 'text/csv';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [getCytoscapeElements]);

  const handleSearch = async () => {
    setSearchError(null);
    const cleanAddress = validateAndCleanAddress(searchAddressInput, setSearchError);
    if (!cleanAddress) return;

    try {
      await searchAddress(cleanAddress);
      setSearchAddressInput('');
      window.history.pushState(null, '', buildAddressHashUrl(cleanAddress));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    }
  };

  const handleAddNode = async () => {
    setAddError(null);
    const cleanAddress = validateAndCleanAddress(addAddressInput, setAddError);
    if (!cleanAddress) return;

    try {
      await addAddress(cleanAddress);
      setAddAddressInput('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add node');
    }
  };

  const handleSearchKeyDown = createKeyDownHandler(handleSearch, loading);
  const handleAddKeyDown = createKeyDownHandler(handleAddNode, loading);

  return (
    <div className="p-4 border-b-3 border-nq-black">
      {/* Search & Expand Section */}
      <div className="nq-card-pink mb-4">
        <h2 className="nq-section-title mb-3 flex items-center gap-2">
          <span>✦</span> Search & Expand
        </h2>

        <div className="space-y-3">
          <input
            type="text"
            value={searchAddressInput}
            onChange={(e) => setSearchAddressInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="NQ42 XXXX XXXX ..."
            className="nq-input text-sm font-mono"
            disabled={loading}
          />

          <button
            onClick={handleSearch}
            disabled={loading}
            className="nq-btn-white w-full text-sm"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>

          {searchError && (
            <p className="text-nq-yellow text-xs font-bold uppercase bg-nq-black/20 rounded-lg px-2 py-1">{searchError}</p>
          )}
        </div>

        <p className="mt-3 text-xs uppercase tracking-wide opacity-80">
          Indexes address and expands its connections.
        </p>
      </div>

      {/* Add Node Section */}
      <div className="nq-card-yellow mb-4">
        <h2 className="nq-section-title mb-3 flex items-center gap-2">
          <span>✦</span> Add Node
        </h2>

        <div className="space-y-3">
          <input
            type="text"
            value={addAddressInput}
            onChange={(e) => setAddAddressInput(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="NQ42 XXXX XXXX ..."
            className="nq-input text-sm font-mono"
            disabled={loading}
          />

          <button
            onClick={handleAddNode}
            disabled={loading}
            className="nq-btn-periwinkle w-full text-sm"
          >
            {loading ? 'Adding...' : 'Add'}
          </button>

          {addError && (
            <p className="text-red-700 text-xs font-bold uppercase bg-nq-white/50 rounded-lg px-2 py-1">{addError}</p>
          )}
        </div>

        <p className="mt-3 text-xs uppercase tracking-wide opacity-80">
          Adds a node without expanding. Use with Find Path.
        </p>
      </div>

      {/* Export Section */}
      <div className="nq-card">
        <label className="nq-label flex items-center gap-2">
          <span className="text-nq-pink">✦</span> Export Graph
        </label>
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => handleExport('json')}
            className="nq-btn-outline flex-1 text-xs py-1"
          >
            JSON
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="nq-btn-outline flex-1 text-xs py-1"
          >
            CSV
          </button>
        </div>
      </div>
    </div>
  );
}

export const SearchPanel = memo(SearchPanelInner);
