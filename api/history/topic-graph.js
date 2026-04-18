/**
 * /api/history/topic-graph
 *
 * Vercel Edge runtime endpoint.
 * POST { query, storyClusterId?, forceRefresh? }
 *
 * Builds an EventGraphBundle for a free-text topic query by:
 *  1. Checking Upstash Redis cache
 *  2. Fetching Wikipedia REST + GDELT + Internet Archive
 *  3. Constructing a minimal EventGraphBundle (mirrors history-graph-adapter logic)
 *  4. Caching the result for 30 days
 *
 * Note on imports: src/services/event-graph.ts imports from ./gdelt which uses
 * a relative proxy path (/api/gdelt) that only works in the browser.  We
 * therefore replicate the data-fetching logic here using absolute upstream URLs.
 * src/utils/event-graph.ts is pure TypeScript with no Node-specific imports and
 * is fetch-based — it WOULD be Edge-compatible in principle, but the Vite/TS
 * compilation boundary means we cannot import raw .ts files from a .js Edge
 * function.  We implement equivalent graph-construction logic inline below.
 */

export const config = { runtime: 'edge' };

import { normalizeSlug }  from '../_lib/slug.js';
import {
  getTopicGraph,
  setTopicGraph,
  acquireLock,
  releaseLock,
  waitForTopicGraph,
} from '../_lib/history-cache.js';
import { checkRateLimit } from '../_lib/history-ratelimit.js';

// ─── CORS helper (mirrors api/ai.js) ─────────────────────────────────────────

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin',  '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

// ─── Minimal graph construction (mirrors src/utils/event-graph.ts logic) ─────
//
// We only need createHistoricalContextGraph behaviour: given a root event + a
// list of HistoricalContextItems, produce an EventGraphBundle.  We inline a
// simplified JS version here so we don't import TS source files.

function fnv32(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function makeId(prefix, ...parts) {
  return `${prefix}_${fnv32(parts.join('|'))}`;
}

function makeConfidence(dimensions, explanation) {
  const vals = Object.values(dimensions).filter(v => typeof v === 'number');
  const overall = vals.length > 0
    ? Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2))
    : 0;
  const tier =
    overall >= 0.8 ? 'high' :
    overall >= 0.6 ? 'medium' :
    overall > 0    ? 'low'   : 'unknown';
  return { overall, tier, dimensions, explanation, signals: {} };
}

function classifySource(provider, url) {
  if (provider === 'wikipedia' || url.includes('wikipedia.org')) {
    return { accessClass: 'open', sourceClass: 'encyclopedia' };
  }
  if (provider === 'gdelt') {
    return { accessClass: 'open', sourceClass: 'open-dataset' };
  }
  if (provider === 'internet-archive' || url.includes('web.archive.org')) {
    return { accessClass: 'open', sourceClass: 'archive' };
  }
  return { accessClass: 'open', sourceClass: 'open-dataset' };
}

/**
 * Build a minimal EventGraphBundle from a root EventNode + HistoricalContextItems.
 * Mirrors createHistoricalContextGraph from src/utils/event-graph.ts.
 *
 * @param {object} rootEvent  — synthetic EventNode
 * @param {Array}  items      — HistoricalContextItem[]
 * @returns {object}          — EventGraphBundle
 */
