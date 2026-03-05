/**
 * Live news channel configurations for the Live tab.
 * YouTube `live_stream?channel=ID` plays the current live stream if active.
 * `fallbackVideoId` is used when the channel isn't live.
 *
 * To find a channel ID: go to youtube.com/@CHANNEL → About → Share → copy ID
 * Or use: https://www.youtube.com/channel/{ID}
 */

export interface LiveChannel {
  id: string;
  name: string;
  channelId: string;       // YouTube channel ID (UCxxxxxxx)
  bias: 'left' | 'center' | 'right' | 'state' | 'gulf';
  region: string;
  language: string;
  enabled: boolean;
}

export const LIVE_CHANNELS: LiveChannel[] = [
  {
    id: 'aljazeera-live',
    name: 'Al Jazeera English',
    channelId: 'UCNye-wNBqNL5ZzHSJdse7ng',
    bias: 'gulf',
    region: 'MENA',
    language: 'English',
    enabled: true,
  },
  {
    id: 'dw-live',
    name: 'DW News',
    channelId: 'UCknLrEdhRCp1aegoMqRaCZg',
    bias: 'center',
    region: 'Europe',
    language: 'English',
    enabled: true,
  },
  {
    id: 'france24-live',
    name: 'France 24 English',
    channelId: 'UCQfwfsi5VrQ8yKZ-UWmAEFg',
    bias: 'left',
    region: 'Europe',
    language: 'English',
    enabled: true,
  },
  {
    id: 'euronews-live',
    name: 'Euronews',
    channelId: 'UCg7JaqKJTg7JGSJ8sBHmH5Q',
    bias: 'center',
    region: 'Europe',
    language: 'English',
    enabled: true,
  },
  {
    id: 'skynews-live',
    name: 'Sky News',
    channelId: 'UCoMdktPbSTixAyNGwb-UYkQ',
    bias: 'center',
    region: 'Europe',
    language: 'English',
    enabled: true,
  },
  {
    id: 'bbc-live',
    name: 'BBC News',
    channelId: 'UC16niRr50-MSBwiO3YDb3RA',
    bias: 'left',
    region: 'Europe',
    language: 'English',
    enabled: true,
  },
  {
    id: 'cgtn-live',
    name: 'CGTN',
    channelId: 'UCqpwFJyeH3-GNJEFLrNIjAQ',
    bias: 'state',
    region: 'Asia',
    language: 'English',
    enabled: false,
  },
  {
    id: 'rt-live',
    name: 'RT (Russian State)',
    channelId: 'UCpwvZG-5eZ7vEDNGKMhM4WA',
    bias: 'state',
    region: 'Europe',
    language: 'English',
    enabled: false,
  },
];

// Grid layout presets
export type GridLayout = '2x2' | '2x3' | '3x2' | '1x4' | 'single';

export const LAYOUT_COUNTS: Record<GridLayout, number> = {
  'single': 1,
  '1x4': 4,
  '2x2': 4,
  '2x3': 6,
  '3x2': 6,
};

export function buildEmbedUrl(channelId: string): string {
  return `https://www.youtube.com/embed/live_stream?channel=${channelId}&autoplay=0&mute=1&controls=1&modestbranding=1&rel=0`;
}
