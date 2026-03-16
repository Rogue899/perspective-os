/**
 * Story Clustering
 * Groups articles covering the same event across different sources.
 * Uses Jaccard token similarity + time proximity (WorldMonitor approach).
 * Optional: upgrade to embedding similarity when /api/embed is available.
 */

import type { RawArticle, ScoredArticle, StoryCluster } from '../types';
import { classifyWithAI, classifyWithKeywords } from '../services/ai';
import { getSourceById } from '../config/sources';
import { detectFocalPoints } from './focal-points';

// ─── Concurrency limiter — prevents 750 parallel HTTP calls ───────────────────
async function limitedParallel<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrent = 5,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < tasks.length) {
      const i = nextIdx++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: maxConcurrent }, worker));
  return results;
}

const SIMILARITY_THRESHOLD = 0.15;  // min Jaccard to cluster
const TIME_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for',
  'of','with','by','from','is','are','was','were','be','been',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','as','this','that','these','those',
  'it','its','not','no','new','after','before','over','under',
  'says','said','say','report','reports','reported',
]);

// ─── Tokenize headline into content words ─────────────────────────────────────
function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
  );
}

// ─── Jaccard similarity between two token sets ────────────────────────────────
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return intersection / union;
}

// ─── Score how divergent sources are (basis for "worth analyzing") ────────────
function calcPerspectiveScore(articles: ScoredArticle[]): number {
  if (articles.length < 2) return 0;
  const sourceCount = new Set(articles.map(a => a.sourceId)).size;
  const leans = articles.map(a => getSourceById(a.sourceId)?.lean ?? 0);
  const spread = Math.max(...leans) - Math.min(...leans);
  // Normalize: max 6 spread (from -3 to +3), max 6 sources
  return Math.min(1, (spread / 6) * 0.6 + (sourceCount / 6) * 0.4);
}

// ─── Infer geo from entity names using a small hub lookup ────────────────────
const GEO_HUBS: Array<{ keywords: string[]; lat: number; lng: number; name: string }> = [
  { keywords: ['ukraine','kyiv','kharkiv','zaporizhzhia','crimea'],    lat: 49.0,  lng: 32.0,   name: 'Ukraine' },
  { keywords: ['russia','moscow','kremlin','putin'],                   lat: 55.75, lng: 37.62,  name: 'Russia' },
  { keywords: ['gaza','hamas','rafah','khan younis'],                 lat: 31.35, lng: 34.31,  name: 'Gaza' },
  { keywords: ['israel','tel aviv','jerusalem','netanyahu','idf'],    lat: 31.77, lng: 35.22,  name: 'Israel' },
  { keywords: ['iran','tehran','khamenei'],                           lat: 35.69, lng: 51.39,  name: 'Iran' },
  { keywords: ['lebanon','beirut','hezbollah','nasrallah'],           lat: 33.89, lng: 35.50,  name: 'Lebanon' },
  { keywords: ['china','beijing','xi jinping','taiwan strait'],       lat: 39.91, lng: 116.39, name: 'China' },
  { keywords: ['taiwan','taipei'],                                    lat: 25.03, lng: 121.56, name: 'Taiwan' },
  { keywords: ['north korea','pyongyang','kim jong'],                 lat: 39.02, lng: 125.75, name: 'North Korea' },
  { keywords: ['syria','damascus','aleppo','hts'],                    lat: 33.51, lng: 36.29,  name: 'Syria' },
  { keywords: ['sudan','khartoum','darfur','rsf'],                   lat: 15.55, lng: 32.53,  name: 'Sudan' },
  { keywords: ['myanmar','burma','naypyidaw','yangon'],               lat: 19.75, lng: 96.10,  name: 'Myanmar' },
  { keywords: ['venezuela','caracas','maduro'],                       lat: 10.49, lng: -66.88, name: 'Venezuela' },
  { keywords: ['somalia','mogadishu','al-shabaab'],                   lat: 2.05,  lng: 45.34,  name: 'Somalia' },
  { keywords: ['sahel','mali','niger','burkina faso','wagner'],       lat: 17.0,  lng: 0.0,    name: 'Sahel' },
  { keywords: ['strait of hormuz','persian gulf'],                    lat: 26.5,  lng: 56.3,   name: 'Strait of Hormuz' },
  { keywords: ['red sea','houthis','bab al-mandeb'],                  lat: 12.6,  lng: 43.5,   name: 'Red Sea' },
  { keywords: ['south china sea','spratly','paracel'],                lat: 14.0,  lng: 114.0,  name: 'South China Sea' },
];

function inferGeo(text: string): { lat: number; lng: number; name: string } | undefined {
  const lower = text.toLowerCase();
  for (const hub of GEO_HUBS) {
    if (hub.keywords.some(k => lower.includes(k))) return { lat: hub.lat, lng: hub.lng, name: hub.name };
  }
  return undefined;
}

// ─── Phase 2: Semantic refinement via Gemini embeddings ──────────────────────

