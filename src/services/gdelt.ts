/**
 * GDELT Service — Global Database of Events, Language, and Tone
 * Completely free, no API key, updates every 15 minutes.
 * We use it for: conflict events, tone divergence detection, topic feeds.
 */

import type { GdeltEvent } from '../types';

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2';
const PROXY_BASE = '/api/gdelt'; // goes through our edge proxy to avoid CORS

export interface GdeltArticle {
  url: string;
  title: string;
  sourcecountry: string;
  language: string;
  domain: string;
  seendate: string;
  socialimage?: string;
  tone?: number;
}

// ─── Fetch recent articles about a topic ─────────────────────────────────────
export async function searchGdelt(query: string, maxRecords = 20): Promise<GdeltArticle[]> {
  try {
    const params = new URLSearchParams({
      query,
      mode: 'artlist',
      maxrecords: String(maxRecords),
      format: 'json',
      timespan: '24h',
      sort: 'DateDesc',
    });
    const res = await fetch(`${PROXY_BASE}/doc?${params}`);
    if (!res.ok) throw new Error(`GDELT ${res.status}`);
    const data = await res.json();
    return (data.articles ?? []) as GdeltArticle[];
  } catch (err) {
    console.warn('[GDELT] Article search failed:', err);
    return [];
  }
}

// ─── Fetch geospatial events (for map layer) ──────────────────────────────────
export async function fetchGdeltEvents(bbox?: {
  minLat: number; maxLat: number; minLng: number; maxLng: number;
}): Promise<GdeltEvent[]> {
  try {
    const query = bbox
      ? `conflict war attack bomb strike ${bboxQuery(bbox)}`
      : 'conflict war attack bomb missile';

    const params = new URLSearchParams({
      query,
      mode: 'pointdata',
      format: 'json',
      timespan: '48h',
      maxrecords: '250',
    });
    const res = await fetch(`${PROXY_BASE}/geo?${params}`);
    if (!res.ok) throw new Error(`GDELT geo ${res.status}`);
    const data = await res.json();

    return ((data.features ?? []) as any[]).map((f: any) => ({
      id:           `gdelt-${f.properties?.GLOBALEVENTID ?? Math.random()}`,
      lat:          f.geometry?.coordinates?.[1] ?? 0,
      lng:          f.geometry?.coordinates?.[0] ?? 0,
      actor1:       f.properties?.Actor1Name ?? 'Unknown',
      actor2:       f.properties?.Actor2Name ?? '',
      eventCode:    f.properties?.EventCode ?? '',
      tone:         f.properties?.AvgTone ?? 0,
      mentionCount: f.properties?.NumMentions ?? 0,
      date:         new Date(f.properties?.SQLDATE ?? Date.now()),
      sourceUrl:    f.properties?.SOURCEURL ?? '',
    } satisfies GdeltEvent)).filter(e => e.lat !== 0 || e.lng !== 0);
  } catch (err) {
    console.warn('[GDELT] Event fetch failed:', err);
    return [];
  }
}

// ─── Tone divergence: Arabic vs English coverage of same topic ────────────────
// This is our secret weapon — detect when Arab and Western press diverge on tone
export async function getToneDivergence(topic: string): Promise<{
  arabicTone: number;
  englishTone: number;
  divergence: number;
  arabicSources: number;
  englishSources: number;
} | null> {
  try {
    const [arabicRes, englishRes] = await Promise.all([
      fetch(`${PROXY_BASE}/doc?${new URLSearchParams({
        query: `${topic} sourcelang:arabic`,
        mode: 'tonechart',
        format: 'json',
        timespan: '7d',
      })}`),
      fetch(`${PROXY_BASE}/doc?${new URLSearchParams({
        query: `${topic} sourcelang:english`,
        mode: 'tonechart',
        format: 'json',
        timespan: '7d',
      })}`),
    ]);

    const arabicData = arabicRes.ok ? await arabicRes.json() : null;
    const englishData = englishRes.ok ? await englishRes.json() : null;

    if (!arabicData || !englishData) return null;

    const arabicTone   = average(arabicData.tonechart?.map((t: any) => t.value) ?? []);
    const englishTone  = average(englishData.tonechart?.map((t: any) => t.value) ?? []);
    const divergence   = Math.abs(arabicTone - englishTone);

    return {
      arabicTone,
      englishTone,
      divergence,
      arabicSources:  arabicData.tonechart?.length ?? 0,
      englishSources: englishData.tonechart?.length ?? 0,
    };
  } catch {
    return null;
  }
}

// ─── Get GDELT topic feeds (military, cyber, nuclear, sanctions) ──────────────
export async function getTopicFeed(topic: 'military' | 'cyber' | 'nuclear' | 'sanctions' | 'protests'): Promise<GdeltArticle[]> {
  const TOPIC_QUERIES: Record<string, string> = {
    military:   'conflict war troops military strike airstrike',
    cyber:      'cyberattack hack ransomware breach malware',
    nuclear:    'nuclear weapon warhead IAEA enrichment',
    sanctions:  'sanctions embargo OFAC blocked assets',
    protests:   'protest demonstration rally riot uprising',
  };
  return searchGdelt(TOPIC_QUERIES[topic] ?? topic, 15);
}

// ─── Convert GDELT articles → RawArticle[] for clustering pipeline ────────────
export function gdeltToRaw(articles: GdeltArticle[], topic: string): import('../types').RawArticle[] {
  return articles
    .filter(a => a.title && a.url)
    .map(a => {
      // GDELT seendate format: "20240315T120000Z"
      const pubStr = a.seendate?.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        '$1-$2-$3T$4:$5:$6Z'
      );
      return {
        sourceId:    'gdelt',
        sourceName:  a.domain ?? 'GDELT Intelligence',
        title:       a.title,
        description: `[GDELT ${topic}] lang:${a.language ?? '?'} | tone: ${a.tone?.toFixed(1) ?? 'n/a'}`,
        url:         a.url,
        publishedAt: pubStr ? new Date(pubStr) : new Date(),
      };
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function bboxQuery(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }): string {
  // GDELT doesn't support bbox natively in v2 doc, but we can filter post-fetch
  return '';
}

function average(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((sum, n) => sum + n, 0) / arr.length;
}
