/**
 * App Context — global state using React Context + useReducer
 * Avoids Redux overhead, mirrors WorldMonitor's localStorage-persisted settings pattern.
 */

import React, { createContext, useContext, useReducer, useEffect } from 'react';
import type { StoryCluster, DataSourceStatus, AppSettings, WatchlistItem, KeywordHit } from '../types';
import { NEWS_SOURCES } from '../config/sources';

interface AppState {
  clusters:           StoryCluster[];
  loading:            boolean;
  lastRefresh:        Date | null;
  settings:           AppSettings;
  sourcesStatus:      DataSourceStatus[];
  selectedCluster:    StoryCluster | null;
  sidebarOpen:        boolean;
  activePanel:        'news' | 'map' | 'analysis' | 'live' | 'finance' | 'watchlist';
  watchlist:          WatchlistItem[];
  globalKeywords:     string[];           // AI-generated, shared across all panels
  keywordHits:        KeywordHit[];       // Live monitor results (capped at 100)
  keywordMonitorOn:   boolean;            // is the background monitor running?
  locationFilter:     { name: string; lat: number; lng: number } | null; // map→feed sync
}

type Action =
  | { type: 'SET_CLUSTERS';           payload: StoryCluster[] }
  | { type: 'SET_LOADING';            payload: boolean }
  | { type: 'SET_LAST_REFRESH';       payload: Date }
  | { type: 'UPDATE_CLUSTER';         payload: StoryCluster }
  | { type: 'SELECT_CLUSTER';         payload: StoryCluster | null }
  | { type: 'UPDATE_SETTINGS';        payload: Partial<AppSettings> }
  | { type: 'SET_SOURCE_STATUS';      payload: DataSourceStatus }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_ACTIVE_PANEL';       payload: AppState['activePanel'] }
  | { type: 'SET_WATCHLIST';          payload: WatchlistItem[] }
  | { type: 'SET_GLOBAL_KEYWORDS';    payload: string[] }
  | { type: 'ADD_KEYWORD_HITS';       payload: KeywordHit[] }
  | { type: 'CLEAR_KEYWORD_HITS' }
  | { type: 'MARK_KEYWORDS_READ' }    // flip isNew → false for all hits
  | { type: 'SET_KEYWORD_MONITOR';    payload: boolean }
  | { type: 'SET_LOCATION_FILTER';    payload: { name: string; lat: number; lng: number } | null };

const DEFAULT_SETTINGS: AppSettings = {
  geminiKey:            '',
  groqKey:              '',
  acledKey:             '',
  nasaFirmsKey:         '',
  openSkyUser:          '',
  openSkyPass:          '',
  upstashUrl:           '',
  upstashToken:         '',
  localMediaSources:    [],
  enabledSources:       NEWS_SOURCES.map(s => s.id),
  enableMap:            true,
  enableConflictLayer:  true,
  enableFlightLayer:    false,
  aiProvider:           'gemini-flash',
};

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem('pos-settings');
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function loadWatchlist(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem('pos-watchlist');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

const initialState: AppState = {
  clusters:           [],
  loading:            false,
  lastRefresh:        null,
  settings:           loadSettings(),
  sourcesStatus:      NEWS_SOURCES.map(s => ({ id: s.id, label: s.name, status: 'loading' })),
  selectedCluster:    null,
  sidebarOpen:        false,
  activePanel:        'map',
  watchlist:          loadWatchlist(),
  globalKeywords:     [],
  keywordHits:        [],
  keywordMonitorOn:   false,
  locationFilter:     null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CLUSTERS':
      return { ...state, clusters: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_LAST_REFRESH':
      return { ...state, lastRefresh: action.payload };
    case 'UPDATE_CLUSTER':
      return {
        ...state,
        clusters: state.clusters.map(c =>
          c.id === action.payload.id ? action.payload : c
        ),
        selectedCluster:
          state.selectedCluster?.id === action.payload.id
            ? action.payload
            : state.selectedCluster,
      };
    case 'SELECT_CLUSTER':
      return { ...state, selectedCluster: action.payload };
    case 'UPDATE_SETTINGS': {
      const next = {
        ...state.settings,
        ...action.payload,
        geminiKey: '',
        groqKey: '',
        acledKey: '',
        nasaFirmsKey: '',
        openSkyUser: '',
        openSkyPass: '',
        upstashUrl: '',
        upstashToken: '',
      };
      try { localStorage.setItem('pos-settings', JSON.stringify(next)); } catch {}
      return { ...state, settings: next };
    }
    case 'SET_SOURCE_STATUS':
      return {
        ...state,
        sourcesStatus: state.sourcesStatus.map(s =>
          s.id === action.payload.id ? action.payload : s
        ),
      };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case 'SET_ACTIVE_PANEL':
      return { ...state, activePanel: action.payload };
    case 'SET_WATCHLIST': {
      try { localStorage.setItem('pos-watchlist', JSON.stringify(action.payload)); } catch {}
      return { ...state, watchlist: action.payload };
    }
    case 'SET_GLOBAL_KEYWORDS':
      return { ...state, globalKeywords: action.payload };
    case 'ADD_KEYWORD_HITS': {
      const MAX = 100;
      const merged = [...action.payload, ...state.keywordHits];
      // Deduplicate by id (same URL might arrive from multiple sources)
      const seen = new Set<string>();
      const deduped = merged.filter(h => { if (seen.has(h.id)) return false; seen.add(h.id); return true; });
      return { ...state, keywordHits: deduped.slice(0, MAX) };
    }
    case 'CLEAR_KEYWORD_HITS':
      return { ...state, keywordHits: [] };
    case 'MARK_KEYWORDS_READ':
      return { ...state, keywordHits: state.keywordHits.map(h => ({ ...h, isNew: false })) };
    case 'SET_KEYWORD_MONITOR':
      return { ...state, keywordMonitorOn: action.payload };
    case 'SET_LOCATION_FILTER':
      return { ...state, locationFilter: action.payload };
    default:
      return state;
  }
}

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
