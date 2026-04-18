/**
 * Unit tests for src/utils/graph-tree-layout.ts
 *
 * Uses inline fake EventGraphBundle data. No network calls.
 * elkjs bundled runs synchronously in Node — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import type { EventGraphBundle, EventNode, ClaimNode, GraphEdge } from '../../src/services/history-graph-adapter';
import { layoutBundleAsTree, filterEdgesByPerspectives } from '../../src/utils/graph-tree-layout';

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

function makeClaim(id: string, eventId = 'ev1'): ClaimNode {
  return {
    id,
    nodeType: 'claim',
    label: `Claim ${id}`,
    eventId,
    claimType: 'shared-fact',
    text: `text of ${id}`,
    evidenceIds: [],
    contradictionEvidenceIds: [],
    entityIds: [],
    placeIds: [],
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

// ─── layoutBundleAsTree ───────────────────────────────────────────────────────

describe('layoutBundleAsTree', () => {
  it('empty bundle returns empty nodes and edges', async () => {
    const result = await layoutBundleAsTree(emptyBundle());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('bundle with 3 events returns 3 nodes', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2'), makeEvent('ev3')],
    };
    const result = await layoutBundleAsTree(bundle);
    expect(result.nodes).toHaveLength(3);
  });

  it('bundle with 3 events and 2 edges returns 3 nodes and 2 edges', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2'), makeEvent('ev3')],
      edges: [
        makeEdge('e1', 'ev1', 'ev2'),
        makeEdge('e2', 'ev2', 'ev3'),
      ],
    };
    const result = await layoutBundleAsTree(bundle);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
  });

  it('nodes have type "event" for EventNodes', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1')],
    };
    const result = await layoutBundleAsTree(bundle);
    expect(result.nodes[0].type).toBe('event');
  });

  it('nodes receive positions from ELK', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      edges: [makeEdge('e1', 'ev1', 'ev2')],
    };
    const result = await layoutBundleAsTree(bundle);
    expect(result.nodes).toHaveLength(2);
    // ELK assigns numeric x/y — at minimum they should be numbers
    for (const node of result.nodes) {
      expect(typeof node.position.x).toBe('number');
      expect(typeof node.position.y).toBe('number');
    }
  });

  it('edges have type "perspective"', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      edges: [makeEdge('e1', 'ev1', 'ev2')],
    };
    const result = await layoutBundleAsTree(bundle);
    expect(result.edges[0].type).toBe('perspective');
  });

  it('showClaims: false (default) — only event nodes returned', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      claims: [makeClaim('c1', 'ev1'), makeClaim('c2', 'ev1')],
    };
    const result = await layoutBundleAsTree(bundle, { showClaims: false });
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.every(n => n.type === 'event')).toBe(true);
  });

  it('showClaims: true — both event and claim nodes returned', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1')],
      claims: [makeClaim('c1', 'ev1')],
    };
    const result = await layoutBundleAsTree(bundle, { showClaims: true });
    expect(result.nodes).toHaveLength(2);
    const types = result.nodes.map(n => n.type);
    expect(types).toContain('event');
    expect(types).toContain('claim');
  });

  it('claim nodes have type "claim"', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1')],
      claims: [makeClaim('c1', 'ev1')],
    };
    const result = await layoutBundleAsTree(bundle, { showClaims: true });
    const claimNode = result.nodes.find(n => n.id === 'c1');
    expect(claimNode?.type).toBe('claim');
  });

  it('node data contains the original node, bundle, and activePerspectiveKeys', async () => {
    const ev = makeEvent('ev1');
    const bundle: EventGraphBundle = { ...emptyBundle(), events: [ev] };
    const keys = ['left', 'right'];
    const result = await layoutBundleAsTree(bundle, { activePerspectiveKeys: keys });
    expect(result.nodes[0].data.node).toBe(ev);
    expect(result.nodes[0].data.bundle).toBe(bundle);
    expect(result.nodes[0].data.activePerspectiveKeys).toBe(keys);
  });

  it('edge data contains the original edge and activePerspectiveKeys', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      edges: [makeEdge('e1', 'ev1', 'ev2')],
    };
    const keys = ['left'];
    const result = await layoutBundleAsTree(bundle, { activePerspectiveKeys: keys });
    expect(result.edges[0].data.edge.id).toBe('e1');
    expect(result.edges[0].data.activePerspectiveKeys).toBe(keys);
  });

  it('edges referencing unknown node IDs are excluded', async () => {
    const bundle: EventGraphBundle = {
      ...emptyBundle(),
      events: [makeEvent('ev1'), makeEvent('ev2')],
      // e2 references a non-existent 'ev99' — should be dropped
      edges: [
        makeEdge('e1', 'ev1', 'ev2'),
        makeEdge('e2', 'ev1', 'ev99'),
      ],
    };
    const result = await layoutBundleAsTree(bundle);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].id).toBe('e1');
  });
});

// ─── filterEdgesByPerspectives ────────────────────────────────────────────────

describe('filterEdgesByPerspectives', () => {
  const universalEdge = makeEdge('e-universal', 'a', 'b');
  const iranianEdge = makeEdge(
    'e-iranian',
    'a',
    'b',
    JSON.stringify([{ axis: 'media-ideology', key: 'iranian-state', label: 'Iranian state' }]),
  );
  const leftEdge = makeEdge(
    'e-left',
    'a',
    'b',
    JSON.stringify([{ axis: 'media-ideology', key: 'left', label: 'Left' }]),
  );

  it('undefined activePerspectiveKeys → returns all edges', () => {
    const edges = [universalEdge, iranianEdge, leftEdge];
    expect(filterEdgesByPerspectives(edges, undefined)).toHaveLength(3);
  });

  it('empty array activePerspectiveKeys → returns all edges', () => {
    const edges = [universalEdge, iranianEdge, leftEdge];
    expect(filterEdgesByPerspectives(edges, [])).toHaveLength(3);
  });

  it('key matching one asserter → returns that edge + universal edges', () => {
    const edges = [universalEdge, iranianEdge, leftEdge];
    const result = filterEdgesByPerspectives(edges, ['iranian-state']);
    expect(result).toHaveLength(2);
    expect(result.map(e => e.id)).toContain('e-universal');
    expect(result.map(e => e.id)).toContain('e-iranian');
    expect(result.map(e => e.id)).not.toContain('e-left');
  });

  it('key matching no asserter → returns only universal edges', () => {
    const edges = [universalEdge, iranianEdge, leftEdge];
    const result = filterEdgesByPerspectives(edges, ['nonexistent-key']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e-universal');
  });

  it('multiple keys → returns all matching edges + universal', () => {
    const edges = [universalEdge, iranianEdge, leftEdge];
    const result = filterEdgesByPerspectives(edges, ['iranian-state', 'left']);
    expect(result).toHaveLength(3);
  });
});
