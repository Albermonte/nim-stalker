'use client';

import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '@/store/graph-store';
import { GraphShell } from '@/components/GraphShell';
import { api } from '@/lib/api';
import type { CytoscapeNode, CytoscapeEdge } from '@nim-stalker/shared';

type Phase = 'counting' | 'nodes' | 'edges' | 'rendering' | 'done' | 'error';

const NODE_BATCH_SIZE = 200;
const EDGE_BATCH_SIZE = 500;
/** How many elements to push into the store per animation frame during rendering */
const RENDER_CHUNK_SIZE = 200;

function ProgressOverlay({
  phase,
  loaded,
  total,
  error,
  onRetry,
}: {
  phase: Phase;
  loaded: number;
  total: number;
  error: string | null;
  onRetry: () => void;
}) {
  if (phase === 'done') return null;

  const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;

  let phaseLabel: string;
  switch (phase) {
    case 'counting':
      phaseLabel = 'Counting...';
      break;
    case 'nodes':
      phaseLabel = `Loading nodes (${loaded.toLocaleString()}/${total.toLocaleString()})`;
      break;
    case 'edges':
      phaseLabel = `Loading edges (${loaded.toLocaleString()}/${total.toLocaleString()})`;
      break;
    case 'rendering':
      phaseLabel = `Rendering graph (${loaded.toLocaleString()}/${total.toLocaleString()} elements)`;
      break;
    case 'error':
      phaseLabel = 'Error';
      break;
  }

  const showProgressBar = phase === 'nodes' || phase === 'edges' || phase === 'rendering';

  return (
    <div className="fixed inset-0 z-50 bg-nq-cream/90 flex items-center justify-center">
      <div className="nq-card max-w-md w-full mx-4 text-center space-y-4">
        <h2 className="text-2xl font-bold text-nq-pink uppercase tracking-wider">
          The Whole Enchilada
        </h2>

        {phase === 'error' ? (
          <>
            <p className="text-red-600 font-medium">{error}</p>
            <button
              onClick={onRetry}
              className="nq-btn-primary"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <p className="text-nq-black font-medium">{phaseLabel}</p>
            {showProgressBar && (
              <div className="w-full bg-nq-cream border-2 border-nq-black rounded-sm overflow-hidden h-6">
                <div
                  className="h-full bg-nq-pink transition-all duration-300 ease-out"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            )}
            {showProgressBar && (
              <p className="text-sm text-nq-black/60">
                {percentage}%
              </p>
            )}
            {phase === 'counting' && (
              <div className="nq-pulse text-nq-pink font-bold uppercase tracking-wider text-sm">
                Querying Neo4j...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function TheWholeEnchiladaPage() {
  const [phase, setPhase] = useState<Phase>('counting');
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const { setSkipInitialLoad, clearGraph } = useGraphStore.getState();
    setSkipInitialLoad(true);
    clearGraph();
    // Re-set after clearGraph since it resets skipInitialLoad
    useGraphStore.getState().setSkipInitialLoad(true);

    setPhase('counting');
    setLoaded(0);
    setTotal(0);
    setError(null);

    (async () => {
      try {
        // Phase 1: Get counts
        const counts = await api.getEverythingCount();
        if (cancelledRef.current) return;

        const { nodeCount, edgeCount } = counts;

        // Handle empty database
        if (nodeCount === 0 && edgeCount === 0) {
          setPhase('done');
          return;
        }

        // Phase 2: Fetch all nodes in batches
        setPhase('nodes');
        setTotal(nodeCount);
        setLoaded(0);

        const allNodes: CytoscapeNode[] = [];
        for (let skip = 0; skip < nodeCount; skip += NODE_BATCH_SIZE) {
          if (cancelledRef.current) return;
          const { nodes } = await api.getEverythingNodes(skip, NODE_BATCH_SIZE);
          allNodes.push(...nodes);
          setLoaded(Math.min(skip + NODE_BATCH_SIZE, nodeCount));
        }

        if (cancelledRef.current) return;

        // Phase 3: Fetch all edges in batches
        setPhase('edges');
        setTotal(edgeCount);
        setLoaded(0);

        const allEdges: CytoscapeEdge[] = [];
        for (let skip = 0; skip < edgeCount; skip += EDGE_BATCH_SIZE) {
          if (cancelledRef.current) return;
          const { edges } = await api.getEverythingEdges(skip, EDGE_BATCH_SIZE);
          allEdges.push(...edges);
          setLoaded(Math.min(skip + EDGE_BATCH_SIZE, edgeCount));
        }

        if (cancelledRef.current) return;

        // Phase 4: Rendering — add to store in small chunks so the browser
        // stays responsive. Each chunk triggers a React re-render where
        // CytoscapeComponent syncs only the new elements (~RENDER_CHUNK_SIZE).
        // Layout is debounced in GraphCanvas — it only fires once after the
        // last chunk arrives.
        const totalElements = allNodes.length + allEdges.length;
        setPhase('rendering');
        setTotal(totalElements);
        setLoaded(0);

        // Yield so the "Rendering..." overlay paints first
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (cancelledRef.current) return;

        let insertedCount = 0;

        // Add nodes in chunks
        for (let i = 0; i < allNodes.length; i += RENDER_CHUNK_SIZE) {
          if (cancelledRef.current) return;
          const chunk = allNodes.slice(i, i + RENDER_CHUNK_SIZE);
          useGraphStore.getState().addGraphData(chunk, []);
          insertedCount += chunk.length;
          setLoaded(insertedCount);
          // Yield between chunks so React can paint the progress update
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        // Add edges in chunks
        for (let i = 0; i < allEdges.length; i += RENDER_CHUNK_SIZE) {
          if (cancelledRef.current) return;
          const chunk = allEdges.slice(i, i + RENDER_CHUNK_SIZE);
          useGraphStore.getState().addGraphData([], chunk);
          insertedCount += chunk.length;
          setLoaded(insertedCount);
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        if (cancelledRef.current) return;
        setPhase('done');
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load graph data');
        setPhase('error');
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [retryKey]);

  return (
    <>
      <ProgressOverlay
        phase={phase}
        loaded={loaded}
        total={total}
        error={error}
        onRetry={() => setRetryKey((k) => k + 1)}
      />
      <GraphShell />
    </>
  );
}
