'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGraphStore, MAX_COMBINED_PATHS } from '@/store/graph-store';
import { LAYOUT_CATEGORIES, findLayoutCategory, getLayoutLabel } from '@/lib/layout-configs';
import { buildMultiPathUrl, buildPathUrl } from '@/lib/url-utils';
import { resolveAddressInput } from '@/lib/address-label-index';
import { formatNimiqAddress } from '@/lib/format-utils';
import { AddressAutocompleteInput } from '@/components/ui/AddressAutocompleteInput';

const MAX_HOPS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function getPathModeStatusText(from: string | null, to: string | null): string {
  if (!from) return 'Select start node';
  if (!to) return 'Select end node';
  return 'Finding paths...';
}

export function GraphControls() {
  const router = useRouter();
  const {
    clearGraph,
    loading,
    pathMode,
    setPathMode,
    setPathModeFrom,
    setPathModeTo,
    setPathModeMaxHops,
    setPathModeDirected,
    pathView,
    exitPathView,
    layoutMode,
    setLayoutMode,
    expandAllNodes,
    nodes,
  } = useGraphStore();
  const [showHelp, setShowHelp] = useState(false);
  const [showEnchiladaConfirm, setShowEnchiladaConfirm] = useState(false);
  const [pathFromInput, setPathFromInput] = useState('');
  const [pathToInput, setPathToInput] = useState('');
  const [pathFromError, setPathFromError] = useState<string | null>(null);
  const [pathToError, setPathToError] = useState<string | null>(null);
  const [pathModeError, setPathModeError] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(() => {
    return findLayoutCategory(layoutMode)?.id ?? null;
  });
  const helpPanelRef = useRef<HTMLDivElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const layoutPanelRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup long-press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

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
    if (!pathView.active) return;

    if (pathView.paths.length > 0) {
      router.replace(buildMultiPathUrl(pathView.paths));
      return;
    }

    // Backward-compatible fallback for legacy state shape
    if (pathView.stats && pathView.from && pathView.to) {
      router.replace(buildPathUrl(pathView.from, pathView.to, pathView.stats.maxHops, pathView.stats.directed));
    }
  }, [pathView.active, pathView.paths, pathView.stats, pathView.from, pathView.to, router]);

  useEffect(() => {
    if (!pathMode.active) return;
    setPathFromInput(pathMode.from ?? '');
    setPathToInput(pathMode.to ?? '');
  }, [pathMode.active, pathMode.from, pathMode.to]);

  const resolveAndSetPathEndpoint = (
    value: string,
    endpoint: 'from' | 'to',
    options?: { silentErrors?: boolean },
  ) => {
    const trimmed = value.trim();
    if (!trimmed) {
      if (endpoint === 'from') {
        setPathFromError(null);
        setPathModeFrom(null);
      } else {
        setPathToError(null);
        setPathModeTo(null);
      }
      return;
    }

    const { address, error } = resolveAddressInput(trimmed);
    if (!address) {
      if (!options?.silentErrors) {
        if (endpoint === 'from') {
          setPathFromError(error);
        } else {
          setPathToError(error);
        }
      }
      return;
    }

    const formattedAddress = formatNimiqAddress(address);
    if (endpoint === 'from') {
      if (pathMode.to && pathMode.to === formattedAddress) {
        setPathFromError('Start and end nodes must be different');
        setPathModeFrom(null);
        return;
      }
      setPathFromError(null);
      setPathModeFrom(formattedAddress);
      return;
    }

    if (pathMode.from && pathMode.from === formattedAddress) {
      setPathToError('Start and end nodes must be different');
      setPathModeTo(null);
      return;
    }
    setPathToError(null);
    setPathModeTo(formattedAddress);
  };

  const startPathMode = (from?: string | null) => {
    if (pathView.active && pathView.paths.length >= MAX_COMBINED_PATHS) {
      setPathModeError(`You can combine up to ${MAX_COMBINED_PATHS} paths`);
      return;
    }

    setPathModeError(null);
    setPathFromError(null);
    setPathToError(null);
    setPathMode(true, from ?? undefined);
    setPathFromInput(from ?? '');
    setPathToInput('');
    setPathModeTo(null);
  };

  const layoutSelector = (
    <div className="nq-card py-2 px-3 text-xs w-full" ref={layoutPanelRef}>
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
  );

  return (
    <div className="absolute top-4 right-4 flex flex-col gap-2 max-w-48">
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
            <div>Paths: {pathView.paths.length}</div>
          </div>
          <button
            onClick={() => {
              if (pathMode.active) {
                setPathMode(false);
                setPathModeError(null);
                setPathFromError(null);
                setPathToError(null);
                return;
              }

              const latestPathStart = pathView.paths[pathView.paths.length - 1]?.from ?? pathView.from;
              startPathMode(latestPathStart ?? null);
            }}
            className={pathMode.active ? 'nq-btn-pink w-full mt-3 text-xs py-1' : 'nq-btn-periwinkle w-full mt-3 text-xs py-1'}
            disabled={!pathMode.active && pathView.paths.length >= MAX_COMBINED_PATHS}
          >
            {pathMode.active ? 'Cancel Path' : 'Add Path'}
          </button>
          <button
            onClick={() => { exitPathView(); router.replace('/'); }}
            className="nq-btn-pink w-full mt-3 text-xs py-1"
          >
            Exit Path View
          </button>
        </div>
      )}

      {/* Layout Selector Accordion */}
      {pathView.active && layoutSelector}

      {!pathView.active && (
        <>
          <button
            onClick={() => expandAllNodes()}
            onMouseDown={() => {
              longPressTimerRef.current = setTimeout(() => setShowEnchiladaConfirm(true), 5000);
            }}
            onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
            onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
            onTouchStart={() => {
              longPressTimerRef.current = setTimeout(() => setShowEnchiladaConfirm(true), 5000);
            }}
            onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
            onTouchCancel={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
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

          {layoutSelector}

          <button
            onClick={() => {
              if (pathMode.active) {
                setPathMode(false);
                setPathModeError(null);
                setPathFromError(null);
                setPathToError(null);
                return;
              }
              startPathMode(pathMode.from);
            }}
            className={pathMode.active ? 'nq-btn-pink text-sm' : 'nq-btn-periwinkle text-sm'}
            title={pathMode.active ? 'Cancel path finding' : 'Find path between nodes'}
          >
            {pathMode.active ? 'Cancel Path' : 'Find Path'}
          </button>
        </>
      )}

      {pathModeError && (
        <div className="nq-card-pink text-xs">
          <span className="font-bold uppercase">{pathModeError}</span>
        </div>
      )}

      {pathMode.active && (
        <div className="nq-card-yellow text-xs space-y-2">
          <AddressAutocompleteInput
            value={pathFromInput}
            onChange={(value) => {
              setPathFromInput(value);
              resolveAndSetPathEndpoint(value, 'from', { silentErrors: false });
            }}
            onEnter={() => resolveAndSetPathEndpoint(pathFromInput, 'from', { silentErrors: false })}
            placeholder="Start: NQ42... or label"
            ariaLabel="Path start node"
            disabled={loading}
          />

          {pathFromError && (
            <p className="text-red-700 text-xs font-bold uppercase bg-nq-white/50 rounded-lg px-2 py-1">{pathFromError}</p>
          )}

          <AddressAutocompleteInput
            value={pathToInput}
            onChange={(value) => {
              setPathToInput(value);
              resolveAndSetPathEndpoint(value, 'to', { silentErrors: false });
            }}
            onEnter={() => resolveAndSetPathEndpoint(pathToInput, 'to', { silentErrors: false })}
            placeholder="End: NQ42... or label"
            ariaLabel="Path end node"
            disabled={loading}
          />

          {pathToError && (
            <p className="text-red-700 text-xs font-bold uppercase bg-nq-white/50 rounded-lg px-2 py-1">{pathToError}</p>
          )}

          {pathView.active && pathView.paths.length >= MAX_COMBINED_PATHS && (
            <p className="text-red-700 text-xs font-bold uppercase bg-nq-white/50 rounded-lg px-2 py-1">
              Path limit reached ({MAX_COMBINED_PATHS})
            </p>
          )}

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

      {/* GitHub Link */}
      <a
        href="https://github.com/Albermonte/nim-stalker"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open repository on GitHub"
        className="nq-btn-white text-sm px-4 inline-flex items-center justify-center"
        title="View source on GitHub"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.92.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.04-.72.08-.71.08-.71 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.67 1.24 3.32.95.1-.74.4-1.24.73-1.52-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.09 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.08.78 2.18 0 1.57-.01 2.84-.01 3.23 0 .3.21.66.79.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
        </svg>
      </a>

      {/* Enchilada Confirmation Dialog */}
      {showEnchiladaConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="nq-card max-w-sm mx-4">
            <h3 className="text-nq-pink uppercase tracking-wider font-bold text-lg mb-3">
              The Whole Enchilada
            </h3>
            <p className="text-sm mb-6">
              Load the entire graph from Neo4j? This may take a while for large databases.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowEnchiladaConfirm(false);
                  router.push('/the-whole-enchilada');
                }}
                className="nq-btn-pink flex-1 text-sm"
              >
                Let&apos;s Go
              </button>
              <button
                onClick={() => setShowEnchiladaConfirm(false)}
                className="nq-btn-white flex-1 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
              <li>Click &quot;Find Path&quot;</li>
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
