/**
 * Local dev server — mimics Vercel edge functions for `npm run dev`
 * Runs on port 3001; Vite proxies /api/* here.
 * Usage: node dev-server.mjs  (started automatically by `npm run dev`)
 */
import http from 'http';
import { URL } from 'url';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env and .env.local into process.env (mirrors what Vite does for VITE_* vars,
// but here we need all vars server-side — keys like GEMINI_API_KEY, GROQ_API_KEY, etc.)
const __dir = dirname(fileURLToPath(import.meta.url));
function loadEnvFile(filename, override = false) {
  const p = resolve(__dir, filename);
  if (!existsSync(p)) return;
  const lines = readFileSync(p, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && val && (override || !process.env[key])) process.env[key] = val;
  }
}
loadEnvFile('.env');
loadEnvFile('.env.local', true); // .env.local overrides .env

const PORT = 3001;

function readIntegrationHeader(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function getRequestIntegrationSettings(req) {
  return {
    geminiKey: readIntegrationHeader(req, 'x-pos-gemini-key') || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '',
    groqKey: readIntegrationHeader(req, 'x-pos-groq-key') || process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || '',
    marketstackKey: readIntegrationHeader(req, 'x-pos-marketstack-key') || process.env.MARKETSTACK_API_KEY || '',
    newsdataKey: readIntegrationHeader(req, 'x-pos-newsdata-key') || process.env.NEWSDATA_API_KEY || process.env.VITE_NEWSDATA_API_KEY || '',
  };
}

function loadAllowedDomains() {
  const manualDomains = [
    'news.google.com',
    'nitter.net',
    'www.reddit.com',
    'rsshub.app',
    'rsshub.rssforever.com',
  ];

  const configPath = resolve(__dir, 'src/config/sources.ts');
  const domains = new Set(manualDomains);

  if (!existsSync(configPath)) return [...domains];

  const sourceConfig = readFileSync(configPath, 'utf8');
  const matches = sourceConfig.matchAll(/rss:\s*'\/api\/rss-proxy\?url=(https:\/\/[^']+?)&id=/g);

  for (const match of matches) {
    try {
      domains.add(new URL(match[1]).hostname);
    } catch {
      // Ignore malformed or non-URL entries.
    }
  }

  return [...domains];
}

const ALLOWED_DOMAINS = loadAllowedDomains();

