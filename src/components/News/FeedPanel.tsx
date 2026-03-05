import { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { StoryCard } from './StoryCard';
import { NEWS_SOURCES } from '../../config/sources';
import { fetchAllFeeds } from '../../services/rss';
import { clusterArticles } from '../../utils/story-cluster';
import { Filter, Wifi, WifiOff } from 'lucide-react';
import type { EventCategory } from '../../types';

const CATEGORIES: Array<{ id: EventCategory | 'all'; label: string }> = [
  { id: 'all',          label: 'All' },
  { id: 'conflict',     label: 'Conflict' },
  { id: 'military',     label: 'Military' },
  { id: 'terrorism',    label: 'Terror' },
  { id: 'diplomatic',   label: 'Diplomacy' },
  { id: 'protest',      label: 'Protests' },
  { id: 'economic',     label: 'Economy' },
  { id: 'cyber',        label: 'Cyber' },
  { id: 'disaster',     label: 'Disaster' },
];

export function FeedPanel({ onRefresh }: { onRefresh?: () => void }) {
  const { state, dispatch } = useApp();
  const { clusters, loading, settings } = state;
  const [filter, setFilter] = useState<EventCategory | 'all'>('all');
  const [minSources, setMinSources] = useState(1);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const up   = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online',  up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  const refresh = useCallback(async () => {
    if (loading) return;
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const enabledIds = settings.enabledSources.length
        ? settings.enabledSources
        : NEWS_SOURCES.map(s => s.id);

      const articles = await fetchAllFeeds(enabledIds);
      const newClusters = await clusterArticles(articles);
      dispatch({ type: 'SET_CLUSTERS', payload: newClusters });
      dispatch({ type: 'SET_LAST_REFRESH', payload: new Date() });
    } catch (err) {
      console.error('[Feed] Refresh failed:', err);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [loading, settings.enabledSources, dispatch]);

  // Initial load + auto-refresh every 5 min
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line

  // Expose refresh to parent
  useEffect(() => {
    if (onRefresh) {
      // Pass refresh function up via custom event
      const handler = () => refresh();
      window.addEventListener('pos:refresh', handler);
      return () => window.removeEventListener('pos:refresh', handler);
    }
  }, [refresh, onRefresh]);

  const filtered = clusters.filter(c => {
    if (filter !== 'all' && c.category !== filter) return false;
    if (c.sourceIds.length < minSources) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1 text-[10px] font-mono text-dim">
          {online ? <Wifi size={10} className="text-green-400" /> : <WifiOff size={10} className="text-red-400" />}
          <span>{filtered.length} stories</span>
        </div>
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

      {/* Category tabs */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto shrink-0 border-b border-border">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setFilter(cat.id)}
            className={`px-2 py-1 text-[10px] font-mono rounded whitespace-nowrap transition-colors ${
              filter === cat.id
                ? 'bg-accent/10 text-accent border border-accent/30'
                : 'text-dim hover:text-white hover:bg-white/5'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Stories */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/50 px-2">
        {loading && clusters.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-dim">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono">Fetching {NEWS_SOURCES.length} sources...</span>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-xs text-dim font-mono">No stories match current filters</p>
          </div>
        )}

        {filtered.map(cluster => (
          <StoryCard key={cluster.id} cluster={cluster} />
        ))}
      </div>
    </div>
  );
}
