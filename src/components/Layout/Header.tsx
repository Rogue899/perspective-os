import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { RefreshCw, Settings, Globe, Newspaper, Brain, Tv, TrendingUp, Bell, Sun, Moon } from 'lucide-react';

interface HeaderProps {
  onRefresh: () => void;
  onSettings: () => void;
  onNotifications?: () => void;
}

type PanelId = 'news' | 'map' | 'analysis' | 'live' | 'finance' | 'watchlist';

export function Header({ onRefresh, onSettings, onNotifications }: HeaderProps) {
  const { state, dispatch } = useApp();
  const { loading, lastRefresh, activePanel, watchlist, clusters, keywordHits } = state;
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('pos-theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('pos-theme', theme);
  }, [theme]);

  const newNotifCount = (keywordHits?.filter((h: { isNew: boolean }) => h.isNew).length ?? 0) +
    clusters.filter(c => c.severity === 'critical').length;

  // Count unread watchlist matches
  const watchlistHits = watchlist.filter(w => !w.muted).reduce((acc, w) => {
    const matched = clusters.filter(c =>
      !w.categories?.length || w.categories.includes(c.category)
    ).filter(c =>
      w.keywords.some(kw => c.headline.toLowerCase().includes(kw.toLowerCase()))
    ).length;
    return acc + matched;
  }, 0);

  const panels: Array<{ id: PanelId; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'news',      label: 'Feed',      icon: <Newspaper size={13} /> },
    { id: 'map',       label: 'Map',       icon: <Globe size={13} /> },
    { id: 'analysis',  label: 'Analyze',   icon: <Brain size={13} /> },
    { id: 'live',      label: 'Live',      icon: <Tv size={13} /> },
    { id: 'finance',   label: 'Finance',   icon: <TrendingUp size={13} /> },
    { id: 'watchlist', label: 'Watch',     icon: <Bell size={13} />, badge: watchlistHits || undefined },
  ];

  return (
    <header className="h-11 bg-surface border-b border-border flex items-center justify-between px-3 shrink-0 z-50 gap-2">
      {/* Logo — keeps mono for the brand wordmark */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-accent font-mono font-semibold text-sm tracking-wider">
          PERSPECTIVE<span className="text-fg/40">OS</span>
        </span>
        <span className="hidden lg:block text-[9px] text-dim font-mono border border-border px-1 py-0.5 rounded">
          v0.2
        </span>
      </div>

      {/* Panel tabs */}
      <nav className="flex gap-0.5 overflow-x-auto">
        {panels.map(p => (
          <button
            key={p.id}
            onClick={() => dispatch({ type: 'SET_ACTIVE_PANEL', payload: p.id })}
            className={`relative flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] font-medium whitespace-nowrap transition-colors ${
              activePanel === p.id
                ? 'bg-accent/10 text-accent border border-accent/30'
                : 'text-dim hover:text-fg hover:bg-white/5'
            }`}
          >
            {p.icon}
            <span className="hidden sm:inline">{p.label}</span>
            {p.badge && p.badge > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5">
                {p.badge > 9 ? '9+' : p.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Right controls */}
      <div className="flex items-center gap-2 shrink-0">
        {lastRefresh && (
          <span className="hidden lg:block text-[9px] text-dim font-mono">
            {lastRefresh.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 text-dim hover:text-fg transition-colors disabled:opacity-40"
          title="Refresh feeds"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-accent' : ''} />
        </button>
        {onNotifications && (
          <button
            onClick={onNotifications}
            className="relative text-dim hover:text-fg transition-colors"
            title="Notifications"
          >
            <Bell size={13} />
            {newNotifCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[12px] h-[12px] bg-red-500 text-white text-[7px] font-bold rounded-full flex items-center justify-center px-0.5">
                {newNotifCount > 9 ? '9+' : newNotifCount}
              </span>
            )}
          </button>
        )}
        <button
          onClick={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))}
          className="text-dim hover:text-fg transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <button
          onClick={onSettings}
          className="text-dim hover:text-fg transition-colors"
          title="Settings"
        >
          <Settings size={13} />
        </button>
      </div>
    </header>
  );
}
