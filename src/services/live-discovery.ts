import { LIVE_CHANNELS } from '../config/live-channels';

export interface DiscoveredLiveChannel {
  id: string;
  name: string;
  channelId: string;
  platform: 'youtube';
  region: string;
  reason: string;
}

function regionFromCoords(lat: number, lng: number): string {
  if (lng >= 20 && lng <= 65 && lat >= 8 && lat <= 42) return 'MENA';
  if (lng >= -12 && lng <= 45 && lat >= 34 && lat <= 72) return 'Europe';
  if (lng <= -50 && lng >= -170 && lat >= 15) return 'Americas';
  if (lat <= 15 && lng >= -20 && lng <= 55) return 'Africa';
  if (lng >= 60 && lat >= -15 && lat <= 55) return 'Asia';
  return 'Global';
}

function heuristicByRegion(region: string): DiscoveredLiveChannel[] {
  const normalized = region.toLowerCase();
  const ranked = LIVE_CHANNELS
    .filter(ch => ch.enabled)
    .map(ch => ({
      ...ch,
      score:
        (ch.region.toLowerCase().includes(normalized) ? 5 : 0) +
        (normalized === 'mena' ? (ch.name.toLowerCase().includes('al jazeera') ? 3 : 0) : 0) +
        (normalized === 'europe' ? ((ch.name.toLowerCase().includes('bbc') || ch.name.toLowerCase().includes('euronews')) ? 2 : 0) : 0) +
        (normalized === 'asia' ? (ch.name.toLowerCase().includes('cgtn') ? 2 : 0) : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(ch => ({
      id: ch.id,
      name: ch.name,
      channelId: ch.channelId,
      platform: 'youtube' as const,
      region: ch.region,
      reason: `Regional match: ${region}`,
    }));

  return ranked.length > 0
    ? ranked
    : LIVE_CHANNELS.slice(0, 4).map(ch => ({
        id: ch.id,
        name: ch.name,
        channelId: ch.channelId,
        platform: 'youtube' as const,
        region: ch.region,
        reason: 'Global fallback',
      }));
}

export async function discoverLiveChannelsForLocation(params: {
  lat: number;
  lng: number;
  locationName: string;
  topic?: string;
}): Promise<{ channels: DiscoveredLiveChannel[]; fallbackUsed: boolean }> {
  const inferredRegion = regionFromCoords(params.lat, params.lng);
  const heuristics = heuristicByRegion(inferredRegion);

  try {
    const prompt = `Rank the best live TV channels for location-aware breaking coverage. Return ONLY JSON array of channel ids.
Location: ${params.locationName}
Region: ${inferredRegion}
Topic: ${params.topic || 'general breaking news'}
Candidates: ${heuristics.map(c => `${c.id} (${c.name}, ${c.region})`).join(', ')}
Rules: choose 3-5 ids, prioritize relevance and diversity.`;

    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, tier: 'flash-lite', maxTokens: 120 }),
    });

    if (!res.ok) return { channels: heuristics, fallbackUsed: true };

    const data = await res.json();
    const cleaned = String(data?.text ?? '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return { channels: heuristics, fallbackUsed: true };

    const ordered = parsed
      .map((id: unknown) => String(id))
      .map(id => heuristics.find(c => c.id === id))
      .filter((c): c is DiscoveredLiveChannel => Boolean(c));

    if (ordered.length === 0) return { channels: heuristics, fallbackUsed: true };

    return { channels: ordered, fallbackUsed: false };
  } catch {
    return { channels: heuristics, fallbackUsed: true };
  }
}
