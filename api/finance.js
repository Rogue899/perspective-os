/**
 * /api/finance
 * Financial data proxy — Yahoo Finance + CoinGecko + MarketStack.
 * Proxies to bypass CORS restrictions from client-side requests.
 *
 * Endpoints:
 *   GET /api/finance?type=quotes               → major indices + commodities (Yahoo)
 *   GET /api/finance?type=crypto               → BTC, ETH, SOL, XRP (CoinGecko)
 *   GET /api/finance?type=quote&symbol=AAPL    → single ticker (Yahoo)
 *   GET /api/finance?type=polymarket           → top geopolitical prediction markets
 *   GET /api/finance?type=eod&symbol=AAPL      → end-of-day OHLCV via MarketStack
 *   GET /api/finance?type=eod&symbols=AAPL,MSFT → batch EOD (up to 5 symbols)
 *   GET /api/finance?type=fx&base=USD          → FX rates via MarketStack
 *   GET /api/finance?type=search&q=Apple       → ticker search via MarketStack
 */

export const config = { runtime: 'edge' };

const YAHOO_BASE    = 'https://query1.finance.yahoo.com/v8/finance/chart';
const COINGECKO     = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&sparkline=false&price_change_percentage=24h';
const POLYMARKET    = 'https://gamma-api.polymarket.com/markets?limit=10&active=true&closed=false&tag_slug=geopolitics';
const MARKETSTACK   = 'https://api.marketstack.com/v2';

// FX pairs to track
const FX_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCNY', 'USDRUB', 'USDSAU', 'USDTRY'];

// Default market watchlist
const DEFAULT_SYMBOLS = [
  '^GSPC',    // S&P 500
  '^DJI',     // Dow Jones
  '^IXIC',    // NASDAQ
  '^VIX',     // Volatility Index
  'GC=F',     // Gold futures
  'SI=F',     // Silver futures
  'PL=F',     // Platinum futures
  'HG=F',     // Copper futures
  'CL=F',     // Crude Oil (WTI)
  'BZ=F',     // Brent Crude
  'NG=F',     // Natural Gas
  'ZW=F',     // Wheat futures
  'DX-Y.NYB', // US Dollar index
];

