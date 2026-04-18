/**
 * api/_lib/history-cache.js
 * Upstash Redis cache helpers for the /api/history/topic-graph endpoint.
 *
 * Degraded mode: if UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
 * absent, the client is null and all operations are no-ops / return null.
 * This allows local development without Redis credentials.
 *
 * Key schema:
 *   hist:tree:<slug>   — cached EventGraphBundle (JSON, 30-day TTL)
 *   hist:lock:<slug>   — distributed lock (60s TTL)
 */

const TTL_30_DAYS = 2592000; // seconds
const LOCK_TTL    = 60;      // seconds

/** @type {import('@upstash/redis').Redis | null} */
let _redis = null;
let _tried = false;

async function getRedis() {
  if (_tried) return _redis;
  _tried = true;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn('[history-cache] Upstash env vars missing — running without Redis cache');
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch {
    console.warn('[history-cache] @upstash/redis not available');
  }
  return _redis;
}

/**
 * Fetch a cached EventGraphBundle for the given slug.
 * Extends TTL to 30 days on cache hit.
 *
 * @param {string} slug
 * @returns {Promise<object | null>}
 */
export async function getTopicGraph(slug) {
  const redis = await getRedis();
  if (!redis) return null;
  const key = `hist:tree:${slug}`;
  try {
    const cached = await redis.get(key);
    if (cached) {
      // Extend TTL on hit (sliding window semantics)
      await redis.expire(key, TTL_30_DAYS).catch(() => {});
      return typeof cached === 'string' ? JSON.parse(cached) : cached;
    }
  } catch (err) {
    console.warn('[history-cache] getTopicGraph error:', err);
  }
  return null;
}

/**
 * Persist an EventGraphBundle for the given slug with a 30-day TTL.
 *
 * @param {string} slug
 * @param {object} bundle
 * @returns {Promise<void>}
 */
export async function setTopicGraph(slug, bundle) {
  const redis = await getRedis();
  if (!redis) return;
  const key = `hist:tree:${slug}`;
  try {
    await redis.set(key, JSON.stringify(bundle), { ex: TTL_30_DAYS });
  } catch (err) {
    console.warn('[history-cache] setTopicGraph error:', err);
  }
}

/**
 * Attempt to acquire a distributed generation lock for the given slug.
 * Uses SET NX (only set if not exists) with a 60s TTL to prevent stampedes.
 *
 * @param {string} slug
 * @returns {Promise<boolean>} true if lock was acquired, false if already held
 */
export async function acquireLock(slug) {
  const redis = await getRedis();
  // In degraded mode, always pretend we acquired the lock (single worker assumption)
  if (!redis) return true;
  const key = `hist:lock:${slug}`;
  try {
    const result = await redis.set(key, '1', { nx: true, ex: LOCK_TTL });
    // Upstash returns 'OK' on SET NX success, null on failure
    return result === 'OK' || result === 1 || result === true;
  } catch (err) {
    console.warn('[history-cache] acquireLock error:', err);
    return true; // fail-open: let the caller proceed
  }
}

/**
 * Release the distributed lock for the given slug.
 *
 * @param {string} slug
 * @returns {Promise<void>}
 */
export async function releaseLock(slug) {
  const redis = await getRedis();
  if (!redis) return;
  const key = `hist:lock:${slug}`;
  try {
    await redis.del(key);
  } catch (err) {
    console.warn('[history-cache] releaseLock error:', err);
  }
}

/**
 * Poll for a cached bundle to appear (written by a concurrent worker).
 * Returns the bundle if found within maxMs, null on timeout.
 *
 * @param {string} slug
 * @param {number} [maxMs=45000]
 * @param {number} [intervalMs=500]
 * @returns {Promise<object | null>}
 */
export async function waitForTopicGraph(slug, maxMs = 45000, intervalMs = 500) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const bundle = await getTopicGraph(slug);
    if (bundle) return bundle;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return null;
}
