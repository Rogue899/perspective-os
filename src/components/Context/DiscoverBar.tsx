/**
 * DiscoverBar.tsx
 *
 * Free-text discover input + recent-query chips + curated-topic chips.
 * Persists recent queries to localStorage key `pos-history-recent` (max 5).
 * Styling matches AnalysisSearchBar in App.tsx.
 */

import { useState, useEffect } from 'react';

const LS_KEY = 'pos-history-recent';
const MAX_RECENT = 5;

const CURATED_CHIPS = ['Lebanon Israel', 'Ukraine war', 'Iran West'];

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch { /* storage quota */ }
}

function pushRecent(query: string, current: string[]): string[] {
  const deduped = [query, ...current.filter(q => q !== query)];
  return deduped.slice(0, MAX_RECENT);
}

interface DiscoverBarProps {
  onSubmit: (query: string) => void;
}

export function DiscoverBar({ onSubmit }: DiscoverBarProps) {
  const [inputValue, setInputValue] = useState('');
  const [recent, setRecent] = useState<string[]>(loadRecent);

  // Sync recent from localStorage on mount (in case another tab wrote)
  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const handleSubmit = (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 3) return;
    const next = pushRecent(trimmed, recent);
    setRecent(next);
    saveRecent(next);
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit(inputValue);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
      {/* Text input */}
      <div className="relative shrink-0 w-[260px]">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Discover a topic…"
          className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-xs text-fg placeholder:text-dim/50 focus:outline-none focus:border-accent/60"
        />
      </div>

      {/* Search button */}
      <button
        onClick={() => handleSubmit(inputValue)}
        disabled={inputValue.trim().length < 3}
        className="shrink-0 px-3 py-1.5 rounded-md bg-accent/10 border border-accent/30 text-accent text-[11px] font-mono hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Go
      </button>

      {/* Divider */}
      {(recent.length > 0 || CURATED_CHIPS.length > 0) && (
        <span className="text-dim text-[10px] shrink-0">|</span>
      )}

      {/* Recent chips */}
      {recent.map(q => (
        <button
          key={q}
          onClick={() => handleSubmit(q)}
          className="shrink-0 px-2 py-1 rounded bg-surface border border-border text-[10px] text-dim hover:text-fg hover:border-accent/40 transition-colors font-mono whitespace-nowrap"
          title={`Recent: ${q}`}
        >
          {q}
        </button>
      ))}

      {/* Curated chips */}
      {CURATED_CHIPS.map(chip => (
        <button
          key={chip}
          onClick={() => handleSubmit(chip)}
          className="shrink-0 px-2 py-1 rounded bg-accent/5 border border-accent/20 text-[10px] text-accent/70 hover:text-accent hover:border-accent/50 transition-colors font-mono whitespace-nowrap"
          title={`Topic: ${chip}`}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
