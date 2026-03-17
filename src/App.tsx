import { useState, useEffect, useRef, useCallback } from 'react';
import { AppProvider } from './context/AppContext';
import { Header } from './components/Layout/Header';
import { FeedPanel } from './components/News/FeedPanel';
import { PerspectivePanel } from './components/News/PerspectivePanel';
import { MapView } from './components/Map/MapView';
import { LivePanel } from './components/Live/LivePanel';
import { FinancePanel } from './components/Finance/FinancePanel';
import { WatchlistPanel } from './components/Watchlist/WatchlistPanel';
import { SettingsModal } from './components/Layout/SettingsModal';
import { NotificationDrawer } from './components/Layout/NotificationDrawer';
import { useApp } from './context/AppContext';
import type { KeywordHit } from './types';
import {
  startKeywordMonitor,
  updateKeywords,
  stopKeywordMonitor,
  resetSeenUrls,
} from './services/keyword-monitor';

function Dashboard() {
  const { state, dispatch } = useApp();
  const { activePanel, selectedCluster, globalKeywords } = state;
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFeedInMap, setShowFeedInMap] = useState(false);
  const monitorActiveRef = useRef(false);

  const handleRefresh = () => window.dispatchEvent(new Event('pos:refresh'));

  // ── Global keyword monitor — starts whenever keywords are (re)generated ──────
  useEffect(() => {
    if (globalKeywords.length === 0) return;

    const onHit = (hits: KeywordHit[]) => {
      dispatch({ type: 'ADD_KEYWORD_HITS', payload: hits });

      // Browser notifications for NEW hits (only if user granted permission)
      if (Notification.permission === 'granted') {
        const newHits = hits.filter(h => h.isNew).slice(0, 2);
        for (const hit of newHits) {
          try {
            new Notification(`🔍 ${hit.keyword}`, {
              body:    hit.title,
              tag:     hit.id,
              icon:    '/favicon.ico',
              silent:  false,
            });
          } catch { /* notifications blocked */ }
        }
      }
    };

    if (!monitorActiveRef.current) {
      // First start — delay 30s so RSS feed + clustering can finish first
      const startDelay = setTimeout(() => {
        startKeywordMonitor(globalKeywords, onHit);
        monitorActiveRef.current = true;
        dispatch({ type: 'SET_KEYWORD_MONITOR', payload: true });
      }, 30_000);
      // Request notification permission silently (no prompt if already decided)
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      return () => {
        clearTimeout(startDelay);
        stopKeywordMonitor();
        monitorActiveRef.current = false;
        dispatch({ type: 'SET_KEYWORD_MONITOR', payload: false });
      };
    } else {
      // Hot-swap keywords without restarting interval
      updateKeywords(globalKeywords);
      resetSeenUrls(); // fresh dedup when topics change
    }

    return () => {
      stopKeywordMonitor();
      monitorActiveRef.current = false;
      dispatch({ type: 'SET_KEYWORD_MONITOR', payload: false });
    };
  // intentionally only restart monitor when keyword LIST changes (not on every re-render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalKeywords.join('|')]);

  // Full-screen panels (replace the whole main area)
  if (activePanel === 'live') {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-fg">
        <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} onNotifications={() => setShowNotifications(p => !p)} />
        <main className="flex-1 overflow-hidden">
          <LivePanel />
        </main>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showNotifications && <NotificationDrawer onClose={() => setShowNotifications(false)} />}
      </div>
    );
  }

  if (activePanel === 'finance') {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-fg">
        <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} onNotifications={() => setShowNotifications(p => !p)} />
        <main className="flex-1 overflow-hidden">
          <FinancePanel />
        </main>
        <StatusBar />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showNotifications && <NotificationDrawer onClose={() => setShowNotifications(false)} />}
      </div>
    );
  }

  if (activePanel === 'watchlist') {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-fg">
        <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} onNotifications={() => setShowNotifications(p => !p)} />
        <main className="flex-1 overflow-hidden">
          <WatchlistPanel />
        </main>
        <StatusBar />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showNotifications && <NotificationDrawer onClose={() => setShowNotifications(false)} />}
      </div>
    );
  }

  // Analysis panel: LLM search bar + feed list + perspective engine side by side, NO map
  if (activePanel === 'analysis') {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-fg">
        <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} />
        <AnalysisSearchBar />
        <main className="flex-1 flex overflow-hidden">
          <div className={`flex flex-col border-r border-border shrink-0 overflow-hidden ${
            selectedCluster ? 'w-full xl:w-[420px]' : 'w-full'
          }`}>
            <FeedPanel onRefresh={handleRefresh} />
          </div>
          {selectedCluster && (
            <div className="flex-1 overflow-hidden relative">
              <PerspectivePanel />
            </div>
          )}
          {!selectedCluster && (
            <div className="flex-1 overflow-hidden relative hidden xl:flex flex-col items-center justify-center text-center text-dim p-8 gap-3">
              <div className="text-accent text-4xl">🧠</div>
              <div className="text-fg font-semibold text-sm">Perspective Engine</div>
              <div className="text-xs text-dim max-w-xs leading-relaxed">Search a topic above or select a story from the feed to cross-analyze how different sources frame the same event.</div>
            </div>
          )}
        </main>
        <StatusBar />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showNotifications && <NotificationDrawer onClose={() => setShowNotifications(false)} />}
      </div>
    );
  }

  // Feed tab — full-width story grid, NO map (tasks A2/R)
  if (activePanel === 'news') {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-fg">
        <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} onNotifications={() => setShowNotifications(p => !p)} />
        <main className="flex-1 flex overflow-hidden relative">
          <div className="flex-1 flex flex-col overflow-hidden">
            <FeedPanel onRefresh={handleRefresh} defaultGrid />
          </div>
          {selectedCluster && <PerspectivePanel />}
        </main>
        <StatusBar />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showNotifications && <NotificationDrawer onClose={() => setShowNotifications(false)} />}
      </div>
    );
  }

  // Map mode: map gets full width; feed panel hidden by default with toggle button
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg text-fg">
      <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} onNotifications={() => setShowNotifications(p => !p)} />

      <main className="flex-1 flex overflow-hidden relative">
        {/* Left column — hidden in map mode unless toggled */}
        {showFeedInMap && (
          <div className="flex flex-col w-[360px] border-r border-border shrink-0 overflow-hidden z-10">
            <FeedPanel onRefresh={handleRefresh} hideGridControls />
          </div>
        )}

        {/* Center — map fills all remaining space */}
        <div className="flex-1 overflow-hidden relative">
          <MapView />
          {/* Feed toggle button — bottom-left of map */}
          <button
            onClick={() => setShowFeedInMap(p => !p)}
            className="absolute bottom-4 left-4 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-bg/90 border border-border text-xs text-dim hover:text-white hover:border-accent transition-colors backdrop-blur-sm"
            title={showFeedInMap ? 'Hide news feed' : 'Show news feed'}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="1" width="4" height="10" rx="0.5" />
              <rect x="7" y="1" width="4" height="4" rx="0.5" />
              <rect x="7" y="7" width="4" height="4" rx="0.5" />
            </svg>
            {showFeedInMap ? 'Hide Feed' : 'Feed'}
          </button>
        </div>

        {/* Right sidebar — perspective panel when story selected */}
        {selectedCluster && <PerspectivePanel />}
      </main>

      <StatusBar />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showNotifications && <NotificationDrawer onClose={() => setShowNotifications(false)} />}
    </div>
  );
}

