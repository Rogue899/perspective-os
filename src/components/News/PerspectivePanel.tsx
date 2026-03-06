import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { OpinionPanel } from './OpinionPanel';
import { HistoricalPanel } from './HistoricalPanel';
import type { StoryCluster, PerspectiveAnalysis, SourcePerspective } from '../../types';
import { getSourceById, getBiasTextClass, getBiasBgClass, getSourceTypeLabel } from '../../config/sources';
import { useApp } from '../../context/AppContext';
import { analyzePerspectives } from '../../services/ai';
import { X, Sparkles, ChevronDown, ChevronUp, ExternalLink, HelpCircle, Eye, AlertCircle, PlayCircle, Copy, Check, BookOpen } from 'lucide-react';
import type { BiasColor } from '../../types';
// ── Shared helpers ────────────────────────────────────────────────────────────

type SocialPost = { title: string; url: string; author: string; ago: string };

function formatAgo(dateStr: string | Date): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (isNaN(d.getTime())) return '';
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Collapsible section wrapper used for all pre-analysis content blocks
function CollapsibleSection({ id, title, icon, badge, children, collapsed, onToggle }: {
  id: string; title: string; icon?: ReactNode; badge?: string;
  children: ReactNode; collapsed: Set<string>; onToggle: (id: string) => void;
}) {
  const open = !collapsed.has(id);
  return (
    <div className="border-b border-border">
      <button
        onClick={() => onToggle(id)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-[11px] font-mono uppercase tracking-wider text-dim flex items-center gap-1.5">
          {icon}
          {title}
          {badge && <span className="text-[9px] normal-case font-normal text-dim/50 ml-1">{badge}</span>}
        </span>
        <ChevronDown size={11} className={`text-dim/50 transition-transform duration-150 shrink-0 ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

// ── MTS-inspired severity + category system ───────────────────────────────────
const MTS_SEVERITY: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: 'S5', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/40' },
  high:     { label: 'S4', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/40' },
  medium:   { label: 'S3', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/40' },
  low:      { label: 'S2', color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/40' },
  info:     { label: 'S1', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/40' },
};

const MTS_CATEGORY_LABEL: Record<string, string> = {
  conflict:       'Conflict',
  military:       'Conflict',
  terrorism:      'Conflict',
  protest:        'Political',
  diplomatic:     'Political',
  tech:           'Political',
  economic:       'Economic',
  infrastructure: 'Economic',
  cyber:          'Cyber',
  disaster:       'Humanitarian',
  health:         'Humanitarian',
  science:        'Science',
  sport:          'Sport',
  general:        'General',
};

type MediaEmbed = {
  platform: 'youtube' | 'x' | 'meta' | 'reddit' | 'ig' | 'rumble' | 'kick';
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

    if (host.includes('instagram.com')) {
      return {
        platform: 'ig',
        embedUrl: rawUrl,
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
  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [socialPosts, setSocialPosts] = useState<{ reddit: SocialPost[]; x: SocialPost[] }>({ reddit: [], x: [] });
  const [loadingSocial, setLoadingSocial] = useState(false);
  const [activeSocialTab, setActiveSocialTab] = useState<'reddit' | 'x' | 'ig' | 'fb'>('reddit');

  const toggleSection = (id: string) =>
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const [copied, setCopied] = useState(false);
  const [copiedQuestionIdx, setCopiedQuestionIdx] = useState<number | null>(null);
  const [showOpinions, setShowOpinions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [polyPredictions, setPolyPredictions] = useState<Array<{ question: string; probability: number; url: string }>>([]);

  // Fetch Polymarket markets relevant to this story
  useEffect(() => {
    if (!selectedCluster) return;
    const words = selectedCluster.headline.toLowerCase().split(/\W+/).filter(w => w.length > 4);
    fetch('/api/finance?type=polymarket')
      .then(r => r.json())
      .then(data => {
        const markets: Array<{ question: string; outcomePrices: string; slug?: string }> = data.markets ?? [];
        const relevant = markets
          .filter(m => {
            const q = (m.question ?? '').toLowerCase();
            return words.some(kw => q.includes(kw));
          })
          .slice(0, 5)
          .map(m => {
            let prob = 0.5;
            try {
              const prices = JSON.parse(m.outcomePrices ?? '["0.5"]');
              prob = Number(prices[0]) || 0.5;
            } catch { /* noop */ }
            return {
              question: m.question,
              probability: prob,
              url: `https://polymarket.com/event/${m.slug ?? ''}`,
            };
          });
        setPolyPredictions(relevant);
      })
      .catch(() => setPolyPredictions([]));
  }, [selectedCluster?.id]);

  // Fetch social posts (Reddit + X/Nitter) when cluster changes
  useEffect(() => {
    if (!selectedCluster) return;
    const q = encodeURIComponent(selectedCluster.headline.split(' ').slice(0, 7).join(' '));
    setLoadingSocial(true);
    setSocialPosts({ reddit: [], x: [] });

    const fetchReddit = async (): Promise<SocialPost[]> => {
      const url = `https://www.reddit.com/search.rss?q=${q}&sort=top&t=week&limit=5`;
      const res = await fetch(`/api/rss-proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
      return Array.from(doc.querySelectorAll('entry')).slice(0, 5).map(e => ({
        title: e.querySelector('title')?.textContent?.trim() ?? '',
        url:   e.querySelector('link')?.getAttribute('href') ?? e.querySelector('id')?.textContent ?? '',
        author: e.querySelector('author name')?.textContent?.trim() ?? 'u/unknown',
        ago:   formatAgo(e.querySelector('updated')?.textContent ?? ''),
      })).filter(p => p.title && p.url);
    };

    const fetchX = async (): Promise<SocialPost[]> => {
      const url = `https://nitter.net/search/rss?f=tweets&q=${q}`;
      const res = await fetch(`/api/rss-proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return [];

      const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
      const entries = Array.from(doc.querySelectorAll('item')).slice(0, 5);

      return entries.map(item => {
        const rawUrl = item.querySelector('link')?.textContent?.trim() ?? '';
        const xUrl = rawUrl.includes('nitter.net') ? rawUrl.replace('nitter.net', 'x.com') : rawUrl;
        return {
          title: item.querySelector('title')?.textContent?.trim() ?? '',
          url: xUrl,
          author: item.querySelector('creator, dc\\:creator')?.textContent?.trim() ?? '@unknown',
          ago: formatAgo(item.querySelector('pubDate')?.textContent ?? ''),
        };
      }).filter(p => p.title && p.url);
    };

    Promise.allSettled([fetchReddit(), fetchX()])
      .then(([redditResult, xResult]) => {
        const reddit = redditResult.status === 'fulfilled' ? redditResult.value : [];
        const x = xResult.status === 'fulfilled' ? xResult.value : [];
        setSocialPosts({ reddit, x });
      })
      .finally(() => {
        setLoadingSocial(false);
      });
  }, [selectedCluster?.id]);

  const copyReport = useCallback(() => {
    if (!selectedCluster?.analysis) return;
    const a = selectedCluster.analysis;
    const lines: string[] = [
      `=== PERSPECTIVE REPORT: ${selectedCluster.headline} ===`,
      '',
      '--- SHARED FACTS ---',
      ...a.sharedFacts.map(f => `• ${f}`),
      '',
      '--- SOURCE FRAMES ---',
      ...a.sourceAnalyses.map(sa =>
        [`[${sa.sourceName}] ${sa.mainFrame}`,
         sa.emphasized.length ? `  ↑ Emphasized: ${sa.emphasized.join(', ')}` : '',
         sa.omitted.length    ? `  ↓ Omitted: ${sa.omitted.join(', ')}` : '',
        ].filter(Boolean).join('\n')
      ),
      '',
      '--- CONTRADICTIONS ---',
      ...a.keyDisagreements.map(d => `⚡ ${d}`),
      '',
      '--- BLIND SPOTS ---',
      ...a.whatNobodyTellsYou.map(g => `👁 ${g}`),
      '',
      '--- SOCRATIC QUESTIONS ---',
      ...a.socraticQuestions.map((q, i) => `${i + 1}. ${q}`),
      '',
      `Model: ${a.model ?? 'unknown'} | Generated: ${new Date(a.generatedAt).toISOString()}`,
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [selectedCluster]);

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

  const allEmbeds = selectedCluster.articles
    .map(a => toMediaEmbed(a.url))
    .filter((m): m is MediaEmbed => Boolean(m))
    .filter((media, idx, arr) => arr.findIndex(m => m.embedUrl === media.embedUrl) === idx);

  // Video section: only actual video platforms (YouTube, Rumble, Kick)
  const mediaEmbeds = allEmbeds
    .filter(m => m.platform === 'youtube' || m.platform === 'rumble' || m.platform === 'kick')
    .slice(0, 4);

  // Inline social embeds: Reddit/X/Meta from article URLs (Social Posts section uses fetched RSS posts instead)
  const inlineSocialEmbeds = allEmbeds
    .filter(m => m.platform === 'reddit' || m.platform === 'x' || m.platform === 'meta' || m.platform === 'ig')
    .slice(0, 8);

  const mapInlineToPosts = (platform: 'reddit' | 'x' | 'meta' | 'ig'): SocialPost[] =>
    inlineSocialEmbeds
      .filter(e => e.platform === platform)
      .map((embed, idx) => {
        try {
          const parsed = new URL(embed.originalUrl);
          const host = parsed.hostname.replace('www.', '');
          const segment = parsed.pathname.split('/').filter(Boolean)[0] ?? 'post';
          const author = platform === 'reddit'
            ? `u/${segment || 'reddit'}`
            : platform === 'x'
            ? `@${segment || 'x'}`
            : platform === 'ig'
            ? `@${segment || 'instagram'}`
            : 'facebook';
          return {
            title: `${host}${parsed.pathname}`.slice(0, 120),
            url: embed.originalUrl,
            author,
            ago: '',
          };
        } catch {
          return {
            title: `Source social post #${idx + 1}`,
            url: embed.originalUrl,
            author: platform,
            ago: '',
          };
        }
      });

  const redditInlinePosts = mapInlineToPosts('reddit');
  const xInlinePosts = mapInlineToPosts('x');
  const igInlinePosts = mapInlineToPosts('ig');
  const fbInlinePosts = mapInlineToPosts('meta');

  const sevMeta = MTS_SEVERITY[selectedCluster.severity] ?? MTS_SEVERITY.info;
  const mtsCategory = MTS_CATEGORY_LABEL[selectedCluster.category] ?? 'General';

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

  const copyQuestion = useCallback((question: string, idx: number) => {
    navigator.clipboard.writeText(question).then(() => {
      setCopiedQuestionIdx(idx);
      setTimeout(() => setCopiedQuestionIdx(prev => (prev === idx ? null : prev)), 1500);
    });
  }, []);

  const groundNewsUrl = `https://ground.news/search?query=${encodeURIComponent(selectedCluster.headline)}`;

  const summarizeBloc = (rows: SourcePerspective[]) => {
    if (!rows.length) return 'No clear framing signals in this cluster.';
    const sample = rows[0].mainFrame?.trim() || '';
    return sample.length > 150 ? `${sample.slice(0, 147)}...` : sample;
  };

  return (
    <div className="absolute inset-y-0 right-0 w-full sm:w-[520px] bg-surface border-l border-border z-40 flex flex-col shadow-2xl">
      {/* Opinion Panel overlay (z-50, same right edge) */}
      {showOpinions && (
        <OpinionPanel cluster={selectedCluster} onClose={() => setShowOpinions(false)} />
      )}
      {showHistory && (
        <HistoricalPanel cluster={selectedCluster} onClose={() => setShowHistory(false)} />
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Eye size={13} className="text-accent shrink-0" />
          <span className="text-[11px] font-mono font-semibold text-white">Perspective Engine</span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-semibold shrink-0 ${sevMeta.bg} ${sevMeta.color}`}>
            {sevMeta.label}
          </span>
          <span className="text-[9px] font-mono text-dim bg-white/5 px-1.5 py-0.5 rounded shrink-0">
            {mtsCategory}
          </span>
          <span className="text-[9px] font-mono text-accent/70 shrink-0">
            {selectedCluster.sourceIds.length} src
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {analysis && (
            <button
              onClick={copyReport}
              title="Copy report to clipboard"
              className="inline-flex items-center gap-1 px-1.5 py-1 text-[10px] font-mono rounded border border-border text-dim hover:text-white hover:border-accent transition-colors"
            >
              {copied ? <Check size={9} className="text-green-400" /> : <Copy size={9} />}
            </button>
          )}
          <button
            onClick={() => dispatch({ type: 'SELECT_CLUSTER', payload: null })}
            className="text-dim hover:text-white transition-colors p-0.5"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Story headline */}
        <div className="px-4 pt-4 pb-3 border-b border-border">
          <h2 className="text-sm font-semibold text-white leading-snug mb-2">
            {selectedCluster.headline}
          </h2>
          {/* Source chips */}
          <div className="flex flex-wrap gap-1 mb-2.5">
            {selectedCluster.sourceIds.map(sid => {
              const srcObj = getSourceById(sid);
              if (!srcObj) return null;
              return (
                <span key={sid} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${getBiasBgClass(srcObj.biasColor)} ${getBiasTextClass(srcObj.biasColor)}`}>
                  {srcObj.name}
                </span>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1 mb-2.5">
            {([
              { key: 'left', label: 'Left' },
              { key: 'center', label: 'Center' },
              { key: 'right', label: 'Right' },
              { key: 'state', label: 'State' },
              { key: 'gulf', label: 'Gulf' },
              { key: 'osint', label: 'OSINT' },
            ] as const).map(item => (
              <span
                key={item.key}
                className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${getBiasBgClass(item.key)} ${getBiasTextClass(item.key)}`}
              >
                {item.label}
              </span>
            ))}
          </div>
          {/* Actions row */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowOpinions(true)}
              title="Generate AI editorial opinions from 4 political lenses"
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border border-accent/40 text-accent/80 hover:text-accent hover:border-accent hover:bg-accent/10 transition-colors"
            >
              <Sparkles size={9} />
              AI Opinions
            </button>
            <button
              onClick={() => setShowHistory(true)}
              title="Show historical context for this story"
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border border-border text-dim hover:text-white hover:border-accent transition-colors"
            >
              <BookOpen size={9} />
              History
            </button>
            <a
              href={groundNewsUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this topic in Ground News"
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border border-border text-dim hover:text-white hover:border-accent transition-colors"
            >
              Ground <ExternalLink size={9} />
            </a>
          </div>
        </div>

        {/* Prediction Markets */}
        {polyPredictions.length > 0 && (
          <CollapsibleSection id="markets" title="Prediction Markets" icon="📊" badge="via Polymarket"
            collapsed={collapsedSections} onToggle={toggleSection}>
            <div className="space-y-2 pt-1">
              {polyPredictions.map((market, i) => {
                const pct = Math.round(market.probability * 100);
                const barColor = pct > 65 ? 'bg-green-500' : pct > 35 ? 'bg-yellow-500' : 'bg-red-500';
                return (
                  <a key={i} href={market.url} target="_blank" rel="noopener noreferrer"
                    className="block p-2 rounded border border-border hover:border-accent/50 bg-white/[0.02] transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] text-white/85 line-clamp-1 flex-1">{market.question}</span>
                      <span className={`text-[11px] font-mono font-semibold shrink-0 ${
                        pct > 65 ? 'text-green-400' : pct > 35 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{pct}%</span>
                    </div>
                    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </a>
                );
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Quick Cross-Source Brief */}
        <CollapsibleSection id="brief" title="Cross-Source Brief"
          collapsed={collapsedSections} onToggle={toggleSection}>
          <div className="grid grid-cols-1 gap-2 pt-1">
            <QuickSide title="Left / Progressive" text={summarizeSide(grouped.left)} tone="text-blue-300" />
            <QuickSide title="Center / Wire" text={summarizeSide(grouped.center)} tone="text-gray-300" />
            <QuickSide title="Right / Nationalist" text={summarizeSide(grouped.right)} tone="text-red-300" />
            <QuickSide title="State Media" text={summarizeSide(grouped.state)} tone="text-purple-300" />
          </div>
        </CollapsibleSection>

        {/* Source Snapshots */}
        <CollapsibleSection id="snapshots" title="Source Snapshots"
          collapsed={collapsedSections} onToggle={toggleSection}>
          <div className="space-y-2 pt-1">
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
                    <a href={article.url} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] px-2 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10">
                      Read
                    </a>
                    {isUnverifiedLane && (
                      <button onClick={() => verifySource(article.sourceId)}
                        className="text-[10px] px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10">
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
        </CollapsibleSection>

        {/* Source Posts */}
        <CollapsibleSection id="sourceposts" title="Source Posts" icon={<BookOpen size={11} className="text-accent" />}
          collapsed={collapsedSections} onToggle={toggleSection}>
          <div className="space-y-2 pt-1">
            {selectedCluster.articles.slice(0, 6).map((article, idx) => {
              const src = getSourceById(article.sourceId);
              const raw = (article.description || article.title).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              const snippet = raw.length > 220 ? raw.slice(0, 217) + '…' : raw;
              return (
                <a key={idx} href={article.url} target="_blank" rel="noopener noreferrer"
                  className="block rounded border border-border bg-surface/40 hover:bg-surface hover:border-accent/40 transition-colors p-2.5 group">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[10px] font-mono font-semibold ${getBiasTextClass(src?.bias as BiasColor)}`}>
                      {src?.name ?? article.sourceId}
                    </span>
                    <span className="text-[10px] text-dim">· {formatAgo(article.publishedAt)}</span>
                    <ExternalLink size={9} className="ml-auto text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-[11px] font-mono text-white/80 leading-relaxed">{snippet}</p>
                </a>
              );
            })}
          </div>
        </CollapsibleSection>

        {/* Social Posts — Reddit, X, locked IG/FB */}
        <CollapsibleSection id="social" title="Social Posts" icon="🌐"
          collapsed={collapsedSections} onToggle={toggleSection}>
          {/* Platform tabs */}
          <div className="flex gap-1 pt-1 pb-2 flex-wrap">
            {(['reddit', 'x', 'ig', 'fb'] as const).map(tab => {
              const labels: Record<string, string> = { reddit: '🟠 Reddit', x: '𝕏 X', ig: '📷 Instagram', fb: '👥 Facebook' };
              return (
                <button key={tab} onClick={() => setActiveSocialTab(tab)}
                  className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors flex items-center gap-1 ${
                    activeSocialTab === tab
                      ? 'bg-accent/15 text-accent border-accent/30'
                      : 'text-dim hover:text-white border-border hover:border-accent/40'
                  }`}>
                  {labels[tab]}
                </button>
              );
            })}
          </div>

          {/* Content */}
          {activeSocialTab === 'reddit' && (
            loadingSocial ? (
              <div className="text-[10px] text-dim font-mono animate-pulse">Fetching Reddit posts…</div>
            ) : socialPosts.reddit.length > 0 || redditInlinePosts.length > 0 ? (
              <div className="space-y-2">
                {socialPosts.reddit.map((post, i) => (
                  <a key={i} href={post.url} target="_blank" rel="noopener noreferrer"
                    className="block p-2.5 rounded border border-border bg-orange-500/5 hover:bg-orange-500/10 hover:border-orange-500/30 transition-colors group">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-mono text-orange-400">{post.author}</span>
                      {post.ago && <span className="text-[10px] text-dim">· {post.ago}</span>}
                      <ExternalLink size={9} className="ml-auto text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-[11px] text-white/80 leading-relaxed line-clamp-3">{post.title}</p>
                  </a>
                ))}
                {redditInlinePosts.map((post, i) => (
                  <a key={`inline-reddit-${i}`} href={post.url} target="_blank" rel="noopener noreferrer"
                    className="block p-2.5 rounded border border-border bg-orange-500/5 hover:bg-orange-500/10 hover:border-orange-500/30 transition-colors group">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-mono text-orange-400">{post.author}</span>
                      <span className="text-[10px] text-dim">· from source link</span>
                      <ExternalLink size={9} className="ml-auto text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-[11px] text-white/80 leading-relaxed line-clamp-3">{post.title}</p>
                  </a>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-dim font-mono py-1">No Reddit posts found for this story.</p>
              </div>
            )
          )}

          {activeSocialTab === 'x' && (
            loadingSocial ? (
              <div className="text-[10px] text-dim font-mono animate-pulse">Fetching X posts…</div>
            ) : socialPosts.x.length > 0 || xInlinePosts.length > 0 ? (
              <div className="space-y-2">
                {[...socialPosts.x, ...xInlinePosts].map((post, i) => (
                  <a key={`x-${i}`} href={post.url} target="_blank" rel="noopener noreferrer"
                    className="block p-2.5 rounded border border-border bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/30 transition-colors group">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-mono text-blue-400">{post.author}</span>
                      {post.ago && <span className="text-[10px] text-dim">· {post.ago}</span>}
                      {!post.ago && <span className="text-[10px] text-dim">· from source link</span>}
                      <ExternalLink size={9} className="ml-auto text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-[11px] text-white/80 leading-relaxed line-clamp-3">{post.title}</p>
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <p className="text-[11px] text-dim font-mono leading-relaxed max-w-[240px]">No X posts found for this story.</p>
                <a
                  href={`https://x.com/search?q=${encodeURIComponent(selectedCluster.headline)}&src=typed_query&f=live`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-blue-500/40 bg-blue-500/10 text-blue-400 text-[11px] font-mono hover:bg-blue-500/20 transition-colors"
                >
                  Open X search <ExternalLink size={10} />
                </a>
              </div>
            )
          )}

          {activeSocialTab === 'ig' && (
            igInlinePosts.length > 0 ? (
              <div className="space-y-2">
                {igInlinePosts.map((post, i) => (
                  <a key={`ig-${i}`} href={post.url} target="_blank" rel="noopener noreferrer"
                    className="block p-2.5 rounded border border-border bg-pink-500/5 hover:bg-pink-500/10 hover:border-pink-500/30 transition-colors group">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-mono text-pink-400">{post.author}</span>
                      <span className="text-[10px] text-dim">· from source link</span>
                      <ExternalLink size={9} className="ml-auto text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-[11px] text-white/80 leading-relaxed line-clamp-3">{post.title}</p>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-dim font-mono py-1">No Instagram posts found in source links for this story.</p>
            )
          )}

          {activeSocialTab === 'fb' && (
            fbInlinePosts.length > 0 ? (
              <div className="space-y-2">
                {fbInlinePosts.map((post, i) => (
                  <a key={`fb-${i}`} href={post.url} target="_blank" rel="noopener noreferrer"
                    className="block p-2.5 rounded border border-border bg-indigo-500/5 hover:bg-indigo-500/10 hover:border-indigo-500/30 transition-colors group">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-mono text-indigo-300">{post.author}</span>
                      <span className="text-[10px] text-dim">· from source link</span>
                      <ExternalLink size={9} className="ml-auto text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-[11px] text-white/80 leading-relaxed line-clamp-3">{post.title}</p>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-dim font-mono py-1">No Facebook posts found in source links for this story.</p>
            )
          )}
        </CollapsibleSection>

        {/* Video — live coverage only (YouTube, Rumble, Kick), not social clips */}
        <CollapsibleSection id="video" title="Video Coverage" icon={<PlayCircle size={11} className="text-accent" />}
          badge={mediaEmbeds.length > 1 ? `${activeVideoIdx + 1}/${mediaEmbeds.length}` : undefined}
          collapsed={collapsedSections} onToggle={toggleSection}>
          {mediaEmbeds.length > 0 ? (
            <div className="rounded border border-border overflow-hidden bg-black/30 mt-1">
              <div className="px-2 py-1 border-b border-border flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono text-dim uppercase">{mediaEmbeds[activeVideoIdx].platform}</span>
                <div className="flex items-center gap-2">
                  {mediaEmbeds.length > 1 && (
                    <>
                      <button onClick={() => setActiveVideoIdx(i => Math.max(0, i - 1))} disabled={activeVideoIdx === 0}
                        className="text-[11px] text-dim hover:text-white disabled:opacity-30">◀</button>
                      <button onClick={() => setActiveVideoIdx(i => Math.min(mediaEmbeds.length - 1, i + 1))} disabled={activeVideoIdx === mediaEmbeds.length - 1}
                        className="text-[11px] text-dim hover:text-white disabled:opacity-30">▶</button>
                    </>
                  )}
                  <a href={mediaEmbeds[activeVideoIdx].originalUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-accent hover:underline flex items-center gap-1">
                    Open <ExternalLink size={9} />
                  </a>
                </div>
              </div>
              <iframe key={mediaEmbeds[activeVideoIdx].embedUrl} src={mediaEmbeds[activeVideoIdx].embedUrl}
                title={`video-${activeVideoIdx}`} className="w-full h-52" loading="lazy" allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              />
            </div>
          ) : (
            <div className="rounded border border-border bg-black/20 py-6 flex flex-col items-center justify-center gap-2 text-dim mt-1">
              <PlayCircle size={20} className="opacity-30" />
              <p className="text-[11px] font-mono text-center">No video (YouTube/Rumble) found for this story.</p>
              <p className="text-[10px] font-mono text-dim/60 text-center">Reddit and social posts are in the Social Posts tab above.</p>
            </div>
          )}
        </CollapsibleSection>

        {/* Loading skeleton while AI is analyzing */}
        {!analysis && loading && (
          <div className="px-4 py-4 space-y-4 animate-pulse">
            <div className="text-[10px] font-mono text-dim uppercase tracking-wider mb-2">Analyzing perspectives…</div>
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded border border-border/40 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-16 h-3 bg-white/10 rounded" />
                  <div className="w-8 h-3 bg-white/5 rounded" />
                </div>
                <div className="w-full h-2.5 bg-white/10 rounded" />
                <div className="w-4/5 h-2.5 bg-white/10 rounded" />
                <div className="w-3/5 h-2.5 bg-white/5 rounded" />
              </div>
            ))}
            <div className="space-y-1.5 pt-2">
              <div className="w-32 h-2.5 bg-accent/20 rounded" />
              <div className="w-5/6 h-2 bg-white/5 rounded" />
              <div className="w-4/6 h-2 bg-white/5 rounded" />
            </div>
          </div>
        )}

        {/* CTA to run analysis */}
        {!analysis && !loading && (
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
            <Section title="All-Sides Synthesis" icon="◉" color="text-cyan-300">
              <div className="grid grid-cols-1 gap-2">
                <QuickSide
                  title="Western / Progressive"
                  tone="text-blue-300"
                  text={summarizeBloc(analysis.sourceAnalyses.filter(sa => sa.biasColor === 'left'))}
                />
                <QuickSide
                  title="Center / Wire"
                  tone="text-gray-300"
                  text={summarizeBloc(analysis.sourceAnalyses.filter(sa => sa.biasColor === 'center'))}
                />
                <QuickSide
                  title="Right / Nationalist"
                  tone="text-red-300"
                  text={summarizeBloc(analysis.sourceAnalyses.filter(sa => sa.biasColor === 'right'))}
                />
                <QuickSide
                  title="State / Gulf / OSINT"
                  tone="text-purple-300"
                  text={summarizeBloc(
                    analysis.sourceAnalyses.filter(sa =>
                      sa.biasColor === 'state' || sa.biasColor === 'gulf' || sa.biasColor === 'osint'
                    )
                  )}
                />
              </div>
            </Section>

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
                      <p className="text-xs text-white/80 italic leading-relaxed flex-1">{q}</p>
                      <button
                        onClick={() => copyQuestion(q, i)}
                        title="Copy question"
                        className="text-dim hover:text-white transition-colors"
                      >
                        {copiedQuestionIdx === i ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                      </button>
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