async function handleRssProxy(req, res, params) {
  const targetUrl = params.get('url');
  if (!targetUrl) {
    res.writeHead(400, cors()); res.end(JSON.stringify({ error: 'Missing url' })); return;
  }
  let hostname;
  try { hostname = new URL(targetUrl).hostname; } catch {
    res.writeHead(400, cors()); res.end(JSON.stringify({ error: 'Invalid URL' })); return;
  }
  if (!ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
    res.writeHead(403, cors()); res.end(JSON.stringify({ error: 'Domain not allowed: ' + hostname })); return;
  }
  try {
    const upstream = await fetch(targetUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PerspectiveOS/1.0 RSS Reader)',
        'Accept': 'application/rss+xml, application/xml, application/atom+xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(10000),
    });
    const body = await upstream.text();
    res.writeHead(upstream.status, {
      ...cors(),
      'Content-Type': upstream.headers.get('content-type') || 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    });
    res.end(body);
  } catch (err) {
    console.error('[rss-proxy] Error:', err.message);
    res.writeHead(502, cors()); res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleGdelt(req, res, params) {
  const endpoint = params.get('endpoint') || 'doc';
  const query = params.get('query') || '';
  const mode  = params.get('mode')  || 'artlist';
  const maxrecords = params.get('maxrecords') || '20';
  const format = 'json';

  let gdeltUrl;
  if (endpoint === 'geo') {
    gdeltUrl = `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(query)}&mode=pointdata&format=json`;
  } else {
    gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=${mode}&maxrecords=${maxrecords}&format=${format}&sort=DateDesc`;
  }

  try {
    const r = await fetch(gdeltUrl, { signal: AbortSignal.timeout(10000) });
    const body = await r.text();
    res.writeHead(r.status, { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
    res.end(body);
  } catch (err) {
    res.writeHead(502, cors()); res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleAI(req, res) {
  const body = await readBody(req);
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = {}; }

  const settings = getRequestIntegrationSettings(req);
  const GEMINI_KEY = settings.geminiKey;
  const GROQ_KEY   = settings.groqKey;

  if (!GEMINI_KEY && !GROQ_KEY) {
    // No keys configured — return stub so UI still renders without crashing
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: '{}', provider: 'none', cached: false }));
    return;
  }

  // Tier 1: Groq (fast, good for dev)
  if (GROQ_KEY) {
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            ...(parsed.systemPrompt ? [{ role: 'system', content: parsed.systemPrompt }] : []),
            { role: 'user', content: parsed.prompt },
          ],
          max_tokens: parsed.maxTokens || 800,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await groqRes.json();
      const text = data.choices?.[0]?.message?.content ?? '{}';
      res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text, provider: 'groq', cached: false }));
      return;
    } catch (e) {
      console.warn('[ai] Groq failed:', e.message);
    }
  }

  // Tier 2: Gemini (flash-lite for classify, flash for perspective analysis)
  if (GEMINI_KEY) {
    const tier  = parsed.tier || 'flash';
    const model = tier === 'flash-lite' ? 'gemini-2.0-flash-lite' : 'gemini-2.5-flash';
    try {
      const gemRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: parsed.prompt }] }],
            ...(parsed.systemPrompt ? { systemInstruction: { parts: [{ text: parsed.systemPrompt }] } } : {}),
            generationConfig: { maxOutputTokens: parsed.maxTokens || 800, temperature: 0.2 },
          }),
          signal: AbortSignal.timeout(25000),
        }
      );
      if (!gemRes.ok) {
        const err = await gemRes.json().catch(() => ({}));
        throw new Error(`Gemini ${gemRes.status}: ${err?.error?.message ?? 'unknown'}`);
      }
      const data = await gemRes.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text, provider: `gemini-${model}`, cached: false }));
      return;
    } catch (e) {
      console.warn('[ai] Gemini failed:', e.message);
    }
  }

  res.writeHead(503, { ...cors(), 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'All AI providers failed. Check GEMINI_API_KEY or GROQ_API_KEY in .env.local' }));
}

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SYMBOLS = ['^GSPC','^DJI','^IXIC','^VIX','GC=F','SI=F','PL=F','HG=F','CL=F','BZ=F','NG=F','ZW=F','DX-Y.NYB'];
const FRED_SERIES = {
  FEDFUNDS: 'Fed Funds Rate', T10YIE: '10Y Breakeven Inflation', DGS10: '10Y Treasury Yield',
  CPIAUCSL: 'CPI (Inflation)', UNRATE: 'Unemployment Rate',
  DEXUSEU: 'EUR/USD', GOLDAMGBD228NLBM: 'Gold (London Fix)',
};

async function fetchYahooQuote(symbol) {
  const r = await fetch(`${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const json = await r.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  return {
    symbol, name: meta.longName ?? meta.shortName ?? symbol,
    price: meta.regularMarketPrice ?? null,
    prev: meta.chartPreviousClose ?? meta.previousClose ?? null,
    change: meta.regularMarketPrice && meta.chartPreviousClose
      ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100) : null,
    currency: meta.currency ?? 'USD', marketState: meta.marketState ?? 'CLOSED',
  };
}

async function handleFinance(req, res, params) {
  const type = params.get('type') || 'quotes';
  const settings = getRequestIntegrationSettings(req);
  try {
    let data = {};
    if (type === 'crypto') {
      const ids = params.get('ids') || 'bitcoin,ethereum,solana,ripple';
      const r = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=10&page=1`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }
      );
      data = { crypto: r.ok ? await r.json() : [] };
    } else if (type === 'polymarket') {
      const r = await fetch(
        'https://gamma-api.polymarket.com/markets?closed=false&limit=20&order=volume24hr&ascending=false',
        { signal: AbortSignal.timeout(10000) }
      );
      const raw = r.ok ? await r.json() : [];
      data = { markets: raw.map(m => ({ id: m.id, question: m.question, outcomePrices: m.outcomePrices, outcomes: m.outcomes, volume24hr: m.volume24hr || 0 })) };
    } else if (type === 'quotes') {
      const results = await Promise.allSettled(YAHOO_SYMBOLS.map(fetchYahooQuote));
      data = { quotes: results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value) };
    } else if (type === 'fred_all') {
      const results = await Promise.allSettled(
        Object.keys(FRED_SERIES).map(async id => {
          const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, {
            headers: { 'User-Agent': 'PerspectiveOS/1.0' }, signal: AbortSignal.timeout(8000),
          });
          if (!r.ok) return null;
          const csv = await r.text();
          const lines = csv.trim().split('\n').slice(1);
          const last2 = lines.slice(-2).map(l => {
            const [date, value] = l.split(',');
            return { date: date?.trim(), value: value?.trim() === '.' ? null : Number(value?.trim()) };
          });
          const latest = last2[last2.length - 1];
          const prev = last2.length > 1 ? last2[0] : null;
          const change = (latest?.value != null && prev?.value != null)
            ? ((latest.value - prev.value) / Math.abs(prev.value) * 100) : null;
          return { id, label: FRED_SERIES[id], latest: latest?.value, date: latest?.date, change };
        })
      );
      data = { indicators: results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value) };
    } else if (type === 'fx') {
      const msKey = settings.marketstackKey;
      if (!msKey) {
        data = { fx: [], disabled: true, reason: 'MARKETSTACK_API_KEY missing' };
      } else {
        const FX_SYMS = 'EURUSD,GBPUSD,USDJPY,USDCNY,USDTRY';
        const r = await fetch(`https://api.marketstack.com/v2/eod/latest?access_key=${msKey}&symbols=${FX_SYMS}`, {
          headers: { 'User-Agent': 'PerspectiveOS/1.0' }, signal: AbortSignal.timeout(10000),
        });
        const json = r.ok ? await r.json() : { data: [] };
        data = { fx: json.data ?? [] };
      }
    } else if (type === 'eod') {
      const msKey = settings.marketstackKey;
      if (!msKey) {
        data = { eod: [], disabled: true, reason: 'MARKETSTACK_API_KEY missing' };
      } else {
        const symbolParam = params.get('symbols') ?? params.get('symbol') ?? 'AAPL';
        const symbols = symbolParam.split(',').slice(0, 10).join(',');
        const limit = params.get('limit') ?? '2';
        const r = await fetch(`https://api.marketstack.com/v2/eod?access_key=${msKey}&symbols=${encodeURIComponent(symbols)}&limit=${limit}`, {
          headers: { 'User-Agent': 'PerspectiveOS/1.0' }, signal: AbortSignal.timeout(10000),
        });
        const json = r.ok ? await r.json() : { data: [] };
        data = { eod: json.data ?? [] };
      }
    } else {
      data = { quotes: [] };
    }
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(502, cors());
    res.end(JSON.stringify({ error: err.message }));
  }
}

