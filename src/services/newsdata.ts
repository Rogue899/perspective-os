import type { RawArticle, EventCategory } from '../types';

function normalizeSourceId(sourceName: string): string {
  return `newsdata-${sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'source'}`;
}

export async function fetchNewsDataArticles(params: {
  topic: string;
  category: EventCategory | 'all';
  size?: number;
}): Promise<RawArticle[]> {
  const q = `${params.topic}`.trim();
  const size = Math.min(Math.max(params.size ?? 20, 1), 50);

  try {
    const res = await fetch(`/api/newsdata?topic=${encodeURIComponent(q)}&language=en&size=${size}`, {
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];

    const data = await res.json();
    const rows = Array.isArray(data?.articles) ? data.articles : [];

    return rows.map((row: any) => {
      const sourceName = String(row.sourceName || row.sourceId || 'NewsData');
      const published = new Date(row.publishedAt || Date.now());
      return {
        sourceId: normalizeSourceId(sourceName),
        sourceName,
        title: String(row.title || '').trim(),
        description: String(row.description || '').trim(),
        url: String(row.url || '').trim(),
        publishedAt: isNaN(published.getTime()) ? new Date() : published,
      } satisfies RawArticle;
    }).filter((a: RawArticle) => a.title && a.url);
  } catch {
    return [];
  }
}
