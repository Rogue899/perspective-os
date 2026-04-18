/**
 * Unit tests for src/services/history-graph-adapter.ts
 *
 * All tests use inline minimal fake data — no real network calls or
 * real event-graph primitives are invoked.
 */

import { describe, it, expect } from 'vitest';
import type { EventGraphBundle, EventNode, ClaimNode, GraphEdge } from '../../src/services/history-graph-adapter';
import {
  isUniversalEdge,
  getEdgeAsserters,
  getAncestorChain,
  computeContestedness,
  getNodeConfidence,
  getConfidenceTier,
  getEdgeConfidence,
  getClaimPerspective,
} from '../../src/services/history-graph-adapter';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfidence(overall: number) {
  return {
    overall,
    tier: overall >= 0.8 ? 'high' as const : overall >= 0.6 ? 'medium' as const : overall > 0 ? 'low' as const : 'unknown' as const,
    dimensions: {},
    explanation: [],
    signals: {},
  };
}

function makeEvent(id: string, startedAt?: string): EventNode {
  return {
    id,
    nodeType: 'event',
    label: `Event ${id}`,
    canonicalKey: id,
    category: 'general',
    current: false,
    tags: [],
    placeIds: [],
    entityIds: [],
    claimIds: [],
    sourceDocumentIds: [],
    startedAt,
    confidence: makeConfidence(0.7),
  };
}

function makeClaim(id: string, overall = 0.65): ClaimNode {
  return {
    id,
    nodeType: 'claim',
    label: `Claim ${id}`,
    eventId: 'ev1',
    claimType: 'shared-fact',
    text: `text of ${id}`,
    evidenceIds: [],
    contradictionEvidenceIds: [],
    entityIds: [],
    placeIds: [],
    confidence: makeConfidence(overall),
  };
}

function makeEdge(
  id: string,
  sourceId: string,
  targetId: string,
  relation: GraphEdge['relation'],
  assertersJson?: string,
): GraphEdge {
  return {
    id,
    sourceId,
    targetId,
    relation,
    confidence: makeConfidence(0.7),
    metadata: assertersJson !== undefined ? { perspectiveAsserters: assertersJson } : undefined,
  };
}

function emptyBundle(): EventGraphBundle {
  return {
    events: [],
    claims: [],
    entities: [],
    places: [],
    sourceDocuments: [],
    evidence: [],
    edges: [],
    perspectiveViews: [],
  };
}

// ─── isUniversalEdge ──────────────────────────────────────────────────────────

describe('isUniversalEdge', () => {
  it('returns true when edge has no metadata', () => {
    const edge = makeEdge('e1', 'a', 'b', 'caused-by');
    expect(edge.metadata).toBeUndefined();
    expect(isUniversalEdge(edge)).toBe(true);
  });

  it('returns true when metadata exists but perspectiveAsserters key is absent', () => {
    const edge: GraphEdge = {
      ...makeEdge('e2', 'a', 'b', 'caused-by'),
      metadata: { someOtherKey: 'value' },
    };
    expect(isUniversalEdge(edge)).toBe(true);
  });

  it('returns true when perspectiveAsserters is null', () => {
    const edge: GraphEdge = {
      ...makeEdge('e3', 'a', 'b', 'caused-by'),
      metadata: { perspectiveAsserters: null },
    };
    expect(isUniversalEdge(edge)).toBe(true);
  });

  it('returns true when perspectiveAsserters is an empty JSON array', () => {
    const edge = makeEdge('e4', 'a', 'b', 'caused-by', '[]');
    expect(isUniversalEdge(edge)).toBe(true);
  });

  it('returns false when perspectiveAsserters is a non-empty JSON array', () => {
    const lens = { axis: 'media-ideology', key: 'left', label: 'Left' };
    const edge = makeEdge('e5', 'a', 'b', 'caused-by', JSON.stringify([lens]));
    expect(isUniversalEdge(edge)).toBe(false);
  });

  it('returns true when perspectiveAsserters is malformed JSON', () => {
    const edge: GraphEdge = {
      ...makeEdge('e6', 'a', 'b', 'caused-by'),
      metadata: { perspectiveAsserters: 'not-valid-json{' },
    };
    expect(isUniversalEdge(edge)).toBe(true);
  });
});

// ─── getEdgeAsserters ─────────────────────────────────────────────────────────

describe('getEdgeAsserters', () => {
  it('returns null when edge has no metadata', () => {
    const edge = makeEdge('e1', 'a', 'b', 'caused-by');
    expect(getEdgeAsserters(edge)).toBeNull();
  });

  it('returns null when perspectiveAsserters is empty array', () => {
    const edge = makeEdge('e2', 'a', 'b', 'caused-by', '[]');
    expect(getEdgeAsserters(edge)).toBeNull();
  });

  it('returns parsed array when perspectiveAsserters has content', () => {
    const lens = { axis: 'media-ideology' as const, key: 'right', label: 'Right' };
    const edge = makeEdge('e3', 'a', 'b', 'caused-by', JSON.stringify([lens]));
    const result = getEdgeAsserters(edge);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].key).toBe('right');
  });
});

