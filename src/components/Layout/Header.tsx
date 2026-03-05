import { useApp } from '../../context/AppContext';
import { RefreshCw, Settings, Globe, Newspaper, Brain } from 'lucide-react';

interface HeaderProps {
  onRefresh: () => void;
  onSettings: () => void;
}

export function Header({ onRefresh, onSettings }: HeaderProps) {
  const { state, dispatch } = useApp();
  const { loading, lastRefresh, activePanel } = state;

  const panels: Array<{ id: typeof activePanel; label: string; icon: React.ReactNode }> = [
    { id: 'news',     label: 'Feed',     icon: <Newspaper size={14} /> },
    { id: 'map',      label: 'Map',      icon: <Globe size={14} /> },
    { id: 'analysis', label: 'Analyze',  icon: <Brain size={14} /> },
  ];

  return (
    <header className="h-11 bg-surface border-b border-border flex items-center justify-between px-4 shrink-0 z-50">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <span className="text-accent font-mono font-semibold text-sm tracking-wider">
          PERSPECTIVE<span className="text-white/40">OS</span>
        </span>
        <span className="hidden sm:block text-[10px] text-dim font-mono border border-border px-1.5 py-0.5 rounded">
          v0.1
        </span>
      </div>

      {/* Panel switcher */}
      <nav className="flex gap-1">
        {panels.map(p => (
          <button
            key={p.id}
            onClick={() => dispatch({ type: 'SET_ACTIVE_PANEL', payload: p.id })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors ${
              activePanel === p.id
                ? 'bg-accent/10 text-accent border border-accent/30'
                : 'text-dim hover:text-white hover:bg-white/5'
            }`}
          >
            {p.icon}
            <span className="hidden sm:inline">{p.label}</span>
          </button>
        ))}
      </nav>

      {/* Right controls */}
      <div className="flex items-center gap-3">
        {lastRefresh && (
          <span className="hidden md:block text-[10px] text-dim font-mono">
            {lastRefresh.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-dim hover:text-white transition-colors disabled:opacity-40"
          title="Refresh feeds"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin text-accent' : ''} />
        </button>
        <button
          onClick={onSettings}
          className="text-dim hover:text-white transition-colors"
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
}
