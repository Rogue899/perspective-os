/**
 * /api/newsdata
 * Optional NewsData.io fallback/enrichment endpoint.
 * Requires NEWSDATA_API_KEY in env.
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }
  if (req.method !== 'GET') {
    return withCors(new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    return withCors(Response.json({ articles: [], disabled: true, reason: 'NEWSDATA_API_KEY missing' }));
  }

  const url = new URL(req.url);
  const topic = (url.searchParams.get('topic') || '').trim();
  const language = (url.searchParams.get('language') || 'en').trim();
  const size = Math.min(Math.max(Number(url.searchParams.get('size') || '20'), 1), 50);

  const upstream = new URL('https://newsdata.io/api/1/news');
  upstream.searchParams.set('apikey', apiKey);
  upstream.searchParams.set('language', language);
  upstream.searchParams.set('size', String(size));
  upstream.searchParams.set('q', topic || 'world geopolitics');

  try {
    const res = await fetch(upstream.toString(), {
      headers: { 'User-Agent': 'PerspectiveOS/1.0 NewsData Adapter' },
      cf: { cacheTtl: 120, cacheEverything: true },
    });

    if (!res.ok) {
      const body = await res.text();
      return withCors(Response.json({
        articles: [],
        error: `NewsData upstream ${res.status}`,
        detail: body.slice(0, 400),
      }, { status: 502 }));
    }

    const data = await res.json();
    const items = Array.isArray(data?.results) ? data.results : [];
    const articles = items.map((item) => ({
      title: item?.title ?? '',
      description: item?.description ?? item?.content ?? '',
      url: item?.link ?? '',
      sourceName: item?.source_name ?? item?.source_id ?? 'NewsData',
      sourceId: item?.source_id ?? 'newsdata',
      publishedAt: item?.pubDate ?? item?.pubDateTZ ?? new Date().toISOString(),
    })).filter(a => a.title && a.url);

    return withCors(Response.json({ articles, disabled: false }));
  } catch (err) {
    return withCors(Response.json({ articles: [], error: String(err) }, { status: 502 }));
  }
}

function withCors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
