/**
 * api/_lib/history-ratelimit.js
 * Per-IP rate limiting for the /api/history/* endpoints using Upstash Ratelimit.
 *
 * Degraded mode: if env vars are missing, returns { allowed: true } so the
 * API remains usable without Upstash credentials (local dev / cold starts).
 *
 * Budgets:
 *   gen     — 20 requests / 60s  (topic-graph generation)
 *   read    — 120 requests / 60s (cache hits / reads)
 *   refresh — 3 requests / 3600s (forced regeneration)
 */

/** @type {Map<string, import('@upstash/ratelimit').Ratelimit>} */
const _limiters = new Map();
let _redis = null;
let _tried = false;

async function getRedis() {
  if (_tried) return _redis;
  _tried = true;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch {
    console.warn('[history-ratelimit] @upstash/redis not available');
  }
  return _redis;
}

/**
 * @param {'gen' | 'read' | 'refresh'} budget
 * @returns {Promise<import('@upstash/ratelimit').Ratelimit | null>}
 */
async function getLimiter(budget) {
  if (_limiters.has(budget)) return _limiters.get(budget);

  const redis = await getRedis();
  if (!redis) return null;

  try {
    const { Ratelimit } = await import('@upstash/ratelimit');

    /** @type {import('@upstash/ratelimit').Ratelimit} */
    let limiter;

    if (budget === 'gen') {
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, '60 s'),
        prefix:  'hist:gen',
      });
    } else if (budget === 'read') {
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(120, '60 s'),
        prefix:  'hist:read',
      });
    } else {
      // refresh
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(3, '3600 s'),
        prefix:  'hist:refresh',
      });
    }

    _limiters.set(budget, limiter);
    return limiter;
  } catch (err) {
    console.warn('[history-ratelimit] Ratelimit init error:', err);
    return null;
  }
}

/**
 * Check whether the given IP is within budget.
 *
 * @param {string} ip
 * @param {'gen' | 'read' | 'refresh'} budget
 * @returns {Promise<{ allowed: boolean; retryAfter: number }>}
 *   retryAfter is seconds until reset (0 when allowed)
 */
export async function checkRateLimit(ip, budget) {
  const limiter = await getLimiter(budget);
  if (!limiter) return { allowed: true, retryAfter: 0 };

  try {
    const result = await limiter.limit(ip);
    if (result.success) return { allowed: true, retryAfter: 0 };
    // result.reset is a Unix timestamp (ms) when the window resets
    const retryAfter = Math.ceil(Math.max(0, result.reset - Date.now()) / 1000);
    return { allowed: false, retryAfter };
  } catch (err) {
    console.warn('[history-ratelimit] checkRateLimit error:', err);
    // Fail-open: allow the request on Redis errors
    return { allowed: true, retryAfter: 0 };
  }
}
