import { useState, useEffect } from 'react';
import { X, BookOpen, Loader2, Globe, ExternalLink } from 'lucide-react';
import type { StoryCluster } from '../../types';
import { searchGdelt, type GdeltArticle } from '../../services/gdelt';

interface WikiFact {
  title: string;
  summary: string;
  url: string;
  thumbnail?: string;
}

interface ActorEntry {
  name: string;
  mentions: number;
}

interface ExternalSnippet {
  source: 'Wikipedia' | 'GDELT' | 'Internet Archive';
  title: string;
  snippet: string;
  url: string;
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

function extractActorsFromText(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) ?? [];
  return matches.filter(name => !SKIP_WORDS.has(name.split(' ')[0]));
}

function isEmptyAiResponse(text: string): boolean {
  const cleaned = text.trim();
  return !cleaned || cleaned === '{}' || cleaned === '[]' || cleaned.toLowerCase() === 'null';
}

function buildLocalHistoryFallback(params: {
  headline: string;
  timeline: string[];
  actors: ActorEntry[];
  gdelt: GdeltArticle[];
}): string {
  const first = params.timeline[params.timeline.length - 1] ?? 'Earlier reports are limited.';
  const latest = params.timeline[0] ?? 'Latest framing is still developing.';
  const actorLine = params.actors.slice(0, 4).map(a => a.name).join(', ');
  const gdeltLine = params.gdelt.slice(0, 2).map(g => `${g.domain}: ${g.title}`).join(' | ');

  return [
    `The available historical record for "${params.headline}" shows evolving framing rather than a single settled narrative. Early coverage emphasized: ${first}. More recent coverage emphasizes: ${latest}.`,
    '',
    'Inflection points:',
    `- Early framing: ${first}`,
    `- Recent framing: ${latest}`,
    `- Key actors appearing across sources: ${actorLine || 'insufficient named-actor overlap yet'}`,
    '',
    'Perspective gaps:',
    `- Source disagreement remains on attribution, intent, and proportionality of actions in the timeline.`,
    `- Open-source corroboration is still partial${gdeltLine ? `; current signals include ${gdeltLine}` : ''}.`,
  ].join('\n');
}

