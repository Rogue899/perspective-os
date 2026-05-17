/**
 * /api/embed
 * Gemini text-embedding-004 — 1,500 RPD free
 * Used for semantic story clustering (upgrade from Jaccard similarity)
 * Redis-cached to minimize quota usage
 */

export const config = { runtime: 'edge' };

import { getRequestIntegrationSettings, SETTINGS_ACCESS_CONTROL_HEADERS } from './_lib/request-settings.js';

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

  const settings = getRequestIntegrationSettings(req);
  if (!settings.geminiKey) return withCors(Response.json({ embedding: [] }));

  // Cache by first 100 chars of text
  const cacheKey = `embed:${text.slice(0, 100)}`;
  let redis = null;

  if (settings.upstashUrl && settings.upstashToken) {
    redis = await getRedis(settings.upstashUrl, settings.upstashToken);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return withCors(Response.json({ embedding: cached, cached: true }));
    } catch {}
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${settings.geminiKey}`,
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

    return withCors(Response.json({ embedding, cached: false }));
  } catch (err) {
    return withCors(Response.json({ error: String(err), embedding: [] }, { status: 502 }));
  }
}

function withCors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', SETTINGS_ACCESS_CONTROL_HEADERS);
  return res;
}