// ─── getAncestorChain ─────────────────────────────────────────────────────────

describe('getAncestorChain', () => {
  it('returns empty array when no causal incoming edges exist', () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('root')],
      edges: [makeEdge('e1', 'root', 'other', 'supports')],
    };
    expect(getAncestorChain(bundle, 'root')).toHaveLength(0);
  });

  it('walks caused-by edge backward', () => {
    const evRoot = makeEvent('ev-root', '2024-01-02');
    const evParent = makeEvent('ev-parent', '2024-01-01');
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [evRoot, evParent],
      // ev-parent caused ev-root: edge goes parent → root with relation caused-by
      edges: [makeEdge('e1', 'ev-parent', 'ev-root', 'caused-by')],
    };
    const chain = getAncestorChain(bundle, 'ev-root');
    expect(chain.map(e => e.id)).toContain('ev-parent');
  });

  it('walks precursor-to edge backward', () => {
    const evRoot = makeEvent('ev-root');
    const evPrecursor = makeEvent('ev-precursor');
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [evRoot, evPrecursor],
      edges: [makeEdge('e1', 'ev-precursor', 'ev-root', 'precursor-to')],
    };
    const chain = getAncestorChain(bundle, 'ev-root');
    expect(chain.map(e => e.id)).toContain('ev-precursor');
  });

  it('walks retaliated-to edge backward', () => {
    const evRoot = makeEvent('ev-root');
    const evRetaliated = makeEvent('ev-retaliated');
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [evRoot, evRetaliated],
      edges: [makeEdge('e1', 'ev-retaliated', 'ev-root', 'retaliated-to')],
    };
    const chain = getAncestorChain(bundle, 'ev-root');
    expect(chain.map(e => e.id)).toContain('ev-retaliated');
  });

  it('does not walk non-causal edges', () => {
    const evRoot = makeEvent('ev-root');
    const evOther = makeEvent('ev-other');
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [evRoot, evOther],
      // 'supports' is not a causal relation
      edges: [makeEdge('e1', 'ev-other', 'ev-root', 'supports')],
    };
    const chain = getAncestorChain(bundle, 'ev-root');
    expect(chain).toHaveLength(0);
  });

  it('respects maxDepth', () => {
    // Chain: A → B → C → root (depth 3)
    const evA = makeEvent('ev-A', '2024-01-01');
    const evB = makeEvent('ev-B', '2024-01-02');
    const evC = makeEvent('ev-C', '2024-01-03');
    const evRoot = makeEvent('ev-root', '2024-01-04');
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [evA, evB, evC, evRoot],
      edges: [
        makeEdge('e1', 'ev-A', 'ev-B', 'caused-by'),
        makeEdge('e2', 'ev-B', 'ev-C', 'caused-by'),
        makeEdge('e3', 'ev-C', 'ev-root', 'caused-by'),
      ],
    };
    // maxDepth=1: only ev-C should be found (immediate ancestor)
    const chain = getAncestorChain(bundle, 'ev-root', 1);
    expect(chain.map(e => e.id)).toContain('ev-C');
    expect(chain.map(e => e.id)).not.toContain('ev-B');
    expect(chain.map(e => e.id)).not.toContain('ev-A');
  });

  it('avoids cycles', () => {
    // A ←→ B (cycle)
    const evA = makeEvent('ev-A');
    const evB = makeEvent('ev-B');
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [evA, evB],
      edges: [
        makeEdge('e1', 'ev-A', 'ev-B', 'caused-by'),
        makeEdge('e2', 'ev-B', 'ev-A', 'caused-by'),
      ],
    };
    // Should not loop forever; should return a finite result
    const chain = getAncestorChain(bundle, 'ev-B');
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe('ev-A');
  });

  it('returns ancestors in chronological order (earliest first)', () => {
    const evEarly = makeEvent('ev-early', '2020-01-01');
    const evMid = makeEvent('ev-mid', '2022-06-01');
    const evRoot = makeEvent('ev-root', '2024-01-01');
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [evRoot, evMid, evEarly],
      edges: [
        makeEdge('e1', 'ev-mid', 'ev-root', 'caused-by'),
        makeEdge('e2', 'ev-early', 'ev-root', 'precursor-to'),
      ],
    };
    const chain = getAncestorChain(bundle, 'ev-root');
    expect(chain[0].id).toBe('ev-early');
    expect(chain[1].id).toBe('ev-mid');
  });
});

// ─── computeContestedness ─────────────────────────────────────────────────────

