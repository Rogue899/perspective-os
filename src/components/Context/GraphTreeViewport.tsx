/**
 * GraphTreeViewport.tsx
 *
 * Wraps ReactFlow + Background + Controls + MiniMap.
 * Calls layoutBundleAsTree on mount / when inputs change.
 * All graph types and layout utilities imported through the adapter surface.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node as RfNode,
  type Edge as RfEdge,
  type EdgeProps,
  BaseEdge,
  getBezierPath,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { EventGraphBundle, GraphEdge } from '../../services/history-graph-adapter';
import { layoutBundleAsTree } from '../../utils/graph-tree-layout';
import { GraphNodeCard } from './GraphNodeCard';
import { getEdgeStyle } from './GraphEdgeStyle';

// ─── Custom edge component ────────────────────────────────────────────────────

function PerspectiveEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps & { data?: { edge: GraphEdge; activePerspectiveKeys?: string[] } }) {
  const edge = data?.edge;
  const style = edge ? getEdgeStyle(edge, data?.activePerspectiveKeys) : { stroke: '#4b5563', strokeWidth: 1 };

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke:           style.stroke,
        strokeWidth:      style.strokeWidth,
        strokeDasharray:  style.strokeDasharray,
      }}
    />
  );
}

// ─── Node / edge type registries (stable references — defined outside component) ─

const nodeTypes = {
  event: GraphNodeCard,
  claim: GraphNodeCard,
};

const edgeTypes = {
  perspective: PerspectiveEdge,
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface GraphTreeViewportProps {
  bundle: EventGraphBundle;
  activePerspectiveKeys?: string[];
  onNodeClick: (id: string) => void;
  showClaims?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GraphTreeViewport({
  bundle,
  activePerspectiveKeys,
  onNodeClick,
  showClaims = false,
}: GraphTreeViewportProps) {
  const [nodes, setNodes] = useState<RfNode[]>([]);
  const [edges, setEdges] = useState<RfEdge[]>([]);
  const [initialLayoutDone, setInitialLayoutDone] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  // Stable key to determine when to re-run layout
  const perspectivesKey = useMemo(
    () => (activePerspectiveKeys ?? []).join(','),
    [activePerspectiveKeys],
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLayoutError(null);
      try {
        const result = await layoutBundleAsTree(bundle, {
          activePerspectiveKeys,
          showClaims,
        });
        if (!cancelled) {
          setNodes(result.nodes);
          setEdges(result.edges);
          setInitialLayoutDone(true);
        }
      } catch (err) {
        if (!cancelled) {
          setLayoutError(err instanceof Error ? err.message : 'Layout failed.');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, perspectivesKey, showClaims]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: RfNode) => {
      onNodeClick(node.id);
    },
    [onNodeClick],
  );

  // Empty bundle — no events at all
  if (bundle.events.length === 0 && bundle.claims.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-dim text-xs font-mono">
        No historical events found for this topic.
      </div>
    );
  }

  if (layoutError) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-xs font-mono">
        Layout error: {layoutError}
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        fitView={!initialLayoutDone}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        className="bg-bg"
      >
        <Background color="rgb(var(--color-border))" gap={24} size={1} />
        <Controls
          className="!bg-surface !border-border"
          showInteractive={false}
        />
        <MiniMap
          style={{
            backgroundColor: 'rgb(var(--color-surface))',
            border: '1px solid rgb(var(--color-border))',
          }}
          maskColor="rgba(0,0,0,0.4)"
          nodeColor="rgb(var(--color-accent))"
        />
      </ReactFlow>
    </div>
  );
}
