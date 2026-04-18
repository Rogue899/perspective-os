/**
 * graph-contestedness.ts
 *
 * Thin wrappers around the adapter's contestedness logic for bulk computation
 * across an entire EventGraphBundle. All types come through the adapter.
 */

import type { EventGraphBundle } from '../services/history-graph-adapter';
import { computeContestedness } from '../services/history-graph-adapter';

// Re-export the per-event function so callers get a single import surface.
export { computeContestedness };

/**
 * Compute contestedness for every event in the bundle.
 * Returns a Map<eventId, score> where score is 0..1.
 */
export function computeBundleContestedness(
  bundle: EventGraphBundle,
  activePerspectiveKeys?: string[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const event of bundle.events) {
    result.set(event.id, computeContestedness(bundle, event.id, activePerspectiveKeys));
  }
  return result;
}

/**
 * Average contestedness across all events in the bundle (0..1).
 * Returns 0 when the bundle has no events.
 */
export function averageBundleContestedness(
  bundle: EventGraphBundle,
  activePerspectiveKeys?: string[],
): number {
  if (bundle.events.length === 0) return 0;
  const scores = bundle.events.map(event =>
    computeContestedness(bundle, event.id, activePerspectiveKeys),
  );
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