describe('computeContestedness', () => {
  it('returns 0 when there are no incoming edges', () => {
    const bundle: EventGraphBundle = { ...emptyBundle(), events: [makeEvent('ev1')] };
    expect(computeContestedness(bundle, 'ev1')).toBe(0);
  });

  it('returns 0 for all-universal incoming edges', () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1')],
      edges: [
        makeEdge('e1', 'src1', 'ev1', 'background-context'), // no metadata → universal
        makeEdge('e2', 'src2', 'ev1', 'corroborates'),        // no metadata → universal
      ],
    };
    expect(computeContestedness(bundle, 'ev1')).toBe(0);
  });

  it('returns 1 for all-partisan incoming edges', () => {
    const lens = { axis: 'media-ideology' as const, key: 'left', label: 'Left' };
    const assertersJson = JSON.stringify([lens]);
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1')],
      edges: [
        makeEdge('e1', 'src1', 'ev1', 'background-context', assertersJson),
        makeEdge('e2', 'src2', 'ev1', 'corroborates', assertersJson),
      ],
    };
    expect(computeContestedness(bundle, 'ev1')).toBe(1);
  });

  it('returns correct fraction for mixed edges (2 partisan + 1 universal = ~0.667)', () => {
    const lens = { axis: 'media-ideology' as const, key: 'right', label: 'Right' };
    const assertersJson = JSON.stringify([lens]);
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1')],
      edges: [
        makeEdge('e1', 'src1', 'ev1', 'background-context', assertersJson), // partisan
        makeEdge('e2', 'src2', 'ev1', 'corroborates', assertersJson),        // partisan
        makeEdge('e3', 'src3', 'ev1', 'supports'),                           // universal (no metadata)
      ],
    };
    const score = computeContestedness(bundle, 'ev1');
    expect(score).toBeCloseTo(2 / 3, 5);
  });

  it('filters by activePerspectiveKeys — excludes non-overlapping partisan edges', () => {
    const lensLeft = { axis: 'media-ideology' as const, key: 'left', label: 'Left' };
    const lensRight = { axis: 'media-ideology' as const, key: 'right', label: 'Right' };
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1')],
      edges: [
        makeEdge('e1', 'src1', 'ev1', 'background-context', JSON.stringify([lensLeft])),  // left asserter
        makeEdge('e2', 'src2', 'ev1', 'corroborates', JSON.stringify([lensRight])),        // right asserter — excluded
        makeEdge('e3', 'src3', 'ev1', 'supports'),                                          // universal
      ],
    };
    // Only activePerspectiveKeys: ['left'] — right-asserter edge is excluded
    // relevant: e1 (partisan/left overlap), e3 (universal)
    const score = computeContestedness(bundle, 'ev1', ['left']);
    expect(score).toBeCloseTo(1 / 2, 5); // 1 partisan out of 2 relevant
  });

  it('only counts incoming edges (targetId matches), not outgoing', () => {
    const lens = { axis: 'media-ideology' as const, key: 'left', label: 'Left' };
    const assertersJson = JSON.stringify([lens]);
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1')],
      edges: [
        // Outgoing from ev1 — should not count
        makeEdge('e1', 'ev1', 'other', 'caused-by', assertersJson),
        // Incoming to ev1 — universal
        makeEdge('e2', 'src1', 'ev1', 'background-context'),
      ],
    };
    expect(computeContestedness(bundle, 'ev1')).toBe(0);
  });
});

// ─── getNodeConfidence ────────────────────────────────────────────────────────

describe('getNodeConfidence', () => {
  it('reads confidence.overall from an EventNode', () => {
    const node = makeEvent('ev1');
    // makeEvent sets overall to 0.7
    expect(getNodeConfidence(node)).toBe(0.7);
  });

  it('reads confidence.overall from a ClaimNode', () => {
    const claim = makeClaim('c1', 0.45);
    expect(getNodeConfidence(claim)).toBe(0.45);
  });
});

// ─── getConfidenceTier ────────────────────────────────────────────────────────

describe('getConfidenceTier', () => {
  it('returns high for confidence >= 0.8', () => {
    const node = { ...makeEvent('ev1'), confidence: makeConfidence(0.85) };
    expect(getConfidenceTier(node)).toBe('high');
  });

  it('returns medium for confidence in [0.6, 0.8)', () => {
    const node = { ...makeEvent('ev1'), confidence: makeConfidence(0.65) };
    expect(getConfidenceTier(node)).toBe('medium');
  });

  it('returns low for confidence in (0, 0.6)', () => {
    const node = { ...makeEvent('ev1'), confidence: makeConfidence(0.4) };
    expect(getConfidenceTier(node)).toBe('low');
  });

  it('returns unknown for confidence 0', () => {
    const node = { ...makeEvent('ev1'), confidence: makeConfidence(0) };
    expect(getConfidenceTier(node)).toBe('unknown');
  });
});

// ─── getEdgeConfidence ────────────────────────────────────────────────────────

describe('getEdgeConfidence', () => {
  it('reads confidence.overall from a GraphEdge', () => {
    const edge = makeEdge('e1', 'a', 'b', 'supports');
    expect(getEdgeConfidence(edge)).toBe(0.7);
  });
});

// ─── getClaimPerspective ──────────────────────────────────────────────────────

describe('getClaimPerspective', () => {
  it('returns null when claim has no perspectiveLens', () => {
    const claim = makeClaim('c1');
    expect(getClaimPerspective(claim)).toBeNull();
  });

  it('returns the perspectiveLens when present', () => {
    const lens = { axis: 'media-ideology' as const, key: 'left', label: 'Left' };
    const claim: ClaimNode = { ...makeClaim('c1'), perspectiveLens: lens };
    expect(getClaimPerspective(claim)).toEqual(lens);
  });
});
