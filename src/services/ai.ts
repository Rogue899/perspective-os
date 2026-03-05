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
    }, 20000);

    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = await res.json();
    return {
      text: data.text,
      provider: data.provider as AIProvider,
      cached: data.cached ?? false,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    console.error('[AI] Perspective analysis failed:', err);
    throw err;
  }
}

// ─── Keyword fallbacks (zero-latency, no API) ─────────────────────────────────
const CRITICAL_WORDS = /\b(war|nuclear|invasion|genocide|massacre|coup|assassination)\b/i;
const HIGH_WORDS     = /\b(attack|strike|killed|explosion|missile|sanctions|clash|crisis)\b/i;
const MEDIUM_WORDS   = /\b(protest|arrest|conflict|dispute|tension|threat|warning)\b/i;

function guessSevertiy(text: string): string {
  if (CRITICAL_WORDS.test(text)) return 'critical';
  if (HIGH_WORDS.test(text))     return 'high';
  if (MEDIUM_WORDS.test(text))   return 'medium';
  return 'low';
}

const CATEGORY_MAP: [RegExp, string][] = [
  [/\b(war|military|troops|soldiers|army|navy|airstrike|missile|weapon)\b/i, 'military'],
  [/\b(attack|bomb|terror|ISIS|Hamas|Hezbollah|al-Qaeda)\b/i, 'terrorism'],
  [/\b(protest|demonstration|riot|march|strike|rally)\b/i, 'protest'],
  [/\b(earthquake|flood|hurricane|tsunami|wildfire|disaster)\b/i, 'disaster'],
  [/\b(election|diplomat|treaty|sanctions|UN|NATO|summit)\b/i, 'diplomatic'],
  [/\b(market|economy|inflation|GDP|trade|currency|bank)\b/i, 'economic'],
  [/\b(hack|cyber|ransomware|breach|malware|darkweb)\b/i, 'cyber'],
  [/\b(virus|pandemic|outbreak|vaccine|hospital|health)\b/i, 'health'],
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
