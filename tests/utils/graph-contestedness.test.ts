/**
 * Unit tests for src/utils/graph-contestedness.ts
 *
 * Uses inline fake EventGraphBundle data. No network calls.
 */

import { describe, it, expect } from 'vitest';
import type { EventGraphBundle, EventNode, GraphEdge } from '../../src/services/history-graph-adapter';
import {
  computeContestedness,
  computeBundleContestedness,
  averageBundleContestedness,
} from '../../src/utils/graph-contestedness';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfidence(overall = 0.7) {
  return {
    overall,
    tier: 'medium' as const,
    dimensions: {},
    explanation: [],
    signals: {},
  };
}

function makeEvent(id: string): EventNode {
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
    confidence: makeConfidence(),
  };
}

function makeEdge(
  id: string,
  sourceId: string,
  targetId: string,
  assertersJson?: string,
): GraphEdge {
  return {
    id,
    sourceId,
    targetId,
    relation: 'caused-by',
    confidence: makeConfidence(),
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

const lensLeft = JSON.stringify([{ axis: 'media-ideology', key: 'left', label: 'Left' }]);
const lensRight = JSON.stringify([{ axis: 'media-ideology', key: 'right', label: 'Right' }]);
const lensCenter = JSON.stringify([{ axis: 'media-ideology', key: 'center', label: 'Center' }]);

// ─── computeContestedness (re-exported) ───────────────────────────────────────

describe('computeContestedness (re-exported)', () => {
  it('returns 0 for event with no incoming edges', () => {
    const bundle: EventGraphBundle = { ...emptyBundle(), events: [makeEvent('ev1')] };
    expect(computeContestedness(bundle, 'ev1')).toBe(0);
  });
});

// ─── computeBundleContestedness ───────────────────────────────────────────────

describe('computeBundleContestedness', () => {
  it('returns empty map for empty bundle', () => {
    const result = computeBundleContestedness(emptyBundle());
    expect(result.size).toBe(0);
  });

  it('returns a score for each event in the bundle', () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
    };
    const result = computeBundleContestedness(bundle);
    expect(result.size).toBe(2);
    expect(result.has('ev1')).toBe(true);
    expect(result.has('ev2')).toBe(true);
  });

  it('computes correct per-event contestedness values', () => {
    // ev1 has 2 universal + 1 partisan → score 1/3
    // ev2 has 3 partisan → score 1
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      edges: [
        // ev1 incoming
        makeEdge('e1', 'src1', 'ev1'),           // universal
        makeEdge('e2', 'src2', 'ev1'),           // universal
        makeEdge('e3', 'src3', 'ev1', lensLeft), // partisan

        // ev2 incoming
        makeEdge('e4', 'src4', 'ev2', lensLeft),   // partisan
        makeEdge('e5', 'src5', 'ev2', lensRight),  // partisan
        makeEdge('e6', 'src6', 'ev2', lensCenter), // partisan
      ],
    };
    const result = computeBundleContestedness(bundle);
    expect(result.get('ev1')).toBeCloseTo(1 / 3, 5);
    expect(result.get('ev2')).toBeCloseTo(1, 5);
  });

  it('respects activePerspectiveKeys — only filters by provided keys', () => {
    // ev1: 1 left-partisan + 1 right-partisan + 1 universal
    // With only 'left' active: right edge is excluded → 1 partisan + 1 universal = 0.5
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1')],
      edges: [
        makeEdge('e1', 'src1', 'ev1', lensLeft),   // left partisan — included
        makeEdge('e2', 'src2', 'ev1', lensRight),  // right partisan — excluded
        makeEdge('e3', 'src3', 'ev1'),              // universal — included
      ],
    };
    const result = computeBundleContestedness(bundle, ['left']);
    expect(result.get('ev1')).toBeCloseTo(1 / 2, 5);
  });
});

// ─── averageBundleContestedness ───────────────────────────────────────────────

describe('averageBundleContestedness', () => {
  it('returns 0 for empty bundle', () => {
    expect(averageBundleContestedness(emptyBundle())).toBe(0);
  });

  it('returns 0 when all edges are universal', () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      edges: [
        makeEdge('e1', 'src1', 'ev1'),
        makeEdge('e2', 'src1', 'ev2'),
      ],
    };
    expect(averageBundleContestedness(bundle)).toBe(0);
  });

  it('returns 1 when all edges are partisan for all events', () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      edges: [
        makeEdge('e1', 'src1', 'ev1', lensLeft),
        makeEdge('e2', 'src1', 'ev2', lensRight),
      ],
    };
    expect(averageBundleContestedness(bundle)).toBe(1);
  });

  it('averages correctly across events with different scores', () => {
    // ev1 has 3 incoming: 2 universal + 1 partisan → 1/3
    // ev2 has 3 incoming: 1 universal + 2 partisan → 2/3
    // average = (1/3 + 2/3) / 2 = 0.5
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      edges: [
        // ev1
        makeEdge('e1', 'src1', 'ev1'),           // universal
        makeEdge('e2', 'src2', 'ev1'),           // universal
        makeEdge('e3', 'src3', 'ev1', lensLeft), // partisan

        // ev2
        makeEdge('e4', 'src4', 'ev2'),            // universal
        makeEdge('e5', 'src5', 'ev2', lensLeft),  // partisan
        makeEdge('e6', 'src6', 'ev2', lensRight), // partisan
      ],
    };
    const avg = averageBundleContestedness(bundle);
    expect(avg).toBeCloseTo(0.5, 5);
  });

  it('event with no incoming edges contributes 0 to average', () => {
    // ev1: 0 edges → 0; ev2: 2 partisan → 1
    // average = (0 + 1) / 2 = 0.5
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      edges: [
        makeEdge('e1', 'src1', 'ev2', lensLeft),
        makeEdge('e2', 'src2', 'ev2', lensRight),
      ],
    };
    const avg = averageBundleContestedness(bundle);
    expect(avg).toBeCloseTo(0.5, 5);
  });
});
