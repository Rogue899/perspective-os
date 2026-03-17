/**
 * /api/tone-baseline
 * Welford online algorithm for running mean+variance of GDELT article tone.
 * Stored in Redis: key `welford:{topic}` → JSON { n, mean, M2 }
 *
 * POST { topic, tones: number[] }
 *   → updates Welford stats, returns { mean, stdDev, count }
 *
 * GET ?topic=X
 *   → returns { mean, stdDev, count }
 *
 * GDELT tone scale: negative = hostile/alarming coverage, positive = upbeat.
 * Typical range: -10 to +5. Baseline drift detects emerging crises before
 * they surface in headlines.
 */

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function createRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch {
    return null;
  }
}

// Welford's online update: numerically stable mean + variance
function welfordUpdate(stats, x) {
  const n      = stats.n + 1;
  const delta  = x - stats.mean;
  const mean   = stats.mean + delta / n;
  const delta2 = x - mean;
  const M2     = stats.M2 + delta * delta2;
  return { n, mean, M2 };
}

function welfordStats(stats) {
  if (stats.n < 2) return { mean: stats.mean, variance: 0, stdDev: 0 };
  const variance = stats.M2 / (stats.n - 1);
  return { mean: stats.mean, variance, stdDev: Math.sqrt(variance) };
}

const EMPTY_STATS = { n: 0, mean: 0, M2: 0 };
const TTL_SECS    = 7 * 24 * 3600; // 7-day rolling window

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const redis  = await createRedis();
  const url    = new URL(req.url);
  const topic  = (url.searchParams.get('topic') ?? 'all').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  const key    = `welford:${topic}`;

  // ── GET — return current baseline ──────────────────────────────────────────
  if (req.method === 'GET') {
    const raw   = redis ? await redis.get(key) : null;
    const stats = raw ?? EMPTY_STATS;
    const { mean, stdDev } = welfordStats(stats);

    return new Response(
      JSON.stringify({ mean, stdDev, count: stats.n }),
      { headers: { 'Content-Type': 'application/json', ...CORS } },
    );
  }

  // ── POST — update baseline with new tone batch ──────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { body = {}; }

    const topicOverride = (body.topic ?? topic).replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
    const redisKey = `welford:${topicOverride}`;

    const tones = (Array.isArray(body.tones) ? body.tones : [])
      .filter(t => typeof t === 'number' && isFinite(t) && t >= -30 && t <= 30);

    if (!tones.length) {
      return new Response(
        JSON.stringify({ error: 'no valid tones' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } },
      );
    }

    const raw    = redis ? await redis.get(redisKey) : null;
    let stats    = raw ?? { ...EMPTY_STATS };

    for (const t of tones) {
      stats = welfordUpdate(stats, t);
    }

    if (redis) {
      await redis.set(redisKey, stats, { ex: TTL_SECS });
    }

    const { mean, stdDev } = welfordStats(stats);
    return new Response(
      JSON.stringify({ mean, stdDev, count: stats.n }),
      { headers: { 'Content-Type': 'application/json', ...CORS } },
    );
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
