import { useState, useEffect, useRef } from 'react';
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
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
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
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
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
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
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

  // Analysis panel: feed list + perspective engine side by side, NO map
  if (activePanel === 'analysis') {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
        <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} />
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
            <div className="flex-1 overflow-hidden relative hidden xl:flex flex-col items-center justify-center text-center text-dim font-mono p-8 gap-3">
              <div className="text-accent text-4xl">🧠</div>
              <div className="text-white font-semibold text-sm">Perspective Engine</div>
              <div className="text-[11px] text-dim max-w-xs leading-relaxed">Select a story from the feed to cross-analyze how different sources frame the same event.</div>
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
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
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

  // Map + sidebar: feed sidebar left, map fills rest
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
      <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} onNotifications={() => setShowNotifications(p => !p)} />

      <main className="flex-1 flex overflow-hidden relative">
        {/* Left column — feed panel hidden entirely in map mode for full map focus */}
        {activePanel !== 'map' && (
          <div className="flex flex-col w-full xl:w-[380px] border-r border-border shrink-0 overflow-hidden">
            <FeedPanel onRefresh={handleRefresh} />
          </div>
        )}

        {/* Center — map */}
        <div className="flex-1 overflow-hidden">
          <MapView />
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
      <span className={`text-[10px] font-mono ${loading ? 'text-accent animate-pulse' : 'text-dim'}`}>
        {loading ? '● UPDATING' : '● LIVE'}
      </span>
      <span className="text-[10px] font-mono text-dim">{clusters.length} stories</span>
      {highPriority > 0 && (
        <span className="text-[10px] font-mono text-red-400">{highPriority} high priority</span>
      )}
      {multiSource > 0 && (
        <span className="text-[10px] font-mono text-accent">{multiSource} multi-source</span>
      )}
      <span className="ml-auto text-[10px] font-mono text-dim">
        {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
      </span>
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