function StatusBar() {
  const { state } = useApp();
  const { clusters, loading, lastRefresh } = state;
  const highPriority = clusters.filter(c => c.severity === 'critical' || c.severity === 'high').length;
  const multiSource  = clusters.filter(c => c.sourceIds.length >= 3).length;

  return (
    <div className="h-6 bg-surface border-t border-border flex items-center px-4 gap-4 shrink-0">
      <span className={`text-[10px] font-mono tabular-nums ${loading ? 'text-accent animate-pulse' : 'text-dim'}`}>
        {loading ? '● UPDATING' : '● LIVE'}
      </span>
      <span className="text-[10px] font-mono tabular-nums text-dim">{clusters.length} stories</span>
      {highPriority > 0 && (
        <span className="text-[10px] font-mono text-red-400">{highPriority} high priority</span>
      )}
      {multiSource > 0 && (
        <span className="text-[10px] font-mono text-accent">{multiSource} multi-source</span>
      )}
      <span className="ml-auto text-[10px] font-mono tabular-nums text-dim">
        {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
      </span>
    </div>
  );
}

/** LLM-powered discovery search bar — shown at top of Analysis tab */
function AnalysisSearchBar() {
  const { dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastQuery, setLastQuery] = useState('');

  const handleSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed === lastQuery) return;
    setLoading(true);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `You are a news intelligence analyst. Given this topic query: "${trimmed}"
Extract 6-10 specific search keywords that will find the most relevant news articles.
Include: key actors, locations, organizations, events, concepts.
Return ONLY a JSON array of lowercase keyword strings. No explanations.
Example: ["ukraine", "zelensky", "nato", "ceasefire", "offensive"]`,
          tier: 'flash-lite',
          maxTokens: 150,
          cacheKey: `analysis_search:${trimmed.toLowerCase().slice(0, 80)}`,
          cacheTtl: 300,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = (data.text || '').replace(/```json\s*/i, '').replace(/```\s*/i, '').replace(/```$/i, '').trim();
        try {
          const keywords: string[] = JSON.parse(raw);
          if (Array.isArray(keywords) && keywords.length > 0) {
            dispatch({ type: 'SET_GLOBAL_KEYWORDS', payload: keywords.map(k => String(k).toLowerCase()) });
            setLastQuery(trimmed);
          }
        } catch {
          // Fallback: split the raw text into words
          const fallback = trimmed.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 8);
          dispatch({ type: 'SET_GLOBAL_KEYWORDS', payload: fallback });
          setLastQuery(trimmed);
        }
      }
    } catch (e) {
      // Network error — still set raw keywords as fallback
      const fallback = trimmed.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 8);
      dispatch({ type: 'SET_GLOBAL_KEYWORDS', payload: fallback });
      setLastQuery(trimmed);
    } finally {
      setLoading(false);
    }
  }, [dispatch, lastQuery]);

  return (
    <div className="border-b border-border bg-surface px-4 py-2 flex items-center gap-2 shrink-0">
      <div className="relative flex-1 max-w-2xl">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(query); }}
          placeholder="Discover a topic — e.g. 'Lebanon ceasefire', 'Fed rate decision', 'AI regulation EU'..."
          className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-xs text-fg placeholder:text-dim/50 focus:outline-none focus:border-accent/60 pr-8"
        />
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-accent text-[10px] animate-pulse">●</span>
        )}
      </div>
      <button
        onClick={() => handleSearch(query)}
        disabled={loading || !query.trim()}
        className="px-3 py-1.5 rounded-md bg-accent/10 border border-accent/30 text-accent text-[11px] font-mono hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      >
        {loading ? 'Searching…' : 'Discover'}
      </button>
      {lastQuery && (
        <button
          onClick={() => { setLastQuery(''); setQuery(''); dispatch({ type: 'SET_GLOBAL_KEYWORDS', payload: [] }); }}
          className="text-[10px] text-dim hover:text-fg transition-colors shrink-0"
          title="Clear search"
        >
          ✕ clear
        </button>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Dashboard />
    </AppProvider>
  );
}
