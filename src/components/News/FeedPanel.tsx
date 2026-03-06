import { useEffect, useState, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { StoryCard, StoryGridCard } from './StoryCard';
import { getAllSources, getSourceById } from '../../config/sources';
import { fetchAllFeeds, getAllCircuitStates } from '../../services/rss';
import { clusterArticles } from '../../utils/story-cluster';
import { getTopicFeed, gdeltToRaw, type GdeltTopic } from '../../services/gdelt';
import { detectUserLocation } from '../../services/geo';
import type { GeoContext } from '../../services/geo';
import type { CircuitState } from '../../services/circuit-breaker';
import { generateKeywords } from '../../services/ai';
import { Filter, Wifi, WifiOff, MapPin, X, Zap, AlertTriangle, Sparkles, Radio, LayoutList, LayoutGrid, Globe } from 'lucide-react';
import type { EventCategory } from '../../types';

const CATEGORIES: Array<{ id: EventCategory | 'all'; label: string; gdelt?: boolean }> = [
  { id: 'all',            label: 'All' },
  { id: 'conflict',       label: 'Conflict',  gdelt: true },
  { id: 'military',       label: 'Military',  gdelt: true },
  { id: 'terrorism',      label: 'Terror',    gdelt: true },
  { id: 'diplomatic',     label: 'Diplomacy', gdelt: true },
  { id: 'protest',        label: 'Protests',  gdelt: true },
  { id: 'economic',       label: 'Economy',   gdelt: true },
  { id: 'cyber',          label: 'Cyber',     gdelt: true },
  { id: 'disaster',       label: 'Disaster',  gdelt: true },
  { id: 'health',         label: 'Health',    gdelt: true },
  { id: 'science',        label: 'Science',   gdelt: true },
  { id: 'sport',          label: 'Sports',    gdelt: true },
  { id: 'infrastructure', label: 'Infra' },
  { id: 'tech',           label: 'Tech',      gdelt: true },
  { id: 'general',        label: 'General' },
];

// Map category → GDELT topic key (covers all GDELT-enriched tabs)
const GDELT_TOPIC_MAP: Partial<Record<EventCategory | 'all', GdeltTopic>> = {
  conflict:   'military',
  military:   'military',
  terrorism:  'terrorism',
  protest:    'protests',
  cyber:      'cyber',
  diplomatic: 'diplomatic',
  economic:   'economic',
  disaster:   'disaster',
  health:     'health',
  science:    'science',
  sport:      'sport',
  tech:       'tech',
};

type SourceFilter = 'all' | 'reddit' | 'social' | 'mainstream' | 'independent' | 'state' | 'rumor';
type ViewMode  = 'list' | 'grid';
type GeoScope  = 'global' | 'regional' | 'local';

const REGIONS = ['Europe', 'Middle East', 'Asia', 'Americas', 'Africa', 'Oceania'] as const;
type Region = typeof REGIONS[number];

const REGION_KEYWORDS: Record<Region, string[]> = {
  Europe:      ['europe', 'eu ', 'ukraine', 'russia', 'nato', 'france', 'germany', 'uk', 'britain'],
  'Middle East': ['iran', 'israel', 'gaza', 'syria', 'iraq', 'saudi', 'lebanon', 'jordan', 'yemen'],
  Asia:         ['china', 'india', 'japan', 'korea', 'taiwan', 'pakistan', 'myanmar', 'asia'],
  Americas:     ['usa', 'mexico', 'brazil', 'canada', 'colombia', 'venezuela', 'chile', 'latin'],
  Africa:       ['africa', 'nigeria', 'ethiopia', 'sudan', 'egypt', 'congo', 'kenya', 'somalia'],
  Oceania:      ['australia', 'new zealand', 'pacific', 'papua'],
};

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all',         label: 'All Sources' },
  { id: 'mainstream',  label: 'Mainstream' },
  { id: 'independent', label: 'Independent' },
  { id: 'state',       label: 'State' },
  { id: 'social',      label: 'Social' },
  { id: 'reddit',      label: 'Reddit' },
  { id: 'rumor',       label: 'Rumor' },
];

