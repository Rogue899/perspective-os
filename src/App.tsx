import { useState } from 'react';
import { AppProvider } from './context/AppContext';
import { Header } from './components/Layout/Header';
import { FeedPanel } from './components/News/FeedPanel';
import { PerspectivePanel } from './components/News/PerspectivePanel';
import { MapView } from './components/Map/MapView';
import { LivePanel } from './components/Live/LivePanel';
import { FinancePanel } from './components/Finance/FinancePanel';
import { WatchlistPanel } from './components/Watchlist/WatchlistPanel';
import { SettingsModal } from './components/Layout/SettingsModal';
import { useApp } from './context/AppContext';

function Dashboard() {
  const { state } = useApp();
  const { activePanel, selectedCluster } = state;
  const [showSettings, setShowSettings] = useState(false);

  const handleRefresh = () => window.dispatchEvent(new Event('pos:refresh'));

  // Full-screen panels (replace the whole main area)
  if (activePanel === 'live') {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
        <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} />
        <main className="flex-1 overflow-hidden">
          <LivePanel />
        </main>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </div>
    );
  }

  if (activePanel === 'finance') {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
        <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} />
        <main className="flex-1 overflow-hidden">
          <FinancePanel />
        </main>
        <StatusBar />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </div>
    );
  }

  if (activePanel === 'watchlist') {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
        <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} />
        <main className="flex-1 overflow-hidden">
          <WatchlistPanel />
        </main>
        <StatusBar />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </div>
    );
  }

  // Standard layout: feed (left) + map (center) + perspective (right)
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg text-white font-mono">
      <Header onRefresh={handleRefresh} onSettings={() => setShowSettings(true)} />

      <main className="flex-1 flex overflow-hidden relative">
        {/* Left column — feed (hidden on mobile when map is active) */}
        <div className={`
          ${activePanel === 'map' ? 'hidden xl:flex' : 'flex'}
          flex-col w-full xl:w-[380px] border-r border-border shrink-0 overflow-hidden
        `}>
          <FeedPanel onRefresh={handleRefresh} />
        </div>

        {/* Center — map */}
        <div className={`
          flex-1 overflow-hidden
          ${activePanel === 'news' ? 'hidden xl:block' : 'block'}
          ${activePanel === 'analysis' && !selectedCluster ? 'hidden xl:block' : ''}
        `}>
          <MapView />
        </div>

        {/* Right sidebar — perspective panel when story selected */}
        {selectedCluster && <PerspectivePanel />}
      </main>

      <StatusBar />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
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
