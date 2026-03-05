/**
 * /api/finance
 * Financial data proxy — Yahoo Finance + CoinGecko (both free, no key).
 * Proxies to bypass CORS restrictions from client-side requests.
 *
 * Endpoints:
 *   GET /api/finance?type=quotes          → major indices + commodities
 *   GET /api/finance?type=crypto          → BTC, ETH, SOL, XRP
 *   GET /api/finance?type=quote&symbol=AAPL → single ticker
 *   GET /api/finance?type=polymarket      → top geopolitical prediction markets
 */

export const config = { runtime: 'edge' };

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const COINGECKO  = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&sparkline=false&price_change_percentage=24h';
const POLYMARKET = 'https://gamma-api.polymarket.com/markets?limit=10&active=true&closed=false&tag_slug=geopolitics';

// Default market watchlist
const DEFAULT_SYMBOLS = [
  '^GSPC',   // S&P 500
  '^DJI',    // Dow Jones
  '^IXIC',   // NASDAQ
  '^VIX',    // Volatility Index
  'GC=F',    // Gold futures
  'CL=F',    // Crude Oil futures
  'NG=F',    // Natural Gas
  'DX-Y.NYB', // US Dollar index
];

async function fetchYahoo(symbol) {
  const res = await fetch(`${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  return {
    symbol,
    name:          meta.longName ?? meta.shortName ?? symbol,
    price:         meta.regularMarketPrice ?? null,
    prev:          meta.chartPreviousClose ?? meta.previousClose ?? null,
    change:        meta.regularMarketPrice && meta.chartPreviousClose
                    ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100)
                    : null,
    currency:      meta.currency ?? 'USD',
    marketState:   meta.marketState ?? 'CLOSED',
    timestamp:     meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    });
  }

  const url  = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'quotes';
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    if (type === 'quotes') {
      const results = await Promise.allSettled(DEFAULT_SYMBOLS.map(fetchYahoo));
      const quotes  = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      return Response.json({ quotes }, { headers: { ...cors, 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } });
    }

    if (type === 'quote') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) return Response.json({ error: 'Missing symbol' }, { status: 400, headers: cors });
      const quote = await fetchYahoo(symbol);
      return Response.json({ quote }, { headers: { ...cors, 'Cache-Control': 'public, s-maxage=60' } });
    }

    if (type === 'crypto') {
      const ids = url.searchParams.get('ids') ?? 'bitcoin,ethereum,solana,ripple';
      const res = await fetch(`${COINGECKO}&ids=${ids}`, {
        headers: { 'User-Agent': 'PerspectiveOS/1.0' },
      });
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const data = await res.json();
      return Response.json({ crypto: data }, { headers: { ...cors, 'Cache-Control': 'public, s-maxage=60' } });
    }

    if (type === 'polymarket') {
      const res = await fetch(POLYMARKET, {
        headers: { 'User-Agent': 'PerspectiveOS/1.0', Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Polymarket ${res.status}`);
      const data = await res.json();
      return Response.json({ markets: data }, { headers: { ...cors, 'Cache-Control': 'public, s-maxage=120' } });
    }

    return Response.json({ error: 'Unknown type' }, { status: 400, headers: cors });

  } catch (err) {
    console.error('[Finance]', err);
    return Response.json({ error: String(err) }, { status: 502, headers: cors });
  }
}
