/**
 * AI Service — Gemini Flash-Lite → Gemini Flash → Groq → Browser T5
 * Mirrors WorldMonitor's 4-tier fallback chain but uses Gemini as primary.
 * All calls go through /api/ai edge function to keep keys server-side.
 */

import type { AIProvider, AIResponse } from '../types';

const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, opts: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Tier 1: Gemini Flash-Lite (high volume, classification) ─────────────────
export async function classifyWithAI(text: string): Promise<{
  severity: string; category: string; sentiment: number; entities: string[];
}> {
  const prompt = `Classify this news headline/text. Return ONLY valid JSON, no markdown:
{
  "severity": "critical|high|medium|low|info",
  "category": "conflict|protest|disaster|diplomatic|economic|terrorism|cyber|health|military|infrastructure|tech|general",
  "sentiment": -1.0 to 1.0,
  "entities": ["country/leader/org names mentioned"]
}

Text: "${text.slice(0, 500)}"`;

  try {
    const res = await fetchWithTimeout('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, tier: 'flash-lite', maxTokens: 200 }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const data = await res.json();
    return JSON.parse(data.text);
  } catch {
    // Keyword fallback
    return {
      severity: guessSevertiy(text),
      category: guessCategory(text),
      sentiment: guessSentiment(text),
      entities: [],
    };
  }
}

// ─── Tier 1: Gemini Flash-Lite (story deduplication embedding) ───────────────
export async function getEmbedding(text: string): Promise<number[]> {
  try {
    const res = await fetchWithTimeout('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 1000) }),
    });
    if (!res.ok) throw new Error('embed fail');
    const data = await res.json();
    return data.embedding as number[];
  } catch {
    return [];
  }
}

