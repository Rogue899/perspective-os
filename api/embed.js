/**
 * /api/embed
 * Gemini text-embedding-004 — 1,500 RPD free
 * Used for semantic story clustering (upgrade from Jaccard similarity)
 * Redis-cached to minimize quota usage
 */

export const config = { runtime: 'edge' };

async function getRedis(url, token) {
  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const { text } = await req.json().catch(() => ({}));
  if (!text) return Response.json({ error: 'missing text' }, { status: 400 });

  const { GEMINI_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;
  if (!GEMINI_API_KEY) return Response.json({ embedding: [] });

  // Cache by first 100 chars of text
  const cacheKey = `embed:${text.slice(0, 100)}`;
  let redis = null;

  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    redis = await getRedis(UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return Response.json({ embedding: cached, cached: true });
    } catch {}
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text }] } }),
      }
    );

    if (!res.ok) throw new Error(`Gemini embed ${res.status}`);
    const data = await res.json();
    const embedding = data.embedding?.values ?? [];

    if (redis && embedding.length) {
      try { await redis.set(cacheKey, embedding, { ex: 3600 }); } catch {}
    }

    const response = Response.json({ embedding, cached: false });
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  } catch (err) {
    return Response.json({ error: String(err), embedding: [] }, { status: 502 });
  }
}
