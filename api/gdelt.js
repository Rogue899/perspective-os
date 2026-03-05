/**
 * /api/gdelt
 * GDELT v2 proxy — completely free, no API key.
 * Bypasses CORS. Caches 15min (GDELT updates every 15min anyway).
 * Supports both /doc (article list/tone) and /geo (point data) endpoints.
 */

const GDELT_DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_GEO = 'https://api.gdeltproject.org/api/v2/geo/geo';
const CACHE_TTL = 900; // 15 min — matches GDELT update cycle

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return corsOk();

  const url   = new URL(req.url);
  const path  = url.pathname; // /api/gdelt/doc or /api/gdelt/geo
  const params = url.searchParams;

  // Force JSON output and safety
  params.set('format', 'json');

  const isGeo     = path.endsWith('/geo');
  const upstream  = isGeo ? GDELT_GEO : GDELT_DOC;
  const targetUrl = `${upstream}?${params.toString()}`;

  try {
    const res = await fetch(targetUrl, {
      headers: { 'User-Agent': 'PerspectiveOS/1.0' },
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
    });

    if (!res.ok) throw new Error(`GDELT upstream ${res.status}`);
    const data = await res.text();

    return new Response(data, {
      headers: {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               `public, s-maxage=${CACHE_TTL}`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), articles: [], features: [] }), {
      status: 502,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

function corsOk() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
