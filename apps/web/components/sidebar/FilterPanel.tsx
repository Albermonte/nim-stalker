'use client';

import { useState, useEffect, memo } from 'react';
import { useGraphStore } from '@/store/graph-store';

function FilterPanelInner() {
  const { filters, setFilters } = useGraphStore();

  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [limit, setLimit] = useState('50');

  // Sync local state with store filters when they change externally
  useEffect(() => {
    if (filters.minValue) setMinValue(filters.minValue.toString());
    if (filters.maxValue) setMaxValue(filters.maxValue.toString());
    if (filters.minTimestamp) {
      setStartDate(new Date(filters.minTimestamp).toISOString().split('T')[0]);
    }
    if (filters.maxTimestamp) {
      setEndDate(new Date(filters.maxTimestamp).toISOString().split('T')[0]);
    }
    if (filters.limit) setLimit(filters.limit.toString());
  }, [filters]);

  const applyFilters = () => {
    setFilters({
      minValue: minValue ? BigInt(Math.floor(parseFloat(minValue) * 1e5)) : undefined,
      maxValue: maxValue ? BigInt(Math.floor(parseFloat(maxValue) * 1e5)) : undefined,
      minTimestamp: startDate ? new Date(startDate).getTime() : undefined,
      maxTimestamp: endDate ? new Date(endDate + 'T23:59:59').getTime() : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  };

  const clearFilters = () => {
    setMinValue('');
    setMaxValue('');
    setStartDate('');
    setEndDate('');
    setLimit('50');
    setFilters({});
  };

  return (
    <div className="p-4 border-b-3 border-nq-black">
      <div className="nq-card-periwinkle">
        <h2 className="nq-section-title mb-4 flex items-center gap-2">
          <span>✦</span> Filters
        </h2>

        <div className="space-y-4">
          {/* Value Range */}
          <div>
            <label className="nq-label">Value Range (NIM)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                placeholder="Min"
                min="0"
                step="0.00001"
                className="nq-input w-1/2 text-xs py-1"
              />
              <input
                type="number"
                value={maxValue}
                onChange={(e) => setMaxValue(e.target.value)}
                placeholder="Max"
                min="0"
                step="0.00001"
                className="nq-input w-1/2 text-xs py-1"
              />
            </div>
          </div>

          {/* Date Range */}
          <div>
            <label className="nq-label">Date Range</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="nq-input w-1/2 text-xs py-1"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="nq-input w-1/2 text-xs py-1"
              />
            </div>
          </div>

          {/* Result Limit */}
          <div>
            <label className="nq-label">Max Transactions</label>
            <select
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="nq-select text-xs py-1"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={applyFilters}
              className="nq-btn-white flex-1 text-xs py-1"
            >
              Apply
            </button>
            <button
              onClick={clearFilters}
              className="nq-btn-outline flex-1 text-xs py-1 bg-nq-white/20"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const FilterPanel = memo(FilterPanelInner);
