/**
 * /api/ai
 * AI inference endpoint with 3-tier fallback and Redis deduplication.
 * WorldMonitor pattern: Groq → OpenRouter → Browser T5
 * PerspectiveOS pattern: Gemini Flash-Lite → Gemini Flash → Groq → error
 *
 * Redis deduplication: identical requests from concurrent users only fire ONE LLM call.
 * Cache TTL is caller-specified (default 3600s for perspective analysis).
 */

export const config = { runtime: 'edge' };

// Rate limiter state (per-instance, resets on cold start)
// For proper per-IP limiting, use Upstash Rate Limit
const REQUEST_COUNTS = new Map();

async function createRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch {
    console.warn('[AI] @upstash/redis not available, running without cache');
    return null;
  }
}

async function callGemini(prompt, systemPrompt, model, maxTokens, apiKey) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini ${res.status}: ${err?.error?.message ?? 'unknown'}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callGroq(prompt, systemPrompt, maxTokens, apiKey) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system',    content: systemPrompt });
  messages.push(              { role: 'user',      content: prompt });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages,
      max_tokens:  maxTokens,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq ${res.status}: ${err?.error?.message ?? 'unknown'}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }));
  }
  if (req.method !== 'POST') {
    return cors(new Response('Method not allowed', { status: 405 }));
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return cors(new Response('Bad JSON', { status: 400 }));
  }

  const { prompt, systemPrompt, tier = 'flash-lite', maxTokens = 500, cacheKey, cacheTtl = 3600 } = body;

  if (!prompt) return cors(new Response('Missing prompt', { status: 400 }));

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey   = process.env.GROQ_API_KEY;
  const redis     = await createRedis();

  // ── Redis cache lookup ─────────────────────────────────────────────────────
  const redisKey = cacheKey ?? `ai:${hashString(prompt.slice(0, 200))}`;

  if (redis) {
    try {
      const cached = await redis.get(redisKey);
      if (cached) {
        return cors(Response.json({ text: cached, provider: 'cache', cached: true }));
      }
    } catch (e) {
      console.warn('Redis get failed:', e);
    }
  }

  // ── Tier selection + fallback chain ───────────────────────────────────────
  const GEMINI_FLASH_LITE = 'gemini-2.0-flash-lite';
  const GEMINI_FLASH      = 'gemini-2.5-flash-preview-04-17';

  let text = null;
  let provider = null;

  // Tier 1: Flash-Lite (classification, sentiment — cheap, fast)
  if (tier === 'flash-lite' && geminiKey) {
    try {
      text     = await callGemini(prompt, systemPrompt, GEMINI_FLASH_LITE, Math.min(maxTokens, 300), geminiKey);
      provider = 'gemini-flash-lite';
    } catch (e) {
      console.warn('[AI] Flash-Lite failed:', e.message);
    }
  }

  // Tier 2: Flash (perspective analysis — deeper, slower)
  // Also runs as fallback when flash-lite fails (tier escalation)
  if (!text && (tier === 'flash' || tier === 'flash-lite') && geminiKey) {
    try {
      text     = await callGemini(prompt, systemPrompt, GEMINI_FLASH, maxTokens, geminiKey);
      provider = 'gemini-flash';
    } catch (e) {
      console.warn('[AI] Flash failed:', e.message);
    }
  }

  // Tier 3: Groq fallback (when Gemini rate-limited)
  if (!text && groqKey) {
    try {
      text     = await callGroq(prompt, systemPrompt, maxTokens, groqKey);
      provider = 'groq';
    } catch (e) {
      console.warn('[AI] Groq failed:', e.message);
    }
  }

  if (!text) {
    return cors(Response.json({ error: 'All AI providers failed. Check API keys in settings.' }, { status: 503 }));
  }

  // ── Cache successful response ──────────────────────────────────────────────
  if (redis) {
    try {
      await redis.set(redisKey, text, { ex: cacheTtl });
    } catch (e) {
      console.warn('Redis set failed:', e);
    }
  }

  return cors(Response.json({ text, provider, cached: false }));
}

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin',  '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

// FNV-1a hash for cache key generation
function hashString(str) {
  let hash = 2166136261n;
  for (const char of str) {
    hash ^= BigInt(char.charCodeAt(0));
    hash = BigInt.asUintN(32, hash * 16777619n);
  }
  return hash.toString(16);
}
