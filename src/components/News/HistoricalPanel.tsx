import { useState, useEffect } from 'react';
import { X, BookOpen, Loader2, Globe, ExternalLink } from 'lucide-react';
import type { StoryCluster } from '../../types';

interface WikiFact {
  title: string;
  summary: string;
  url: string;
  thumbnail?: string;
}

const SKIP_WORDS = new Set([
  'The','This','That','They','Then','There','With','From','Into','Over',
  'After','Says','Amid','Hits','Kills','Dead','Will','Warns','Report',
  'Reports','After','More','Also','Both','Amid','When','What','Where',
]);

function extractSearchTerms(cluster: StoryCluster): string[] {
  const terms: string[] = [];
  if (cluster.geoHint?.name) terms.push(cluster.geoHint.name);
  const matches = cluster.headline.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  const unique = [...new Set(matches)].filter(w => !SKIP_WORDS.has(w));
  terms.push(...unique.slice(0, 3));
  return [...new Set(terms)].slice(0, 2);
}

export function HistoricalPanel({
  cluster,
  onClose,
}: {
  cluster: StoryCluster;
  onClose: () => void;
}) {
  const [facts, setFacts] = useState<WikiFact[]>([]);
  const [aiSummary, setAiSummary] = useState('');
  const [loading, setLoading] = useState(true);

  const searchTerms = extractSearchTerms(cluster);

  useEffect(() => {
    let cancelled = false;
    setFacts([]);
    setAiSummary('');
    setLoading(true);

    const run = async () => {
      const results: WikiFact[] = [];

      // Fetch Wikipedia summaries
      for (const term of searchTerms) {
        try {
          const res = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`
          );
          if (res.ok) {
            const data = await res.json();
            if (
              data.extract &&
              data.extract.length > 80 &&
              data.type !== 'disambiguation'
            ) {
              results.push({
                title: data.title,
                summary:
                  data.extract.slice(0, 500) +
                  (data.extract.length > 500 ? '…' : ''),
                url:
                  data.content_urls?.desktop?.page ??
                  `https://en.wikipedia.org/wiki/${encodeURIComponent(term)}`,
                thumbnail: data.thumbnail?.source,
              });
            }
          }
        } catch {
          /* noop */
        }
      }

      if (!cancelled) setFacts(results);

      // AI historical synthesis
      try {
        const ctx = results
          .map(f => f.summary)
          .join('\n\n')
          .slice(0, 700);
        const prompt = `You are a concise geopolitical historian. In 120 words, explain the KEY historical background and root causes behind: "${cluster.headline}". Wikipedia context: ${ctx || 'not available'}. Be neutral, factual, cite 2-3 turning-point dates if known. Write one clear paragraph, no bullet lists.`;
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, tier: 'flash-lite', maxTokens: 300 }),
        });
        const data = await res.json();
        if (!cancelled)
          setAiSummary(
            (data.text ?? '')
              .replace(/^```[a-z]*\n?/i, '')
              .replace(/\n?```$/i, '')
              .trim()
          );
      } catch {
        /* noop */
      }

      if (!cancelled) setLoading(false);
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id]);

  return (
    <div className="absolute inset-0 bg-surface z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-accent" />
          <span className="text-sm font-mono font-semibold text-white">
            Historical Context
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-dim hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Story hint */}
      <div className="px-4 py-2.5 bg-white/[0.02] border-b border-border shrink-0">
        <p className="text-[11px] text-dim leading-snug line-clamp-2">
          {cluster.headline}
        </p>
        {cluster.geoHint?.name && (
          <div className="flex items-center gap-1 mt-1">
            <Globe size={9} className="text-accent" />
            <span className="text-[9px] font-mono text-accent">
              {cluster.geoHint.name}
            </span>
          </div>
        )}
        {searchTerms.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {searchTerms.map(t => (
              <span
                key={t}
                className="text-[8px] font-mono text-dim border border-border/40 px-1.5 py-0.5 rounded"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 size={20} className="text-accent animate-spin" />
            <span className="text-[11px] font-mono text-dim">
              Fetching Wikipedia + AI historical context…
            </span>
          </div>
        )}

        {!loading && (
          <div className="divide-y divide-border">
            {/* AI Historical Analysis */}
            {aiSummary && (
              <div className="px-4 py-4">
                <h4 className="text-[11px] font-mono uppercase tracking-wider text-accent mb-2.5 flex items-center gap-1.5">
                  <span>🧠</span> AI Historical Analysis
                  <span className="text-[8px] text-dim font-normal normal-case ml-1">
                    Gemini Flash-Lite
                  </span>
                </h4>
                <p className="text-[12px] text-white/85 leading-relaxed">
                  {aiSummary}
                </p>
                <p className="text-[9px] font-mono text-dim/50 mt-2">
                  AI-generated — verify with primary sources
                </p>
              </div>
            )}

            {/* Wikipedia entries */}
            {facts.map((fact, i) => (
              <div key={i} className="px-4 py-4">
                <div className="flex items-start gap-3">
                  {fact.thumbnail && (
                    <img
                      src={fact.thumbnail}
                      alt={fact.title}
                      className="w-14 h-14 object-cover rounded border border-border shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <h4 className="text-[11px] font-mono font-semibold text-white truncate">
                        📖 {fact.title}
                      </h4>
                      <a
                        href={fact.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 flex items-center gap-1 text-[9px] font-mono text-accent hover:underline"
                      >
                        Wikipedia <ExternalLink size={8} />
                      </a>
                    </div>
                    <p className="text-[11px] text-white/70 leading-relaxed">
                      {fact.summary}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {/* Empty state */}
            {facts.length === 0 && !aiSummary && (
              <div className="px-4 py-10 text-center space-y-2">
                <BookOpen size={24} className="text-dim/20 mx-auto" />
                <p className="text-[11px] text-dim font-mono">
                  No historical data found.
                </p>
                <p className="text-[10px] text-dim/60">
                  Stories with clear geographic references work best.
                </p>
              </div>
            )}

            {/* External search links */}
            {searchTerms.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[9px] font-mono text-dim uppercase tracking-wider mb-2">
                  Explore further
                </p>
                <div className="flex flex-wrap gap-2">
                  {searchTerms.map(term => (
                    <a
                      key={term}
                      href={`https://en.wikipedia.org/wiki/${encodeURIComponent(term)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] font-mono px-2 py-1 rounded border border-border text-dim hover:text-white hover:border-accent/50 transition-colors"
                    >
                      {term} on Wikipedia ↗
                    </a>
                  ))}
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(cluster.headline + ' history background')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] font-mono px-2 py-1 rounded border border-border text-dim hover:text-white hover:border-accent/50 transition-colors"
                  >
                    Google History ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