// Category aliases — broader tabs catch related sub-categories
const CATEGORY_ALIASES: Partial<Record<EventCategory | 'all', EventCategory[]>> = {
  conflict:   ['conflict', 'military', 'terrorism'],
  military:   ['military', 'conflict'],
  terrorism:  ['terrorism', 'conflict'],
  protest:    ['protest'],
  diplomatic: ['diplomatic'],
  economic:   ['economic'],
  cyber:      ['cyber'],
  disaster:   ['disaster'],
  health:     ['health', 'science'],
  science:    ['science', 'health', 'tech'],
  sport:      ['sport'],
  infrastructure: ['infrastructure'],
  tech:       ['tech', 'science'],
  general:    ['general'],
};

export function FeedPanel({ onRefresh, defaultGrid }: { onRefresh?: () => void; defaultGrid?: boolean }) {
  const { state, dispatch } = useApp();
  const { clusters, loading, settings, locationFilter } = state;
  const [filter, setFilter] = useState<EventCategory | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>(defaultGrid ? 'grid' : 'list');
  const [geoScope, setGeoScope] = useState<GeoScope>('global');
  const [activeRegion, setActiveRegion] = useState<Region>('Europe');
  const [minSources, setMinSources] = useState(1);
  const [online, setOnline] = useState(navigator.onLine);
  const [gdeltCount, setGdeltCount] = useState(0);
  const [geo, setGeo] = useState<GeoContext | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoActive, setGeoActive] = useState(false);
  const [feedStatuses, setFeedStatuses] = useState<Array<{ feedId: string; state: CircuitState; error: string | null }>>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [hitsExpanded, setHitsExpanded] = useState(false);
  const [gridCols, setGridCols] = useState(2); // 2–4 columns in grid view
  const allSources = getAllSources();
  const isFetching = useRef(false);

  // Haversine distance helper for map→feed proximity filter
  const distKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
    const R = 6371;
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLng = ((bLng - aLng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // global keywords + hits from AppContext (shared across all panels)
  const { globalKeywords, keywordHits } = state;
  const newHitCount = keywordHits.filter(h => h.isNew).length;

  // ── Topic keyword for social __TOPIC__ feeds ────────────────────────────────
  const topicFromFilter = useCallback((category: EventCategory | 'all'): string => {
    const map: Record<EventCategory | 'all', string> = {
      all:            'world news geopolitics',
      conflict:       'war conflict frontline',
      military:       'military strike troops defense',
      terrorism:      'terror attack extremist',
      diplomatic:     'diplomacy summit treaty foreign minister',
      protest:        'protest demonstration civil unrest',
      economic:       'economy market trade tariff inflation',
      cyber:          'cyberattack hack ransomware breach',
      disaster:       'earthquake flood hurricane wildfire disaster',
      health:         'health pandemic medicine hospital outbreak',
      science:        'science research discovery space climate',
      sport:          'sports football soccer basketball olympics championship',
      infrastructure: 'infrastructure energy pipeline grid',
      tech:           'technology AI startup chip semiconductor',
      general:        'world news',
    };
    return map[category] ?? 'world news';
  }, []);

  // ── Online / offline indicator ──────────────────────────────────────────────
  useEffect(() => {
    const up   = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online',  up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  // ── Main refresh ────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (isFetching.current) return;
    isFetching.current = true;
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const topic = topicFromFilter(filter);

      // Only fetch sources that have a real RSS URL (skip synthetic 'gdelt' entry)
      const enabledIds = (
        settings.enabledSources.length
          ? settings.enabledSources
          : allSources.map(s => s.id)
      ).filter(id => {
        const src = getSourceById(id);
        return src?.rss && src.rss.length > 0;
      });

      // Fetch all RSS feeds — Promise.allSettled means one dead feed never blocks others
      const rssArticles = await fetchAllFeeds(enabledIds, topic);

      // GDELT enrichment for intel-heavy category tabs
      let enriched = 0;
      const gdeltTopic = GDELT_TOPIC_MAP[filter];
      if (gdeltTopic) {
        try {
          const raw = await getTopicFeed(gdeltTopic);
          const converted = gdeltToRaw(raw, filter);
          enriched = converted.length;
          rssArticles.push(...converted);
        } catch (e) {
          console.warn('[Feed] GDELT enrichment failed:', e);
        }
      }
      setGdeltCount(enriched);

      const newClusters = await clusterArticles(rssArticles);
      dispatch({ type: 'SET_CLUSTERS', payload: newClusters });
      dispatch({ type: 'SET_LAST_REFRESH', payload: new Date() });

      // Update circuit breaker status badges after fetch completes
      setFeedStatuses(getAllCircuitStates().filter(s => s.state !== 'closed'));
    } catch (err) {
      console.error('[Feed] Refresh failed:', err);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
      isFetching.current = false;
    }
  }, [settings.enabledSources, dispatch, allSources, filter, topicFromFilter]);

  // Initial load + 5-min auto-refresh
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line

  // Re-fetch on filter tab change (changes GDELT topic + social __TOPIC__ query)
  useEffect(() => {
    refresh();
  }, [filter]); // eslint-disable-line

  // Global refresh event (from Header button)
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('pos:refresh', handler);
    return () => window.removeEventListener('pos:refresh', handler);
  }, [refresh]);

  // ── Auto-detect location silently on mount ──────────────────────────────
  useEffect(() => {
    // Only attempt once — silent, no spinner visible to user
    let cancelled = false;
    detectUserLocation()
      .then(result => {
        if (!cancelled && result) {
          setGeo(result);
          // Auto-apply if we got location from cache (instant, user has consented before)
          try {
            const cached = localStorage.getItem('pos-geo');
            if (cached) setGeoActive(true);
          } catch {}
        }
      })
      .catch(() => { /* silently ignore permission denied */ });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

  // ── Gemini keyword generation ────────────────────────────────────────
  // Regenerate keywords 2s after clusters update (debounced to avoid hammering)
  useEffect(() => {
    if (loading || clusters.length === 0) return;
    const timer = setTimeout(async () => {
      setKeywordsLoading(true);
      try {
        const baseTopic = topicFromFilter(filter);
        // Enrich with auto-detected country so keywords are localised
        const topic = geo ? `${baseTopic} ${geo.country}` : baseTopic;
        const topHeadlines = clusters.slice(0, 5).map(c => c.headline);
        const kw = await generateKeywords(topic, topHeadlines);
        // Write to global AppContext so ALL panels can use keywords
        dispatch({ type: 'SET_GLOBAL_KEYWORDS', payload: kw });
        setSelectedKeyword(null);
      } catch {
        // silently ignore
      } finally {
        setKeywordsLoading(false);
      }
    }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters.length, filter, loading, geo?.countryCode]);

  // ── Geolocation ─────────────────────────────────────────────────────────────
  const handleGeoToggle = useCallback(async () => {
    if (geoActive) { setGeoActive(false); return; }
    if (geo)        { setGeoActive(true);  return; }
    setGeoLoading(true);
    try {
      const result = await detectUserLocation();
      if (result) { setGeo(result); setGeoActive(true); }
    } catch { /* permission denied */ }
    finally { setGeoLoading(false); }
  }, [geo, geoActive]);

  // ── Client-side filtering ───────────────────────────────────────────────────
  // Keyword regex fallback — catches stories AI classified as 'general' but whose text matches
  const CATEGORY_KEYWORDS: Partial<Record<EventCategory, RegExp>> = {
    conflict:    /\b(war|battle|fighting|ceasefire|killed|attack|offensive|invasion|strike|bomb|shelling|troops|frontline|besieged|siege)\b/i,
    military:    /\b(military|troops|army|navy|airstrike|missile|weapon|drone|nato|defense|warship|regiment|battalion)\b/i,
    terrorism:   /\b(terror|terrorist|bomb|explosion|ISIS|Hamas|Hezbollah|extremist|hostage|suicide.?bomb|jihad)\b/i,
    protest:     /\b(protest|riot|march|demonstration|uprising|crackdown|demonstrators|activists)\b/i,
    economic:    /\b(market|economy|inflation|trade|tariff|bank|stock|oil|recession|currency|gdp|unemployment|federal.reserve|interest.rate)\b/i,
    cyber:       /\b(hack|cyber|ransomware|breach|malware|APT|phishing|zero.?day|intrusion|data.leak|espionage)\b/i,
    disaster:    /\b(earthquake|flood|hurricane|tsunami|wildfire|disaster|eruption|cyclone|tornado|avalanche|drought|famine)\b/i,
    health:      /\b(pandemic|outbreak|virus|vaccine|hospital|disease|mortality|epidemic|pathogen|WHO|medicine|clinical|treatment|drug.approval)\b/i,
    diplomatic:  /\b(summit|treaty|sanctions|embassy|diplomat|bilateral|foreign.minister|negotiations|ceasefire|peace.talks|accord)\b/i,
    science:     /\b(research|discovery|study|NASA|ESA|space|climate|CERN|particle|genome|AI|quantum|breakthrough|published|journal)\b/i,
    sport:       /\b(olympics|championship|tournament|football|soccer|basketball|tennis|formula.1|F1|NBA|FIFA|UEFA|medal|athlete|match|game)\b/i,
    tech:        /\b(technology|AI|startup|chip|semiconductor|OpenAI|Meta|Google|Apple|Microsoft|Amazon|SpaceX|launch|product|software)\b/i,
    infrastructure: /\b(pipeline|grid|power.plant|dam|bridge|rail|port|energy|electricity|water|gas.pipeline|cable)\b/i,
  };

  const filtered = clusters.filter(c => {
    if (filter !== 'all') {
      const allowed = CATEGORY_ALIASES[filter] ?? [filter as EventCategory];
      // Match if cluster head OR majority of articles match allowed categories
      const clusterMatch = allowed.includes(c.category);
      const articleMatch = c.articles.some(a => allowed.includes(a.category));
      // Keyword fallback — catch stories classified as 'general' that semantically belong to this tab
      const kwRe = CATEGORY_KEYWORDS[filter as EventCategory];
      const kwMatch = !!kwRe && (kwRe.test(c.headline) || c.articles.some(a => kwRe.test(a.title)));
      if (!clusterMatch && !articleMatch && !kwMatch) return false;
    }

    if (sourceFilter !== 'all') {
      const match = c.sourceIds.some(sid => {
        const src = getSourceById(sid);
        if (!src) return false;
        if (sourceFilter === 'reddit') return sid.startsWith('reddit-');
        return src.sourceType === sourceFilter;
      });
      if (!match) return false;
    }

    if (c.sourceIds.length < minSources) return false;

    // Geo scope filter
    if (geoScope === 'local' && geo) {
      const geoMatch =
        (c.geoHint?.name && (
          c.geoHint.name.toLowerCase().includes(geo.country.toLowerCase()) ||
          c.geoHint.name.toLowerCase().includes(geo.region.toLowerCase())
        )) ||
        c.sourceIds.some(sid => {
          const src = getSourceById(sid);
          return src?.country === geo.country || src?.region === geo.region;
        });
      if (!geoMatch) return false;
    }

    if (geoScope === 'regional') {
      const kws = REGION_KEYWORDS[activeRegion];
      const headline = c.headline.toLowerCase();
      const geoName  = (c.geoHint?.name ?? '').toLowerCase();
      const match = kws.some(k => headline.includes(k) || geoName.includes(k));
      if (!match) return false;
    }

    // Legacy geo active banner (when scope=local but geo not yet obtained)
    if (geoActive && geo && geoScope !== 'local') {
      const geoMatch =
        (c.geoHint?.name && (
          c.geoHint.name.toLowerCase().includes(geo.country.toLowerCase()) ||
          c.geoHint.name.toLowerCase().includes(geo.region.toLowerCase())
        )) ||
        c.sourceIds.some(sid => {
          const src = getSourceById(sid);
          return src?.country === geo.country || src?.region === geo.region;
        });
      if (!geoMatch) return false;
    }

    // Map→feed sync: filter by proximity to right-clicked location (dispatched from MapView)
    if (locationFilter) {
      if (c.geoHint) {
        const dist = distKm(locationFilter.lat, locationFilter.lng, c.geoHint.lat, c.geoHint.lng);
        if (dist > 800) return false; // 800km radius
      } else {
        // No geo hint: keep if headline/geo text loosely matches the location name
        const locName = locationFilter.name.toLowerCase();
        const headlineLower = c.headline.toLowerCase();
        if (!headlineLower.includes(locName.split(',')[0].toLowerCase()) &&
            !c.articles.some(a => a.title.toLowerCase().includes(locName.split(',')[0].toLowerCase()))) {
          return false;
        }
      }
    }

    return true;
  });

  const activeCategory = CATEGORIES.find(c => c.id === filter);
  const isGdeltEnriched = activeCategory?.gdelt && gdeltCount > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Map→Feed location filter banner */}
      {locationFilter && (
        <div className="px-3 py-1.5 bg-accent/10 border-b border-accent/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            <MapPin size={10} className="text-accent" />
            <span className="text-accent font-semibold">Map filter:</span>
            <span className="text-white">{locationFilter.name}</span>
            <span className="text-dim">— showing nearby stories</span>
          </div>
          <button
            onClick={() => dispatch({ type: 'SET_LOCATION_FILTER', payload: null })}
            className="text-dim hover:text-white text-[10px] font-mono flex items-center gap-0.5"
            title="Clear map filter, show all stories"
          >
            <X size={10} />
            <span>Reset</span>
          </button>
        </div>
      )}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-dim">
          {online
            ? <Wifi size={10} className="text-green-400" />
            : <WifiOff size={10} className="text-red-400" />}
          <span>{filtered.length} stories</span>
          {isGdeltEnriched && (
            <span className="flex items-center gap-0.5 text-amber-400">
              <Zap size={9} />+{gdeltCount} GDELT
            </span>
          )}
        </div>

        {/* Near Me geo-filter button */}
        <button
          onClick={handleGeoToggle}
          disabled={geoLoading}
          title={geo ? `Location: ${geo.country} (${geo.region})` : 'Filter by your location'}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
            geoActive && geo
              ? 'bg-green-500/15 text-green-400 border-green-500/40'
              : 'text-dim border-transparent hover:text-white hover:bg-white/5'
          }`}
        >
          <MapPin size={9} />
          {geoLoading ? '…' : geoActive && geo ? geo.country : 'Near Me'}
          {geoActive && geo && (
            <X
              size={8}
              className="ml-0.5 opacity-60 hover:opacity-100"
              onClick={e => { e.stopPropagation(); setGeoActive(false); }}
            />
          )}
        </button>

        <div className="flex-1" />

        {/* Grid / List toggle */}
        <div className="flex items-center border border-border/60 rounded overflow-hidden">
          <button
            onClick={() => setViewMode('list')}
            title="List view"
            className={`px-1.5 py-1 transition-colors ${
              viewMode === 'list' ? 'bg-accent/15 text-accent' : 'text-dim hover:text-white hover:bg-white/5'
            }`}
          >
            <LayoutList size={11} />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            title="Grid view"
            className={`px-1.5 py-1 transition-colors ${
              viewMode === 'grid' ? 'bg-accent/15 text-accent' : 'text-dim hover:text-white hover:bg-white/5'
            }`}
          >
            <LayoutGrid size={11} />
          </button>
        </div>

        {/* Grid density +/- (only in grid mode) */}
        {viewMode === 'grid' && (
          <div className="flex items-center border border-border/60 rounded overflow-hidden">
            <button
              onClick={() => setGridCols(c => Math.max(2, c - 1))}
              disabled={gridCols <= 2}
              title="Fewer columns"
              className="px-1.5 py-1 text-[10px] font-mono text-dim hover:text-white hover:bg-white/5 disabled:opacity-30 transition-colors"
            >−</button>
            <span className="px-1 text-[10px] font-mono text-dim">{gridCols}</span>
            <button
              onClick={() => setGridCols(c => Math.min(4, c + 1))}
              disabled={gridCols >= 4}
              title="More columns"
              className="px-1.5 py-1 text-[10px] font-mono text-dim hover:text-white hover:bg-white/5 disabled:opacity-30 transition-colors"
            >+</button>
          </div>
        )}

        <Filter size={10} className="text-dim" />
        <select
          value={minSources}
          onChange={e => setMinSources(Number(e.target.value))}
          className="text-[10px] font-mono bg-surface border border-border rounded px-1.5 py-1 text-dim hover:text-white focus:outline-none focus:border-accent"
        >
          <option value={1}>Any sources</option>
          <option value={2}>2+ sources</option>
          <option value={3}>3+ sources</option>
          <option value={4}>4+ sources</option>
        </select>
      </div>

      {/* Scope selector — Global / Regional / Local */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
        <Globe size={9} className="text-dim shrink-0" />
        {(['global', 'regional', 'local'] as GeoScope[]).map(s => (
          <button
            key={s}
            onClick={() => {
              setGeoScope(s);
              if (s === 'local' && !geo) handleGeoToggle();
            }}
            className={`px-2 py-0.5 text-[9px] font-mono rounded capitalize transition-colors ${
              geoScope === s
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-dim hover:text-white hover:bg-white/5'
            }`}
          >
            {s}
          </button>
        ))}
        {geoScope === 'regional' && (
          <select
            value={activeRegion}
            onChange={e => setActiveRegion(e.target.value as Region)}
            className="ml-1 text-[9px] font-mono bg-surface border border-border rounded px-1.5 py-0.5 text-dim hover:text-white focus:outline-none focus:border-accent"
          >
            {REGIONS.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}
        {geoScope === 'local' && geo && (
          <span className="ml-1 text-[9px] font-mono text-green-400">{geo.country}</span>
        )}
      </div>

      {/* Category tabs — amber dot = GDELT-enriched */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto shrink-0 border-b border-border">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setFilter(cat.id)}
            className={`relative px-2 py-1 text-[10px] font-mono rounded whitespace-nowrap transition-colors ${
              filter === cat.id
                ? 'bg-accent/10 text-accent border border-accent/30'
                : 'text-dim hover:text-white hover:bg-white/5'
            }`}
          >
            {cat.label}
            {cat.gdelt && (
              <span
                className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 opacity-60"
                title="GDELT intelligence enriched"
              />
            )}
          </button>
        ))}
      </div>

      {/* Source type filter tabs */}
      <div className="flex gap-1 px-3 py-1.5 overflow-x-auto shrink-0 border-b border-border/60">
        {SOURCE_FILTERS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSourceFilter(tab.id)}
            className={`px-2 py-0.5 text-[9px] font-mono rounded whitespace-nowrap transition-colors ${
              sourceFilter === tab.id
                ? 'bg-accent/10 text-accent border border-accent/30'
                : 'text-dim hover:text-white hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Feed circuit-breaker status badges — only visible when feeds are down/degraded */}
      {feedStatuses.length > 0 && (
        <div className="px-3 py-1.5 bg-red-500/5 border-b border-red-500/20 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <AlertTriangle size={9} className="text-red-400 shrink-0" />
            <span className="text-[9px] font-mono text-red-400 uppercase tracking-wider">Feed issues:</span>
            {feedStatuses.map(s => (
              <span
                key={s.feedId}
                title={s.error ?? 'Feed unavailable'}
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  s.state === 'open'
                    ? 'border-red-500/40 text-red-400 bg-red-500/10'
                    : 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10'
                }`}
              >
                {s.state === 'open' ? '✕' : '◑'} {s.feedId}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI Gemini keyword chips — searchable topic keywords generated from current headlines */}
      {(globalKeywords.length > 0 || keywordsLoading) && (
        <div className="px-3 py-2 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles size={9} className={`${keywordsLoading ? 'text-accent animate-pulse' : 'text-accent/60'}`} />
            <span className="text-[9px] font-mono text-dim uppercase tracking-wider">AI keywords</span>
            {state.keywordMonitorOn && (
              <span className="flex items-center gap-0.5 text-[8px] font-mono text-green-400 ml-1">
                <Radio size={7} className="animate-pulse" /> live
              </span>
            )}
            {selectedKeyword && (
              <button
                onClick={() => setSelectedKeyword(null)}
                className="ml-auto text-[9px] font-mono text-dim hover:text-white flex items-center gap-0.5"
              >
                <X size={8} /> clear
              </button>
            )}
          </div>
          {keywordsLoading ? (
            <div className="flex gap-1.5 flex-wrap">
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="h-5 w-20 bg-white/5 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              {globalKeywords.map(kw => {
                const isRumour   = kw.toLowerCase().startsWith('rumour:') || kw.toLowerCase().startsWith('rumor:');
                const isHashtag  = kw.toLowerCase().startsWith('hashtag') || kw.toLowerCase().includes('standwith') || kw.toLowerCase().includes('#');
                const isCounter  = kw.toLowerCase().includes('aggression') || kw.toLowerCase().includes('propaganda');
                const display    = kw.replace(/^rumou?r:\s*/i, '').replace(/^hashtag[: ]*/i, '');
                return (
                  <button
                    key={kw}
                    onClick={() => {
                      setSelectedKeyword(selectedKeyword === kw ? null : kw);
                      // Find best matching cluster and open Perspective panel
                      const needle = display.toLowerCase();
                      const match = clusters.find(c =>
                        c.headline.toLowerCase().includes(needle) ||
                        c.articles.some(a => a.title.toLowerCase().includes(needle))
                      );
                      if (match) dispatch({ type: 'SELECT_CLUSTER', payload: match });
                    }}
                    title={`Filter stories: ${display}`}
                    className={`px-2 py-0.5 text-[9px] font-mono rounded border transition-colors cursor-pointer ${
                      selectedKeyword === kw
                        ? 'border-accent text-accent bg-accent/10'
                        : isRumour
                          ? 'border-orange-500/40 text-orange-400 hover:border-orange-400 hover:bg-orange-500/10'
                          : isCounter
                            ? 'border-purple-500/40 text-purple-400 hover:border-purple-400 hover:bg-purple-500/10'
                            : isHashtag
                              ? 'border-blue-500/40 text-blue-400 hover:border-blue-400 hover:bg-blue-500/10'
                              : 'border-border text-dim hover:text-white hover:border-accent/50 hover:bg-white/5'
                    }`}
                  >
                    {isRumour ? '⚠ ' : isHashtag ? '# ' : ''}{display}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Live keyword hits strip — results from background monitor */}
      {keywordHits.length > 0 && (
        <div className="border-b border-border/60 shrink-0">
          <button
            onClick={() => {
              setHitsExpanded(p => !p);
              if (!hitsExpanded) dispatch({ type: 'MARK_KEYWORDS_READ' });
            }}
            className="w-full px-3 py-1.5 flex items-center gap-1.5 hover:bg-white/5 transition-colors"
          >
            <Radio size={9} className="text-green-400" />
            <span className="text-[9px] font-mono text-dim uppercase tracking-wider">Live monitor hits</span>
            {newHitCount > 0 && (
              <span className="px-1.5 py-0.5 text-[8px] font-mono rounded-full bg-accent text-black font-bold">
                {newHitCount} new
              </span>
            )}
            <span className="text-[9px] font-mono text-dim ml-auto">
              {keywordHits.length} total {hitsExpanded ? '▲' : '▼'}
            </span>
          </button>

          {hitsExpanded && (
            <div className="max-h-48 overflow-y-auto divide-y divide-border/40">
              {keywordHits.slice(0, 40).map(hit => {
                const sourceIcon = hit.source === 'reddit' ? '🟠' : hit.source === 'meta-og' ? '𝕏' : '📰';
                const isRumourKw = hit.keyword.toLowerCase().startsWith('rumour:') || hit.keyword.toLowerCase().startsWith('rumor:');
                return (
                  <button
                    key={hit.id}
                    onClick={() => {
                      // Find a matching cluster by keyword match — show in Perspective panel
                      const needle = hit.keyword.replace(/^rumou?r:\s*/i, '').toLowerCase();
                      const match = clusters.find(c =>
                        c.headline.toLowerCase().includes(needle) ||
                        c.articles.some(a => a.title.toLowerCase().includes(needle))
                      );
                      if (match) dispatch({ type: 'SELECT_CLUSTER', payload: match });
                    }}
                    className={`w-full flex items-start gap-2 px-3 py-2 hover:bg-white/5 transition-colors group text-left ${
                      hit.isNew ? 'bg-accent/5' : ''
                    }`}
                  >
                    <span className="text-[10px] shrink-0 mt-0.5">{sourceIcon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-white/90 leading-snug line-clamp-2 group-hover:text-white">
                        {hit.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[8px] font-mono px-1 rounded border ${
                          isRumourKw
                            ? 'border-orange-500/30 text-orange-400/80'
                            : 'border-border/50 text-dim'
                        }`}>
                          {isRumourKw ? '⚠ ' : ''}{hit.keyword.replace(/^rumou?r:\s*/i, '')}
                        </span>
                        {hit.isNew && (
                          <span className="text-[8px] font-mono text-accent">NEW</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[8px] font-mono text-dim shrink-0 mt-1 opacity-0 group-hover:opacity-100">→ open</span>
                  </button>
                );
              })}
              {keywordHits.length > 40 && (
                <p className="px-3 py-2 text-[9px] font-mono text-dim text-center">
                  +{keywordHits.length - 40} older hits
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Geo active banner */}
      {geoActive && geo && (
        <div className="px-3 py-1.5 bg-green-500/5 border-b border-green-500/20 flex items-center gap-2 shrink-0">
          <MapPin size={9} className="text-green-400 shrink-0" />
          <span className="text-[10px] font-mono text-green-400">
            Showing <strong>{geo.country}</strong> ({geo.region}) relevant stories
          </span>
          <button onClick={() => setGeoActive(false)} className="ml-auto text-dim hover:text-white">
            <X size={10} />
          </button>
        </div>
      )}

      {/* Stories list / grid */}
      <div className={`flex-1 overflow-y-auto ${
        viewMode === 'grid'
          ? `grid gap-2 p-2 content-start`
          : 'divide-y divide-border/50 px-2'
      }`} style={viewMode === 'grid' ? { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` } : undefined}>
        {loading && clusters.length === 0 && (
          <div className={`flex flex-col items-center gap-3 py-12 text-dim ${
            viewMode === 'grid' ? 'col-span-full' : ''
          }`}>
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono">
              Fetching {allSources.filter(s => s.rss).length} sources
              {activeCategory?.gdelt ? ' + GDELT intel' : ''}…
            </span>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className={`py-12 text-center space-y-2 ${
            viewMode === 'grid' ? 'col-span-full' : ''
          }`}>
            <p className="text-xs text-dim font-mono">No stories match current filters</p>
            {(filter !== 'all' || sourceFilter !== 'all' || geoActive || geoScope !== 'global') && (
              <button
                onClick={() => { setFilter('all'); setSourceFilter('all'); setGeoActive(false); setGeoScope('global'); }}
                className="text-[10px] text-accent font-mono hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {viewMode === 'grid'
          ? filtered.map(cluster => <StoryGridCard key={cluster.id} cluster={cluster} />)
          : filtered.map(cluster => <StoryCard     key={cluster.id} cluster={cluster} />)
        }
      </div>
    </div>
  );
}