function buildHistoricalBundle(rootEvent, items) {
  const sourceDocuments = [];
  const claims          = [];
  const evidence        = [];
  const edges           = [];

  for (const item of items) {
    const sourceMeta = classifySource(item.provider, item.url);

    const docId = makeId('doc', item.provider, item.url);
    const sourceDocument = {
      id: docId,
      nodeType: 'source-document',
      label: item.title,
      summary: item.snippet,
      sourceId: item.provider,
      sourceName: item.provider,
      sourceClass: item.sourceClass ?? sourceMeta.sourceClass,
      accessClass: item.accessClass ?? sourceMeta.accessClass,
      publisher: item.provider,
      url: item.url,
      publishedAt: item.publishedAt ?? undefined,
      excerpt: item.excerpt ?? item.snippet,
      confidence: makeConfidence(
        { provenance: 0.8 },
        ['Historical source document is preserved as provenance for graph enrichment.'],
      ),
      metadata: item.metadata ?? null,
    };

    const claimId = makeId('claim', rootEvent.id, 'historical', item.provider, item.title);
    const claim = {
      id: claimId,
      nodeType: 'claim',
      label: item.title,
      summary: item.snippet,
      eventId: rootEvent.id,
      claimType: item.provider === 'gdelt' ? 'structured-signal' : 'historical-context',
      text: item.snippet || item.title,
      evidenceIds: [],
      contradictionEvidenceIds: [],
      entityIds: rootEvent.entityIds,
      placeIds: rootEvent.placeIds,
      confidence: makeConfidence(
        {
          provenance: item.provider === 'internet-archive' ? 0.88 : 0.76,
          linkage:    0.7,
          existence:  item.provider === 'gdelt' ? 0.8 : 0.68,
        },
        ['Historical context claim is attached to the event through cited source material.'],
      ),
    };

    const evidenceId = makeId('evidence', claimId, docId, (sourceDocument.excerpt || sourceDocument.label).slice(0, 80));
    const evidenceNode = {
      id: evidenceId,
      nodeType: 'evidence',
      label: `${item.provider} evidence`,
      summary: sourceDocument.excerpt || sourceDocument.label,
      claimId,
      sourceDocumentId: docId,
      accessClass: sourceDocument.accessClass,
      sourceClass: sourceDocument.sourceClass,
      excerpt: sourceDocument.excerpt || sourceDocument.label,
      locator: sourceDocument.url,
      retrievedAt: new Date().toISOString(),
      generated: false,
      contradiction: false,
      confidence: makeConfidence(
        { provenance: 0.85, existence: 0.75 },
        ['Evidence node is anchored to a concrete source document excerpt.'],
      ),
    };

    claim.evidenceIds.push(evidenceId);
    sourceDocuments.push(sourceDocument);
    claims.push(claim);
    evidence.push(evidenceNode);

    const supportEdgeId = makeId('edge', docId, 'supports', claimId);
    edges.push({
      id: supportEdgeId,
      sourceId: docId,
      targetId: claimId,
      relation: 'supports',
      confidence: makeConfidence(
        { linkage: 0.68, provenance: 0.72 },
        ['Historical source document supports the attached claim.'],
      ),
    });

    const contextEdgeId = makeId('edge', claimId, 'background-context', rootEvent.id);
    edges.push({
      id: contextEdgeId,
      sourceId: claimId,
      targetId: rootEvent.id,
      relation: 'background-context',
      confidence: makeConfidence(
        { linkage: 0.68, provenance: 0.72 },
        ['Historical claim provides background context for the event.'],
      ),
    });
  }

  return {
    events:           [rootEvent],
    claims,
    entities:         [],
    places:           [],
    sourceDocuments,
    evidence,
    edges,
    perspectiveViews: [],
  };
}

// ─── Data fetchers (server-side, absolute URLs) ───────────────────────────────

const SKIP_WORDS = new Set([
  'the', 'this', 'that', 'they', 'then', 'there', 'with', 'from', 'into', 'over',
  'after', 'says', 'amid', 'hits', 'kills', 'dead', 'will', 'warns', 'report',
  'reports', 'more', 'also', 'both', 'when', 'what', 'where', 'and', 'for',
]);

