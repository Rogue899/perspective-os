/**
 * Global Keyword Monitor
 * ─────────────────────
 * Runs as a persistent background service after keywords are generated.
 * Every CHECK_INTERVAL_MS it polls:
 *   • Google News RSS   — mainstream + regional coverage
 *   • Reddit RSS search — community/social signal
 *   • Nitter RSS search — X / public social posts
 *
 * Only NEW URLs (not seen before) are reported via the `onHit` callback.
 * The caller (AppContext via App.tsx) stores hits globally so every panel can read them.
 *
 * Usage:
 *   startKeywordMonitor(['Ukraine ceasefire', 'AI chips ban'], (hits) => dispatch(ADD_KEYWORD_HITS, hits));
 *   updateKeywords(['new keyword set']);
 *   stopKeywordMonitor();
 */

import type { KeywordHit, KeywordHitSource } from '../types';

const CHECK_INTERVAL_MS = 90_000; // 90 seconds between full sweeps
const MAX_ITEMS_PER_SOURCE = 5;
const MAX_HITS_STORED = 100;      // caller should cap; exported for reference

// ─── Module-level singleton state ────────────────────────────────────────────
let _keywords: string[]               = [];
let _onHit: ((hits: KeywordHit[]) => void) | null = null;
let _intervalId: ReturnType<typeof setInterval> | null = null;
const _seenUrls = new Set<string>();

export { MAX_HITS_STORED };

// ─── Public API ───────────────────────────────────────────────────────────────

/** Start (or restart) the periodic monitor with a new keyword list. */
export function startKeywordMonitor(
  keywords: string[],
  onHit: (hits: KeywordHit[]) => void,
  intervalMs = CHECK_INTERVAL_MS,
): void {
  _keywords = keywords;
  _onHit    = onHit;

  if (_intervalId !== null) clearInterval(_intervalId);

  // Immediate first sweep
  void runSweep();

  _intervalId = setInterval(() => void runSweep(), intervalMs);
  console.info(`[KeywordMonitor] Started — ${keywords.length} keywords, every ${intervalMs / 1000}s`);
}

/** Hot-swap keywords without restarting the timer. Next sweep picks up new list. */
export function updateKeywords(keywords: string[]): void {
  _keywords = keywords;
}

/** Stop the background monitor. */
export function stopKeywordMonitor(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

/** True if the monitor is currently running. */
export function isMonitorRunning(): boolean {
  return _intervalId !== null;
}

/** Reset seen-URL dedup cache (call when keyword list completely changes). */
export function resetSeenUrls(): void {
  _seenUrls.clear();
}

// ─── Core sweep ───────────────────────────────────────────────────────────────

async function runSweep(): Promise<void> {
  if (_keywords.length === 0 || !_onHit) return;

  const results = await Promise.allSettled(
    _keywords.flatMap(keyword => [
      fetchGoogleNewsHits(keyword),
      fetchRedditHits(keyword),
      fetchNitterHits(keyword),
    ])
  );

  const allHits: KeywordHit[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allHits.push(...r.value);
  }

  if (allHits.length > 0) {
    console.debug(`[KeywordMonitor] ${allHits.length} new hits across ${_keywords.length} keywords`);
    _onHit(allHits);
  }
}

// ─── Source fetchers ──────────────────────────────────────────────────────────

async function fetchGoogleNewsHits(keyword: string): Promise<KeywordHit[]> {
  const clean = stripPrefix(keyword);
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(clean)}&hl=en&gl=US&ceid=US:en`;
  const proxyUrl = `/api/rss-proxy?url=${encodeURIComponent(rssUrl)}`;

  try {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, keyword, 'google-news', 'link', 'title', 'description', 'pubDate');
  } catch {
    return [];
  }
}

async function fetchRedditHits(keyword: string): Promise<KeywordHit[]> {
  const clean = stripPrefix(keyword);
  // Reddit Atom feed — `entry` not `item`
  const rssUrl = `https://www.reddit.com/search.rss?q=${encodeURIComponent(clean)}&sort=new&limit=${MAX_ITEMS_PER_SOURCE}&t=day`;
  const proxyUrl = `/api/rss-proxy?url=${encodeURIComponent(rssUrl)}`;

  try {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseAtomEntries(xml, keyword, 'reddit');
  } catch {
    return [];
  }
}

async function fetchNitterHits(keyword: string): Promise<KeywordHit[]> {
  const clean = stripPrefix(keyword);
  // Nitter public search RSS (X mirror — no key required)
  const rssUrl = `https://nitter.net/search/rss?f=tweets&q=${encodeURIComponent(clean)}&lang=en`;
  const proxyUrl = `/api/rss-proxy?url=${encodeURIComponent(rssUrl)}`;

  try {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, keyword, 'meta-og', 'link', 'title', 'description', 'pubDate');
  } catch {
    return [];
  }
}

// ─── XML parsers ──────────────────────────────────────────────────────────────

/** Parse standard RSS 2.0 `<item>` elements. */
function parseRssItems(
  xml: string,
  keyword: string,
  source: KeywordHitSource,
  linkTag: string,
  titleTag: string,
  descTag: string,
  dateTag: string,
): KeywordHit[] {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xml, 'text/xml');
  const items  = Array.from(doc.querySelectorAll('item')).slice(0, MAX_ITEMS_PER_SOURCE);
  const hits: KeywordHit[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    const url = getText(item, linkTag) || getAttr(item, 'link', 'href');
    if (!url || _seenUrls.has(url)) continue;

    _seenUrls.add(url);
    hits.push({
      id:          hashUrl(url),
      keyword,
      title:       cleanText(getText(item, titleTag)),
      url,
      source,
      publishedAt: getText(item, dateTag) || now,
      snippet:     cleanText(getText(item, descTag)).slice(0, 160),
      seenAt:      now,
      isNew:       true,
    });
  }
  return hits;
}

/** Parse Atom 1.0 `<entry>` elements (Reddit uses Atom). */
function parseAtomEntries(
  xml: string,
  keyword: string,
  source: KeywordHitSource,
): KeywordHit[] {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xml, 'text/xml');
  const entries = Array.from(doc.querySelectorAll('entry')).slice(0, MAX_ITEMS_PER_SOURCE);
  const hits: KeywordHit[] = [];
  const now = new Date().toISOString();

  for (const entry of entries) {
    const url = getAttr(entry, 'link', 'href') || getText(entry, 'id');
    if (!url || _seenUrls.has(url)) continue;

    _seenUrls.add(url);
    hits.push({
      id:          hashUrl(url),
      keyword,
      title:       cleanText(getText(entry, 'title')),
      url,
      source,
      publishedAt: getText(entry, 'updated') || getText(entry, 'published') || now,
      snippet:     cleanText(getText(entry, 'content') || getText(entry, 'summary')).slice(0, 160),
      seenAt:      now,
      isNew:       true,
    });
  }
  return hits;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip "rumour:" / "rumor:" prefix from keyword before using as search query. */
function stripPrefix(keyword: string): string {
  return keyword.replace(/^rumou?r:\s*/i, '').trim();
}

function getText(el: Element, tag: string): string {
  return el.querySelector(tag)?.textContent?.trim() ?? '';
}

function getAttr(el: Element, tag: string, attr: string): string {
  return el.querySelector(tag)?.getAttribute(attr)?.trim() ?? '';
}

/** Strip HTML tags and decode common HTML entities. */
function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/\s+/g,    ' ')
    .trim();
}

/** Simple non-crypto hash for stable ID from URL. */
function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}
