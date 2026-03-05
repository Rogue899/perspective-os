/**
 * RSS Feed Circuit Breaker — WorldMonitor pattern (feat #625 / circuit-breaker)
 *
 * Per-feed state machine:
 *   CLOSED (normal) → 2 failures in 60s → OPEN (cooldown 5min) → HALF-OPEN (probe)
 *
 * Stale-while-revalidate: returns cached response during OPEN state.
 * State is kept in-memory per page session. No localStorage (fresh on reload).
 */

const FAILURE_THRESHOLD = 2;
const COOLDOWN_MS       = 5 * 60 * 1000; // 5 min
const FAILURE_WINDOW_MS = 60 * 1000;     // 1 min
const PROBE_TIMEOUT_MS  = 10 * 1000;     // timeout for probe request

export type CircuitState = 'closed' | 'open' | 'half-open';

interface FeedRecord {
  state:       CircuitState;
  failures:    number;
  firstFailAt: number | null;  // timestamp of first failure in window
  openedAt:    number | null;  // when circuit opened
  staleCache:  string | null;  // last successful response body
  lastError:   string | null;
}

const records = new Map<string, FeedRecord>();

function get(feedId: string): FeedRecord {
  if (!records.has(feedId)) {
    records.set(feedId, {
      state: 'closed', failures: 0, firstFailAt: null,
      openedAt: null, staleCache: null, lastError: null,
    });
  }
  return records.get(feedId)!;
}

function resetFailures(r: FeedRecord) {
  r.failures    = 0;
  r.firstFailAt = null;
}

function onSuccess(feedId: string, body: string) {
  const r = get(feedId);
  r.staleCache = body;
  r.lastError  = null;
  r.state      = 'closed';
  resetFailures(r);
}

function onFailure(feedId: string, error: string): boolean {
  const r  = get(feedId);
  const now = Date.now();

  r.lastError = error;

  // Reset failure window if first failure was > WINDOW ago
  if (r.firstFailAt && now - r.firstFailAt > FAILURE_WINDOW_MS) {
    resetFailures(r);
  }

  if (r.firstFailAt === null) r.firstFailAt = now;
  r.failures++;

  if (r.failures >= FAILURE_THRESHOLD) {
    r.state    = 'open';
    r.openedAt = now;
    console.warn(`[circuit] ${feedId} OPENED (${r.failures} failures). Cooling down ${COOLDOWN_MS / 60000}min.`);
    return true; // tripped
  }
  return false;
}

function isOpen(feedId: string): boolean {
  const r = get(feedId);
  if (r.state !== 'open') return false;

  const elapsed = Date.now() - (r.openedAt ?? 0);
  if (elapsed >= COOLDOWN_MS) {
    r.state = 'half-open';
    console.info(`[circuit] ${feedId} HALF-OPEN — probing.`);
    return false; // allow one probe through
  }
  return true;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Wrapped fetch for RSS feeds with circuit breaker.
 * Returns { ok: true, body } or { ok: false, stale?, error }.
 */
export async function fetchWithBreaker(
  feedId: string,
  url: string,
  options?: RequestInit,
): Promise<{ ok: true; body: string } | { ok: false; stale: string | null; error: string }> {
  const r = get(feedId);

  // Circuit OPEN — return stale immediately
  if (isOpen(feedId)) {
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - (r.openedAt ?? 0))) / 1000);
    const msg = `[FEED DOWN] ${feedId}: circuit open, ${remaining}s cooldown remaining`;
    console.warn(msg);
    return { ok: false, stale: r.staleCache, error: msg };
  }

  try {
    const timeout = r.state === 'half-open' ? PROBE_TIMEOUT_MS : 12000;
    const resp = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);

    const body = await resp.text();
    onSuccess(feedId, body);

    if (r.state === 'half-open') {
      console.info(`[circuit] ${feedId} CLOSED — probe succeeded.`);
    }
    return { ok: true, body };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const tripped = onFailure(feedId, error);
    if (tripped) {
      console.warn(`[circuit] ${feedId} circuit tripped: ${error}`);
    }
    return { ok: false, stale: r.staleCache, error };
  }
}

/**
 * Get current circuit state for a feed (for UI badge display).
 */
export function getCircuitState(feedId: string): CircuitState {
  const r = get(feedId);
  if (r.state === 'open' && Date.now() - (r.openedAt ?? 0) >= COOLDOWN_MS) return 'half-open';
  return r.state;
}

export function getCircuitError(feedId: string): string | null {
  return get(feedId).lastError;
}

export function getAllCircuitStates(): Array<{ feedId: string; state: CircuitState; error: string | null }> {
  return [...records.entries()].map(([feedId, r]) => ({
    feedId,
    state: getCircuitState(feedId),
    error: r.lastError,
  }));
}