export function HistoricalPanel({
  cluster,
  onClose,
}: {
  cluster: StoryCluster;
  onClose: () => void;
}) {
  const [facts, setFacts] = useState<WikiFact[]>([]);
  const [gdeltArticles, setGdeltArticles] = useState<GdeltArticle[]>([]);
  const [aiSummary, setAiSummary] = useState('');
  const [synthLoading, setSynthLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actors, setActors] = useState<ActorEntry[]>([]);
  const [narrativeShift, setNarrativeShift] = useState<Array<{ when: string; summary: string }>>([]);
  const [externalSnippets, setExternalSnippets] = useState<ExternalSnippet[]>([]);
  const [snippetsLoading, setSnippetsLoading] = useState(false);

  const searchTerms = extractSearchTerms(cluster);

  useEffect(() => {
    let cancelled = false;
    setFacts([]);
    setGdeltArticles([]);
    setActors([]);
    setNarrativeShift([]);
    setExternalSnippets([]);
    setAiSummary('');
    setLoading(true);
    setSnippetsLoading(true);

    const run = async () => {
      const results: WikiFact[] = [];
      const snippets: ExternalSnippet[] = [];

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

      results.slice(0, 2).forEach(item => {
        snippets.push({
          source: 'Wikipedia',
          title: item.title,
          snippet: item.summary,
          url: item.url,
        });
      });

      const actorCounter = new Map<string, number>();
      cluster.articles.forEach(article => {
        const pool = `${article.title} ${article.description ?? ''}`;
        extractActorsFromText(pool).forEach(name => {
          actorCounter.set(name, (actorCounter.get(name) ?? 0) + 1);
        });
      });
      if (!cancelled) {
        setActors(
          [...actorCounter.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([name, mentions]) => ({ name, mentions }))
        );
      }

      const chron = [...cluster.articles].sort((a, b) => +new Date(a.publishedAt) - +new Date(b.publishedAt));
      if (!cancelled && chron.length > 1) {
        const pivot = Math.floor(chron.length / 2);
        const early = chron.slice(0, Math.max(1, pivot));
        const late = chron.slice(Math.max(1, pivot));
        setNarrativeShift([
          {
            when: `Early (${new Date(early[0].publishedAt).toLocaleDateString()})`,
            summary: early[0]?.title ?? 'No early narrative found',
          },
          {
            when: `Later (${new Date(late[late.length - 1].publishedAt).toLocaleDateString()})`,
            summary: late[late.length - 1]?.title ?? 'No later narrative found',
          },
        ]);
      }

      // Fetch open-source timeline from GDELT (beyond Wikipedia)
      try {
        const query = searchTerms.length > 0 ? searchTerms.join(' OR ') : cluster.headline;
        const gdelt = await searchGdelt(query, 10);
        if (!cancelled) setGdeltArticles(gdelt);

        gdelt.slice(0, 3).forEach(item => {
          snippets.push({
            source: 'GDELT',
            title: item.title,
            snippet: `${item.domain || 'Open-source'} • ${item.seendate?.slice(0, 8) || 'recent signal'}`,
            url: item.url,
          });
        });
      } catch {
        /* noop */
      }

      try {
        const primaryUrl = cluster.articles[0]?.url;
        if (primaryUrl) {
          const cdx = await fetch(
            `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(primaryUrl)}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=1`
          );
          if (cdx.ok) {
            const rows = await cdx.json();
            if (Array.isArray(rows) && rows.length > 1 && Array.isArray(rows[1])) {
              const ts = String(rows[1][0] ?? '');
              const original = String(rows[1][1] ?? primaryUrl);
              if (ts.length >= 8) {
                const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
                snippets.push({
                  source: 'Internet Archive',
                  title: 'Archived snapshot available',
                  snippet: `Historical capture found for this story URL (${date}).`,
                  url: `https://web.archive.org/web/${ts}/${original}`,
                });
              }
            }
          }
        }
      } catch {
        /* noop */
      }

      if (!cancelled) setExternalSnippets(snippets.slice(0, 6));

      if (!cancelled) setLoading(false);
      if (!cancelled) setSnippetsLoading(false);
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id]);

  const runHistorySynthesis = async () => {
    setSynthLoading(true);
    try {
      const timelineRows = [...cluster.articles]
        .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
        .slice(0, 8)
        .map(a => `${new Date(a.publishedAt).toISOString().slice(0, 10)} | ${a.sourceName}: ${a.title}`);
      const timeline = timelineRows.join('\n');

      const wikiCtx = facts.map(f => `${f.title}: ${f.summary}`).join('\n').slice(0, 1400);
      const gdeltCtx = gdeltArticles.map(g => `${g.seendate} | ${g.domain}: ${g.title}`).join('\n').slice(0, 1400);

      const prompt = `You are a neutral geopolitical historian. Build a concise historical synthesis for this event: "${cluster.headline}".

Use these sources:
- Story timeline:\n${timeline || 'none'}
- Wikipedia context:\n${wikiCtx || 'none'}
- GDELT open-source context:\n${gdeltCtx || 'none'}

Output format:
1) 1 short paragraph (max 140 words) explaining root context.
2) "Inflection points:" with 3 bullets in chronological order.
3) "Perspective gaps:" with 2 bullets about what is still uncertain.

Be factual, avoid bias, and mark uncertainty clearly.`;

      const request = async (keySuffix: string) => fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tier: 'flash', maxTokens: 520, cacheKey: `history:${cluster.id}:v2:${keySuffix}`, cacheTtl: 3600 }),
      });

      let res = await request('main');
      let data = await res.json();
      let cleaned = String(data.text ?? '')
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim();

      if (isEmptyAiResponse(cleaned)) {
        res = await request('retry');
        data = await res.json();
        cleaned = String(data.text ?? '')
          .replace(/^```[a-z]*\n?/i, '')
          .replace(/\n?```$/i, '')
          .trim();
      }

      if (isEmptyAiResponse(cleaned)) {
        cleaned = buildLocalHistoryFallback({
          headline: cluster.headline,
          timeline: timelineRows,
          actors,
          gdelt: gdeltArticles,
        });
      }

      setAiSummary(cleaned);
    } catch {
      const timelineRows = [...cluster.articles]
        .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
        .slice(0, 8)
        .map(a => `${new Date(a.publishedAt).toISOString().slice(0, 10)} | ${a.sourceName}: ${a.title}`);

      setAiSummary(buildLocalHistoryFallback({
        headline: cluster.headline,
        timeline: timelineRows,
        actors,
        gdelt: gdeltArticles,
      }));
    } finally {
      setSynthLoading(false);
    }
  };

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
        <div className="mt-2">
          <button
            onClick={runHistorySynthesis}
            disabled={synthLoading || loading}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border border-accent/40 text-accent hover:text-accent hover:border-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
          >
            {synthLoading ? <Loader2 size={10} className="animate-spin" /> : <BookOpen size={10} />}
            Analyze History
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 size={20} className="text-accent animate-spin" />
            <span className="text-[11px] font-mono text-dim">
              Fetching Wikipedia + GDELT historical context…
            </span>
          </div>
        )}

        {!loading && (
          <div className="divide-y divide-border">
            {/* AI Historical Analysis */}
            {aiSummary && (
              <div className="px-4 py-4">
                <h4 className="text-[11px] font-mono uppercase tracking-wider text-accent mb-2.5 flex items-center gap-1.5">
                  <span>🧠</span> AI Historical Synthesis
                  <span className="text-[8px] text-dim font-normal normal-case ml-1">
                    Gemini Flash
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

            {/* Source timeline from current cluster */}
            <div className="px-4 py-4">
              <h4 className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 mb-2.5">
                Source Timeline
              </h4>
              <div className="space-y-1.5">
                {[...cluster.articles]
                  .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
                  .slice(0, 8)
                  .map((article, i) => (
                    <a
                      key={`${article.url}-${i}`}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-[10px] text-white/75 hover:text-white rounded border border-border/40 px-2 py-1.5 hover:border-accent/40 transition-colors"
                    >
                      <span className="text-dim font-mono mr-1">{new Date(article.publishedAt).toLocaleDateString()}</span>
                      <span className="text-accent/80 font-mono mr-1">{article.sourceName}</span>
                      {article.title}
                    </a>
                  ))}
              </div>
            </div>

            {/* Actors + alliances */}
            {actors.length > 0 && (
              <div className="px-4 py-4">
                <h4 className="text-[11px] font-mono uppercase tracking-wider text-violet-300 mb-2.5">
                  Actors & Alliances
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {actors.map(actor => (
                    <span
                      key={actor.name}
                      className="text-[10px] font-mono px-2 py-1 rounded border border-border bg-white/[0.02] text-white/85"
                    >
                      {actor.name} <span className="text-dim">({actor.mentions})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Narrative evolution */}
            {narrativeShift.length > 0 && (
              <div className="px-4 py-4">
                <h4 className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 mb-2.5">
                  Narrative Evolution
                </h4>
                <div className="space-y-2">
                  {narrativeShift.map((point, i) => (
                    <div key={i} className="rounded border border-border bg-white/[0.02] p-2">
                      <div className="text-[9px] font-mono text-cyan-300 mb-1">{point.when}</div>
                      <p className="text-[11px] text-white/80 leading-relaxed">{point.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GDELT open-source feed */}
            {gdeltArticles.length > 0 && (
              <div className="px-4 py-4">
                <h4 className="text-[11px] font-mono uppercase tracking-wider text-amber-300 mb-2.5">
                  Open-Source Signals (GDELT)
                </h4>
                <div className="space-y-2">
                  {gdeltArticles.slice(0, 8).map((item, i) => (
                    <a
                      key={`${item.url}-${i}`}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded border border-border bg-white/[0.02] hover:bg-white/[0.04] hover:border-accent/40 transition-colors p-2"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] font-mono text-amber-300">{item.domain || 'source'}</span>
                        <span className="text-[9px] text-dim">{item.seendate?.slice(0, 8) ?? ''}</span>
                        <ExternalLink size={8} className="ml-auto text-dim" />
                      </div>
                      <p className="text-[11px] text-white/80 leading-relaxed">{item.title}</p>
                    </a>
                  ))}
                </div>
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
            {facts.length === 0 && gdeltArticles.length === 0 && !aiSummary && (
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

            {/* Pulled external snippets */}
            {(snippetsLoading || externalSnippets.length > 0) && (
              <div className="px-4 py-3">
                <p className="text-[9px] font-mono text-dim uppercase tracking-wider mb-2">
                  Explore further (pulled snippets)
                </p>
                {snippetsLoading && externalSnippets.length === 0 ? (
                  <div className="flex items-center gap-2 text-[10px] text-dim font-mono">
                    <Loader2 size={10} className="animate-spin" /> Pulling external context snippets…
                  </div>
                ) : (
                  <div className="space-y-2">
                    {externalSnippets.map((item, idx) => (
                      <a
                        key={`${item.source}-${idx}`}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded border border-border bg-white/[0.02] hover:bg-white/[0.04] hover:border-accent/40 transition-colors p-2"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-mono text-accent/90">{item.source}</span>
                          <ExternalLink size={8} className="ml-auto text-dim" />
                        </div>
                        <p className="text-[11px] text-white/85 leading-relaxed">{item.title}</p>
                        <p className="text-[10px] text-dim mt-1 leading-relaxed">{item.snippet}</p>
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-2.5">
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
                    href={`https://www.gdeltproject.org/#query=${encodeURIComponent(cluster.headline)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] font-mono px-2 py-1 rounded border border-border text-dim hover:text-white hover:border-accent/50 transition-colors"
                  >
                    GDELT Explore ↗
                  </a>
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