/** Extract meaningful title-case tokens from a query for Wikipedia lookups */
function extractTerms(query) {
  // First try capitalized words from the raw query
  const capitalWords = query.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  const filtered = [...new Set(capitalWords)].filter(w => !SKIP_WORDS.has(w.toLowerCase()));
  if (filtered.length > 0) return filtered.slice(0, 3);
  // Fall back to splitting on spaces and using meaningful tokens
  const tokens = query.split(/\s+/).filter(t => t.length >= 3 && !SKIP_WORDS.has(t.toLowerCase()));
  return tokens.slice(0, 3).map(t => t.charAt(0).toUpperCase() + t.slice(1));
}

/**
 * Fetch Wikipedia article summaries for up to 3 search terms.
 * @param {string[]} terms
 * @returns {Promise<object[]>} HistoricalContextItem[]
 */
async function fetchWikipedia(terms) {
  const items = [];
  for (const term of terms.slice(0, 3)) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`,
        { headers: { 'User-Agent': 'PerspectiveOS/1.0 (tarek.roukoz@growthtechnology.us)' } },
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.extract || data.extract.length <= 80 || data.type === 'disambiguation') continue;
      items.push({
        provider: 'wikipedia',
        title: data.title,
        snippet: data.extract.slice(0, 500) + (data.extract.length > 500 ? '\u2026' : ''),
        excerpt: data.extract.slice(0, 280),
        url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(term)}`,
        metadata: { thumbnail: data.thumbnail?.source ?? null },
      });
    } catch {
      // non-fatal
    }
  }
  return items;
}

/**
 * Fetch GDELT articles for the query.
 * Uses the upstream GDELT API directly (no proxy needed server-side).
 * @param {string} query
 * @returns {Promise<object[]>} HistoricalContextItem[]
 */
