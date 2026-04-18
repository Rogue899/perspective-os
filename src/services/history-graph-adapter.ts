/**
 * history-graph-adapter.ts
 *
 * Centralized adapter over the event-graph system.
 * Every downstream file (Context tab, useTopicGraph, tree layout, etc.) imports
 * types and functions from HERE — never directly from event-graph modules.
 * If the underlying API changes, only this file needs updating.
 */

// ─── Re-exported types (stable import surface) ───────────────────────────────

export type {
  EventGraphBundle,
  EventNode,
  ClaimNode,
  GraphEdge,
  GraphEdgeRelation,
  PerspectiveLens,
  ConfidenceProfile,
  HistoricalContextItem,
} from '../types/event-graph';

export type { StoryCluster } from '../types';

// ─── Internal imports (adapter implementation only) ──────────────────────────

import type {
  EventGraphBundle,
  EventNode,
  ClaimNode,
  GraphEdge,
  PerspectiveLens,
  HistoricalContextItem,
} from '../types/event-graph';
import type { StoryCluster } from '../types';
import {
  fetchEventGraphHistoryContext,
  extractEventGraphSearchTerms,
} from './event-graph';
import {
  createEventGraphFromCluster,
  createHistoricalContextGraph,
  mergeEventGraphBundles,
} from '../utils/event-graph';

// ─── perspectiveAsserters serialization contract ─────────────────────────────
//
// GraphEdge.metadata is typed as Record<string, GraphMetadataValue> where
// GraphMetadataValue = string | number | boolean | null.  An array of
// PerspectiveLens objects cannot be stored directly.
//
// Contract: perspectiveAsserters is stored as a JSON-serialized string in
// edge.metadata['perspectiveAsserters'].  An absent key or null/empty string
// means the edge is universal.  Writers call JSON.stringify(lenses) before
// storing; readers call JSON.parse on read.  Existing edges from the underlying
// event-graph system lack this key and therefore default to universal —
// backward-compatible by design.
//
const ASSERTERS_KEY = 'perspectiveAsserters';

// ─── Topic-query graph builder ────────────────────────────────────────────────

/**
 * Build an EventGraphBundle from a free-text query.
 * Creates a synthetic StoryCluster to feed fetchEventGraphHistoryContext,
 * then constructs a root EventNode and attaches historical context.
 */
export async function buildTopicGraph(
  query: string,
  opts?: { perspectives?: PerspectiveLens[] },
): Promise<EventGraphBundle> {
  // Kebab-case slug for stable IDs
  const slug = query
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Synthetic root EventNode representing the topic
  const rootEvent: EventNode = {
    id: `topic:${slug}`,
    nodeType: 'event',
    label: query,
    canonicalKey: slug,
    category: 'general',
    current: false,
    tags: [],
    placeIds: [],
    entityIds: [],
    claimIds: [],
    sourceDocumentIds: [],
    confidence: {
      overall: 0.5,
      tier: 'medium',
      dimensions: { provenance: 0.5 },
      explanation: ['Synthetic topic root node — confidence reflects topic-level aggregation.'],
      signals: {},
    },
  };

  // Build a minimal synthetic StoryCluster so we can call fetchEventGraphHistoryContext.
  // We set articles to an empty array (no live-cluster articles for a topic query).
  const syntheticCluster: StoryCluster = {
    id: `topic-cluster:${slug}`,
    headline: query,
    articles: [],
    sourceIds: [],
    publishedAt: new Date(),
    updatedAt: new Date(),
    severity: 'low',
    category: 'general',
    perspectiveScore: 0,
    hasAnalysis: false,
  };

  // Derive search terms from the query (re-use the same heuristic logic)
  const searchTerms = extractEventGraphSearchTerms(syntheticCluster);
  // If the automatic extraction yields nothing, fall back to the query itself
  const effectiveTerms = searchTerms.length > 0 ? searchTerms : [query];

  let historyItems: HistoricalContextItem[] = [];
  try {
    const context = await fetchEventGraphHistoryContext(syntheticCluster, effectiveTerms);
    historyItems = context.historyItems;
  } catch {
    // Non-fatal — proceed with an empty history graph
  }

  const historicalBundle = createHistoricalContextGraph(rootEvent, historyItems);

  // If perspective lenses were provided, attach them as asserters on every
  // new edge in the historical bundle so callers can filter later.
  let finalBundle: EventGraphBundle;
  if (opts?.perspectives && opts.perspectives.length > 0) {
    const assertersJson = JSON.stringify(opts.perspectives);
    const taggedEdges = historicalBundle.edges.map(edge => ({
      ...edge,
      metadata: {
        ...(edge.metadata ?? {}),
        [ASSERTERS_KEY]: assertersJson,
      },
    }));
    finalBundle = { ...historicalBundle, edges: taggedEdges, events: [rootEvent] };
  } else {
    finalBundle = { ...historicalBundle, events: [rootEvent] };
  }

  return finalBundle;
}

// ─── Cluster graph builder ────────────────────────────────────────────────────

/**
 * Build an EventGraphBundle from a StoryCluster.
 * Thin wrapper around createEventGraphFromCluster.
 */
export function buildClusterGraph(cluster: StoryCluster): EventGraphBundle {
  return createEventGraphFromCluster(cluster);
}

