import { searchGdelt, type GdeltArticle } from './gdelt';
import type { HistoricalContextItem, StoryCluster } from '../types';
import { fetchWithSettings } from './integration-settings';

export interface EventGraphActorEntry {
  name: string;
  mentions: number;
}

export interface EventGraphHistoryContext {
  searchTerms: string[];
  historyItems: HistoricalContextItem[];
  gdeltArticles: GdeltArticle[];
  actors: EventGraphActorEntry[];
}

function toClusterList(subject: StoryCluster | StoryCluster[]): StoryCluster[] {
  return Array.isArray(subject) ? subject : [subject];
}

function getSubjectLabel(subject: StoryCluster | StoryCluster[]): string {
  const clusters = toClusterList(subject);
  if (clusters.length === 0) return 'Current event graph';
  if (clusters.length === 1) return clusters[0].headline;
  const geoName = clusters.find(cluster => cluster.geoHint?.name)?.geoHint?.name;
  return geoName ? `${geoName} area event graph` : `${clusters.length} nearby events`;
}

const SKIP_WORDS = new Set([
  'The', 'This', 'That', 'They', 'Then', 'There', 'With', 'From', 'Into', 'Over',
  'After', 'Says', 'Amid', 'Hits', 'Kills', 'Dead', 'Will', 'Warns', 'Report',
  'Reports', 'More', 'Also', 'Both', 'When', 'What', 'Where',
]);

export function extractEventGraphSearchTerms(subject: StoryCluster | StoryCluster[]): string[] {
  const clusters = toClusterList(subject);
  const terms: string[] = [];
  for (const cluster of clusters) {
    if (cluster.geoHint?.name) terms.push(cluster.geoHint.name);
    const matches = cluster.headline.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
    const unique = [...new Set(matches)].filter(word => !SKIP_WORDS.has(word));
    terms.push(...unique.slice(0, 3));
  }
  return [...new Set(terms)].slice(0, clusters.length > 1 ? 6 : 3);
}

export function extractActorsFromText(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) ?? [];
  return matches.filter(name => !SKIP_WORDS.has(name.split(' ')[0]));
}

export function buildEventHistoryTimeline(subject: StoryCluster | StoryCluster[]): string[] {
  return toClusterList(subject)
    .flatMap(cluster => cluster.articles)
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
    .slice(0, 8)
    .map(article => `${new Date(article.publishedAt).toISOString().slice(0, 10)} | ${article.sourceName}: ${article.title}`);
}

export function isEmptyAiResponse(text: string): boolean {
  const cleaned = text.trim();
  return !cleaned || cleaned === '{}' || cleaned === '[]' || cleaned.toLowerCase() === 'null';
}

export function buildLocalHistoryFallback(params: {
  headline: string;
  timeline: string[];
  actors: EventGraphActorEntry[];
  gdelt: GdeltArticle[];
}): string {
  const first = params.timeline[params.timeline.length - 1] ?? 'Earlier reporting is still sparse.';
  const latest = params.timeline[0] ?? 'Recent reporting is still forming.';
  const actorLine = params.actors.slice(0, 4).map(actor => actor.name).join(', ');
  const gdeltLine = params.gdelt.slice(0, 2).map(item => `${item.domain}: ${item.title}`).join(' | ');

  return [
    `The current record around "${params.headline}" shows an evolving event with uneven historical grounding. Early coverage emphasized: ${first}. More recent reporting emphasizes: ${latest}.`,
    '',
    'Inflection points:',
    `- Early framing: ${first}`,
    `- Recent framing: ${latest}`,
    `- Recurring actors: ${actorLine || 'limited named-actor overlap so far'}`,
    '',
    'Perspective gaps:',
    '- Attribution, sequencing, and intent are still contested across reporting lanes.',
    `- Open-source corroboration is still partial${gdeltLine ? `; current structured signals include ${gdeltLine}` : ''}.`,
  ].join('\n');
}

