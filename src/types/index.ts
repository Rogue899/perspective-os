// ─── Source bias types ────────────────────────────────────────────────────────
export type BiasLabel =
  | 'right' | 'center-right' | 'center' | 'center-left' | 'left'
  | 'state-media' | 'pro-kremlin' | 'pro-beijing' | 'iranian-state'
  | 'arab-funded' | 'gulf-aligned' | 'pro-palestinian' | 'israeli-left'
  | 'israeli-center' | 'osint' | 'western-liberal';

export type BiasColor = 'right' | 'left' | 'center' | 'state' | 'gulf' | 'osint';

export interface NewsSource {
  id: string;
  name: string;
  bias: BiasLabel;
  biasColor: BiasColor;
  lean: number;       // -3 (hard left/state) to +3 (hard right)
  region: string;
  country: string;
  rss: string;
  logo?: string;
  description: string;
}

// ─── Article types ────────────────────────────────────────────────────────────
export interface RawArticle {
  sourceId: string;
  sourceName: string;
  title: string;
  description: string;
  url: string;
  publishedAt: Date;
  content?: string;
}

export interface ScoredArticle extends RawArticle {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: EventCategory;
  sentiment: number;           // -1 to +1
  entities: string[];          // countries, leaders, orgs extracted
  geoHint?: { lat: number; lng: number; name: string };
}

export type EventCategory =
  | 'conflict' | 'protest' | 'disaster' | 'diplomatic'
  | 'economic' | 'terrorism' | 'cyber' | 'health'
  | 'military' | 'infrastructure' | 'tech' | 'general';

// ─── Story cluster (same event, multiple sources) ─────────────────────────────
export interface StoryCluster {
  id: string;
  headline: string;             // best headline from cluster
  articles: ScoredArticle[];
  sourceIds: string[];
  publishedAt: Date;
  updatedAt: Date;
  severity: ScoredArticle['severity'];
  category: EventCategory;
  geoHint?: { lat: number; lng: number; name: string };
  perspectiveScore: number;     // 0-1: how much do sources diverge?
  hasAnalysis: boolean;         // has Perspective Engine run?
  analysis?: PerspectiveAnalysis;
}

// ─── Perspective Engine output ────────────────────────────────────────────────
export interface SourcePerspective {
  sourceId: string;
  sourceName: string;
  biasLabel: BiasLabel;
  biasColor: BiasColor;
  mainFrame: string;            // 1-sentence framing summary
  emphasized: string[];         // what they highlight
  omitted: string[];            // what they skip
  loadedLanguage: string[];     // specific bias-revealing words
  tone: 'sympathetic' | 'hostile' | 'neutral' | 'alarming' | 'dismissive';
}

export interface PerspectiveAnalysis {
  clusterId: string;
  sharedFacts: string[];
  sourceAnalyses: SourcePerspective[];
  keyDisagreements: string[];
  whatNobodyTellsYou: string[];  // gaps ACROSS ALL sources
  socraticQuestions: string[];
  confidenceOnFacts: number;     // 0-1
  generatedAt: Date;
  model: string;
}

// ─── Conflict / map data ──────────────────────────────────────────────────────
export interface ConflictEvent {
  id: string;
  source: 'acled' | 'gdelt';
  lat: number;
  lng: number;
  country: string;
  eventType: string;
  actor1: string;
  actor2?: string;
  fatalities: number;
  date: Date;
  notes: string;
  severity: 'high' | 'medium' | 'low';
}

export interface GdeltEvent {
  id: string;
  lat: number;
  lng: number;
  actor1: string;
  actor2: string;
  eventCode: string;
  tone: number;
  mentionCount: number;
  date: Date;
  sourceUrl: string;
}

// ─── AI service types ─────────────────────────────────────────────────────────
export type AIProvider = 'gemini-flash' | 'gemini-flash-lite' | 'groq' | 'browser-t5';

export interface AIRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  provider?: AIProvider;
  cacheKey?: string;
  cacheTtl?: number;
}

export interface AIResponse {
  text: string;
  provider: AIProvider;
  cached: boolean;
  latencyMs: number;
}

// ─── App state ────────────────────────────────────────────────────────────────
export interface AppSettings {
  geminiKey: string;
  groqKey: string;
  acledKey: string;
  nasaFirmsKey: string;
  openSkyUser: string;
  openSkyPass: string;
  upstashUrl: string;
  upstashToken: string;
  enabledSources: string[];
  enableMap: boolean;
  enableConflictLayer: boolean;
  enableFlightLayer: boolean;
  aiProvider: AIProvider;
}

export interface DataSourceStatus {
  id: string;
  label: string;
  status: 'fresh' | 'stale' | 'error' | 'disabled' | 'loading';
  lastUpdated?: Date;
  errorMsg?: string;
}
