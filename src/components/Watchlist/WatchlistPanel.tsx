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
import { Bell, BellOff, Plus, Trash2, X, CheckCircle, AlertTriangle, Zap, Info, ChevronDown, ChevronUp } from 'lucide-react';

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

// ─── How-it-works explainer (collapsible) ──────────────────────────────────────
function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-3 py-2 border-b border-border bg-surface/40 shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 text-[10px] font-mono text-dim hover:text-white transition-colors"
      >
        <Info size={10} className="text-accent shrink-0" />
        <span className="flex-1 text-left">How keyword alerts work</span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 text-[9px] font-mono text-dim leading-relaxed">
          <p><span className="text-white">1. Add an alert</span> — give it a name and one or more keywords (e.g. "Gaza ceasefire").</p>
          <p><span className="text-white">2. Set filters</span> — optionally limit matches by severity (critical / high / medium), category (conflict, cyber…), or geography (e.g. "Lebanon").</p>
          <p><span className="text-white">3. Live matching</span> — as new stories arrive, any cluster whose headline contains your keywords lights up here with a <span className="text-accent">⚡</span> icon.</p>
          <p><span className="text-white">4. Browser notifications</span> — if you grant permission, new matches also fire a browser notification so you don't have to stay on this tab.</p>
          <p><span className="text-white">Mute</span> an alert to pause matching without deleting it. <span className="text-white">Delete</span> removes it permanently.</p>
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-white font-semibold">Keyword Alerts</span>
            {totalMatches > 0 && (
              <span className="text-[9px] font-mono bg-accent/20 text-accent px-1.5 py-0.5 rounded-full animate-pulse">
                {totalMatches} live match{totalMatches !== 1 ? 'es' : ''}
              </span>
            )}
          </div>
          <div className="text-[9px] font-mono text-dim/60 mt-0.5">
            Track breaking stories by keyword — get alerted when they appear
          </div>
        </div>
        <AddItemForm onAdd={addItem} />
      </div>

      {/* How-it-works */}
      <HowItWorks />

      {/* Live status bar */}
      <div className="px-3 py-1.5 bg-surface/20 border-b border-border flex items-center gap-2 shrink-0">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${totalMatches > 0 ? 'bg-accent animate-pulse' : 'bg-dim/30'}`} />
        <span className="text-[9px] font-mono text-dim flex-1">
          {watchlist.length === 0
            ? 'No alerts configured — add your first keyword alert above'
            : totalMatches > 0
              ? `${totalMatches} stor${totalMatches !== 1 ? 'ies' : 'y'} matching your alerts right now`
              : `${watchlist.filter(w => !w.muted).length} alert${watchlist.filter(w => !w.muted).length !== 1 ? 's' : ''} active — no matches in current feed`
          }
        </span>
        {totalMatches > 0 && (
          <CheckCircle size={10} className="text-accent shrink-0" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-4 px-4">
            <div className="w-14 h-14 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Bell size={24} className="text-accent/40" />
            </div>
            <div className="space-y-1.5">
              <div className="text-[12px] font-mono text-white font-semibold">No keyword alerts yet</div>
              <div className="text-[10px] font-mono text-dim leading-relaxed max-w-xs">
                Create an alert with keywords like <span className="text-accent">"Gaza ceasefire"</span> or <span className="text-accent">"Iran nuclear"</span>.
                When a matching story lands in the feed, it appears here and triggers a browser notification.
              </div>
            </div>
            <div className="flex flex-col gap-1.5 w-full max-w-xs text-left">
              {[
                { label: 'Gaza ceasefire', tag: 'conflict · critical' },
                { label: 'NATO troop deployment', tag: 'military · high' },
                { label: 'Fed interest rate', tag: 'economic · medium' },
              ].map(ex => (
                <div key={ex.label} className="flex items-center gap-2 p-2 rounded border border-border bg-surface/40">
                  <Zap size={9} className="text-dim/40 shrink-0" />
                  <span className="text-[10px] font-mono text-dim flex-1">{ex.label}</span>
                  <span className="text-[8px] font-mono text-dim/50">{ex.tag}</span>
                </div>
              ))}
            </div>
            <p className="text-[9px] font-mono text-dim/50">Click "Add Alert" above to get started</p>
          </div>
        ) : (
          <>
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

      {/* Footer */}
      {watchlist.length > 0 && (
        <div className="px-3 py-2 border-t border-border shrink-0 flex items-center gap-2">
          <AlertTriangle size={9} className="text-dim/50 shrink-0" />
          <span className="text-[8px] font-mono text-dim/60">
            Matches against live story headlines only. Browser notifications require permission — grant via browser prompt.
          </span>
        </div>
      )}
    </div>
  );
}
