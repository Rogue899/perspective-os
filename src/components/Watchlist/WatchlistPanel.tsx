/**
 * Watchlist Panel — keyword alerts against live story clusters
 *
 * Features:
 * - Add watchlist items: label + keywords + severity/category/geo filters
 * - Shows live matches from current clusters
 * - Mute / delete items
 * - Badge count driven by Header.tsx
 * - Persisted to localStorage via AppContext SET_WATCHLIST
 */

import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import type { WatchlistItem, EventCategory, StoryCluster } from '../../types';
import { Bell, BellOff, Plus, Trash2, X, CheckCircle, AlertTriangle, Zap } from 'lucide-react';

const SEVERITY_LEVELS = ['any', 'low', 'medium', 'high', 'critical'] as const;
const SEVERITY_ORDER: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const CATEGORIES: EventCategory[] = [
  'conflict', 'military', 'terrorism', 'cyber', 'protest',
  'diplomatic', 'economic', 'disaster', 'health', 'tech', 'general',
];

function severityColor(s: string) {
  if (s === 'critical') return 'text-red-400';
  if (s === 'high')     return 'text-orange-400';
  if (s === 'medium')   return 'text-yellow-400';
  if (s === 'low')      return 'text-blue-400';
  return 'text-dim';
}

function matchCluster(item: WatchlistItem, cluster: StoryCluster): string[] {
  // Severity gate
  const minOrder = SEVERITY_ORDER[item.minSeverity] ?? 0;
  if (item.minSeverity !== 'any' && SEVERITY_ORDER[cluster.severity] < minOrder) return [];

  // Category filter
  if (item.categories && item.categories.length > 0 && !item.categories.includes(cluster.category)) return [];

  // Geo filter
  if (item.geoFilter) {
    const geoName = cluster.geoHint?.name?.toLowerCase() ?? '';
    if (!geoName.includes(item.geoFilter.toLowerCase())) return [];
  }

  // Source filter
  if (item.sourceIds && item.sourceIds.length > 0) {
    const clusterSources = new Set(cluster.sourceIds);
    if (!item.sourceIds.some(id => clusterSources.has(id))) return [];
  }

  // Keyword match (case-insensitive, against headline)
  const headline = cluster.headline.toLowerCase();
  return item.keywords.filter(kw => headline.includes(kw.toLowerCase()));
}

