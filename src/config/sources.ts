import type { NewsSource } from '../types';

export const NEWS_SOURCES: NewsSource[] = [
  // ── Western Liberal ──────────────────────────────────────────────────────
  {
    id: 'bbc',
    name: 'BBC World',
    bias: 'center-left',
    biasColor: 'left',
    lean: -1,
    region: 'Europe',
    country: 'UK',
    rss: '/api/rss-proxy?url=https://feeds.bbci.co.uk/news/world/rss.xml&id=bbc',
    description: 'UK public broadcaster. Center-left, Western framing. Credible but reflects British foreign policy alignment.',
  },
  {
    id: 'france24',
    name: 'France 24',
    bias: 'western-liberal',
    biasColor: 'left',
    lean: -1,
    region: 'Europe',
    country: 'France',
    rss: '/api/rss-proxy?url=https://www.france24.com/en/rss&id=france24',
    description: 'French international broadcaster. Pro-EU, Western liberal. Strong Africa and MENA coverage.',
  },
  {
    id: 'dw',
    name: 'Deutsche Welle',
    bias: 'center-left',
    biasColor: 'left',
    lean: -1,
    region: 'Europe',
    country: 'Germany',
    rss: '/api/rss-proxy?url=https://rss.dw.com/rdf/rss-en-all&id=dw',
    description: 'German public international broadcaster. Reliable, center-left, strong human rights focus.',
  },
  {
    id: 'apnews',
    name: 'AP News',
    bias: 'center',
    biasColor: 'center',
    lean: 0,
    region: 'Global',
    country: 'USA',
    rss: '/api/rss-proxy?url=https://rsshub.app/apnews/topics/ap-top-news&id=apnews',
    description: 'Associated Press wire service. Most neutral major outlet. Widely syndicated.',
  },
  {
    id: 'reuters',
    name: 'Reuters',
    bias: 'center',
    biasColor: 'center',
    lean: 0,
    region: 'Global',
    country: 'UK',
    rss: '/api/rss-proxy?url=https://feeds.reuters.com/reuters/topNews&id=reuters',
    description: 'Global wire service. Considered most factual. Financial sector lean.',
  },

  // ── US Right ─────────────────────────────────────────────────────────────
  {
    id: 'foxnews',
    name: 'Fox News',
    bias: 'right',
    biasColor: 'right',
    lean: 3,
    region: 'Americas',
    country: 'USA',
    rss: '/api/rss-proxy?url=https://moxie.foxnews.com/google-publisher/world.xml&id=foxnews',
    description: 'US right-wing cable news. Strong nationalist/conservative framing. High US domestic bias.',
  },
  {
    id: 'nypost',
    name: 'New York Post',
    bias: 'center-right',
    biasColor: 'right',
    lean: 2,
    region: 'Americas',
    country: 'USA',
    rss: '/api/rss-proxy?url=https://nypost.com/feed/&id=nypost',
    description: 'US tabloid-style center-right. Murdoch-owned. More sensational than ideological.',
  },

  // ── Arab / Gulf ───────────────────────────────────────────────────────────
  {
    id: 'aljazeera',
    name: 'Al Jazeera',
    bias: 'arab-funded',
    biasColor: 'gulf',
    lean: -2,
    region: 'MENA',
    country: 'Qatar',
    rss: '/api/rss-proxy?url=https://www.aljazeera.com/xml/rss/all.xml&id=aljazeera',
    description: 'Qatar state-funded. Anti-Western, pro-Palestinian, pro-Muslim Brotherhood. Major voice in Arab world.',
  },
  {
    id: 'arabnews',
    name: 'Arab News',
    bias: 'gulf-aligned',
    biasColor: 'gulf',
    lean: 1,
    region: 'MENA',
    country: 'Saudi Arabia',
    rss: '/api/rss-proxy?url=https://www.arabnews.com/rss.xml&id=arabnews',
    description: 'Saudi-aligned English outlet. Pro-MBS, anti-Iran, anti-Qatar. Gulf conservative.',
  },
  {
    id: 'mee',
    name: 'Middle East Eye',
    bias: 'pro-palestinian',
    biasColor: 'left',
    lean: -2,
    region: 'MENA',
    country: 'UK',
    rss: '/api/rss-proxy?url=https://www.middleeasteye.net/rss&id=mee',
    description: 'UK-based. Strong pro-Palestinian, often sympathetic to Muslim Brotherhood. Qatar-linked funding reported.',
  },

  // ── Israeli ───────────────────────────────────────────────────────────────
  {
    id: 'haaretz',
    name: 'Haaretz',
    bias: 'israeli-left',
    biasColor: 'left',
    lean: -1,
    region: 'MENA',
    country: 'Israel',
    rss: '/api/rss-proxy?url=https://www.haaretz.com/cmlink/1.628765&id=haaretz',
    description: 'Israeli left-wing daily. Most critical Israeli outlet of government policy. Often cited internationally.',
  },
  {
    id: 'timesofisrael',
    name: 'Times of Israel',
    bias: 'israeli-center',
    biasColor: 'center',
    lean: 1,
    region: 'MENA',
    country: 'Israel',
    rss: '/api/rss-proxy?url=https://www.timesofisrael.com/feed&id=timesofisrael',
    description: 'Israeli center. English-language. More balanced than most Israeli outlets. Pro-Israel framing.',
  },

  // ── Russian / Kremlin ─────────────────────────────────────────────────────
  {
    id: 'rt',
    name: 'RT',
    bias: 'pro-kremlin',
    biasColor: 'state',
    lean: -3,
    region: 'Europe',
    country: 'Russia',
    rss: '/api/rss-proxy?url=https://www.rt.com/rss/&id=rt',
    description: 'Russian state media. Kremlin mouthpiece. Banned in EU. Important to include to understand Russian framing.',
  },
  {
    id: 'tass',
    name: 'TASS',
    bias: 'pro-kremlin',
    biasColor: 'state',
    lean: -3,
    region: 'Europe',
    country: 'Russia',
    rss: '/api/rss-proxy?url=https://tass.com/rss/v2.xml&id=tass',
    description: 'Official Russian state newswire. Pure Kremlin position. No editorial independence.',
  },

  // ── Chinese ───────────────────────────────────────────────────────────────
  {
    id: 'cgtn',
    name: 'CGTN',
    bias: 'pro-beijing',
    biasColor: 'state',
    lean: -3,
    region: 'Asia',
    country: 'China',
    rss: '/api/rss-proxy?url=https://www.cgtn.com/subscribe/feeds/rss/news.xml&id=cgtn',
    description: 'Chinese state international broadcaster. CCP mouthpiece in English. Important for Chinese framing.',
  },
  {
    id: 'scmp',
    name: 'SCMP',
    bias: 'pro-beijing',
    biasColor: 'state',
    lean: -1,
    region: 'Asia',
    country: 'Hong Kong',
    rss: '/api/rss-proxy?url=https://www.scmp.com/rss/91/feed&id=scmp',
    description: 'South China Morning Post. Hong Kong-based, Alibaba-owned. More nuanced than CGTN but Beijing-influenced.',
  },

  // ── Iranian ───────────────────────────────────────────────────────────────
  {
    id: 'presstv',
    name: 'Press TV',
    bias: 'iranian-state',
    biasColor: 'state',
    lean: -3,
    region: 'MENA',
    country: 'Iran',
    rss: '/api/rss-proxy?url=https://www.presstv.ir/RSS&id=presstv',
    description: 'Iranian state media in English. Anti-US, anti-Israel, pro-resistance axis framing.',
  },

  // ── OSINT / Investigative ─────────────────────────────────────────────────
  {
    id: 'bellingcat',
    name: 'Bellingcat',
    bias: 'osint',
    biasColor: 'osint',
    lean: -1,
    region: 'Global',
    country: 'Netherlands',
    rss: '/api/rss-proxy?url=https://www.bellingcat.com/feed&id=bellingcat',
    description: 'Open-source investigative journalism. Fact-based, evidence-driven. Western-leaning but methodologically rigorous.',
  },
  {
    id: 'theintercept',
    name: 'The Intercept',
    bias: 'left',
    biasColor: 'left',
    lean: -2,
    region: 'Americas',
    country: 'USA',
    rss: '/api/rss-proxy?url=https://theintercept.com/feed/?rss&id=intercept',
    description: 'US left-wing investigative. Anti-surveillance, anti-empire. Strong on US foreign policy critique.',
  },

  // ── Indian ────────────────────────────────────────────────────────────────
  {
    id: 'thehindu',
    name: 'The Hindu',
    bias: 'center-left',
    biasColor: 'left',
    lean: -1,
    region: 'Asia',
    country: 'India',
    rss: '/api/rss-proxy?url=https://www.thehindu.com/feeder/default.rss&id=thehindu',
    description: 'Indian center-left. Respected journalism, non-Western perspective on global events.',
  },
];

