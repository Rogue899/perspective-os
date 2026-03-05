/**
 * /api/acled
 * ACLED Armed Conflict Location & Event Data
 * Free with academic registration at acleddata.com
 * 30-day rolling window, 10-minute Redis cache (WorldMonitor TTL)
 */

import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const CACHE_KEY = 'acled:30d';
const CACHE_TTL = 600; // 10 min

export default async function handler(req) {
  if (req.method === 'OPTIONS') return corsOk();

  const { ACLED_EMAIL, ACLED_ACCESS_TOKEN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  if (!ACLED_EMAIL || !ACLED_ACCESS_TOKEN) {
    return cors(Response.json({ error: 'ACLED credentials not configured', events: [] }, { status: 200 }));
  }

  // Redis cache
  let redis = null;
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
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