// FRED series IDs → label mapping (all free, no key required for CSV)
const FRED_SERIES = {
  FEDFUNDS:  'Fed Funds Rate',
  T10YIE:    '10Y Breakeven Inflation',
  DGS10:     '10Y Treasury Yield',
  CPIAUCSL:  'CPI (Inflation)',
  UNRATE:    'Unemployment Rate',
  DEXUSEU:   'EUR/USD',
  GOLDAMGBD228NLBM: 'Gold (London Fix)',
};

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

    // ── FRED: Economic indicators (St. Louis Fed — completely free) ───────────
    if (type === 'fred') {
      const seriesId = url.searchParams.get('series') ?? 'FEDFUNDS';
      // FRED CSV endpoint — no API key needed for recent observations
      const fredUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
      const res = await fetch(fredUrl, { headers: { 'User-Agent': 'PerspectiveOS/1.0' } });
      if (!res.ok) throw new Error(`FRED ${res.status}`);
      const csv = await res.text();
      const lines = csv.trim().split('\n').slice(1); // skip header
      // Return last 12 observations
      const observations = lines.slice(-12).map(line => {
        const [date, value] = line.split(',');
        return { date: date?.trim(), value: value?.trim() === '.' ? null : Number(value?.trim()) };
      }).filter(o => o.date);
      const label = FRED_SERIES[seriesId] ?? seriesId;
      return Response.json({ series: seriesId, label, observations }, {
        headers: { ...cors, 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
      });
    }

    // ── FRED: All key indicators in one call ──────────────────────────────────
    if (type === 'fred_all') {
      const results = await Promise.allSettled(
        Object.keys(FRED_SERIES).map(async id => {
          const fredUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
          const res = await fetch(fredUrl, { headers: { 'User-Agent': 'PerspectiveOS/1.0' } });
          if (!res.ok) return null;
          const csv = await res.text();
          const lines = csv.trim().split('\n').slice(1);
          const last2 = lines.slice(-2).map(l => {
            const [date, value] = l.split(',');
            return { date: date?.trim(), value: value?.trim() === '.' ? null : Number(value?.trim()) };
          });
          const latest = last2[last2.length - 1];
          const prev    = last2.length > 1 ? last2[0] : null;
          const change  = (latest?.value != null && prev?.value != null)
            ? ((latest.value - prev.value) / Math.abs(prev.value) * 100) : null;
          return { id, label: FRED_SERIES[id], latest: latest?.value, date: latest?.date, change };
        })
      );
      const indicators = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      return Response.json({ indicators }, {
        headers: { ...cors, 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
      });
    }

    // ── MarketStack: EOD data for one or multiple symbols ─────────────────────
    if (type === 'eod') {
      const msKey = process.env.MARKETSTACK_API_KEY;
      if (!msKey) return Response.json({ error: 'MarketStack key not configured' }, { status: 503, headers: cors });

      const symbolParam = url.searchParams.get('symbols') ?? url.searchParams.get('symbol') ?? 'AAPL';
      const symbols = symbolParam.split(',').slice(0, 5).join(','); // cap at 5
      const limit = url.searchParams.get('limit') ?? '30';

      const msUrl = `${MARKETSTACK}/eod?access_key=${msKey}&symbols=${encodeURIComponent(symbols)}&limit=${limit}`;
      const res = await fetch(msUrl, { headers: { 'User-Agent': 'PerspectiveOS/1.0' } });
      if (!res.ok) throw new Error(`MarketStack EOD ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`MarketStack: ${data.error.message ?? JSON.stringify(data.error)}`);
      return Response.json({ eod: data.data ?? [] }, {
        headers: { ...cors, 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
      });
    }

    // ── MarketStack: latest intraday / real-time quote ────────────────────────
    if (type === 'ms_quote') {
      const msKey = process.env.MARKETSTACK_API_KEY;
      if (!msKey) return Response.json({ error: 'MarketStack key not configured' }, { status: 503, headers: cors });

      const symbol = url.searchParams.get('symbol');
      if (!symbol) return Response.json({ error: 'Missing symbol' }, { status: 400, headers: cors });

      const msUrl = `${MARKETSTACK}/eod/latest?access_key=${msKey}&symbols=${encodeURIComponent(symbol)}`;
      const res = await fetch(msUrl, { headers: { 'User-Agent': 'PerspectiveOS/1.0' } });
      if (!res.ok) throw new Error(`MarketStack quote ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`MarketStack: ${data.error.message ?? JSON.stringify(data.error)}`);
      const entry = data.data?.[0] ?? null;
      return Response.json({ quote: entry }, {
        headers: { ...cors, 'Cache-Control': 'public, s-maxage=300' },
      });
    }

    // ── MarketStack: FX rates ─────────────────────────────────────────────────
    if (type === 'fx') {
      const msKey = process.env.MARKETSTACK_API_KEY;
      if (!msKey) return Response.json({ error: 'MarketStack key not configured' }, { status: 503, headers: cors });

      const symbols = url.searchParams.get('symbols') ?? FX_SYMBOLS.join(',');
      const msUrl = `${MARKETSTACK}/eod/latest?access_key=${msKey}&symbols=${encodeURIComponent(symbols)}`;
      const res = await fetch(msUrl, { headers: { 'User-Agent': 'PerspectiveOS/1.0' } });
      if (!res.ok) throw new Error(`MarketStack FX ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`MarketStack: ${data.error.message ?? JSON.stringify(data.error)}`);
      return Response.json({ fx: data.data ?? [] }, {
        headers: { ...cors, 'Cache-Control': 'public, s-maxage=1800' },
      });
    }

    // ── MarketStack: ticker search ────────────────────────────────────────────
    if (type === 'search') {
      const msKey = process.env.MARKETSTACK_API_KEY;
      if (!msKey) return Response.json({ error: 'MarketStack key not configured' }, { status: 503, headers: cors });

      const q = url.searchParams.get('q');
      if (!q) return Response.json({ error: 'Missing q' }, { status: 400, headers: cors });

      const msUrl = `${MARKETSTACK}/tickers?access_key=${msKey}&search=${encodeURIComponent(q)}&limit=10`;
      const res = await fetch(msUrl, { headers: { 'User-Agent': 'PerspectiveOS/1.0' } });
      if (!res.ok) throw new Error(`MarketStack search ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`MarketStack: ${data.error.message ?? JSON.stringify(data.error)}`);
      return Response.json({ tickers: data.data ?? [] }, {
        headers: { ...cors, 'Cache-Control': 'public, s-maxage=86400' },
      });
    }

    return Response.json({ error: 'Unknown type' }, { status: 400, headers: cors });

  } catch (err) {
    console.error('[Finance]', err);
    return Response.json({ error: String(err) }, { status: 502, headers: cors });
  }
}
