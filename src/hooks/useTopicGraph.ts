/**
 * useTopicGraph.ts
 *
 * React hook that builds a topic-query-driven EventGraphBundle.
 *
 * Flow:
 *  1. Derive a stable slug from the query string.
 *  2. Check IndexedDB for a fresh cached result.
 *  3. If missing or stale, POST /api/history/topic-graph with rotating
 *     progress messages while waiting.
 *  4. Write successful results back to IndexedDB (best-effort).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventGraphBundle } from '../services/history-graph-adapter';
import { fetchWithSettings } from '../services/integration-settings';
import {
  getCachedTopicGraph,
  setCachedTopicGraph,
  clearCachedTopicGraph,
} from '../services/history-cache-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseTopicGraphResult {
  bundle: EventGraphBundle | null;
  loading: boolean;
  error: string | null;
  progress: string | null;
  refetch: (forceRefresh?: boolean) => void;
}

// ─── Progress messages ────────────────────────────────────────────────────────

const PROGRESS_MESSAGES = [
  'Fetching historical context…',
  'Reading Wikipedia in multiple languages…',
  'Scanning GDELT for contextual events…',
  'Extracting actors and places…',
  'Synthesizing perspective narratives…',
  'Attaching source documents…',
] as const;

const PROGRESS_INTERVAL_MS = 4500;

// ─── Slug utility ─────────────────────────────────────────────────────────────

/**
 * Compute a stable slug from a free-text query.
 * - Lowercased
 * - Punctuation stripped (Unicode-aware: keeps letters, digits, spaces, hyphens)
 * - Whitespace collapsed
 * - Tokens sorted alphabetically (so "Israel Lebanon" === "Lebanon Israel")
 * - Joined with hyphens
 */
function computeSlug(query: string): string {
  const stripped = query
    .toLowerCase()
    // Strip anything that is not a Unicode letter, digit, whitespace, or hyphen.
    // The 'u' flag enables Unicode property escapes.
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped) return '';

  const tokens = stripped.split(' ').filter(Boolean).sort();
  return tokens.join('-');
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTopicGraph(query: string, storyClusterId?: string): UseTopicGraphResult {
  const [bundle, setBundle] = useState<EventGraphBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  // Tick counter — incrementing this value re-runs the fetch effect.
  const [tick, setTick] = useState(0);
  // Whether the next fetch should bypass caches.
  const forceRefreshRef = useRef(false);

  const refetch = useCallback(
    (forceRefresh = false) => {
      forceRefreshRef.current = forceRefresh;
      setTick(t => t + 1);
    },
    [],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setBundle(null);
      setLoading(false);
      setError(null);
      setProgress(null);
      return;
    }

    const slug = computeSlug(trimmed);
    const forceRefresh = forceRefreshRef.current;
    // Consume the flag so subsequent re-renders don't incorrectly force-refresh.
    forceRefreshRef.current = false;

    let cancelled = false;
    let progressIndex = 0;
    let progressTimerId: ReturnType<typeof setInterval> | null = null;

    const startProgressRotation = () => {
      setProgress(PROGRESS_MESSAGES[0]);
      progressTimerId = setInterval(() => {
        if (cancelled) return;
        progressIndex = (progressIndex + 1) % PROGRESS_MESSAGES.length;
        setProgress(PROGRESS_MESSAGES[progressIndex]);
      }, PROGRESS_INTERVAL_MS);
    };

    const stopProgressRotation = () => {
      if (progressTimerId !== null) {
        clearInterval(progressTimerId);
        progressTimerId = null;
      }
      setProgress(null);
    };

    const run = async () => {
      setError(null);

      // Step 1: clear IndexedDB if force-refreshing
      if (forceRefresh) {
        await clearCachedTopicGraph(slug).catch(() => {});
      }

      // Step 2: check IndexedDB cache
      if (!forceRefresh) {
        const cached = await getCachedTopicGraph(slug);
        if (cached && !cached.isStale) {
          if (!cancelled) {
            setBundle(cached.bundle);
            setLoading(false);
          }
          return;
        }
      }

      // Step 3: fetch from server with rotating progress messages
      setLoading(true);
      startProgressRotation();

      try {
        const response = await fetchWithSettings('/api/history/topic-graph', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: trimmed,
            storyClusterId,
            forceRefresh,
          }),
        });

        if (!response.ok) {
          throw new Error(`Server error ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as {
          bundle: EventGraphBundle;
          cache?: unknown;
          diagnostics?: unknown;
        };

        if (cancelled) return;

        setBundle(data.bundle);
        setError(null);

        // Step 4: write to IndexedDB (best-effort — don't block UI)
        setCachedTopicGraph(slug, data.bundle).catch(() => {});
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch historical context.');
        setBundle(null);
      } finally {
        if (!cancelled) {
          stopProgressRotation();
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (progressTimerId !== null) {
        clearInterval(progressTimerId);
      }
    };
    // `tick` is intentionally included so `refetch()` re-runs this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, storyClusterId, tick]);

  return { bundle, loading, error, progress, refetch };
}
