'use client';

import { useState, useRef, useEffect } from 'react';
import { useGraphStore, type LayoutMode } from '@/store/graph-store';
import { LAYOUT_CATEGORIES, findLayoutCategory, getLayoutLabel } from '@/lib/layout-configs';
import { buildPathUrl } from '@/lib/url-utils';

const MAX_HOPS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function getPathModeStatusText(from: string | null, to: string | null): string {
  if (!from) return 'Select start node';
  if (!to) return 'Select end node';
  return 'Finding paths...';
}

export function GraphControls() {
  const { clearGraph, loading, pathMode, setPathMode, setPathModeMaxHops, setPathModeDirected, pathView, exitPathView, layoutMode, setLayoutMode, expandAllNodes, nodes } = useGraphStore();
  const [showHelp, setShowHelp] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(() => {
    return findLayoutCategory(layoutMode)?.id ?? null;
  });
  const helpPanelRef = useRef<HTMLDivElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const layoutPanelRef = useRef<HTMLDivElement>(null);

  // Close help panel when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        showHelp &&
        helpPanelRef.current &&
        helpButtonRef.current &&
        !helpPanelRef.current.contains(event.target as Node) &&
        !helpButtonRef.current.contains(event.target as Node)
      ) {
        setShowHelp(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHelp]);

  // Sync URL when entering/exiting path view
  useEffect(() => {
    if (pathView.active && pathView.stats && pathView.pathNodeOrder.length >= 2) {
      const from = pathView.pathNodeOrder[0];
      const to = pathView.pathNodeOrder[pathView.pathNodeOrder.length - 1];
      window.history.replaceState(null, '', buildPathUrl(from, to, pathView.stats.maxHops, pathView.stats.directed));
    }
  }, [pathView.active, pathView.stats, pathView.pathNodeOrder]);

  return (
    <div className="absolute top-4 right-4 flex flex-col gap-2">
      {/* Path View Banner */}
      {pathView.active && (
        <div className="nq-card-yellow">
          <div className="font-bold uppercase tracking-wider mb-1 flex items-center gap-2">
            <span>✦</span> {pathView.stats?.directed ? 'Directed Paths' : 'All Paths'} View
          </div>
          <div className="text-xs uppercase tracking-wide opacity-80 space-y-0.5">
            <div>{pathView.stats?.nodeCount ?? pathView.pathNodeIds.size} nodes, {pathView.stats?.edgeCount ?? pathView.pathEdgeIds.size} edges</div>
            {pathView.stats && (
              <>
                <div>Max hops: {pathView.stats.maxHops}</div>
                <div>Shortest: {pathView.stats.shortestPath} hop{pathView.stats.shortestPath !== 1 ? 's' : ''}</div>
                {pathView.stats.directed && <div className="text-nq-pink font-bold">Outgoing only</div>}
              </>
            )}
          </div>
          <button
            onClick={() => { exitPathView(); window.history.replaceState(null, '', '/'); }}
            className="nq-btn-pink w-full mt-3 text-xs py-1"
          >
            Exit Path View
          </button>
        </div>
      )}

      {!pathView.active && (
        <>
          <button
            onClick={() => expandAllNodes()}
            className="nq-btn-periwinkle text-sm"
            disabled={loading || nodes.size === 0}
            title="Expand all visible nodes"
          >
            Expand All
          </button>

          <button
            onClick={() => clearGraph()}
            className="nq-btn-white text-sm"
            title="Clear graph"
          >
            Clear
          </button>

          {/* Layout Selector Accordion */}
          <div className="nq-card py-2 px-3 text-xs w-48" ref={layoutPanelRef}>
            <div className="nq-label mb-1">Layout: {getLayoutLabel(layoutMode)}</div>
            <div className="space-y-0.5">
              {LAYOUT_CATEGORIES.map((cat) => {
                const isExpanded = expandedCategory === cat.id;
                const hasActive = cat.layouts.some((l) => l.id === layoutMode);
                return (
                  <div key={cat.id}>
                    <button
                      onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                      className={`w-full flex items-center justify-between py-1 px-1 font-bold uppercase tracking-wide text-xs transition-colors rounded-sm ${
                        hasActive ? 'text-nq-pink' : ''
                      } hover:bg-gray-50`}
                    >
                      <span>{cat.label}</span>
                      <span className="text-[10px]">{isExpanded ? '▾' : '▸'}</span>
                    </button>
                    {isExpanded && (
                      <div className="ml-2 space-y-0.5">
                        {cat.layouts.map((layout) => {
                          const isActive = layoutMode === layout.id;
                          return (
                            <button
                              key={layout.id}
                              onClick={() => {
                                setLayoutMode(layout.id);
                              }}
                              className={`w-full text-left py-1 px-2 rounded-sm transition-colors ${
                                isActive
                                  ? 'bg-nq-pink text-white font-bold'
                                  : 'hover:bg-gray-50'
                              }`}
                            >
                              <div className="font-bold uppercase tracking-wide">{layout.label}</div>
                              <div className={`text-[10px] ${isActive ? 'text-white opacity-80' : 'opacity-50'}`}>
                                {layout.description}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => setPathMode(!pathMode.active)}
            className={pathMode.active ? 'nq-btn-pink text-sm' : 'nq-btn-periwinkle text-sm'}
            title={pathMode.active ? 'Cancel path finding' : 'Find path between nodes'}
          >
            {pathMode.active ? 'Cancel Path' : 'Find Path'}
          </button>

          {pathMode.active && (
            <div className="nq-card-yellow text-xs space-y-2">
              <div className="flex items-center gap-2">
                <span className="nq-label">Max Hops:</span>
                <select
                  value={pathMode.maxHops}
                  onChange={(e) => setPathModeMaxHops(Number(e.target.value))}
                  className="nq-select text-xs py-1 px-2 flex-1"
                >
                  {MAX_HOPS_OPTIONS.map((hop) => (
                    <option key={hop} value={hop}>
                      {hop}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pathMode.directed}
                  onChange={(e) => setPathModeDirected(e.target.checked)}
                  className="w-4 h-4 accent-nq-pink cursor-pointer"
                />
                <span className="nq-label">Directed only</span>
              </label>
              <span className="font-bold uppercase block">
                {getPathModeStatusText(pathMode.from, pathMode.to)}
              </span>
            </div>
          )}
        </>
      )}

      {loading && (
        <div className="nq-card-pink text-xs nq-pulse">
          <span className="font-bold uppercase">Loading...</span>
        </div>
      )}

      {/* Help Button */}
      <button
        ref={helpButtonRef}
        onClick={() => setShowHelp(!showHelp)}
        className={showHelp ? 'nq-btn-pink text-sm px-4' : 'nq-btn-white text-sm px-4'}
        title="Show help"
      >
        ?
      </button>

      {/* Help Panel */}
      {showHelp && (
        <div
          ref={helpPanelRef}
          className="absolute top-0 right-full mr-2 w-72 nq-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold uppercase tracking-wider flex items-center gap-2">
              <span className="text-nq-pink">✦</span> Graph Help
            </h3>
            <button
              onClick={() => setShowHelp(false)}
              className="nq-btn-outline px-2 py-0 text-sm"
            >
              X
            </button>
          </div>

          {/* Edge Colors Legend */}
          <div className="mb-4">
            <h4 className="nq-label mb-2">Edge Colors</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-1 bg-nq-pink rounded-full"></div>
                <span className="text-xs uppercase">Outgoing (leaving)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-1 bg-green-500 rounded-full"></div>
                <span className="text-xs uppercase">Incoming (arriving)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-1 bg-gray-400 opacity-30 rounded-full"></div>
                <span className="text-xs uppercase">Unconnected</span>
              </div>
            </div>
          </div>

          {/* Interactions */}
          <div className="mb-4">
            <h4 className="nq-label mb-2">Interactions</h4>
            <div className="space-y-1 text-xs">
              <div><span className="font-bold text-nq-pink">CLICK</span> - Select</div>
              <div><span className="font-bold text-nq-pink">DOUBLE-CLICK</span> - Expand</div>
              <div><span className="font-bold text-nq-pink">RIGHT-CLICK</span> - Menu</div>
              <div><span className="font-bold text-nq-pink">DRAG</span> - Move node</div>
              <div><span className="font-bold text-nq-pink">SCROLL</span> - Zoom</div>
            </div>
          </div>

          {/* Path Finding */}
          <div>
            <h4 className="nq-label mb-2">Path Finding</h4>
            <ol className="space-y-1 text-xs list-decimal list-inside">
              <li>Click "Find Path"</li>
              <li>Select start node</li>
              <li>Select end node</li>
              <li>View path or exit</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
