/**
 * /api/acled
 * ACLED Armed Conflict Location & Event Data
 * Free with academic registration at acleddata.com
 *
 * Auth: OAuth2 Bearer token (new API, May 2025)
 *   POST https://acleddata.com/oauth/token  →  access_token (24h)
 *   Token cached in Redis for 23h to avoid repeat logins.
 *
 * Events cache: 10-minute Redis TTL (WorldMonitor pattern)
 */

export const config = { runtime: 'edge' };

const TOKEN_CACHE_KEY  = 'acled:oauth:token';
const EVENT_CACHE_KEY  = 'acled:30d';
const TOKEN_TTL = 82800;  // 23h (token valid 24h)
const EVENT_TTL = 600;    // 10 min

// ── Redis helper ─────────────────────────────────────────────────────────────
async function getRedis(url, token) {
  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

// ── OAuth: fetch fresh Bearer token from ACLED ────────────────────────────────
async function fetchAcledToken(email, password) {
  const body = new URLSearchParams({
    username:   email,
    password:   password,
    grant_type: 'password',
    client_id:  'acled',
  });
  const res = await fetch('https://acleddata.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!res.ok) throw new Error(`ACLED OAuth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('ACLED OAuth: no access_token in response');
  return data.access_token;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return corsOk();

  const {
    ACLED_EMAIL,
    ACLED_PASSWORD,
    UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN,
  } = process.env;

  if (!ACLED_EMAIL || !ACLED_PASSWORD) {
    return cors(Response.json({ error: 'ACLED credentials not configured', events: [] }, { status: 200 }));
  }

  // ── Redis setup ──────────────────────────────────────────────────────────
  let redis = null;
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    redis = await getRedis(UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN);
  }

  // ── Check event cache ────────────────────────────────────────────────────
  if (redis) {
    try {
      const cached = await redis.get(EVENT_CACHE_KEY);
      if (cached) return cors(Response.json({ events: cached, cached: true }));
    } catch {}
  }

  // ── Get OAuth token (cached → fresh) ────────────────────────────────────
  let bearerToken = null;
  if (redis) {
    try { bearerToken = await redis.get(TOKEN_CACHE_KEY); } catch {}
  }
  if (!bearerToken) {
    bearerToken = await fetchAcledToken(ACLED_EMAIL, ACLED_PASSWORD);
    if (redis) {
      try { await redis.set(TOKEN_CACHE_KEY, bearerToken, { ex: TOKEN_TTL }); } catch {}
    }
  }

  // ── Build 30-day window ──────────────────────────────────────────────────
  const today = new Date();
  const ago30 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt   = (d) => d.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    _format:          'json',
    event_date:       `${fmt(ago30)}|${fmt(today)}`,
    event_date_where: 'BETWEEN',
    fields:           'event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|location|latitude|longitude|fatalities|notes',
    limit:            '500',
  });

  try {
    const res = await fetch(`https://acleddata.com/api/acled/read?${params}`, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type':  'application/json',
      },
    });
    if (!res.ok) throw new Error(`ACLED ${res.status}`);
    const data = await res.json();

    const events = (data.data ?? []).map(e => ({
      id:         e.event_id_cnty,
      date:       e.event_date,
      eventType:  e.event_type,
      subType:    e.sub_event_type,
      actor1:     e.actor1,
      actor2:     e.actor2,
      country:    e.country,
      location:   e.location,
      lat:        parseFloat(e.latitude),
      lng:        parseFloat(e.longitude),
      fatalities: parseInt(e.fatalities ?? '0', 10),
      notes:      e.notes?.slice(0, 300),
      source:     'acled',
    })).filter(e => !isNaN(e.lat) && !isNaN(e.lng));

    if (redis) {
      try { await redis.set(EVENT_CACHE_KEY, events, { ex: EVENT_TTL }); } catch {}
    }

    return cors(Response.json({ events, cached: false }));
  } catch (err) {
    return cors(Response.json({ error: String(err), events: [] }, { status: 502 }));
  }
}

const cors = (res) => {
  res.headers.set('Access-Control-Allow-Origin', '*');
  return res;
};
const corsOk = () => new Response(null, {
  status:  204,
  headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
});


const CACHE_KEY = 'acled:30d';
const CACHE_TTL = 600; // 10 min

async function getRedis(url, token) {
  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return corsOk();

  const { ACLED_EMAIL, ACLED_ACCESS_TOKEN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  if (!ACLED_EMAIL || !ACLED_ACCESS_TOKEN) {
    return cors(Response.json({ error: 'ACLED credentials not configured', events: [] }, { status: 200 }));
  }

  // Redis cache
  let redis = null;
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    redis = await getRedis(UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN);
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return cors(Response.json({ events: cached, cached: true }));
    } catch {}
  }

  // Build 30-day window
  const today = new Date();
  const ago30 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt   = (d) => d.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    email:       ACLED_EMAIL,
    access_key:  ACLED_ACCESS_TOKEN,
    event_date:  `${fmt(ago30)}|${fmt(today)}`,
    event_date_where: 'BETWEEN',
    fields:      'event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|location|latitude|longitude|fatalities|notes',
    limit:       '500',
    format:      'json',
  });

  try {
    const res = await fetch(`https://api.acleddata.com/acled/read?${params}`);
    if (!res.ok) throw new Error(`ACLED ${res.status}`);
    const data = await res.json();

    const events = (data.data ?? []).map(e => ({
      id:        e.event_id_cnty,
      date:      e.event_date,
      eventType: e.event_type,
      subType:   e.sub_event_type,
      actor1:    e.actor1,
      actor2:    e.actor2,
      country:   e.country,
      location:  e.location,
      lat:       parseFloat(e.latitude),
      lng:       parseFloat(e.longitude),
      fatalities: parseInt(e.fatalities ?? '0', 10),
      notes:     e.notes?.slice(0, 300),
      source:    'acled',
    })).filter(e => !isNaN(e.lat) && !isNaN(e.lng));

    if (redis) {
      try { await redis.set(CACHE_KEY, events, { ex: CACHE_TTL }); } catch {}
    }

    return cors(Response.json({ events, cached: false }));
  } catch (err) {
    return cors(Response.json({ error: String(err), events: [] }, { status: 502 }));
  }
}

const cors = (res) => {
  res.headers.set('Access-Control-Allow-Origin', '*');
  return res;
};
const corsOk = () => new Response(null, {
  status: 204,
  headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
});
