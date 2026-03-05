/**
 * App Context — global state using React Context + useReducer
 * Avoids Redux overhead, mirrors WorldMonitor's localStorage-persisted settings pattern.
 */

import React, { createContext, useContext, useReducer, useEffect } from 'react';
import type { StoryCluster, DataSourceStatus, AppSettings } from '../types';
import { NEWS_SOURCES } from '../config/sources';

interface AppState {
  clusters:       StoryCluster[];
  loading:        boolean;
  lastRefresh:    Date | null;
  settings:       AppSettings;
  sourcesStatus:  DataSourceStatus[];
  selectedCluster: StoryCluster | null;
  sidebarOpen:    boolean;
  activePanel:    'news' | 'map' | 'analysis';
}

type Action =
  | { type: 'SET_CLUSTERS';        payload: StoryCluster[] }
  | { type: 'SET_LOADING';         payload: boolean }
  | { type: 'SET_LAST_REFRESH';    payload: Date }
  | { type: 'UPDATE_CLUSTER';      payload: StoryCluster }
  | { type: 'SELECT_CLUSTER';      payload: StoryCluster | null }
  | { type: 'UPDATE_SETTINGS';     payload: Partial<AppSettings> }
  | { type: 'SET_SOURCE_STATUS';   payload: DataSourceStatus }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_ACTIVE_PANEL';    payload: AppState['activePanel'] };

const DEFAULT_SETTINGS: AppSettings = {
  geminiKey:            '',
  groqKey:              '',
  acledKey:             '',
  nasaFirmsKey:         '',
  openSkyUser:          '',
  openSkyPass:          '',
  upstashUrl:           '',
  upstashToken:         '',
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

const initialState: AppState = {
  clusters:        [],
  loading:         false,
  lastRefresh:     null,
  settings:        loadSettings(),
  sourcesStatus:   NEWS_SOURCES.map(s => ({ id: s.id, label: s.name, status: 'loading' })),
  selectedCluster: null,
  sidebarOpen:     false,
  activePanel:     'news',
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
      const next = { ...state.settings, ...action.payload };
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