async function fetchEmbedding(title: string): Promise<number[]> {
  try {
    const res = await fetch('/api/embed', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: title.slice(0, 200) }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.embedding) ? data.embedding : [];
  } catch {
    return [];
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length !== a.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

const EMBED_SIMILARITY_THRESHOLD = 0.82;
const PHASE2_MIN_CLUSTERS = 10; // skip Phase 2 below this count — not worth quota

async function refineWithEmbeddings(clusters: StoryCluster[]): Promise<StoryCluster[]> {
  if (clusters.length <= PHASE2_MIN_CLUSTERS) return clusters;

  // Fetch all embeddings with same concurrency limiter (max 5 parallel calls)
  const embeddingTasks = clusters.map(c => () => fetchEmbedding(c.headline));
  const embeddings = await limitedParallel(embeddingTasks, 5);

  const merged = new Set<number>(); // original indices that were absorbed
  const result: StoryCluster[] = [];

  for (let i = 0; i < clusters.length; i++) {
    if (merged.has(i)) continue;

    let base = clusters[i];
    const embI = embeddings[i];
    if (embI.length === 0) { result.push(base); continue; }

    for (let j = i + 1; j < clusters.length; j++) {
      if (merged.has(j)) continue;
      const embJ = embeddings[j];
      if (embJ.length === 0) continue;

      if (cosine(embI, embJ) >= EMBED_SIMILARITY_THRESHOLD) {
        // Merge cluster j into base — dedupe by URL
        const seenUrls = new Set(base.articles.map(a => a.url));
        const newArticles = clusters[j].articles.filter(a => !seenUrls.has(a.url));
        const combined = [...base.articles, ...newArticles]
          .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

        base = {
          ...base,
          articles:       combined,
          sourceIds:      [...new Set(combined.map(a => a.sourceId))],
          updatedAt:      combined[0].publishedAt,
          perspectiveScore: calcPerspectiveScore(combined),
        };
        merged.add(j);
        console.info(`[cluster:embed] merged "${clusters[j].headline}" → "${base.headline}"`);
      }
    }

    result.push(base);
  }

  return result;
}

// ─── Main cluster function ────────────────────────────────────────────────────
export async function clusterArticles(articles: RawArticle[]): Promise<StoryCluster[]> {
  // Step 1: Classify articles
  // Strategy: keyword fallback is synchronous and "good enough" for most articles.
  // Only call the AI for articles where the keyword guesser returns 'general'
  // (ambiguous content) — and cap at MAX_AI_CALLS to avoid flooding the server.
  const MAX_AI_CALLS = 20;
  let aiCallsUsed = 0;

  const tasks = articles.map(a => async (): Promise<ScoredArticle> => {
    const text = `${a.title} ${a.description}`.slice(0, 300);
    const keywordResult = classifyWithKeywords(text);

    let classification = keywordResult;

    // Only upgrade to AI if keyword classifier is uncertain AND budget remains
    if (keywordResult.category === 'general' && aiCallsUsed < MAX_AI_CALLS) {
      aiCallsUsed++;
      try {
        const aiResult = await classifyWithAI(text);
        classification = aiResult;
      } catch {
        // Keep keyword result
      }
    }

    return {
      ...a,
      severity: classification.severity as ScoredArticle['severity'],
      category: classification.category as ScoredArticle['category'],
      sentiment: classification.sentiment,
      entities: classification.entities,
      geoHint: inferGeo(`${a.title} ${a.description}`),
    };
  });

  // Run with max 5 concurrent AI calls to avoid overwhelming the dev server
  const scored = await limitedParallel(tasks, 5);

  // Step 2: Cluster by Jaccard + time window
  const clusters: StoryCluster[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < scored.length; i++) {
    if (assigned.has(i)) continue;
    const base = scored[i];
    const baseTokens = tokenize(base.title);
    const group: ScoredArticle[] = [base];
    assigned.add(i);

    for (let j = i + 1; j < scored.length; j++) {
      if (assigned.has(j)) continue;
      const candidate = scored[j];

      // Must be within time window
      const timeDiff = Math.abs(base.publishedAt.getTime() - candidate.publishedAt.getTime());
      if (timeDiff > TIME_WINDOW_MS) continue;

      // Must not be from same source
      if (base.sourceId === candidate.sourceId) continue;

      // Jaccard similarity check
      const sim = jaccard(baseTokens, tokenize(candidate.title));
      if (sim >= SIMILARITY_THRESHOLD) {
        group.push(candidate);
        assigned.add(j);
      }
    }

    // Build cluster
    const sorted = [...group].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    const bestArticle = sorted[0];
    const perspectiveScore = calcPerspectiveScore(group);

    const cluster: StoryCluster = {
      id: `cluster-${Date.now()}-${i}`,
      headline: bestArticle.title,
      articles: sorted,
      sourceIds: [...new Set(group.map(a => a.sourceId))],
      publishedAt: sorted[sorted.length - 1].publishedAt,
      updatedAt: sorted[0].publishedAt,
      severity: bestArticle.severity,
      category: bestArticle.category,
      geoHint: group.find(a => a.geoHint)?.geoHint,
      perspectiveScore,
      hasAnalysis: false,
    };

    clusters.push(cluster);
  }

  // Step 3: Sort by severity + recency + perspective score
  clusters.sort((a, b) => {
    const sevScore: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    const aSev = sevScore[a.severity] ?? 1;
    const bSev = sevScore[b.severity] ?? 1;
    if (aSev !== bSev) return bSev - aSev;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  // Step 4: Semantic refinement — merge near-duplicate clusters using embeddings
  const refined = await refineWithEmbeddings(clusters);

  // Step 5: Focal point detection — mark hot zones (geo appearing in 3+ clusters)
  return detectFocalPoints(refined).clusters;
}
