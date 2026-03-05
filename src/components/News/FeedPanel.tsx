import { useEffect, useState, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { StoryCard } from './StoryCard';
import { getAllSources, getSourceById } from '../../config/sources';
import { fetchAllFeeds } from '../../services/rss';
import { clusterArticles } from '../../utils/story-cluster';
import { getTopicFeed, gdeltToRaw } from '../../services/gdelt';
import { detectUserLocation } from '../../services/geo';
import type { GeoContext } from '../../services/geo';
import { Filter, Wifi, WifiOff, MapPin, X, Zap } from 'lucide-react';
import type { EventCategory } from '../../types';

const CATEGORIES: Array<{ id: EventCategory | 'all'; label: string; gdelt?: boolean }> = [
  { id: 'all',            label: 'All' },
  { id: 'conflict',       label: 'Conflict',  gdelt: true },
  { id: 'military',       label: 'Military',  gdelt: true },
  { id: 'terrorism',      label: 'Terror',    gdelt: true },
  { id: 'diplomatic',     label: 'Diplomacy' },
  { id: 'protest',        label: 'Protests',  gdelt: true },
  { id: 'economic',       label: 'Economy' },
  { id: 'cyber',          label: 'Cyber',     gdelt: true },
  { id: 'disaster',       label: 'Disaster' },
  { id: 'health',         label: 'Health' },
  { id: 'infrastructure', label: 'Infra' },
  { id: 'tech',           label: 'Tech' },
  { id: 'general',        label: 'General' },
];

// Map category → GDELT topic key (only for intel-enriched tabs)
const GDELT_TOPIC_MAP: Partial<Record<EventCategory | 'all', 'military' | 'cyber' | 'nuclear' | 'sanctions' | 'protests'>> = {
  conflict:  'military',
  military:  'military',
  terrorism: 'military',
  protest:   'protests',
  cyber:     'cyber',
};

type SourceFilter = 'all' | 'reddit' | 'social' | 'mainstream' | 'independent' | 'state' | 'rumor';

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all',         label: 'All Sources' },
  { id: 'mainstream',  label: 'Mainstream' },
  { id: 'independent', label: 'Independent' },
  { id: 'state',       label: 'State' },
  { id: 'social',      label: 'Social' },
  { id: 'reddit',      label: 'Reddit' },
  { id: 'rumor',       label: 'Rumor' },
];

export function FeedPanel({ onRefresh }: { onRefresh?: () => void }) {
  const { state, dispatch } = useApp();
  const { clusters, loading, settings } = state;
  const [filter, setFilter] = useState<EventCategory | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [minSources, setMinSources] = useState(1);
  const [online, setOnline] = useState(navigator.onLine);
  const [gdeltCount, setGdeltCount] = useState(0);
  const [geo, setGeo] = useState<GeoContext | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoActive, setGeoActive] = useState(false);
  const allSources = getAllSources();
  const isFetching = useRef(false);

  // ── Topic keyword for social __TOPIC__ feeds ────────────────────────────────
  const topicFromFilter = useCallback((category: EventCategory | 'all'): string => {
    const map: Record<EventCategory | 'all', string> = {
      all:            'world news geopolitics',
      conflict:       'war conflict frontline',
      military:       'military strike troops defense',
      terrorism:      'terror attack extremist',
      diplomatic:     'diplomacy summit sanctions negotiation',
      protest:        'protest demonstration unrest',
      economic:       'economy inflation trade sanctions',
      cyber:          'cyberattack breach ransomware',
      disaster:       'earthquake flood wildfire disaster',
      health:         'health outbreak hospital vaccine',
      infrastructure: 'infrastructure blackout bridge pipeline',
      tech:           'technology AI surveillance chips',
      general:        'breaking world news',
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
  const filtered = clusters.filter(c => {
    if (filter !== 'all' && c.category !== filter) return false;

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

    // Geo filter — must match user's country or region
    if (geoActive && geo) {
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

    return true;
  });

  const activeCategory = CATEGORIES.find(c => c.id === filter);
  const isGdeltEnriched = activeCategory?.gdelt && gdeltCount > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
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

      {/* Stories list */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/50 px-2">
        {loading && clusters.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-dim">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono">
              Fetching {allSources.filter(s => s.rss).length} sources
              {activeCategory?.gdelt ? ' + GDELT intel' : ''}…
            </span>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-12 text-center space-y-2">
            <p className="text-xs text-dim font-mono">No stories match current filters</p>
            {(filter !== 'all' || sourceFilter !== 'all' || geoActive) && (
              <button
                onClick={() => { setFilter('all'); setSourceFilter('all'); setGeoActive(false); }}
                className="text-[10px] text-accent font-mono hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {filtered.map(cluster => (
          <StoryCard key={cluster.id} cluster={cluster} />
        ))}
      </div>
    </div>
  );
}