// ─── Tier 2: Gemini Flash (Perspective Engine) — the main feature ─────────────
export async function analyzePerspectives(
  articles: Array<{ sourceId: string; sourceName: string; biasLabel: string; title: string; description: string; }>,
  cacheKey: string
): Promise<AIResponse> {
  const start = Date.now();

  const articlesText = articles.map((a, i) =>
    `SOURCE ${i + 1} — [${a.sourceName}, bias: ${a.biasLabel}]:\nTitle: ${a.title}\nSummary: ${a.description?.slice(0, 400) ?? '(no description)'}`
  ).join('\n\n---\n\n');

  const systemPrompt = `You are a media literacy analyst specializing in geopolitical framing and propaganda detection.
You will receive the same news event covered by multiple sources with different political/ideological biases.
Your job is NOT to pick a side. Your job is to:
1. Expose HOW each source frames the story differently
2. Identify what facts each source includes or omits
3. Flag loaded/biased language choices
4. Generate Socratic questions that make the reader think critically
5. Identify gaps that ALL sources share — what nobody is saying

Be specific. Name the omissions. Quote the loaded words. Challenge all sides equally.
State facts you can verify. When uncertain, say so.`;

  const userPrompt = `Here are ${articles.length} articles about the same event from sources with different political biases:

${articlesText}

Respond ONLY with valid JSON (no markdown, no backticks, no preamble):
{
  "sharedFacts": ["fact1", "fact2", "fact3"],
  "sourceAnalyses": [
    {
      "sourceId": "SOURCE_1_ID",
      "sourceName": "SOURCE_1_NAME",
      "mainFrame": "One sentence: how does this source frame this story?",
      "emphasized": ["what they highlight or amplify"],
      "omitted": ["specific facts/context this source leaves out"],
      "loadedLanguage": ["specific biased words or phrases they use"],
      "tone": "sympathetic|hostile|neutral|alarming|dismissive"
    }
  ],
  "keyDisagreements": ["specific point where sources directly contradict each other"],
  "whatNobodyTellsYou": ["gaps present across ALL sources — the meta-omissions"],
  "socraticQuestions": [
    "Question 1: challenges reader's first instinct",
    "Question 2: who benefits from this particular framing?",
    "Question 3: what would you need to know to verify the shared claims?"
  ],
  "confidenceOnFacts": 0.0
}`;

  try {
    const res = await fetchWithTimeout('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: userPrompt,
        systemPrompt,
        tier: 'flash',
        maxTokens: 1500,
        cacheKey,
        cacheTtl: 3600,
      }),
    }, 25000);

    if (!res.ok) {
      // Try to extract meaningful error from the response body
      let errMsg = `AI HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody?.error) errMsg = errBody.error;
      } catch { /* ignore parse failure */ }
      if (res.status === 503) {
        throw new Error('AI providers unavailable. Add GEMINI_API_KEY or GROQ_API_KEY in Settings, or try again in a few minutes.');
      }
      if (res.status === 404) {
        throw new Error('AI endpoint not found (/api/ai). Check Vercel deployment or restart local dev server.');
      }
      throw new Error(errMsg);
    }
    const data = await res.json();
    return {
      text: data.text,
      provider: data.provider as AIProvider,
      cached: data.cached ?? false,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    // Retry once on network abort/timeout before giving up
    if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
      console.warn('[AI] Perspective analysis timed out, retrying once...');
      try {
        const retry = await fetchWithTimeout('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: userPrompt,
            systemPrompt,
            tier: 'flash',
            maxTokens: 1500,
            cacheKey,
            cacheTtl: 3600,
          }),
        }, 30000);
        if (!retry.ok) throw new Error(`AI retry HTTP ${retry.status}`);
        const data = await retry.json();
        return {
          text: data.text,
          provider: data.provider as AIProvider,
          cached: data.cached ?? false,
          latencyMs: Date.now() - start,
        };
      } catch (retryErr) {
        console.error('[AI] Retry also failed:', retryErr);
        throw new Error('AI analysis timed out twice. Check your internet connection or try again.');
      }
    }
    console.error('[AI] Perspective analysis failed:', err);
    throw err;
  }
}

// ─── Gemini Flash — Opinion Generator (4 editorial lenses) ───────────────────
export type OpinionLens = 'conservative' | 'progressive' | 'state-media' | 'osint';

export const OPINION_LENS_LABELS: Record<OpinionLens, string> = {
  conservative:  'Conservative / Nationalist',
  progressive:   'Progressive / Human Rights',
  'state-media': 'State Media (Russia–China)',
  osint:         'OSINT / Evidence-Based',
};

export const OPINION_LENS_COLORS: Record<OpinionLens, string> = {
  conservative:  'border-red-500/30 bg-red-500/5 text-red-300',
  progressive:   'border-blue-500/30 bg-blue-500/5 text-blue-300',
  'state-media': 'border-purple-500/30 bg-purple-500/5 text-purple-300',
  osint:         'border-cyan-500/30 bg-cyan-500/5 text-cyan-300',
};

export async function generateOpinionForLens(
  headline: string,
  lens: OpinionLens,
  cacheKey: string,
): Promise<string> {
  const lensDescription: Record<OpinionLens, string> = {
    conservative:  'a conservative/nationalist commentator who prioritises national sovereignty, security, and traditional values. Focus on national interest, border security, protecting the homeland, and scepticism of globalist institutions.',
    progressive:   'a progressive human-rights advocate who prioritises civil liberties, international humanitarian law, marginalised communities, and accountability of power.',
    'state-media': 'a Russian or Chinese state media editorial board that frames the West as the aggressor, emphasises multipolar world order, sovereignty against interference, and questions Western media credibility.',
    osint:         'an OSINT analyst who only references verifiable open-source evidence — intercepted signals, satellite imagery, geolocated footage — and clearly flags what is confirmed vs unconfirmed rumour.',
  };

  const prompt = `Write a 120-word editorial opinion about the following news event from the perspective of ${lensDescription[lens]}

News event: "${headline}"

Rules:
- 120 words maximum
- Be authentic to that worldview — do NOT caricature or mock it
- Do not break character
- Do not mention that this is AI-generated or that you are playing a role
- Write as if this is a real editorial opinion piece

Opinion:`;

  const res = await fetchWithTimeout('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      tier: 'flash',
      maxTokens: 250,
      cacheKey,
      cacheTtl: 7200,
    }),
  }, 15000);

  if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
  const data = await res.json();
  return String(data.text ?? '').trim();
}

// ─── Gemini-powered keyword search generator ──────────────────────────────────
/**
 * Asks Gemini Flash-Lite to generate 6-8 search keywords for a topic.
 * These are used to drive dynamic Google News RSS + social searches.
 * Falls back to splitting the topic string if the AI call fails.
 */
export async function generateKeywords(
  topic: string,
  headlines: string[] = [],
): Promise<string[]> {
  const headlinesSample = headlines.slice(0, 6).join(' | ');
  const prompt = `You are a search strategist for a geopolitical news intelligence engine.
Generate high-recall, low-noise query phrases for RSS + social discovery.

Topic: "${topic}"
${headlinesSample ? `Recent headlines: ${headlinesSample}` : ''}

Return ONLY valid JSON in this exact shape:
{
  "keywords": [
    "..."
  ]
}

Generate exactly 8 keyword phrases with these intents (one each, diverse wording):
1) Core event phrase
2) Key actor/institution phrase
3) Geographic/localized phrase
4) Social-trending phrasing
5) Investigative/evidence phrasing
6) Economic/market-impact phrasing if relevant
7) Counter-narrative phrasing seen in state/alt media
8) Rumor/disputed phrasing prefixed EXACTLY with "rumour:"