// Source map for O(1) lookup
export const SOURCE_MAP = new Map(NEWS_SOURCES.map(s => [s.id, s]));

// Color hex values for bias rendering
export const BIAS_COLORS: Record<string, string> = {
  right:   '#ef4444',
  left:    '#3b82f6',
  state:   '#8b5cf6',
  gulf:    '#f59e0b',
  center:  '#6b7280',
  osint:   '#06b6d4',
};

// Get contrasting text color for a bias color
export function getBiasTextClass(color: string): string {
  const map: Record<string, string> = {
    right:  'text-red-400',
    left:   'text-blue-400',
    state:  'text-purple-400',
    gulf:   'text-amber-400',
    center: 'text-gray-400',
    osint:  'text-cyan-400',
  };
  return map[color] ?? 'text-gray-400';
}

export function getBiasBgClass(color: string): string {
  const map: Record<string, string> = {
    right:  'bg-red-500/10 border-red-500/30',
    left:   'bg-blue-500/10 border-blue-500/30',
    state:  'bg-purple-500/10 border-purple-500/30',
    gulf:   'bg-amber-500/10 border-amber-500/30',
    center: 'bg-gray-500/10 border-gray-500/30',
    osint:  'bg-cyan-500/10 border-cyan-500/30',
  };
  return map[color] ?? 'bg-gray-500/10 border-gray-500/30';
}
