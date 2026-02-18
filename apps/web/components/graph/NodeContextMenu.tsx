'use client';

import { useState, useEffect, useCallback, useRef, RefObject } from 'react';
import type { Core } from 'cytoscape';
import { useGraphStore } from '@/store/graph-store';
import { addressToUrlSlug, buildAddressHashUrl } from '@/lib/url-utils';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string | null;
}

interface NodeContextMenuProps {
  cyRef: RefObject<Core | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function NodeContextMenu({ cyRef, containerRef }: NodeContextMenuProps) {
  const [menu, setMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null,
  });
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { expandNode, removeNode, setPathMode, selectNode, searchAddress } = useGraphStore();

  const hideMenu = useCallback(() => {
    setMenu((prev) => ({ ...prev, visible: false }));
    setAdjustedPos(null);
  }, []);

  useEffect(() => {
    if (!menu.visible || !menuRef.current || !containerRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    const padding = 8;

    let x = menu.x;
    let y = menu.y;

    if (menuRect.bottom > containerRect.bottom - padding) {
      y = containerRect.height - menuRect.height - padding;
    }
    if (menuRect.right > containerRect.right - padding) {
      x = containerRect.width - menuRect.width - padding;
    }

    if (x !== menu.x || y !== menu.y) {
      setAdjustedPos({ x, y });
    }
  }, [menu.visible, menu.x, menu.y, containerRef]);

  useEffect(() => {
    const cy = cyRef.current;
    const container = containerRef.current;
    if (!cy || !container) return;

    const handleContextMenu = (evt: any) => {
      evt.preventDefault();
      const target = evt.target;

      if (target !== cy && target.isNode()) {
        const nodeId = target.id();
        const renderedPosition = target.renderedPosition();

        setMenu({
          visible: true,
          x: renderedPosition.x,
          y: renderedPosition.y,
          nodeId,
        });

        selectNode(nodeId);
      } else {
        hideMenu();
      }
    };

    cy.on('cxttap', handleContextMenu);

    // Hide menu on click elsewhere
    const handleClick = () => hideMenu();
    document.addEventListener('click', handleClick);

    return () => {
      cy.off('cxttap', handleContextMenu);
      document.removeEventListener('click', handleClick);
    };
  }, [cyRef, containerRef, hideMenu, selectNode]);

  if (!menu.visible || !menu.nodeId) return null;

  const handleExpand = (direction: 'incoming' | 'outgoing' | 'both') => {
    if (menu.nodeId) {
      expandNode(menu.nodeId, direction);
    }
    hideMenu();
  };

  const handleRemove = () => {
    if (menu.nodeId) {
      removeNode(menu.nodeId);
    }
    hideMenu();
  };

  const handleFindPath = () => {
    if (menu.nodeId) {
      setPathMode(true, menu.nodeId);
    }
    hideMenu();
  };

  const handleOpen = () => {
    if (menu.nodeId) {
      searchAddress(menu.nodeId);
      window.history.pushState(null, '', buildAddressHashUrl(menu.nodeId));
    }
    hideMenu();
  };

  const handleTxTimeline = () => {
    if (menu.nodeId) {
      const slug = addressToUrlSlug(menu.nodeId);
      window.location.href = `/tx?addr=${encodeURIComponent(slug)}&direction=both&limit=200`;
    }
    hideMenu();
  };

  return (
    <div
      ref={menuRef}
      className="absolute nq-card py-1 min-w-[180px] z-50"
      style={{ left: adjustedPos?.x ?? menu.x, top: adjustedPos?.y ?? menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => handleExpand('both')}
        className="w-full px-4 py-2 text-left text-sm font-bold uppercase tracking-wide hover:bg-nq-pink hover:text-nq-white transition-colors rounded-sm"
      >
        Expand All
      </button>
      <button
        onClick={() => handleExpand('incoming')}
        className="w-full px-4 py-2 text-left text-sm font-bold uppercase tracking-wide hover:bg-nq-pink hover:text-nq-white transition-colors rounded-sm"
      >
        Expand Incoming
      </button>
      <button
        onClick={() => handleExpand('outgoing')}
        className="w-full px-4 py-2 text-left text-sm font-bold uppercase tracking-wide hover:bg-nq-pink hover:text-nq-white transition-colors rounded-sm"
      >
        Expand Outgoing
      </button>
      <div className="border-t border-nq-black my-1" />
      <button
        onClick={handleFindPath}
        className="w-full px-4 py-2 text-left text-sm font-bold uppercase tracking-wide hover:bg-nq-pink hover:text-nq-white transition-colors rounded-sm"
      >
        Find Path From Here
      </button>
      <div className="border-t border-nq-black my-1" />
      <button
        onClick={handleOpen}
        className="w-full px-4 py-2 text-left text-sm font-bold uppercase tracking-wide hover:bg-nq-pink hover:text-nq-white transition-colors rounded-sm"
      >
        Open Node
      </button>
      <button
        onClick={handleTxTimeline}
        className="w-full px-4 py-2 text-left text-sm font-bold uppercase tracking-wide hover:bg-nq-pink hover:text-nq-white transition-colors rounded-sm"
      >
        Tx Timeline
      </button>
      <div className="border-t border-nq-black my-1" />
      <button
        onClick={handleRemove}
        className="w-full px-4 py-2 text-left text-sm font-bold uppercase tracking-wide text-red-500 hover:bg-red-500 hover:text-nq-white transition-colors rounded-sm"
      >
        Remove Node
      </button>
    </div>
  );
}