// ─── Add item form ─────────────────────────────────────────────────────────────
function AddItemForm({ onAdd }: { onAdd: (item: WatchlistItem) => void }) {
  const [label, setLabel]         = useState('');
  const [keywordInput, setKwInput]= useState('');
  const [keywords, setKeywords]   = useState<string[]>([]);
  const [severity, setSeverity]   = useState<WatchlistItem['minSeverity']>('any');
  const [cats, setCats]           = useState<EventCategory[]>([]);
  const [geo, setGeo]             = useState('');
  const [open, setOpen]           = useState(false);

  function addKeyword() {
    const kw = keywordInput.trim();
    if (kw && !keywords.includes(kw)) setKeywords(prev => [...prev, kw]);
    setKwInput('');
  }

  function toggleCat(c: EventCategory) {
    setCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || keywords.length === 0) return;
    onAdd({
      id: `wl-${Date.now()}`,
      label: label.trim(),
      keywords,
      minSeverity: severity,
      categories: cats.length > 0 ? cats : undefined,
      geoFilter: geo.trim() || undefined,
      createdAt: new Date().toISOString(),
      matchCount: 0,
      muted: false,
    });
    setLabel(''); setKeywords([]); setKwInput(''); setSeverity('any'); setCats([]); setGeo('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[10px] font-mono text-accent hover:bg-accent/10 border border-accent/30 rounded px-2 py-1.5 transition-colors"
      >
        <Plus size={11} /> Add Alert
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-white font-semibold">New Alert</span>
        <button type="button" onClick={() => setOpen(false)} className="text-dim hover:text-white">
          <X size={12} />
        </button>
      </div>

      {/* Label */}
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Alert name (e.g. Iran Nuclear)"
        className="w-full bg-bg border border-border rounded px-2 py-1 text-[10px] font-mono text-white placeholder-dim/50 focus:outline-none focus:border-accent/50"
      />

      {/* Keywords */}
      <div>
        <div className="text-[9px] font-mono text-dim mb-1">Keywords (match any)</div>
        <div className="flex gap-1 mb-1.5 flex-wrap">
          {keywords.map(kw => (
            <span key={kw} className="flex items-center gap-0.5 text-[9px] font-mono bg-accent/10 text-accent border border-accent/20 rounded px-1 py-0.5">
              {kw}
              <button type="button" onClick={() => setKeywords(p => p.filter(k => k !== kw))}>
                <X size={8} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            value={keywordInput}
            onChange={e => setKwInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); }}}
            placeholder="Add keyword…"
            className="flex-1 bg-bg border border-border rounded px-2 py-1 text-[10px] font-mono text-white placeholder-dim/50 focus:outline-none focus:border-accent/50"
          />
          <button
            type="button"
            onClick={addKeyword}
            className="text-[9px] font-mono text-accent border border-accent/30 rounded px-2 py-1 hover:bg-accent/10"
          >
            Add
          </button>
        </div>
      </div>

      {/* Severity */}
      <div>
        <div className="text-[9px] font-mono text-dim mb-1">Min severity</div>
        <div className="flex gap-1 flex-wrap">
          {SEVERITY_LEVELS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                severity === s
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'text-dim border-border hover:text-white hover:bg-white/5'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Categories */}
      <div>
        <div className="text-[9px] font-mono text-dim mb-1">Categories (all if none selected)</div>
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => toggleCat(c)}
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                cats.includes(c)
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'text-dim border-border hover:text-white hover:bg-white/5'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Geo filter */}
      <input
        value={geo}
        onChange={e => setGeo(e.target.value)}
        placeholder="Geo filter (optional — e.g. Lebanon)"
        className="w-full bg-bg border border-border rounded px-2 py-1 text-[10px] font-mono text-white placeholder-dim/50 focus:outline-none focus:border-accent/50"
      />

      <button
        type="submit"
        disabled={!label.trim() || keywords.length === 0}
        className="w-full text-[10px] font-mono bg-accent/20 text-accent border border-accent/30 rounded py-1.5 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Create Alert
      </button>
    </form>
  );
}