const TG_ALLOWED = ['intelcrab','GeoConfirmed','nexta_tv','wartranslated','militaryland_net','rybar','OSINTdefender','bbcnews','reutersagency','alarabiya_breaking'];

async function handleTelegram(_req, res, params) {
  const channel = (params.get('channel') || '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!channel || !TG_ALLOWED.includes(channel)) {
    res.writeHead(403, cors()); res.end(JSON.stringify({ error: 'Channel not allowed' })); return;
  }
  try {
    const r = await fetch(`https://t.me/s/${channel}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PerspectiveOS/1.0)', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { res.writeHead(502, cors()); res.end(JSON.stringify({ error: `Upstream ${r.status}` })); return; }
    const html = await r.text();
    // Extract post texts via simple regex (same as edge function)
    const texts = [...html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(m => m[1].replace(/<[^>]+>/g,'').replace(/&[a-z]+;/g,' ').trim().slice(0,400));
    const dates = [...html.matchAll(/<time datetime="([^"]+)"/g)].map(m => m[1]);
    const ids   = [...html.matchAll(/data-post="[^\/]+\/(\d+)"/g)].map(m => m[1]);
    const posts = texts.slice(0,15).map((t,i) => ({ id: ids[i]||String(i), text: t, date: dates[i]||new Date().toISOString(), url: `https://t.me/${channel}/${ids[i]||''}` })).filter(p => p.text.length > 10);
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' });
    res.end(JSON.stringify({ channel, posts: posts.reverse().slice(0,12) }));
  } catch (err) {
    res.writeHead(502, cors()); res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleEmbed(req, res) {
  const body = await readBody(req);
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = {}; }

  const settings = getRequestIntegrationSettings(req);
  const GEMINI_KEY = settings.geminiKey;
  if (!GEMINI_KEY) {
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ embedding: [], cached: false }));
    return;
  }
  try {
    const gemRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text: (parsed.text || '').slice(0, 1000) }] } }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!gemRes.ok) throw new Error(`Gemini embed ${gemRes.status}`);
    const data = await gemRes.json();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ embedding: data.embedding?.values ?? [], cached: false }));
  } catch (err) {
    console.warn('[embed] Failed:', err.message);
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ embedding: [], cached: false }));
  }
}