Rules:
- 2-6 words each
- Include at least one non-Western framing angle when topic is geopolitical
- Avoid generic words alone (bad: "war", "breaking")
- No hashtags, no punctuation-heavy strings
- No duplicates
- English output only`;

  try {
    const res = await fetchWithTimeout('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, tier: 'flash-lite', maxTokens: 350 }),
    }, 8000);
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const data = await res.json();
    const cleaned = String(data.text ?? '')
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
    const raw: unknown[] = Array.isArray(parsed)
      ? parsed
      : (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { keywords?: unknown[] }).keywords))
      ? ((parsed as { keywords: unknown[] }).keywords)
      : [];

    if (raw.length > 0) {
      const normalized = raw
        .filter((k: unknown): k is string => typeof k === 'string')
        .map(normalizeKeyword)
        .filter(Boolean);

      const deduped = Array.from(new Set(normalized));
      if (deduped.length > 0) {
        return deduped.slice(0, 8);
      }
    }
  } catch {
    // silent fallback
  }
  // Fallback: deterministic keyword expansion from topic + headlines
  const candidates = buildFallbackKeywords(topic, headlines);
  return candidates.slice(0, 8);
}

function normalizeKeyword(value: string): string {
  return value
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function buildFallbackKeywords(topic: string, headlines: string[]): string[] {
  const base = normalizeKeyword(topic);
  const words = base.split(' ').filter(w => w.length > 2);
  const twoGrams = words.map((_, i) => words.slice(i, i + 2).join(' ')).filter(s => s.split(' ').length >= 2);
  const threeGrams = words.map((_, i) => words.slice(i, i + 3).join(' ')).filter(s => s.split(' ').length >= 3);

  const headlineEntities = headlines
    .flatMap(h => (h.match(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,})?\b/g) ?? []))
    .map(normalizeKeyword)
    .filter(Boolean)
    .slice(0, 5);

  const seeded = [
    base,
    ...threeGrams,
    ...twoGrams,
    ...headlineEntities,
    `${base} timeline`,
    `${base} latest updates`,
    `${base} regional response`,
    `rumour: ${base}`,
  ].map(normalizeKeyword).filter(Boolean);

  return Array.from(new Set(seeded));
}

// ─── Keyword fallbacks (zero-latency, no API) ─────────────────────────────────
const CRITICAL_WORDS = /\b(war|nuclear|invasion|genocide|massacre|coup|assassination)\b/i;
const HIGH_WORDS     = /\b(attack|strike|killed|explosion|missile|sanctions|clash|crisis)\b/i;
const MEDIUM_WORDS   = /\b(protest|arrest|conflict|dispute|tension|threat|warning)\b/i;

/** Synchronous keyword-only classification — zero network calls, instant. */
export function classifyWithKeywords(text: string): {
  severity: string; category: string; sentiment: number; entities: string[];
} {
  return {
    severity: guessSevertiy(text),
    category: guessCategory(text),
    sentiment: guessSentiment(text),
    entities: [],
  };
}

function guessSevertiy(text: string): string {
  if (CRITICAL_WORDS.test(text)) return 'critical';
  if (HIGH_WORDS.test(text))     return 'high';
  if (MEDIUM_WORDS.test(text))   return 'medium';
  return 'low';
}

const CATEGORY_MAP: [RegExp, string][] = [
  [/\b(conflict|battle|fighting|frontline|offensive|siege|ceasefire|shelling|casualties|killed|war|combat|invasion|occupation|liberat)\b/i, 'conflict'],
  [/\b(military|troops|soldiers|army|navy|air force|airstrike|missile|weapon|artillery|drone strike|warship|nuclear|nato|defense)\b/i, 'military'],
  [/\b(terror|terrorist|attack|bomb|explosion|ISIS|ISIL|Hamas|Hezbollah|al-Qaeda|al-Shabaab|jihad|extremist|hostage)\b/i, 'terrorism'],
  [/\b(protest|demonstration|riot|march|strike|rally|coup|uprising|unrest|crackdown)\b/i, 'protest'],
  [/\b(earthquake|flood|hurricane|tsunami|wildfire|disaster|storm|eruption|cyclone|drought)\b/i, 'disaster'],
  [/\b(election|diplomat|treaty|sanctions|UN|NATO|summit|bilateral|embassy|foreign minister|secretary of state)\b/i, 'diplomatic'],
  [/\b(market|economy|inflation|GDP|trade|currency|bank|tariff|recession|stock|oil price|debt)\b/i, 'economic'],
  [/\b(hack|cyber|ransomware|breach|malware|darkweb|APT|phishing|zero-day|spyware)\b/i, 'cyber'],
  [/\b(virus|pandemic|outbreak|vaccine|hospital|health|epidemic|pathogen|WHO|disease)\b/i, 'health'],
  [/\b(infrastructure|pipeline|grid|bridge|blackout|supply chain|port|logistics)\b/i, 'infrastructure'],
  [/\b(AI|artificial intelligence|tech|startup|software|chip|semiconductor|quantum|space|satellite)\b/i, 'tech'],
  [/\b(science|research|study|discovery|experiment|genome|climate|biology|physics|NASA|ESA|laboratory)\b/i, 'science'],
  [/\b(sport|football|soccer|basketball|tennis|cricket|olympics|athlete|tournament|championship|FIFA|UEFA|NBA|NFL)\b/i, 'sport'],
];

function guessCategory(text: string): string {
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(text)) return cat;
  }
  return 'general';
}

const NEG_WORDS = /\b(war|kill|death|attack|bomb|crisis|fail|collapse|sanction|threat)\b/i;
const POS_WORDS = /\b(peace|agree|deal|success|aid|recovery|ceasefire|cooperation)\b/i;

function guessSentiment(text: string): number {
  const neg = (text.match(NEG_WORDS) ?? []).length;
  const pos = (text.match(POS_WORDS) ?? []).length;
  if (neg === 0 && pos === 0) return 0;
  return (pos - neg) / (pos + neg);
}
