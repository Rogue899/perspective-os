export type PublicVideoPlatform = 'youtube' | 'rumble' | 'kick' | 'reddit' | 'x';

export type PublicVideoLink = {
  platform: PublicVideoPlatform;
  label: string;
  url: string;
  embedUrl?: string;
};

export function buildPublicVideoLinks(query: string): PublicVideoLink[] {
  const normalized = query.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const encoded = encodeURIComponent(normalized);

  return [
    {
      platform: 'youtube',
      label: `YouTube: ${normalized}`,
      url: `https://www.youtube.com/results?search_query=${encoded}`,
      // NOTE: YouTube removed listType=search embed support in 2023 — no embed available without video ID
      // embedUrl intentionally omitted; UI shows search button instead
    },
    {
      platform: 'rumble',
      label: `Rumble: ${normalized}`,
      url: `https://rumble.com/search/video?q=${encoded}`,
    },
    {
      platform: 'kick',
      label: `Kick: ${normalized}`,
      url: `https://kick.com/search?query=${encoded}`,
    },
    {
      platform: 'reddit',
      label: `Reddit: ${normalized}`,
      url: `https://www.reddit.com/search/?q=${encoded}&sort=new`,
    },
    {
      platform: 'x',
      label: `X: ${normalized}`,
      url: `https://x.com/search?q=${encoded}&src=typed_query`,
    },
  ];
}