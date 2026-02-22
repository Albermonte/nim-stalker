'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { SearchPanel } from '@/components/sidebar/SearchPanel';
import { FilterPanel } from '@/components/sidebar/FilterPanel';
import { DetailsPanel } from '@/components/sidebar/DetailsPanel';
import { GraphControls } from '@/components/graph/GraphControls';
import { GraphErrorBoundary } from '@/components/graph/GraphErrorBoundary';

const GraphCanvas = dynamic(
  () => import('@/components/graph/GraphCanvas').then((mod) => mod.GraphCanvas),
  { ssr: false, loading: () => <GraphLoading /> }
);

function GraphLoading() {
  return (
    <div className="flex items-center justify-center w-full h-full bg-nq-cream">
      <div className="nq-card text-center">
        <div className="text-nq-pink font-bold uppercase tracking-wider nq-pulse">
          Loading Graph...
        </div>
      </div>
    </div>
  );
}

export function GraphShell() {
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-nq-cream">
      {/* Sidebar */}
      <aside className="sidebar w-80 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b-3 border-nq-black bg-nq-pink text-nq-white">
          <h1 className="text-2xl font-bold tracking-tight">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nq-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-nq-pink"
            >
              <span className="text-nq-yellow">✦</span>
              NIM STALKER
              <span className="text-nq-yellow">✦</span>
            </Link>
          </h1>
          <p className="text-sm uppercase tracking-wider opacity-90">Making Blockchain Gossip Visual ✨</p>
        </div>

        <div className="flex-1 overflow-y-auto bg-nq-cream">
          <SearchPanel />
          <FilterPanel />
          <DetailsPanel />
        </div>
      </aside>

      {/* Main Graph Area */}
      <div className="flex-1 relative border-l-3 border-nq-black">
        <GraphErrorBoundary>
          <Suspense fallback={<GraphLoading />}>
            <GraphCanvas />
          </Suspense>
        </GraphErrorBoundary>
        <GraphControls />
      </div>
    </main>
  );
}
