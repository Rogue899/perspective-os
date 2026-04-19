/**
 * Wave 4 integration note: This component is standalone. The parallel Wave 3 Agent E
 * creates ContextPanel.tsx with a `TODO(Wave 4)` placeholder marking where to integrate
 * this component when `state.historyMode === 'compare'`. Wave 4 will wire it up.
 */

import type { EventGraphBundle, GraphEdge, PerspectiveLens } from '../../services/history-graph-adapter';
import { isUniversalEdge, getEdgeAsserters } from '../../services/history-graph-adapter';

// ---------------------------------------------------------------------------
// GraphTreeViewport stub
// ---------------------------------------------------------------------------
// Agent E (Wave 3) creates GraphTreeViewport.tsx in parallel. If it has not
// been committed yet when this file is compiled, we fall back to a minimal
// list-based renderer. Wave 4 will replace this import with the real viewport.
//
// To switch: delete this stub block and uncomment the import below.
//
//   import { GraphTreeViewport } from './GraphTreeViewport';
//
// ---------------------------------------------------------------------------

interface StubViewportProps {
  bundle: EventGraphBundle;
  activePerspectiveKeys: string[];
  onNodeClick: (id: string) => void;
  selectedNodeId?: string | null;
}

function GraphTreeViewport({
  bundle,
  activePerspectiveKeys: _activePerspectiveKeys,
  onNodeClick,
  selectedNodeId,
}: StubViewportProps) {
  // Wave 4: replace this body with the real <GraphTreeViewport> import.
  if (bundle.events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-dim text-[11px] font-mono">
        No events in this view.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1 p-3 overflow-y-auto h-full">
      {bundle.events.map(event => (
        <li
          key={event.id}
          onClick={() => onNodeClick(event.id)}
          className={[
            'cursor-pointer rounded px-2 py-1.5 text-[11px] font-mono transition-colors',
            selectedNodeId === event.id
              ? 'bg-accent/20 border border-accent/40 text-fg'
              : 'bg-surface border border-border text-fg hover:bg-surface/80',
          ].join(' ')}
        >
          {event.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Edge divergence computation
// ---------------------------------------------------------------------------

interface DivergenceSets {
  inBoth: GraphEdge[];
  onlyA: GraphEdge[];
  onlyB: GraphEdge[];
}

function computeDivergence(
  edges: GraphEdge[],
  perspectiveAKey: string,
  perspectiveBKey: string,
): DivergenceSets {
  const inBoth: GraphEdge[] = [];
  const onlyA: GraphEdge[] = [];
  const onlyB: GraphEdge[] = [];

  for (const edge of edges) {
    if (isUniversalEdge(edge)) {
      // Universal edges are shared by all perspectives
      inBoth.push(edge);
      continue;
    }

    const asserters: PerspectiveLens[] | null = getEdgeAsserters(edge);
    if (!asserters || asserters.length === 0) {
      inBoth.push(edge);
      continue;
    }

    const hasA = asserters.some(lens => lens.key === perspectiveAKey);
    const hasB = asserters.some(lens => lens.key === perspectiveBKey);

    if (hasA && hasB) {
      inBoth.push(edge);
    } else if (hasA) {
      onlyA.push(edge);
    } else if (hasB) {
      onlyB.push(edge);
    }
    // Edges asserter-restricted to neither A nor B are skipped (hidden from both columns)
  }

  return { inBoth, onlyA, onlyB };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PerspectiveCompareViewProps {
  bundle: EventGraphBundle;
  /** PerspectiveLens.key for the left column */
  perspectiveAKey: string;
  /** PerspectiveLens.key for the right column */
  perspectiveBKey: string;
  onNodeClick: (id: string) => void;
  selectedNodeId?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PerspectiveCompareView({
  bundle,
  perspectiveAKey,
  perspectiveBKey,
  onNodeClick,
  selectedNodeId,
}: PerspectiveCompareViewProps) {
  // Empty-state guard
  if (bundle.events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-bg text-dim text-[11px] font-mono">
        No events to compare.
      </div>
    );
  }

  // Compute divergence sets
  const { onlyA, onlyB } = computeDivergence(bundle.edges, perspectiveAKey, perspectiveBKey);
  const divergeCount = onlyA.length + onlyB.length;

  // Per-column bundles: pass full bundle but restrict edges via activePerspectiveKeys.
  // GraphTreeViewport uses activePerspectiveKeys to filter internally.
  // (The stub above ignores it — real viewport will honour it.)

  // Check whether each perspective key appears in any claim's perspectiveLens
  const claimKeys = new Set(
    bundle.claims
      .filter(c => c.perspectiveLens != null)
      .map(c => c.perspectiveLens!.key),
  );
  const perspectiveAAvailable = claimKeys.has(perspectiveAKey) || bundle.events.length > 0;
  const perspectiveBAvailable = claimKeys.has(perspectiveBKey) || bundle.events.length > 0;

  return (
    <div className="flex flex-col h-full bg-bg text-fg">
      {/* Divergence badge */}
      <div className="flex justify-center py-2 px-4 border-b border-border">
        {divergeCount === 0 ? (
          <span className="text-[10px] font-mono uppercase tracking-wider text-dim">
            None diverge
          </span>
        ) : (
          <span
            className="px-3 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider
                       bg-accent/10 border border-accent/30 text-accent"
          >
            {divergeCount} edge{divergeCount !== 1 ? 's' : ''} disagree on causation
          </span>
        )}
      </div>

      {/* Two-column split */}
      <div className="flex flex-1 overflow-hidden">
        {/* Column A */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden border-r border-border">
          <div className="px-3 py-1.5 border-b border-border flex-shrink-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-dim">
              Per {perspectiveAKey}
            </span>
          </div>
          {perspectiveAAvailable ? (
            <div className="flex-1 overflow-hidden">
              <GraphTreeViewport
                bundle={bundle}
                activePerspectiveKeys={[perspectiveAKey]}
                onNodeClick={onNodeClick}
                selectedNodeId={selectedNodeId}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-dim text-[11px] font-mono p-4 text-center">
              Perspective not available in this bundle.
            </div>
          )}
        </div>

        {/* Divider (border-r on left column acts as divider) */}

        {/* Column B */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-border flex-shrink-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-dim">
              Per {perspectiveBKey}
            </span>
          </div>
          {perspectiveBAvailable ? (
            <div className="flex-1 overflow-hidden">
              <GraphTreeViewport
                bundle={bundle}
                activePerspectiveKeys={[perspectiveBKey]}
                onNodeClick={onNodeClick}
                selectedNodeId={selectedNodeId}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-dim text-[11px] font-mono p-4 text-center">
              Perspective not available in this bundle.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
