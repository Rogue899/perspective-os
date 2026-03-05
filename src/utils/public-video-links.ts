export type PublicVideoPlatform = 'youtube' | 'rumble' | 'kick' | 'reddit' | 'x';

export type PublicVideoLink = {
  platform: PublicVideoPlatform;
  label: string;
  url: string;
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
      label: `X via Nitter: ${normalized}`,
      url: `https://nitter.net/search?f=tweets&q=${encoded}`,
    },
  ];
}