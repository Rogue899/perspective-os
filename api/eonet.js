/**
 * /api/eonet
 * Proxies NASA EONET v3 open events API.
 * No API key required for public endpoint.
 * Returns: { events: EONETEvent[] }
 * Caches 5 min at edge.
 */

export const config = { runtime: 'edge' };

const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60&days=14';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      },
    });
  }

  try {
    const res = await fetch(EONET_URL, {
      headers: { 'User-Agent': 'PerspectiveOS/1.0 (eonet-proxy)' },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) throw new Error(`EONET upstream ${res.status}`);

    const data = await res.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=300',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), events: [] }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
