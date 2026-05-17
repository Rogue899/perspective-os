import type { AppSettings } from '../types';

const SETTINGS_STORAGE_KEY = 'pos-settings';

function getStoredSettings(): Partial<AppSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<AppSettings>;
  } catch {
    return {};
  }
}

function setHeader(headers: Headers, name: string, value?: string) {
  const trimmed = value?.trim();
  if (trimmed) headers.set(name, trimmed);
}

export function withIntegrationHeaders(headersInit?: HeadersInit): Headers {
  const headers = new Headers(headersInit);
  const settings = getStoredSettings();

  setHeader(headers, 'x-pos-gemini-key', settings.geminiKey);
  setHeader(headers, 'x-pos-groq-key', settings.groqKey);
  setHeader(headers, 'x-pos-marketstack-key', settings.marketstackKey);
  setHeader(headers, 'x-pos-newsdata-key', settings.newsdataKey);
  setHeader(headers, 'x-pos-acled-email', settings.acledEmail);
  setHeader(headers, 'x-pos-acled-password', settings.acledPassword);
  setHeader(headers, 'x-pos-upstash-url', settings.upstashUrl);
  setHeader(headers, 'x-pos-upstash-token', settings.upstashToken);

  return headers;
}

export function fetchWithSettings(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    headers: withIntegrationHeaders(init.headers),
  });
}