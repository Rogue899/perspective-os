# PerspectiveOS — Claude Code Instructions

> Read this first before every session. This file is the ground truth for all architectural decisions.

## What This Is

A **media literacy + geopolitical intelligence dashboard** that aggregates news from 20 ideologically diverse sources, clusters same-event stories together, then runs AI analysis to expose how each source frames the story differently — including what they emphasize, what they omit, and loaded language choices. Core feature: **Perspective Engine** generates Socratic questions to challenge reader assumptions.

Differentiator from WorldMonitor: WorldMonitor aggregates and classifies. We cross-reference and interrogate.

---

## Stack (do not deviate without asking)

| Layer | Choice | DO NOT substitute |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | — |
| Styles | Tailwind CSS | No CSS-in-JS, no styled-components |
| Map | MapLibre GL JS v4 | NOT Mapbox (paid tokens) |
| Map Tiles | OpenFreeMap (dark style) | NOT Mapbox tiles |
| AI Primary | Gemini 2.5 Flash (Flash-Lite for volume) | NOT Claude API |
| AI Fallback | Groq llama-3.3-70b-versatile | NOT GPT-4 |
| Cache | Upstash Redis | NOT Vercel KV |
| Backend | Vercel Edge Functions (api/*.js) | NOT Node.js server |
| Deployment | Vercel hobby (free) | — |

---

## AI Rules — CRITICAL

1. **Never use Claude API** — user has Claude subscription, not API credits
2. **Flash-Lite first** for: headline classification, sentiment, entity extraction, embedding
3. **Flash only** for: Perspective Engine analysis (the JSON response user sees)
4. **Groq** as: rate-limit fallback on BOTH Flash and Flash-Lite
5. **Always cache** every Gemini call in Redis (TTL: 3600s for analysis, 300s for classification)
6. **Never call Gemini twice** for the same content — check Redis first, every time
7. On 429 from Gemini: immediately fall back to Groq, log warn, do NOT retry Gemini
8. All AI calls go through `/api/ai.js` edge function. Never call Gemini directly from client.

### Gemini Free Tier Limits (March 2026)
- Flash-Lite: 15 RPM, 1,000 RPD
- Flash: 10 RPM, 250 RPD  
- text-embedding-004: 1,500 RPD
- All: 250K TPM

---

## Free APIs Used (no cost)

| API | Key | Used For |
|---|---|---|
| GDELT v2 | None | Conflict events, tone divergence, topic feeds |
| USGS Earthquake | None | Seismic events |
| NASA FIRMS | Free key | Satellite fire detection |
| OpenStreetMap Nominatim | None | Geocoding |
| OpenFreeMap | None | Dark map tiles |
| All RSS feeds | None | News from 20 sources |
| Polymarket | None | Geopolitical prediction markets |

## Paid APIs (register when ready to scale)

| API | Free Tier | Cost | Used For |
|---|---|---|---|
| Gemini (Google) | 250 RPD Flash | Free forever | AI analysis |
| Groq | 14,400 req/day | Free forever | AI fallback |
| ACLED | Free academic | Free | Verified conflict events |
| Upstash Redis | 10K cmd/day | Free forever | Cache |
| OpenSky | Rate-limited free | Free | Flight tracking |
| AISStream | 1 connection free | Free | Ship tracking |

---

## File Structure

```
perspectiveos/
├── src/
│   ├── App.tsx                     Main layout + routing
│   ├── main.tsx                    Entry point
│   ├── index.css                   Tailwind + MapLibre overrides
│   ├── context/
│   │   └── AppContext.tsx           Global state (useReducer)
│   ├── types/
│   │   └── index.ts                All shared TypeScript types
│   ├── config/
│   │   └── sources.ts              News sources with bias metadata (20 sources)
│   ├── services/
│   │   ├── ai.ts                   AI calls → /api/ai
│   │   ├── rss.ts                  RSS fetching → /api/rss-proxy
│   │   └── gdelt.ts                GDELT free data
│   ├── utils/
│   │   └── story-cluster.ts        Jaccard clustering algorithm
│   └── components/
│       ├── Layout/
│       │   ├── Header.tsx
│       │   └── SettingsModal.tsx
│       ├── News/
│       │   ├── FeedPanel.tsx       Left column story list
│       │   ├── StoryCard.tsx       Individual story card
│       │   └── PerspectivePanel.tsx  Right sidebar — THE CORE FEATURE
│       └── Map/
│           └── MapView.tsx         MapLibre map with conflict markers
├── api/
│   ├── rss-proxy.js               RSS CORS bypass + ETag caching
│   ├── ai.js                      Gemini/Groq inference + Redis cache
│   ├── gdelt.js                   GDELT proxy (free, no key)
│   ├── acled.js                   ACLED conflict data
│   └── embed.js                   Gemini embedding endpoint
├── vercel.json
├── .env.example                   All keys documented with registration links
└── CLAUDE.md                      This file
```

---

## Core Data Flow

```
RSS feeds (20 sources)
    ↓ /api/rss-proxy (CORS bypass + ETag cache)
    ↓ src/services/rss.ts
    ↓ src/utils/story-cluster.ts (Jaccard dedup)
    → StoryCluster[] (same event, N sources)
    
User clicks story → PerspectivePanel
    ↓ src/services/ai.ts → analyzePerspectives()
    ↓ /api/ai (Redis check → Gemini Flash → Groq fallback)
    → PerspectiveAnalysis JSON
    → Render: source frames, omissions, loaded language, Socratic questions
```

---

## Bias Color System

| Color | Class | Sources |
|---|---|---|
| Red | text-red-400 | Fox News, NY Post (right) |
| Blue | text-blue-400 | BBC, DW, France 24, The Intercept (left) |
| Purple | text-purple-400 | RT, TASS, CGTN (state media) |
| Amber | text-amber-400 | Al Jazeera, Arab News (Gulf-aligned) |
| Gray | text-gray-400 | AP, Reuters (center) |
| Cyan | text-cyan-400 | Bellingcat (OSINT) |

---

## What WorldMonitor Does That We Should Copy

From their codebase (31K stars, studied carefully):
- **ETag conditional GET** on RSS feeds — `feat #625` — reduces edge invocations by 95%
- **Welford's algorithm** for statistical baselines (stored in Redis across requests)
- **Circuit breakers** with 5-min cooldowns per feed
- **Haversine deduplication** for conflict events on 0.1° grid
- **Promise.allSettled** — one failing API never blocks others
- **Intelligence gap tracker** — explicitly show when data sources are down, not silently hide
- **Focal point detection** — correlate events across news + military + markets

## What We Do That WorldMonitor DOESN'T

- Cross-source perspective comparison (the whole point)
- Bias color-coding on every source chip
- Loaded language detection
- Socratic question generation
- GDELT tone divergence (Arabic vs English coverage gaps)
- "What nobody tells you" — meta-omissions across all sources
- Media literacy as primary UI goal

---

## Development Commands

```bash
# Local dev (runs frontend + all edge functions)
vercel dev

# Type check
npm run typecheck

# Build
npm run build

# Deploy
vercel --prod
```

## Common Pitfalls

1. **MapLibre style** — OpenFreeMap dark tile URL may return 404 briefly on cold start. Fallback to raster OSM is already in MapView.tsx
2. **RSS CORS** — Never fetch RSS directly from client. Always through /api/rss-proxy
3. **Gemini JSON** — Always validate with try/catch before using. Gemini sometimes wraps JSON in markdown backticks despite prompting
4. **Rate limits** — If you see 429s from Gemini, the Redis cache is not working. Check UPSTASH env vars first
5. **Source IDs** — The sourceId in PerspectiveAnalysis must match the sourceId in NEWS_SOURCES config. Gemini sometimes invents IDs — always map back by array index in PerspectivePanel.tsx
