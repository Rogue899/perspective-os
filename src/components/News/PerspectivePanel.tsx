import { useState, useCallback } from 'react';
import type { StoryCluster, PerspectiveAnalysis, SourcePerspective } from '../../types';
import { getSourceById, getBiasTextClass, getBiasBgClass, getSourceTypeLabel } from '../../config/sources';
import { useApp } from '../../context/AppContext';
import { analyzePerspectives } from '../../services/ai';
import { X, Sparkles, ChevronDown, ChevronUp, ExternalLink, HelpCircle, Eye, Minus, AlertCircle, PlayCircle, LogIn } from 'lucide-react';
import type { BiasColor } from '../../types';

type MediaEmbed = {
  platform: 'youtube' | 'x' | 'meta' | 'reddit' | 'rumble' | 'kick';
  embedUrl: string;
  originalUrl: string;
};

function toMediaEmbed(rawUrl: string): MediaEmbed | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();

    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      let id = '';
      if (host.includes('youtu.be')) {
        id = url.pathname.slice(1);
      } else {
        id = url.searchParams.get('v') || '';
      }
      if (!id) return null;
      return {
        platform: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(id)}`,
        originalUrl: rawUrl,
      };
    }

    if (host.includes('x.com') || host.includes('twitter.com')) {
      return {
        platform: 'x',
        embedUrl: `https://twitframe.com/show?url=${encodeURIComponent(rawUrl)}`,
        originalUrl: rawUrl,
      };
    }

    if (host.includes('nitter.net')) {
      const xUrl = rawUrl.replace('nitter.net', 'x.com');
      return {
        platform: 'x',
        embedUrl: `https://twitframe.com/show?url=${encodeURIComponent(xUrl)}`,
        originalUrl: xUrl,
      };
    }

    if (host.includes('facebook.com') || host.includes('fb.watch')) {
      return {
        platform: 'meta',
        embedUrl: `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(rawUrl)}&show_text=true&width=500`,
        originalUrl: rawUrl,
      };
    }

    if (host.includes('reddit.com')) {
      return {
        platform: 'reddit',
        embedUrl: `https://www.redditmedia.com${url.pathname}?ref_source=embed&ref=share&embed=true`,
        originalUrl: rawUrl,
      };
    }

    if (host.includes('rumble.com')) {
      const match = url.pathname.match(/\/([a-z0-9]+)-/i) || url.pathname.match(/\/(v[a-z0-9]+)/i);
      const videoId = match?.[1];
      if (!videoId) return null;
      return {
        platform: 'rumble',
        embedUrl: `https://rumble.com/embed/${encodeURIComponent(videoId)}/`,
        originalUrl: rawUrl,
      };
    }

    if (host.includes('kick.com')) {
      const channel = url.pathname.split('/').filter(Boolean)[0];
      if (!channel) return null;
      return {
        platform: 'kick',
        embedUrl: `https://player.kick.com/${encodeURIComponent(channel)}`,
        originalUrl: rawUrl,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function PerspectivePanel() {
  const { state, dispatch } = useApp();
  const { selectedCluster } = state;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [verification, setVerification] = useState<Record<string, { label: string; confidence: number }>>({});

  if (!selectedCluster) return null;

  const handleAnalyze = useCallback(async () => {
    if (!selectedCluster || loading) return;
    setLoading(true);
    setError(null);

    try {
      const articles = selectedCluster.articles.map(a => {
        const src = getSourceById(a.sourceId);
        return {
          sourceId:   a.sourceId,
          sourceName: a.sourceName,
          biasLabel:  src?.bias ?? 'center',
          title:      a.title,
          description: a.description ?? '',
        };
      });

      const cacheKey = `perspective-${selectedCluster.id}`;
      const result = await analyzePerspectives(articles, cacheKey);

      const cleaned = String(result.text ?? '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed: Omit<PerspectiveAnalysis, 'clusterId' | 'generatedAt' | 'model' | 'sourceAnalyses'> & {
        sourceAnalyses: Array<Omit<SourcePerspective, 'biasColor'> & { sourceId?: string }>;
      } = JSON.parse(cleaned || '{}');

      const aiRows = Array.isArray(parsed.sourceAnalyses) ? parsed.sourceAnalyses : [];

      // Map sourceId indices back to actual IDs
      const analyses: SourcePerspective[] = (aiRows.length > 0 ? aiRows : selectedCluster.articles.map(a => ({
        sourceId: a.sourceId,
        sourceName: a.sourceName,
        mainFrame: a.description?.slice(0, 180) || a.title,
        emphasized: [],
        omitted: [],
        loadedLanguage: [],
        tone: 'neutral' as const,
      }))).map((sa, i) => {
        const article = selectedCluster.articles.find(a => a.sourceId === sa.sourceId) ?? selectedCluster.articles[i];
        const src = getSourceById(article?.sourceId ?? '');
        return {
          sourceId:     article?.sourceId ?? sa.sourceId ?? '',
          sourceName:   sa.sourceName || article?.sourceName || '',
          biasLabel:    src?.bias ?? 'center',
          biasColor:    (src?.biasColor ?? 'center') as BiasColor,
          mainFrame:    sa.mainFrame,
          emphasized:   sa.emphasized ?? [],
          omitted:      sa.omitted ?? [],
          loadedLanguage: sa.loadedLanguage ?? [],
          tone:         sa.tone ?? 'neutral',
        };
      });

      const analysis: PerspectiveAnalysis = {
        clusterId:          selectedCluster.id,
        sharedFacts:        Array.isArray(parsed.sharedFacts) ? parsed.sharedFacts : [],
        sourceAnalyses:     analyses,
        keyDisagreements:   Array.isArray(parsed.keyDisagreements) ? parsed.keyDisagreements : [],
        whatNobodyTellsYou: Array.isArray(parsed.whatNobodyTellsYou) ? parsed.whatNobodyTellsYou : [],
        socraticQuestions:  Array.isArray(parsed.socraticQuestions) ? parsed.socraticQuestions : [],
        confidenceOnFacts:  parsed.confidenceOnFacts ?? 0.5,
        generatedAt:        new Date(),
        model:              result.provider,
      };

      dispatch({
        type: 'UPDATE_CLUSTER',
        payload: { ...selectedCluster, hasAnalysis: true, analysis },
      });
    } catch (err: any) {
      setError(err?.message ?? 'Analysis failed. Check API keys in settings.');
    } finally {
      setLoading(false);
    }
  }, [selectedCluster, loading, dispatch]);

  const analysis = selectedCluster.analysis;

  const grouped = {
    left: selectedCluster.articles.filter(a => (getSourceById(a.sourceId)?.lean ?? 0) <= -1),
    center: selectedCluster.articles.filter(a => {
      const lean = getSourceById(a.sourceId)?.lean ?? 0;
      return lean > -1 && lean < 1;
    }),
    right: selectedCluster.articles.filter(a => (getSourceById(a.sourceId)?.lean ?? 0) >= 1),
    state: selectedCluster.articles.filter(a => getSourceById(a.sourceId)?.sourceType === 'state'),
  };

  const mediaEmbeds = selectedCluster.articles
    .map(a => toMediaEmbed(a.url))
    .filter((m): m is MediaEmbed => Boolean(m))
    .filter((media, idx, arr) => arr.findIndex(m => m.embedUrl === media.embedUrl) === idx)
    .slice(0, 4);

  const summarizeSide = (items: StoryCluster['articles']) => {
    if (!items.length) return 'No significant coverage in this cluster.';
    const top = items[0];
    const text = (top.description || top.title).replace(/\s+/g, ' ').trim();
    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  };

  const verifySource = async (sourceId: string) => {
    const article = selectedCluster.articles.find(a => a.sourceId === sourceId);
    if (!article) return;
    try {
      const prompt = `Evaluate this claim for credibility and return ONLY JSON:\n{"label":"likely|mixed|unverified","confidence":0.0}\nClaim: ${article.title}\nSummary: ${article.description}`;
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tier: 'flash-lite', maxTokens: 100 }),
      });
      const data = await res.json();
      const parsed = JSON.parse(String(data?.text ?? '{}').replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
      setVerification(prev => ({
        ...prev,
        [sourceId]: {
          label: parsed?.label ?? 'mixed',
          confidence: Number(parsed?.confidence ?? 0.5),
        },
      }));
    } catch {
      setVerification(prev => ({
        ...prev,
        [sourceId]: { label: 'unverified', confidence: 0.4 },
      }));
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[520px] bg-surface border-l border-border z-40 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-accent" />
          <span className="text-sm font-mono font-semibold text-white">Perspective Engine</span>
          <span className="text-[9px] font-mono text-dim bg-white/5 px-1.5 py-0.5 rounded">
            {selectedCluster.sourceIds.length} sources
          </span>
        </div>
        <button
          onClick={() => dispatch({ type: 'SELECT_CLUSTER', payload: null })}
          className="text-dim hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Story headline */}
        <div className="px-4 pt-4 pb-3 border-b border-border">
          <h2 className="text-sm font-semibold text-white leading-snug mb-2">
            {selectedCluster.headline}
          </h2>
          {/* Source chips */}
          <div className="flex flex-wrap gap-1">
            {selectedCluster.sourceIds.map(sid => {
              const src = getSourceById(sid);
              if (!src) return null;
              return (
                <span key={sid} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${getBiasBgClass(src.biasColor)} ${getBiasTextClass(src.biasColor)}`}>
                  {src.name}
                </span>
              );
            })}
          </div>
        </div>

        {/* Quick journalist brief */}
        <div className="px-4 py-3 border-b border-border space-y-2">
          <h4 className="text-[11px] font-mono uppercase tracking-wider text-accent">Quick Cross-Source Brief</h4>
          <div className="grid grid-cols-1 gap-2">
            <QuickSide title="Left / Progressive" text={summarizeSide(grouped.left)} tone="text-blue-300" />
            <QuickSide title="Center / Wire" text={summarizeSide(grouped.center)} tone="text-gray-300" />
            <QuickSide title="Right / Nationalist" text={summarizeSide(grouped.right)} tone="text-red-300" />
            <QuickSide title="State Media" text={summarizeSide(grouped.state)} tone="text-purple-300" />
          </div>
        </div>

        {/* Quick source actions */}
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-[11px] font-mono uppercase tracking-wider text-dim mb-2">Source snapshots</h4>
          <div className="space-y-2">
            {selectedCluster.articles.slice(0, 8).map(article => {
              const src = getSourceById(article.sourceId);
              const meta = verification[article.sourceId];
              const isUnverifiedLane = src?.sourceType === 'social' || src?.sourceType === 'rumor';
              return (
                <div key={article.url} className="p-2 rounded border border-border bg-white/[0.02]">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={`text-[10px] font-mono ${getBiasTextClass(src?.biasColor ?? 'center')}`}>
                      {src?.name ?? article.sourceName}
                    </span>
                    <span className="text-[9px] text-dim font-mono">{getSourceTypeLabel(src?.sourceType)}</span>
                  </div>
                  <p className="text-[11px] text-white/85 line-clamp-2 mb-2">{article.description || article.title}</p>
                  <div className="flex items-center gap-2">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] px-2 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10"
                    >
                      Read
                    </a>
                    {isUnverifiedLane && (
                      <button
                        onClick={() => verifySource(article.sourceId)}
                        className="text-[10px] px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                      >
                        AI Verify
                      </button>
                    )}
                    {meta && (
                      <span className="text-[9px] font-mono text-dim">
                        {meta.label} · {Math.round(meta.confidence * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Media bubble */}
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-[11px] font-mono uppercase tracking-wider text-dim mb-2 flex items-center gap-1.5">
            <PlayCircle size={11} className="text-accent" />
            Media Bubble
          </h4>

          {mediaEmbeds.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {mediaEmbeds.map((media, idx) => (
                <div key={`${media.embedUrl}-${idx}`} className="rounded border border-border overflow-hidden bg-black/30">
                  <div className="px-2 py-1 border-b border-border flex items-center justify-between">
                    <span className="text-[10px] font-mono text-dim uppercase">{media.platform}</span>
                    <a
                      href={media.originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-accent hover:underline"
                    >
                      Open source
                    </a>
                  </div>
                  <iframe
                    src={media.embedUrl}
                    title={`embed-${media.platform}-${idx}`}
                    className="w-full h-52"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded border border-border overflow-hidden bg-black/30">
              <div className="px-2 py-1 border-b border-border text-[10px] font-mono text-dim uppercase">YouTube topic video</div>
              <iframe
                src={`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(selectedCluster.headline)}`}
                title="youtube-topic-search"
                className="w-full h-52"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              />
            </div>
          )}

          <div className="mt-2 pt-2 border-t border-border">
            <div className="text-[10px] text-dim font-mono mb-1 flex items-center gap-1">
              <LogIn size={10} />
              Platform login shortcuts (if embed/data is private)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                ['X', 'https://x.com/i/flow/login'],
                ['Meta', 'https://www.facebook.com/login'],
                ['Reddit', 'https://www.reddit.com/login/'],
                ['YouTube', 'https://accounts.google.com/ServiceLogin?service=youtube'],
                ['Rumble', 'https://rumble.com/login.php'],
                ['Kick', 'https://kick.com/login'],
              ].map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 text-[10px] font-mono rounded border border-border text-dim hover:text-white hover:border-accent"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* CTA to run analysis */}
        {!analysis && (
          <div className="px-4 py-6 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Sparkles size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-sm text-white font-medium mb-1">Run Perspective Analysis</p>
              <p className="text-xs text-dim leading-relaxed">
                AI will compare how each source frames this story, what they emphasize,
                what they omit, and generate Socratic questions to challenge your assumptions.
              </p>
            </div>
            {error && (
              <div className="w-full flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-black text-sm font-mono font-semibold rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Sparkles size={14} className="animate-pulse" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Analyze {selectedCluster.sourceIds.length} perspectives
                </>
              )}
            </button>
            <p className="text-[10px] text-dim font-mono">
              Uses Gemini Flash → Groq fallback chain
            </p>
          </div>
        )}

        {/* Analysis results */}
        {analysis && (
          <div className="divide-y divide-border">
            {/* Shared facts */}
            {analysis.sharedFacts.length > 0 && (
              <Section title="What All Sources Agree On" icon="✓" color="text-green-400">
                <ul className="space-y-1.5">
                  {analysis.sharedFacts.map((f, i) => (
                    <li key={i} className="text-xs text-white/80 flex gap-2">
                      <span className="text-green-400 shrink-0 mt-0.5">•</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Per-source breakdown */}
            <Section title="How Each Source Frames It" icon="◐" color="text-white">
              <div className="space-y-2">
                {analysis.sourceAnalyses.map(sa => (
                  <SourceCard
                    key={sa.sourceId}
                    analysis={sa}
                    expanded={expandedSource === sa.sourceId}
                    onToggle={() => setExpandedSource(prev => prev === sa.sourceId ? null : sa.sourceId)}
                    articles={selectedCluster.articles}
                  />
                ))}
              </div>
            </Section>

            {/* Key disagreements */}
            {analysis.keyDisagreements.length > 0 && (
              <Section title="Direct Contradictions" icon="⚡" color="text-yellow-400">
                <ul className="space-y-2">
                  {analysis.keyDisagreements.map((d, i) => (
                    <li key={i} className="text-xs text-white/80 p-2 bg-yellow-500/5 border border-yellow-500/20 rounded">
                      {d}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* What nobody tells you */}
            {analysis.whatNobodyTellsYou.length > 0 && (
              <Section title="What No Source Is Telling You" icon="👁" color="text-purple-400">
                <p className="text-[10px] text-dim mb-2">Gaps present across ALL sources — the shared blind spots.</p>
                <ul className="space-y-2">
                  {analysis.whatNobodyTellsYou.map((g, i) => (
                    <li key={i} className="text-xs text-white/80 p-2 bg-purple-500/5 border border-purple-500/20 rounded">
                      {g}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Socratic questions */}
            {analysis.socraticQuestions.length > 0 && (
              <Section title="Questions to Ask Yourself" icon="?" color="text-accent">
                <div className="space-y-2">
                  {analysis.socraticQuestions.map((q, i) => (
                    <div key={i} className="flex gap-2 p-2.5 bg-accent/5 border border-accent/20 rounded">
                      <HelpCircle size={12} className="text-accent shrink-0 mt-0.5" />
                      <p className="text-xs text-white/80 italic leading-relaxed">{q}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Confidence + meta */}
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-[10px] font-mono text-dim">
                Fact confidence: {Math.round(analysis.confidenceOnFacts * 100)}%
              </span>
              <span className="text-[10px] font-mono text-dim">
                via {analysis.model} · {analysis.generatedAt.toLocaleTimeString()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickSide({ title, text, tone }: { title: string; text: string; tone: string }) {
  return (
    <div className="p-2 rounded border border-border bg-white/[0.02]">
      <div className={`text-[10px] font-mono mb-1 ${tone}`}>{title}</div>
      <div className="text-[11px] text-white/85 leading-relaxed">{text}</div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, icon, color, children }: {
  title: string; icon: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <h4 className={`text-[11px] font-mono font-semibold uppercase tracking-wider mb-2.5 flex items-center gap-1.5 ${color}`}>
        <span>{icon}</span>
        {title}
      </h4>
      {children}
    </div>
  );
}

function SourceCard({ analysis, expanded, onToggle, articles }: {
  analysis: SourcePerspective;
  expanded: boolean;
  onToggle: () => void;
  articles: StoryCluster['articles'];
}) {
  const src = getSourceById(analysis.sourceId);
  const article = articles.find(a => a.sourceId === analysis.sourceId);
  const toneColors: Record<string, string> = {
    sympathetic: 'text-blue-400', hostile: 'text-red-400',
    alarming: 'text-orange-400', dismissive: 'text-dim', neutral: 'text-gray-400',
  };

  return (
    <div className={`rounded border ${getBiasBgClass(analysis.biasColor)} overflow-hidden`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono font-semibold ${getBiasTextClass(analysis.biasColor)}`}>
            {analysis.sourceName}
          </span>
          <span className={`text-[9px] font-mono ${toneColors[analysis.tone] ?? 'text-dim'}`}>
            {analysis.tone}
          </span>
        </div>
        {expanded ? <ChevronUp size={12} className="text-dim" /> : <ChevronDown size={12} className="text-dim" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-white/5">
          <p className="text-xs text-white/80 pt-2 leading-relaxed italic">
            "{analysis.mainFrame}"
          </p>

          {analysis.emphasized.length > 0 && (
            <InfoRow label="Emphasizes" items={analysis.emphasized} color="text-white/70" />
          )}
          {analysis.omitted.length > 0 && (
            <InfoRow label="Omits" items={analysis.omitted} color="text-red-300/80" prefix="✗ " />
          )}
          {analysis.loadedLanguage.length > 0 && (
            <div>
              <span className="text-[9px] font-mono text-dim uppercase tracking-wider">Loaded language</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {analysis.loadedLanguage.map((w, i) => (
                  <code key={i} className="text-[9px] text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                    "{w}"
                  </code>
                ))}
              </div>
            </div>
          )}

          {article && (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-accent hover:underline"
            >
              <ExternalLink size={10} />
              Read original article
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, items, color, prefix = '' }: {
  label: string; items: string[]; color: string; prefix?: string;
}) {
  return (
    <div>
      <span className="text-[9px] font-mono text-dim uppercase tracking-wider">{label}</span>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className={`text-[11px] ${color} flex gap-1`}>
            <span className="shrink-0">{prefix || '•'}</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
