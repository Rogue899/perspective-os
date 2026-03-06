/**
 * Finance Panel — news-driven investment signal analysis
 *
 * Data sources (all free, no API key required):
 * - Yahoo Finance: indices, commodities, forex via /api/finance
 * - CoinGecko: crypto prices
 * - Polymarket: geopolitical prediction markets
 * - Gemini Flash: news→sector impact analysis
 *
 * DISCLAIMER: AI analysis only. NOT financial advice.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle, BarChart2, ExternalLink } from 'lucide-react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

interface Quote {
  symbol: string;
  name: string;
  price: number | null;
  prev: number | null;
  change: number | null;
  currency: string;
  marketState: string;
}

interface CryptoCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
}

interface PolymarketEntry {
  id: string;
  question: string;
  outcomePrices: string;      // JSON string "['0.72','0.28']"
  outcomes: string;           // JSON string "['Yes','No']"
  volume24hr: number;
}

interface SectorSignal {
  sector: string;
  impact: 'positive' | 'negative' | 'neutral';
  reason: string;
  relatedHeadlines: string[];
  confidence: number;
}

type PricePt = { t: string; v: number };

function Sparkline({ data, up }: { data: PricePt[]; up: boolean | null }) {
  if (!data || data.length < 2) return <div className="h-8" />;
  const color = up === null ? '#6b7280' : up ? '#22c55e' : '#ef4444';
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sg-${up}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.2}
          fill={`url(#sg-${up})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ChangeArrow({ change }: { change: number | null }) {
  if (change === null) return <Minus size={11} className="text-gray-400" />;
  if (change > 0)  return <TrendingUp  size={11} className="text-green-400" />;
  if (change < 0)  return <TrendingDown size={11} className="text-red-400" />;
  return <Minus size={11} className="text-gray-400" />;
}

function QuoteCard({ q, history }: { q: Quote; history?: PricePt[] }) {
  const color = q.change === null ? 'text-gray-400' : q.change > 0 ? 'text-green-400' : q.change < 0 ? 'text-red-400' : 'text-gray-400';
  const up = q.change === null ? null : q.change > 0;
  return (
    <div className="bg-surface border border-border rounded p-2 flex flex-col gap-1">
      <div className="text-[9px] font-mono text-dim truncate">{q.symbol}</div>
      <div className="text-[11px] font-mono text-white font-semibold">
        {q.price != null ? q.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
        <span className="text-[8px] text-dim ml-0.5">{q.currency}</span>
      </div>
      <div className={`text-[10px] font-mono flex items-center gap-0.5 ${color}`}>
        <ChangeArrow change={q.change} />
        {q.change != null ? `${q.change > 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}
      </div>
      {history && history.length > 1 && <Sparkline data={history} up={up} />}
      <div className="text-[8px] font-mono text-dim truncate">{q.name}</div>
    </div>
  );
}

export function FinancePanel() {
  const { state } = useApp();
  const { clusters } = state;

  const [quotes,       setQuotes]       = useState<Quote[]>([]);
  const [crypto,       setCrypto]       = useState<CryptoCoin[]>([]);
  const [polymarket,   setPolymarket]   = useState<PolymarketEntry[]>([]);
  const [signals,      setSignals]      = useState<SectorSignal[]>([]);
  const [priceHistory, setPriceHistory] = useState<Record<string, PricePt[]>>({});
  const [chartSymbol,  setChartSymbol]  = useState<string | null>(null);
  const priceHistoryRef = useRef<Record<string, PricePt[]>>({});
  const [loading,   setLoading]   = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [tab, setTab]             = useState<'markets' | 'signals' | 'predictions' | 'charts'>('markets');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMarketData = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, cRes, pRes] = await Promise.allSettled([
        fetch('/api/finance?type=quotes').then(r => r.json()),
        fetch('/api/finance?type=crypto&ids=bitcoin,ethereum,solana,ripple').then(r => r.json()),
        fetch('/api/finance?type=polymarket').then(r => r.json()),
      ]);
      if (qRes.status === 'fulfilled') {
        const qs: Quote[] = qRes.value.quotes ?? [];
        setQuotes(qs);
        // Append to rolling price history (keep last 30 pts)
        const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const next = { ...priceHistoryRef.current };
        for (const q of qs) {
          if (q.price == null) continue;
          const prev = next[q.symbol] ?? [];
          next[q.symbol] = [...prev, { t: now, v: q.price }].slice(-30);
        }
        priceHistoryRef.current = next;
        setPriceHistory({ ...next });
      }
      if (cRes.status === 'fulfilled') setCrypto(cRes.value.crypto ?? []);
      if (pRes.status === 'fulfilled') setPolymarket(pRes.value.markets ?? []);
      setLastUpdated(new Date());
    } catch (e) {
      console.warn('[Finance] Fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const generateSignals = useCallback(async () => {
    if (clusters.length === 0) return;
    setAiLoading(true);
    try {
      // Top 5 high-severity clusters → AI sector analysis
      const topClusters = clusters
        .filter(c => c.severity === 'critical' || c.severity === 'high' || c.severity === 'medium')
        .slice(0, 5);

      const headlineBlock = topClusters.map(c =>
        `[${c.severity.toUpperCase()}] ${c.headline} (sources: ${c.sourceIds.length})`
      ).join('\n');

      const prompt = `You are a financial analyst. Given these current news headlines, identify which market sectors/assets are likely affected and why.

Headlines:
${headlineBlock}

Respond ONLY with valid JSON (no markdown):
{
  "signals": [
    {
      "sector": "Energy / Defense / Tech / Finance / Agriculture / Crypto / Forex / etc",
      "impact": "positive" | "negative" | "neutral",
      "reason": "Brief specific explanation tied to the headlines",
      "relatedHeadlines": ["headline 1", "headline 2"],
      "confidence": 0.0 to 1.0
    }
  ]
}

Analyze 3-5 sectors. Be specific about which stocks/commodities/currencies might move.
IMPORTANT: End with a disclaimer that this is AI analysis only, not financial advice.`;

      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          tier: 'flash-lite',
          maxTokens: 600,
          cacheKey: `finance:signals:${topClusters.map(c => c.id).join('-')}`,
          cacheTtl: 1800,
        }),
      });
      const data = await res.json();
      const text = (data.text ?? '').replace(/^```json\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(text);
      setSignals(parsed.signals ?? []);
    } catch (e) {
      console.warn('[Finance] AI signals failed:', e);
    } finally {
      setAiLoading(false);
    }
  }, [clusters]);

  // Initial load
  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60 * 1000); // 1 min
    return () => clearInterval(interval);
  }, [fetchMarketData]);

  // Generate signals when clusters change
  useEffect(() => {
    if (clusters.length > 0) generateSignals();
  }, [clusters.length]); // eslint-disable-line

  const TABS: Array<{ id: typeof tab; label: string; icon?: React.ReactNode }> = [
    { id: 'markets',     label: 'Markets' },
    { id: 'charts',      label: 'Charts', icon: <BarChart2 size={10} /> },
    { id: 'signals',     label: 'AI Signals' },
    { id: 'predictions', label: 'Polymarket' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-mono text-dim">
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
        </span>
        <div className="flex-1" />
        <button
          onClick={fetchMarketData}
          disabled={loading}
          className="text-dim hover:text-white transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-accent' : ''} />
        </button>
      </div>

      {/* Disclaimer */}
      <div className="px-3 py-1 bg-amber-500/5 border-b border-amber-500/20 flex items-center gap-1.5 shrink-0">
        <AlertTriangle size={10} className="text-amber-400 shrink-0" />
        <span className="text-[9px] font-mono text-amber-400">
          AI analysis only — NOT financial advice. Do your own research before investing.
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-border shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
              tab === t.id
                ? 'bg-accent/10 text-accent border border-accent/30'
                : 'text-dim hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="flex items-center gap-1">
              {t.icon && t.icon}
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Markets tab */}
        {tab === 'markets' && (
          <div className="p-3 space-y-4">
            {/* Indices + Commodities */}
            <div>
              <h3 className="text-[10px] font-mono text-dim mb-2 uppercase tracking-widest">Indices & Commodities</h3>
              {loading && quotes.length === 0 ? (
                <div className="text-[10px] text-dim font-mono">Loading market data…</div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {quotes.map(q => <QuoteCard key={q.symbol} q={q} history={priceHistory[q.symbol]} />)}
                </div>
              )}
            </div>

            {/* Crypto */}
            <div>
              <h3 className="text-[10px] font-mono text-dim mb-2 uppercase tracking-widest">Crypto</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {crypto.map(c => (
                  <div key={c.id} className="bg-surface border border-border rounded p-2 flex flex-col gap-1">
                    <div className="text-[9px] font-mono text-dim uppercase">{c.symbol}</div>
                    <div className="text-[11px] font-mono text-white font-semibold">
                      ${c.current_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </div>
                    <div className={`text-[10px] font-mono flex items-center gap-0.5 ${
                      c.price_change_percentage_24h > 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      <ChangeArrow change={c.price_change_percentage_24h} />
                      {c.price_change_percentage_24h > 0 ? '+' : ''}{c.price_change_percentage_24h.toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Charts tab */}
        {tab === 'charts' && (() => {
          const symbols = quotes.filter(q => (priceHistory[q.symbol]?.length ?? 0) >= 2).map(q => q.symbol);
          const active = chartSymbol && symbols.includes(chartSymbol) ? chartSymbol : symbols[0] ?? null;
          const chartData = active ? priceHistory[active] ?? [] : [];
          const activeQ = quotes.find(q => q.symbol === active);
          const up = activeQ?.change !== null && activeQ?.change !== undefined ? activeQ.change > 0 : null;
          const lineColor = up === null ? '#06b6d4' : up ? '#22c55e' : '#ef4444';
          const newsSignal = signals.find(s =>
            active && s.relatedHeadlines.some(h => h.toLowerCase().includes(active.toLowerCase()))
          );
          return (
            <div className="p-3 space-y-3">
              {symbols.length === 0 ? (
                <div className="text-[10px] text-dim font-mono text-center py-10">
                  Price history builds as data refreshes (every 60s).<br />Check back shortly.
                </div>
              ) : (
                <>
                  {/* Symbol selector */}
                  <div className="flex flex-wrap gap-1">
                    {symbols.map(sym => (
                      <button
                        key={sym}
                        onClick={() => setChartSymbol(sym)}
                        className={`px-2 py-0.5 text-[9px] font-mono rounded border transition-colors ${
                          active === sym
                            ? 'border-accent text-accent bg-accent/10'
                            : 'border-border text-dim hover:text-white hover:border-accent/50'
                        }`}
                      >
                        {sym}
                      </button>
                    ))}
                  </div>

                  {/* Price history chart */}
                  {active && (
                    <div className="bg-surface/50 border border-border rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-mono text-white font-semibold">{active}</span>
                        {activeQ && (
                          <span className={`text-[10px] font-mono ${ up ? 'text-green-400' : up === false ? 'text-red-400' : 'text-gray-400' }`}>
                            {activeQ.price?.toLocaleString('en-US', { maximumFractionDigits: 2 })} {activeQ.currency}
                            {activeQ.change != null && ` (${activeQ.change > 0 ? '+' : ''}${activeQ.change.toFixed(2)}%)`}
                          </span>
                        )}
                      </div>
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="t" tick={{ fontSize: 8, fill: '#6b7280' }} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 8, fill: '#6b7280' }} domain={['auto', 'auto']} />
                          <Tooltip
                            contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 10, fontFamily: 'monospace' }}
                            labelStyle={{ color: '#9ca3af' }}
                            itemStyle={{ color: lineColor }}
                          />
                          <Line type="monotone" dataKey="v" stroke={lineColor} strokeWidth={2}
                            dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="text-[8px] font-mono text-dim mt-1">
                        Session data — {chartData.length} readings
                      </div>
                    </div>
                  )}

                  {/* Related news signal if available */}
                  {newsSignal && (
                    <div className={`border rounded p-2.5 text-[10px] font-mono ${
                      newsSignal.impact === 'positive' ? 'border-green-500/30 bg-green-500/5 text-green-300' :
                      newsSignal.impact === 'negative' ? 'border-red-500/30 bg-red-500/5 text-red-300' :
                      'border-gray-500/30 bg-gray-500/5 text-gray-300'
                    }`}>
                      <div className="font-semibold mb-1">AI Signal — {newsSignal.sector}</div>
                      <div className="text-[9px] leading-relaxed">{newsSignal.reason}</div>
                    </div>
                  )}

                  {/* Crypto sparkline grid */}
                  <div>
                    <h3 className="text-[10px] font-mono text-dim mb-2 uppercase tracking-widest">Crypto 24h</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {crypto.slice(0, 4).map(c => {
                        const pts = [{ t: '-24h', v: c.current_price / (1 + c.price_change_percentage_24h / 100) }, { t: 'now', v: c.current_price }];
                        return (
                          <div key={c.id} className="bg-surface border border-border rounded p-2 space-y-1">
                            <div className="flex justify-between">
                              <span className="text-[9px] font-mono text-dim uppercase">{c.symbol}</span>
                              <span className={`text-[9px] font-mono ${ c.price_change_percentage_24h > 0 ? 'text-green-400' : 'text-red-400' }`}>
                                {c.price_change_percentage_24h > 0 ? '+' : ''}{c.price_change_percentage_24h.toFixed(1)}%
                              </span>
                            </div>
                            <Sparkline data={pts} up={c.price_change_percentage_24h > 0} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* AI Signals tab */}
        {tab === 'signals' && (
          <div className="p-3 space-y-3">
            {aiLoading && signals.length === 0 ? (
              <div className="flex items-center gap-2 text-dim text-[10px] font-mono py-6 justify-center">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Analyzing current news for market signals…
              </div>
            ) : signals.length === 0 ? (
              <div className="text-[10px] text-dim font-mono text-center py-6">
                No signals yet — refresh the feed to generate analysis
              </div>
            ) : (
              signals.map((s, i) => (
                <div
                  key={i}
                  className={`border rounded p-3 space-y-2 ${
                    s.impact === 'positive' ? 'border-green-500/30 bg-green-500/5' :
                    s.impact === 'negative' ? 'border-red-500/30 bg-red-500/5' :
                    'border-gray-500/30 bg-gray-500/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold text-white">{s.sector}</span>
                    <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                      s.impact === 'positive' ? 'bg-green-500/20 text-green-400' :
                      s.impact === 'negative' ? 'bg-red-500/20 text-red-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {s.impact} · {Math.round(s.confidence * 100)}% conf
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-dim leading-relaxed">{s.reason}</p>
                  <div className="space-y-0.5">
                    {s.relatedHeadlines.slice(0, 2).map((h, j) => (
                      <div key={j} className="text-[9px] font-mono text-dim/60 flex items-start gap-1">
                        <span className="text-accent/40">›</span>{h}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
            <div className="text-[8px] text-dim font-mono pt-2 border-t border-border">
              ⚠ AI-generated analysis. Not financial advice. Always verify independently before making investment decisions.
            </div>
            {!aiLoading && (
              <button
                onClick={generateSignals}
                className="text-[10px] text-accent font-mono hover:underline"
              >
                Regenerate signals
              </button>
            )}
          </div>
        )}

        {/* Polymarket predictions tab */}
        {tab === 'predictions' && (
          <div className="p-3 space-y-2">
            <p className="text-[9px] font-mono text-dim">
              Prediction market odds for geopolitical outcomes (Polymarket). Market prices ≈ crowd probability estimate.
            </p>
            {polymarket.length === 0 ? (
              <div className="text-[10px] text-dim font-mono text-center py-6">
                {loading ? 'Loading prediction markets…' : 'No active markets found'}
              </div>
            ) : (
              polymarket.slice(0, 15).map((m, i) => {
                let prices: number[] = [];
                let outcomes: string[] = [];
                try { prices = JSON.parse(m.outcomePrices ?? '[]').map(Number); } catch {}
                try { outcomes = JSON.parse(m.outcomes ?? '[]'); } catch {}
                const yesIdx = outcomes.findIndex(o => o === 'Yes');
                const prob = yesIdx >= 0 && prices[yesIdx] !== undefined ? prices[yesIdx] : prices[0];
                const pct = prob != null ? Math.round(prob * 100) : null;

                return (
                  <div key={m.id} className="border border-border rounded p-2.5 space-y-1.5">
                    <div className="text-[10px] font-mono text-white leading-snug">{m.question}</div>
                    <div className="flex items-center gap-2">
                      {pct !== null && (
                        <>
                          <div className="flex-1 bg-surface rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct >= 50 ? 'bg-green-500' : 'bg-red-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-[10px] font-mono font-semibold ${pct >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                            {pct}%
                          </span>
                        </>
                      )}
                      {m.volume24hr > 0 && (
                        <span className="text-[8px] font-mono text-dim">
                          ${(m.volume24hr / 1000).toFixed(1)}K vol
                        </span>
                      )}
                    </div>
                    {outcomes.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {outcomes.slice(0, 3).map((o, j) => (
                          <span key={j} className="text-[8px] font-mono text-dim bg-surface px-1 py-0.5 rounded border border-border">
                            {o}: {prices[j] != null ? Math.round(prices[j] * 100) : '?'}%
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <a
              href="https://polymarket.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[9px] text-dim font-mono hover:text-accent pt-2"
            >
              <ExternalLink size={9} /> View all on Polymarket
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
