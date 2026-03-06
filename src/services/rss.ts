/**
 * RSS Service
 * Fetches and parses RSS feeds through the /api/rss-proxy edge function.
 * Returns normalized RawArticle arrays.
 */

import type { RawArticle } from '../types';
import { getSourceById } from '../config/sources';
import { fetchWithBreaker, getCircuitState, getAllCircuitStates } from './circuit-breaker';

const FEED_CACHE = new Map<string, { articles: RawArticle[]; fetchedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min client-side cache

export { getCircuitState, getAllCircuitStates }; // re-export for UI status badges

export async function fetchFeed(sourceId: string, topic = 'world news'): Promise<RawArticle[]> {
  const source = getSourceById(sourceId);
  if (!source) return [];
  const resolvedRss = source.rss.replace(/__TOPIC__/g, encodeURIComponent(topic));
  const cacheKey = `${sourceId}::${topic}`;

  // Check client-side cache first
  const cached = FEED_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.articles;
  }

  // Use circuit breaker for all RSS fetches
  const result = await fetchWithBreaker(sourceId, resolvedRss, {
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' },
  });

  if (!result.ok) {
    // Return stale cache from circuit breaker if available, otherwise client cache
    if (result.stale) {
      const staleArticles = parseRSS(result.stale, sourceId, source.name);
      if (staleArticles.length > 0) return staleArticles;
    }
    return FEED_CACHE.get(cacheKey)?.articles ?? [];
  }

  const articles = parseRSS(result.body, sourceId, source.name);
  FEED_CACHE.set(cacheKey, { articles, fetchedAt: Date.now() });
  return articles;
}

export async function fetchAllFeeds(sourceIds: string[], topic = 'world news'): Promise<RawArticle[]> {
  const results = await Promise.allSettled(sourceIds.map(id => fetchFeed(id, topic)));
  return results
    .filter((r): r is PromiseFulfilledResult<RawArticle[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

function parseRSS(xml: string, sourceId: string, sourceName: string): RawArticle[] {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) throw new Error('XML parse error');

    // Support both RSS 2.0 and Atom
    const isAtom = doc.querySelector('feed') !== null;
    const items = isAtom
      ? Array.from(doc.querySelectorAll('entry'))
      : Array.from(doc.querySelectorAll('item'));

    return items.slice(0, 12).map(item => {
      const get = (tag: string) => item.querySelector(tag)?.textContent?.trim() ?? '';

      const title = get('title');
      const description = stripHtml(get('description') || get('summary') || get('content'));
      const url = isAtom
        ? (item.querySelector('link')?.getAttribute('href') ?? get('link'))
        : (get('link') || (item.querySelector('link')?.textContent ?? ''));
      const pubStr = get('pubDate') || get('published') || get('updated');
      const publishedAt = pubStr ? new Date(pubStr) : new Date();

      return {
        sourceId,
        sourceName,
        title: stripHtml(title),
        description: description.slice(0, 600),
        url: url.trim(),
        publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
      } satisfies RawArticle;
    }).filter(a => a.title && a.url);
  } catch (err) {
    console.warn(`[RSS] Parse error for ${sourceId}:`, err);
    return [];
  }
}

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
