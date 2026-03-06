/**
 * /api/rss-proxy
 * Server-side RSS fetcher — same pattern as WorldMonitor's rss-relay.
 * - Bypasses CORS for client-side RSS parsing
 * - Adds ETag / If-Modified-Since conditional GET (WorldMonitor feat #625)
 * - Domain allowlist prevents abuse
 * - Returns raw XML
 */

const ALLOWED_DOMAINS = [
  'feeds.bbci.co.uk', 'www.aljazeera.com', 'www.france24.com',
  'rss.dw.com', 'moxie.foxnews.com', 'feeds.reuters.com',
  'www.rt.com', 'tass.com', 'www.cgtn.com', 'www.scmp.com',
  'www.arabnews.com', 'www.middleeasteye.net', 'www.haaretz.com',
  'www.timesofisrael.com', 'www.presstv.ir', 'www.bellingcat.com',
  'theintercept.com', 'www.thehindu.com', 'nypost.com',
  // Fixed/new sources
  'news.yahoo.com',        // Reuters/Yahoo RSS world feed
  'news.google.com',       // Google News RSS
  'www.theguardian.com',   // The Guardian (replaces AP rsshub)
  'english.news.cn',       // Xinhua English
  'www.xinhuanet.com',     // Xinhua alternate domain
  'www.jpost.com',         // Jerusalem Post (replaces paywalled Haaretz)
  'www.alarabiya.net',     // Al Arabiya
  'english.alarabiya.net', // Al Arabiya English subdomain
  'www.globaltimes.cn',    // Global Times (Chinese state, hawkish perspective)
  'rss.chinadaily.com.cn', // China Daily RSS
  'www.channelnewsasia.com', // CNA — Singapore, good Asia/MENA coverage
  'www.al-monitor.com',    // Al-Monitor — Middle East specialist
  'feeds.npr.org',         // NPR World
  'nitter.net',            // X/Twitter mirror RSS
  'www.reddit.com',        // Reddit community/local feeds
  'www.mtv.com.lb',        // MTV Lebanon local feed
  'www.the961.com',        // The 961 — English-language Lebanese news portal
  // EU / country sources
  'www.rfi.fr',            // RFI — Radio France Internationale (English)
  'www.spiegel.de',        // Der Spiegel International (Germany)
  'feeds.skynews.com',     // Sky News UK world feed
  'www.ansa.it',           // ANSA — Italian national wire service
  'kyivindependent.com',   // Kyiv Independent (Ukraine English)
  'notesfrompoland.com',   // Notes from Poland
  'www.politico.eu',       // Politico Europe
  'euobserver.com',        // EUobserver
  'mg.co.za',              // Mail & Guardian (South Africa)
  'allafrica.com',         // AllAfrica aggregator
  'www.whitehouse.gov',    // U.S. White House
  'www.gov.uk',            // UK government feeds
  'rsshub.app',            // RSSHub public instance
  'rsshub.rssforever.com', // RSSHub mirror
];

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url param' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Domain allowlist check
  let hostname;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400 });
  }

  if (!ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
    return new Response(JSON.stringify({ error: 'Domain not allowed' }), { status: 403 });
  }

  // Conditional GET — forward client's ETag/If-Modified-Since headers
  const forwardHeaders = { 'User-Agent': 'PerspectiveOS/1.0 RSS Reader' };
  const etag = req.headers.get('if-none-match');
  const modified = req.headers.get('if-modified-since');
  if (etag)     forwardHeaders['If-None-Match']     = etag;
  if (modified) forwardHeaders['If-Modified-Since'] = modified;

  try {
    const upstream = await fetch(targetUrl, {
      headers: forwardHeaders,
      cf: { cacheTtl: 300, cacheEverything: true }, // Cloudflare edge cache 5min
    });

    if (upstream.status === 304) {
      return new Response(null, {
        status: 304,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const body = await upstream.text();

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type':                'application/xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, s-maxage=300',
        'ETag':                        upstream.headers.get('etag') ?? '',
        'Last-Modified':               upstream.headers.get('last-modified') ?? '',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