async function fetchGdelt(query) {
  const items = [];
  try {
    const params = new URLSearchParams({
      query,
      mode:       'artlist',
      maxrecords: '8',
      format:     'json',
      timespan:   '7d',
      sort:       'DateDesc',
    });
    const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`);
    if (!res.ok) return items;
    const data = await res.json();
    const articles = (data.articles ?? []).slice(0, 4);
    for (const article of articles) {
      items.push({
        provider: 'gdelt',
        title:    article.title,
        snippet:  `${article.domain || 'Open source'} \u2022 ${(article.seendate ?? '').slice(0, 8) || 'recent signal'}`,
        excerpt:  article.title,
        url:      article.url,
        metadata: { domain: article.domain, seenDate: article.seendate },
      });
    }
  } catch {
    // non-fatal
  }
  return items;
}

/**
 * Check Internet Archive for a historical snapshot.
 * Since we have no primary article URL for topic queries, we search by query.
 * @param {string} query
 * @returns {Promise<object | null>} HistoricalContextItem | null
 */
async function fetchInternetArchive(query) {
  try {
    // Use CDX API to search for archived pages matching the query as a URL query
    const searchUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(query.split(' ')[0])}`;
    const res = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(searchUrl)}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=1`,
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length < 2 || !Array.isArray(rows[1])) return null;
    const timestamp = String(rows[1][0] ?? '');
    const original  = String(rows[1][1] ?? searchUrl);
    if (timestamp.length < 8) return null;
    const snapshotDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
    return {
      provider: 'internet-archive',
      title:    'Archived snapshot available',
      snippet:  `Historical capture found for this topic (${snapshotDate}).`,
      excerpt:  `Snapshot from ${snapshotDate}`,
      url:      `https://web.archive.org/web/${timestamp}/${original}`,
      metadata: { snapshotDate },
    };
  } catch {
    return null;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }));
  }

  if (req.method !== 'POST') {
    return cors(new Response('Method not allowed', { status: 405 }));
  }

  // Extract client IP
  const ip =
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return cors(new Response('Bad JSON', { status: 400 }));
  }

  const { query, storyClusterId, forceRefresh = false } = body ?? {};

  // Validate query
  if (!query || typeof query !== 'string') {
    return cors(Response.json({ error: 'query is required' }, { status: 400 }));
  }
  if (query.trim().length < 3) {
    return cors(Response.json({ error: 'query too short (min 3 characters)' }, { status: 400 }));
  }
  if (query.trim().length > 200) {
    return cors(Response.json({ error: 'query too long (max 200 characters)' }, { status: 400 }));
  }

  // Normalize slug
  let slug;
  try {
    slug = normalizeSlug(query);
  } catch (err) {
    return cors(Response.json({ error: err.message }, { status: 400 }));
  }

  // Rate limit — use 'refresh' budget for forced regeneration, 'gen' otherwise
  const budget = forceRefresh ? 'refresh' : 'gen';
  const rl = await checkRateLimit(ip, budget);
  if (!rl.allowed) {
    return cors(
      Response.json(
        { error: 'Rate limit exceeded', retryAfter: rl.retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfter) },
        },
      ),
    );
  }

  const startMs = Date.now();

  // Cache hit path (skip when forceRefresh)
  if (!forceRefresh) {
    const cached = await getTopicGraph(slug);
    if (cached) {
      return cors(
        Response.json({
          bundle: cached,
          cache: { hit: true, ageSeconds: null, ttlExtended: true },
          diagnostics: { durationMs: Date.now() - startMs, sourcesUsed: ['cache'] },
        }),
      );
    }
  }

  // Deduplication lock — if we can't acquire, wait for another worker to finish
  const lockAcquired = await acquireLock(slug);
  if (!lockAcquired) {
    const waited = await waitForTopicGraph(slug);
    if (waited) {
      return cors(
        Response.json({
          bundle: waited,
          cache: { hit: true, ageSeconds: null, ttlExtended: false },
          diagnostics: { durationMs: Date.now() - startMs, sourcesUsed: ['cache:waited'] },
        }),
      );
    }
    // Timed out waiting — fall through to generate ourselves
  }

  const sourcesUsed = [];

  try {
    // Build synthetic root EventNode
    const rootEvent = {
      id:               `topic:${slug}`,
      nodeType:         'event',
      label:            query.trim(),
      canonicalKey:     slug,
      category:         'general',
      current:          false,
      tags:             [],
      placeIds:         [],
      entityIds:        [],
      claimIds:         [],
      sourceDocumentIds:[],
      metadata: {
        storyClusterId: storyClusterId ?? null,
      },
      confidence: {
        overall:    0.5,
        tier:       'medium',
        dimensions: { provenance: 0.5 },
        explanation:['Synthetic topic root node — confidence reflects topic-level aggregation.'],
        signals:    {},
      },
    };

    // Derive search terms
    const terms = extractTerms(query);

    // Fetch historical context from multiple providers in parallel
    const [wikiItems, gdeltItems, iaItem] = await Promise.all([
      fetchWikipedia(terms.length > 0 ? terms : [query.trim()]),
      fetchGdelt(query.trim()),
      fetchInternetArchive(query.trim()),
    ]);

    if (wikiItems.length  > 0) sourcesUsed.push('wikipedia');
    if (gdeltItems.length > 0) sourcesUsed.push('gdelt');
    if (iaItem)                sourcesUsed.push('internet-archive');

    const historyItems = [
      ...wikiItems,
      ...gdeltItems,
      ...(iaItem ? [iaItem] : []),
    ];

    // Build the EventGraphBundle
    const bundle = buildHistoricalBundle(rootEvent, historyItems);

    // Persist to cache
    await setTopicGraph(slug, bundle);

    const durationMs = Date.now() - startMs;

    return cors(
      Response.json({
        bundle,
        cache:       { hit: false, ageSeconds: null, ttlExtended: false },
        diagnostics: { durationMs, sourcesUsed },
      }),
    );
  } catch (err) {
    console.error('[topic-graph] generation error:', err);
    return cors(
      Response.json(
        { error: 'Topic graph generation failed', details: err?.message ?? 'unknown' },
        { status: 500 },
      ),
    );
  } finally {
    if (lockAcquired) {
      await releaseLock(slug);
    }
  }
}