async function handleEonet(_req, res) {
  try {
    const r = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60&days=14', {
      headers: { 'User-Agent': 'PerspectiveOS/1.0 (eonet-proxy)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`EONET upstream ${r.status}`);
    const data = await r.json();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.warn('[eonet] Failed:', err.message);
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events: [] }));
  }
}

async function handleNewsData(req, res, params) {
  const settings = getRequestIntegrationSettings(req);
  const apiKey = settings.newsdataKey;
  if (!apiKey) {
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ articles: [], disabled: true, reason: 'NEWSDATA_API_KEY missing' }));
    return;
  }

  const topic = (params.get('topic') || 'world geopolitics').trim();
  const language = (params.get('language') || 'en').trim();
  const size = Math.min(Math.max(Number(params.get('size') || '20'), 1), 50);

  const upstream = new URL('https://newsdata.io/api/1/news');
  upstream.searchParams.set('apikey', apiKey);
  upstream.searchParams.set('language', language);
  upstream.searchParams.set('size', String(size));
  upstream.searchParams.set('q', topic);

  try {
    const r = await fetch(upstream.toString(), {
      headers: { 'User-Agent': 'PerspectiveOS/1.0 NewsData Adapter' },
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) {
      const body = await r.text();
      res.writeHead(502, { ...cors(), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ articles: [], error: `NewsData upstream ${r.status}`, detail: body.slice(0, 400) }));
      return;
    }

    const data = await r.json();
    const items = Array.isArray(data?.results) ? data.results : [];
    const articles = items.map((item) => ({
      title: item?.title ?? '',
      description: item?.description ?? item?.content ?? '',
      url: item?.link ?? '',
      sourceName: item?.source_name ?? item?.source_id ?? 'NewsData',
      sourceId: item?.source_id ?? 'newsdata',
      publishedAt: item?.pubDate ?? item?.pubDateTZ ?? new Date().toISOString(),
    })).filter(a => a.title && a.url);

    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' });
    res.end(JSON.stringify({ articles, disabled: false }));
  } catch (err) {
    res.writeHead(502, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ articles: [], error: err.message }));
  }
}

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-pos-gemini-key, x-pos-groq-key, x-pos-marketstack-key, x-pos-newsdata-key, x-pos-acled-email, x-pos-acled-password, x-pos-upstash-url, x-pos-upstash-token',
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors()); res.end(); return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const params = url.searchParams;

  console.log(`[dev-api] ${req.method} ${url.pathname}`);

  if (url.pathname === '/api/rss-proxy')      return handleRssProxy(req, res, params);
  if (url.pathname === '/api/gdelt')          return handleGdelt(req, res, params);
  if (url.pathname === '/api/ai')             return handleAI(req, res);
  if (url.pathname === '/api/finance')        return handleFinance(req, res, params);
  if (url.pathname === '/api/telegram-proxy') return handleTelegram(req, res, params);
  if (url.pathname === '/api/embed')          return handleEmbed(req, res);
  if (url.pathname === '/api/eonet')          return handleEonet(req, res);
  if (url.pathname === '/api/newsdata')       return handleNewsData(req, res, params);

  res.writeHead(404, cors());
  res.end(JSON.stringify({ error: 'Not found: ' + url.pathname }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Port already occupied — a previous session is still running. That's fine.
    // Exit 0 so `npm run dev` continues and vite starts with the existing server.
    console.log(`[dev-api] Port ${PORT} already in use — existing server will handle /api/*. OK.`);
    process.exit(0);
  } else {
    console.error('[dev-api] Fatal:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-api] Local API server running on http://localhost:${PORT}`);
  console.log('[dev-api] Proxying: /api/rss-proxy, /api/gdelt, /api/ai, /api/finance');
});