// ─── Single watchlist row ──────────────────────────────────────────────────────
function WatchlistRow({
  item,
  matches,
  onMute,
  onDelete,
}: {
  item: WatchlistItem;
  matches: StoryCluster[];
  onMute: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMatches = matches.length > 0;

  return (
    <div className={`border rounded p-2.5 space-y-2 transition-colors ${
      item.muted ? 'border-border opacity-50' :
      hasMatches ? 'border-accent/30 bg-accent/5' : 'border-border'
    }`}>
      <div className="flex items-center gap-2">
        {/* Status icon */}
        <div className="shrink-0">
          {hasMatches && !item.muted
            ? <Zap size={12} className="text-accent animate-pulse" />
            : <Bell size={12} className="text-dim" />
          }
        </div>

        {/* Label + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-white font-semibold truncate">{item.label}</span>
            {hasMatches && !item.muted && (
              <span className="text-[8px] font-mono bg-accent/20 text-accent px-1 rounded">
                {matches.length} match{matches.length !== 1 ? 'es' : ''}
              </span>
            )}
          </div>
          <div className="text-[8px] font-mono text-dim flex gap-1.5 flex-wrap mt-0.5">
            {item.keywords.slice(0, 4).map(kw => (
              <span key={kw} className="bg-surface border border-border px-1 rounded">{kw}</span>
            ))}
            {item.keywords.length > 4 && <span>+{item.keywords.length - 4}</span>}
            {item.minSeverity !== 'any' && (
              <span className={severityColor(item.minSeverity)}>≥{item.minSeverity}</span>
            )}
            {item.geoFilter && <span className="text-dim">📍{item.geoFilter}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {hasMatches && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-[8px] font-mono text-dim hover:text-white border border-border rounded px-1 py-0.5"
            >
              {expanded ? 'hide' : 'view'}
            </button>
          )}
          <button onClick={onMute} title={item.muted ? 'Unmute' : 'Mute'} className="text-dim hover:text-white p-0.5">
            {item.muted ? <Bell size={11} /> : <BellOff size={11} />}
          </button>
          <button onClick={onDelete} title="Delete" className="text-dim hover:text-red-400 p-0.5">
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Matched stories */}
      {expanded && matches.length > 0 && (
        <div className="space-y-1 pl-4 border-l border-accent/20">
          {matches.slice(0, 5).map(c => (
            <div key={c.id} className="space-y-0.5">
              <div className="text-[9px] font-mono text-white leading-snug">{c.headline}</div>
              <div className="flex items-center gap-1.5 text-[8px] font-mono text-dim">
                <span className={severityColor(c.severity)}>{c.severity}</span>
                <span>·</span>
                <span>{c.sourceIds.length} src</span>
                <span>·</span>
                <span>{c.category}</span>
              </div>
            </div>
          ))}
          {matches.length > 5 && (
            <div className="text-[8px] font-mono text-dim">+{matches.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────
export function WatchlistPanel() {
  const { state, dispatch } = useApp();
  const { watchlist, clusters } = state;

  // Compute matches for each watchlist item
  const matchMap = useMemo(() => {
    const map = new Map<string, StoryCluster[]>();
    for (const item of watchlist) {
      if (item.muted) { map.set(item.id, []); continue; }
      const matched = clusters.filter(c => matchCluster(item, c).length > 0);
      map.set(item.id, matched);
    }
    return map;
  }, [watchlist, clusters]);

  const totalMatches = useMemo(() =>
    [...matchMap.values()].reduce((sum, m) => sum + m.length, 0),
  [matchMap]);

  function addItem(item: WatchlistItem) {
    dispatch({ type: 'SET_WATCHLIST', payload: [...watchlist, item] });
  }

  function deleteItem(id: string) {
    dispatch({ type: 'SET_WATCHLIST', payload: watchlist.filter(w => w.id !== id) });
  }

  function muteItem(id: string) {
    dispatch({
      type: 'SET_WATCHLIST',
      payload: watchlist.map(w => w.id === id ? { ...w, muted: !w.muted } : w),
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <Bell size={12} className="text-accent" />
        <span className="text-[10px] font-mono text-white font-semibold">Watchlist</span>
        {totalMatches > 0 && (
          <span className="text-[9px] font-mono bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
            {totalMatches} active
          </span>
        )}
        <div className="flex-1" />
        <AddItemForm onAdd={addItem} />
      </div>

      {/* Info banner */}
      <div className="px-3 py-1.5 bg-accent/5 border-b border-accent/20 flex items-start gap-1.5 shrink-0">
        <AlertTriangle size={9} className="text-accent shrink-0 mt-0.5" />
        <span className="text-[9px] font-mono text-dim leading-relaxed">
          Keyword alerts match against live story headlines. Add keywords, set severity/category filters, and view matching stories in real time.
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Bell size={28} className="text-dim/30" />
            <div>
              <div className="text-[11px] font-mono text-dim">No alerts configured</div>
              <div className="text-[9px] font-mono text-dim/60 mt-1">
                Add keywords to get notified when matching stories appear.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Active matches summary */}
            {totalMatches > 0 && (
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-accent mb-1">
                <CheckCircle size={10} />
                {totalMatches} cluster{totalMatches !== 1 ? 's' : ''} matching your alerts right now
              </div>
            )}

            {watchlist.map(item => (
              <WatchlistRow
                key={item.id}
                item={item}
                matches={matchMap.get(item.id) ?? []}
                onMute={() => muteItem(item.id)}
                onDelete={() => deleteItem(item.id)}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer hint */}
      {watchlist.length > 0 && (
        <div className="px-3 py-2 border-t border-border shrink-0">
          <span className="text-[8px] font-mono text-dim">
            Alerts match headline text only. Updates as new stories arrive.
          </span>
        </div>
      )}
    </div>
  );
}
