/**
 * graph-tree-layout.ts
 *
 * Converts an EventGraphBundle into react-flow nodes + edges with
 * elkjs-computed positions. All types come through the adapter.
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node as RfNode, Edge as RfEdge } from 'reactflow';
import type {
  EventGraphBundle,
  EventNode,
  ClaimNode,
  GraphEdge,
} from '../services/history-graph-adapter';
import { isUniversalEdge, getEdgeAsserters } from '../services/history-graph-adapter';

// Module-level ELK instance — reused across calls
const elk = new ELK();

export interface LayoutOptions {
  /** If set, only include edges where isUniversalEdge OR asserter.key is in this list. */
  activePerspectiveKeys?: string[];
  /** Graph direction. Defaults to 'LEFT-RIGHT'. */
  direction?: 'LEFT-RIGHT' | 'TOP-BOTTOM';
  /** If false (default), only EventNodes are included. If true, ClaimNodes are also included. */
  showClaims?: boolean;
}

/**
 * Filter edges by active perspective keys.
 * - undefined or empty array → return all edges (no filter).
 * - Otherwise include edges that are universal OR have an asserter whose key
 *   is in activePerspectiveKeys.
 */
export function filterEdgesByPerspectives(
  edges: GraphEdge[],
  activePerspectiveKeys: string[] | undefined,
): GraphEdge[] {
  if (!activePerspectiveKeys || activePerspectiveKeys.length === 0) {
    return edges;
  }
  return edges.filter(edge => {
    if (isUniversalEdge(edge)) return true;
    const asserters = getEdgeAsserters(edge);
    if (!asserters) return true;
    return asserters.some(lens => activePerspectiveKeys.includes(lens.key));
  });
}

/**
 * Convert an EventGraphBundle into react-flow nodes + edges with positions
 * computed by elkjs.
 */
export async function layoutBundleAsTree(
  bundle: EventGraphBundle,
  opts: LayoutOptions = {},
): Promise<{ nodes: RfNode[]; edges: RfEdge[] }> {
  const { activePerspectiveKeys, direction = 'LEFT-RIGHT', showClaims = false } = opts;

  // Collect nodes to lay out
  const eventNodes: EventNode[] = bundle.events;
  const claimNodes: ClaimNode[] = showClaims ? bundle.claims : [];

  if (eventNodes.length === 0 && claimNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Filter edges by perspective
  const filteredEdges = filterEdgesByPerspectives(bundle.edges, activePerspectiveKeys);

  // Build ELK children
  const elkChildren = [
    ...eventNodes.map(node => ({
      id: node.id,
      width: 220,
      height: 96,
    })),
    ...claimNodes.map(node => ({
      id: node.id,
      width: 200,
      height: 80,
    })),
  ];

  // Collect the IDs present in the layout so we only emit edges between laid-out nodes
  const presentIds = new Set(elkChildren.map(c => c.id));

  // Build ELK edges (only between nodes present in the layout)
  const elkEdges = filteredEdges
    .filter(edge => presentIds.has(edge.sourceId) && presentIds.has(edge.targetId))
    .map(edge => ({
      id: edge.id,
      sources: [edge.sourceId],
      targets: [edge.targetId],
    }));

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'TOP-BOTTOM' ? 'DOWN' : 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '60',
    },
    children: elkChildren,
    edges: elkEdges,
  };

  const layout = await elk.layout(elkGraph);

  // Build a map from id → position from the ELK result
  const positionMap = new Map<string, { x: number; y: number }>();
  for (const child of layout.children ?? []) {
    positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  // Build react-flow nodes
  const rfNodes: RfNode[] = [
    ...eventNodes.map(node => ({
      id: node.id,
      type: 'event' as const,
      position: positionMap.get(node.id) ?? { x: 0, y: 0 },
      data: { node, bundle, activePerspectiveKeys },
    })),
    ...claimNodes.map(node => ({
      id: node.id,
      type: 'claim' as const,
      position: positionMap.get(node.id) ?? { x: 0, y: 0 },
      data: { node, bundle, activePerspectiveKeys },
    })),
  ];

  // Build react-flow edges
  const rfEdges: RfEdge[] = filteredEdges
    .filter(edge => presentIds.has(edge.sourceId) && presentIds.has(edge.targetId))
    .map(edge => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      type: 'perspective' as const,
      data: { edge, activePerspectiveKeys },
    }));

  return { nodes: rfNodes, edges: rfEdges };
}