// ─── Confidence readers ───────────────────────────────────────────────────────

/**
 * Returns the overall confidence score (0..1) for an EventNode or ClaimNode.
 */
export function getNodeConfidence(node: EventNode | ClaimNode): number {
  return node.confidence.overall;
}

/**
 * Returns the overall confidence score (0..1) for a GraphEdge.
 */
export function getEdgeConfidence(edge: GraphEdge): number {
  return edge.confidence.overall;
}

/**
 * Returns the confidence tier for an EventNode or ClaimNode.
 */
export function getConfidenceTier(
  node: EventNode | ClaimNode,
): 'high' | 'medium' | 'low' | 'mixed' | 'unknown' {
  return node.confidence.tier;
}

// ─── Perspective readers ──────────────────────────────────────────────────────

/**
 * Returns the PerspectiveLens for a ClaimNode, or null if none.
 */
export function getClaimPerspective(claim: ClaimNode): PerspectiveLens | null {
  return claim.perspectiveLens ?? null;
}

/**
 * Returns true if the edge is universal (i.e. asserted by all / no specific
 * perspective). An edge is universal when perspectiveAsserters metadata is
 * absent, null, an empty string, or an empty JSON array.
 */
export function isUniversalEdge(edge: GraphEdge): boolean {
  if (!edge.metadata) return true;
  const raw = edge.metadata[ASSERTERS_KEY];
  if (raw === undefined || raw === null || raw === '') return true;
  // Stored as a JSON-serialized array of PerspectiveLens objects
  try {
    const parsed = JSON.parse(String(raw));
    return !Array.isArray(parsed) || parsed.length === 0;
  } catch {
    return true;
  }
}

/**
 * Returns the array of PerspectiveLens objects that assert this edge, or null
 * if the edge is universal. See serialization contract above.
 */
export function getEdgeAsserters(edge: GraphEdge): PerspectiveLens[] | null {
  if (!edge.metadata) return null;
  const raw = edge.metadata[ASSERTERS_KEY];
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // Type cast: the stored objects were written as PerspectiveLens[]
    return parsed as PerspectiveLens[];
  } catch {
    return null;
  }
}

// ─── Ancestor traversal ───────────────────────────────────────────────────────

/**
 * Walk backward from eventId following causal/precursor/retaliation edges,
 * collecting ancestor EventNodes in chronological order (earliest first).
 * Caps at maxDepth (default 5). Cycle-safe via a visited set.
 */
export function getAncestorChain(
  bundle: EventGraphBundle,
  eventId: string,
  maxDepth = 5,
): EventNode[] {
  const eventMap = new Map(bundle.events.map(e => [e.id, e]));
  const visited = new Set<string>();
  const result: EventNode[] = [];

  function walk(currentId: string, depth: number): void {
    if (depth >= maxDepth) return;
    // Find edges that point TO currentId and represent a causal relationship
    const incomingCausal = bundle.edges.filter(
      edge =>
        edge.targetId === currentId &&
        (edge.relation === 'caused-by' ||
          edge.relation === 'precursor-to' ||
          edge.relation === 'retaliated-to'),
    );

    for (const edge of incomingCausal) {
      const sourceId = edge.sourceId;
      if (visited.has(sourceId)) continue;
      visited.add(sourceId);
      const sourceEvent = eventMap.get(sourceId);
      if (sourceEvent) {
        result.push(sourceEvent);
        walk(sourceId, depth + 1);
      }
    }
  }

  visited.add(eventId);
  walk(eventId, 0);

  // Sort chronologically: nodes with startedAt go earlier; undated go last
  result.sort((a, b) => {
    if (!a.startedAt && !b.startedAt) return 0;
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  });

  return result;
}

// ─── Contestedness ────────────────────────────────────────────────────────────

/**
 * Compute how contested an event is based on incoming edges.
 *
 * Contestedness = partisan_edge_count / total_relevant_edge_count.
 * A "partisan" edge has at least one asserter (non-universal).
 * A "universal" edge has no asserters.
 *
 * If activePerspectiveKeys is provided, only edges that are universal OR have
 * asserters overlapping with those keys are considered.
 *
 * Returns 0 if no relevant edges exist.
 */
export function computeContestedness(
  bundle: EventGraphBundle,
  eventId: string,
  activePerspectiveKeys?: string[],
): number {
  const incomingEdges = bundle.edges.filter(edge => edge.targetId === eventId);

  let relevantEdges: GraphEdge[];
  if (!activePerspectiveKeys || activePerspectiveKeys.length === 0) {
    relevantEdges = incomingEdges;
  } else {
    relevantEdges = incomingEdges.filter(edge => {
      if (isUniversalEdge(edge)) return true;
      const asserters = getEdgeAsserters(edge);
      if (!asserters) return true;
      return asserters.some(lens => activePerspectiveKeys.includes(lens.key));
    });
  }

  if (relevantEdges.length === 0) return 0;

  const partisanCount = relevantEdges.filter(edge => !isUniversalEdge(edge)).length;
  return partisanCount / relevantEdges.length;
}

// ─── Re-export merge utility for convenience ─────────────────────────────────

export { mergeEventGraphBundles };
