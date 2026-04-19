/**
 * ContextPanel.tsx
 *
 * Top-level orchestrator for the Context tab.
 * Wires AppContext state + useTopicGraph + toolbar + viewport + drawer.
 * All graph types imported through the adapter surface.
 */

import { useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useTopicGraph } from '../../hooks/useTopicGraph';
import type { PerspectiveLens } from '../../services/history-graph-adapter';
import { DiscoverBar } from './DiscoverBar';
import { ModeToolbar } from './ModeToolbar';
import { GraphTreeViewport } from './GraphTreeViewport';
import { PerspectiveCompareView } from './PerspectiveCompareView';
import { DetailDrawer } from './DetailDrawer';

export function ContextPanel() {
  const { state, dispatch } = useApp();
  const {
    historyQuery,
    historyMode,
    historyActivePerspectives,
    historySelectedNodeId,
  } = state;

  const { bundle, loading, error, progress } = useTopicGraph(historyQuery);

  // ── Derive available perspectives from bundle ──────────────────────────────
  const availablePerspectives = useMemo<PerspectiveLens[]>(() => {
    if (!bundle) return [];

    const seen = new Map<string, PerspectiveLens>();

    // Collect from claims
    for (const claim of bundle.claims) {
      if (claim.perspectiveLens) {
        const { key } = claim.perspectiveLens;
        if (!seen.has(key)) {
          seen.set(key, claim.perspectiveLens);
        }
      }
    }

    // Collect from perspectiveViews
    for (const view of bundle.perspectiveViews) {
      for (const lens of view.lenses) {
        if (!seen.has(lens.key)) {
          seen.set(lens.key, lens);
        }
      }
    }

    const all = [...seen.values()];

    // Sort: media-ideology first, then actor-country
    all.sort((a, b) => {
      if (a.axis === b.axis) return 0;
      return a.axis === 'media-ideology' ? -1 : 1;
    });

    return all;
  }, [bundle]);

  // ── Derive selected node ───────────────────────────────────────────────────
  const selectedNode = useMemo(() => {
    if (!bundle || !historySelectedNodeId) return null;
    return (
      bundle.events.find(e => e.id === historySelectedNodeId) ??
      bundle.claims.find(c => c.id === historySelectedNodeId) ??
      null
    );
  }, [bundle, historySelectedNodeId]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleDiscover = useCallback(
    (query: string) => {
      dispatch({ type: 'SET_HISTORY_QUERY', payload: query });
    },
    [dispatch],
  );

  const handleModeChange = useCallback(
    (mode: 'causal' | 'compare' | 'drill') => {
      dispatch({ type: 'SET_HISTORY_MODE', payload: mode });
    },
    [dispatch],
  );

  const handlePerspectivesChange = useCallback(
    (keys: string[]) => {
      dispatch({ type: 'SET_HISTORY_ACTIVE_PERSPECTIVES', payload: keys });
    },
    [dispatch],
  );

  const handleNodeClick = useCallback(
    (id: string) => {
      dispatch({ type: 'SET_HISTORY_SELECTED_NODE', payload: id });
    },
    [dispatch],
  );

  const handleDrawerClose = useCallback(() => {
    dispatch({ type: 'SET_HISTORY_SELECTED_NODE', payload: null });
  }, [dispatch]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg text-fg">

      {/* Toolbar row */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface shrink-0 overflow-x-auto">
        <DiscoverBar onSubmit={handleDiscover} />
        <ModeToolbar
          mode={historyMode}
          onModeChange={handleModeChange}
          activePerspectiveKeys={historyActivePerspectives}
          onActivePerspectivesChange={handlePerspectivesChange}
          availablePerspectives={availablePerspectives}
        />
      </div>

      {/* Main viewport area */}
      <div className="flex-1 relative overflow-hidden">

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg/80 backdrop-blur-sm">
            <span className="text-accent text-xs font-mono animate-pulse">●</span>
            {progress && (
              <p className="text-[11px] font-mono text-dim">{progress}</p>
            )}
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="text-center space-y-2">
              <p className="text-red-400 text-xs font-mono">Error loading context graph</p>
              <p className="text-[10px] text-dim max-w-xs">{error}</p>
            </div>
          </div>
        )}

        {/* Empty state — no query yet */}
        {!bundle && !loading && !error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center px-8">
            <span className="text-4xl text-accent/30">⧖</span>
            <p className="text-sm font-medium text-fg/60">No topic selected</p>
            <p className="text-xs text-dim max-w-xs leading-relaxed">
              Enter a topic above or pick a curated chip to explore its historical causal graph.
            </p>
          </div>
        )}

        {/* Graph viewport */}
        {bundle && !error && (
          historyMode === 'compare' && historyActivePerspectives.length === 2 ? (
            <PerspectiveCompareView
              bundle={bundle}
              perspectiveAKey={historyActivePerspectives[0]}
              perspectiveBKey={historyActivePerspectives[1]}
              onNodeClick={handleNodeClick}
              selectedNodeId={historySelectedNodeId}
            />
          ) : (
            <GraphTreeViewport
              bundle={bundle}
              activePerspectiveKeys={historyActivePerspectives}
              onNodeClick={handleNodeClick}
            />
          )
        )}

        {/* Detail drawer */}
        {selectedNode && bundle && (
          <DetailDrawer
            node={selectedNode}
            bundle={bundle}
            onClose={handleDrawerClose}
          />
        )}

      </div>
    </div>
  );
}