export async function fetchEventGraphHistoryContext(
  subject: StoryCluster | StoryCluster[],
  searchTerms = extractEventGraphSearchTerms(subject),
): Promise<EventGraphHistoryContext> {
  const clusters = toClusterList(subject);
  const primaryCluster = clusters[0];
  const historyItems: HistoricalContextItem[] = [];

  const actorCounter = new Map<string, number>();
  for (const cluster of clusters) {
    for (const article of cluster.articles) {
      const pool = `${article.title} ${article.description ?? ''}`;
      for (const actor of extractActorsFromText(pool)) {
        actorCounter.set(actor, (actorCounter.get(actor) ?? 0) + 1);
      }
    }
  }

  const actors = [...actorCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, mentions]) => ({ name, mentions }));

  for (const term of searchTerms) {
    try {
      const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`);
      if (!response.ok) continue;
      const data = await response.json();
      if (!data.extract || data.extract.length <= 80 || data.type === 'disambiguation') continue;
      historyItems.push({
        provider: 'wikipedia',
        title: data.title,
        snippet: data.extract.slice(0, 500) + (data.extract.length > 500 ? '…' : ''),
        excerpt: data.extract.slice(0, 280),
        url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(term)}`,
        metadata: {
          thumbnail: data.thumbnail?.source ?? null,
        },
      });
    } catch {
      // noop
    }
  }

  let gdeltArticles: GdeltArticle[] = [];
  try {
    const query = searchTerms.length > 0 ? searchTerms.join(' OR ') : getSubjectLabel(subject);
    gdeltArticles = await searchGdelt(query, 10);
    for (const item of gdeltArticles.slice(0, 4)) {
      historyItems.push({
        provider: 'gdelt',
        title: item.title,
        snippet: `${item.domain || 'Open source'} • ${item.seendate?.slice(0, 8) || 'recent signal'}`,
        excerpt: item.title,
        url: item.url,
        metadata: {
          domain: item.domain,
          seenDate: item.seendate,
        },
      });
    }
  } catch {
    gdeltArticles = [];
  }

  try {
    const primaryUrl = primaryCluster?.articles[0]?.url;
    if (primaryUrl) {
      const response = await fetch(
        `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(primaryUrl)}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=1`,
      );
      if (response.ok) {
        const rows = await response.json();
        if (Array.isArray(rows) && rows.length > 1 && Array.isArray(rows[1])) {
          const timestamp = String(rows[1][0] ?? '');
          const original = String(rows[1][1] ?? primaryUrl);
          if (timestamp.length >= 8) {
            const snapshotDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
            historyItems.push({
              provider: 'internet-archive',
              title: 'Archived snapshot available',
              snippet: `Historical capture found for this story URL (${snapshotDate}).`,
              excerpt: `Snapshot from ${snapshotDate}`,
              url: `https://web.archive.org/web/${timestamp}/${original}`,
              metadata: {
                snapshotDate,
              },
            });
          }
        }
      }
    }
  } catch {
    // noop
  }

  return {
    searchTerms,
    historyItems,
    gdeltArticles,
    actors,
  };
}

export async function synthesizeEventHistory(params: {
  subject: StoryCluster | StoryCluster[];
  headline?: string;
  historyItems: HistoricalContextItem[];
  gdeltArticles: GdeltArticle[];
  actors: EventGraphActorEntry[];
}): Promise<string> {
  const clusters = toClusterList(params.subject);
  const primaryCluster = clusters[0];
  const headline = params.headline ?? getSubjectLabel(params.subject);
  const timelineRows = buildEventHistoryTimeline(params.subject);
  const wikiCtx = params.historyItems
    .filter(item => item.provider === 'wikipedia')
    .map(item => `${item.title}: ${item.snippet}`)
    .join('\n')
    .slice(0, 1400);
  const gdeltCtx = params.gdeltArticles
    .map(item => `${item.seendate} | ${item.domain}: ${item.title}`)
    .join('\n')
    .slice(0, 1400);

  const prompt = `You are a neutral geopolitical historian. Build a concise historical synthesis for this event: "${headline}".

Use these sources:
- Story timeline:\n${timelineRows.join('\n') || 'none'}
- Wikipedia context:\n${wikiCtx || 'none'}
- GDELT open-source context:\n${gdeltCtx || 'none'}

Output format:
1) 1 short paragraph (max 140 words) explaining root context.
2) "Inflection points:" with 3 bullets in chronological order.
3) "Perspective gaps:" with 2 bullets about what is still uncertain.

Be factual, avoid bias, and mark uncertainty clearly.`;

  const request = async (suffix: string) => fetchWithSettings('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      tier: 'flash',
      maxTokens: 520,
      cacheKey: `history-graph:${primaryCluster?.id ?? headline}:${suffix}`,
      cacheTtl: 3600,
    }),
  });

  try {
    let response = await request('main');
    let data = await response.json();
    let cleaned = String(data.text ?? '')
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    if (isEmptyAiResponse(cleaned)) {
      response = await request('retry');
      data = await response.json();
      cleaned = String(data.text ?? '')
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim();
    }

    if (isEmptyAiResponse(cleaned)) {
      cleaned = buildLocalHistoryFallback({
        headline,
        timeline: timelineRows,
        actors: params.actors,
        gdelt: params.gdeltArticles,
      });
    }

    return cleaned;
  } catch {
    return buildLocalHistoryFallback({
      headline,
      timeline: timelineRows,
      actors: params.actors,
      gdelt: params.gdeltArticles,
    });
  }
}
