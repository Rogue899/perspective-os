import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getAllSources } from '../../config/sources';
import { fetchWithSettings } from '../../services/integration-settings';
import { X, Database, Link, Plus, Sparkles, Trash2 } from 'lucide-react';

const INTEGRATION_ROWS = [
  { name: 'Gemini', mode: 'API key', note: 'Used for classification, perspectives, keywords, history synthesis, and embeddings.' },
  { name: 'Groq', mode: 'API key', note: 'Fallback AI provider when Gemini is unavailable.' },
  { name: 'MarketStack', mode: 'API key', note: 'Required for finance EOD, FX, and ticker search.' },
  { name: 'NewsData.io', mode: 'API key', note: 'Optional article enrichment and fallback coverage.' },
  { name: 'ACLED', mode: 'Account credentials', note: 'Email + password for conflict event access when enabled.' },
  { name: 'Upstash Redis', mode: 'URL + token', note: 'Used for AI caching, embeddings, tone baselines, and history cache/rate limits.' },
  { name: 'GDELT', mode: 'Open', note: 'No key required. Used for topic feeds and map events.' },
  { name: 'NASA EONET', mode: 'Open', note: 'No key required. Used for natural event layers.' },
  { name: 'OpenStreetMap/Nominatim', mode: 'Open', note: 'No key required. Used for reverse geocoding and tiles.' },
  { name: 'Wikipedia / Internet Archive / Yahoo / CoinGecko / Polymarket / FRED', mode: 'Open', note: 'Public data sources used across history and finance panels.' },
  { name: 'X / Reddit / Meta / TikTok', mode: 'Linked account optional', note: 'Current app mostly uses public feeds. Settings can track linked-account readiness.' },
] as const;

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [settings, setSettings] = useState(state.settings);
  const [detectLoading, setDetectLoading] = useState(false);
  const [localForm, setLocalForm] = useState({
    name: '',
    url: '',
    country: '',
    city: '',
    sourceType: 'independent' as const,
  });
  const allSources = getAllSources();

  const toggleAuth = (provider: 'x' | 'reddit' | 'meta' | 'tiktok') => {
    update('socialAuth', {
      ...settings.socialAuth,
      [provider]: !settings.socialAuth[provider],
      updatedAt: new Date().toISOString(),
    });
    if (!settings.socialAuth[provider]) {
      const authUrls: Record<typeof provider, string> = {
        x: 'https://developer.x.com/en/docs/authentication/oauth-2-0',
        reddit: 'https://www.reddit.com/prefs/apps',
        meta: 'https://developers.facebook.com/docs/facebook-login/',
        tiktok: 'https://developers.tiktok.com/doc/login-kit-web',
      };
      window.open(authUrls[provider], '_blank', 'noopener,noreferrer');
    }
  };

  const toggleScope = (scope: string) => {
    const has = settings.socialAuth.scopes.includes(scope);
    update('socialAuth', {
      ...settings.socialAuth,
      scopes: has
        ? settings.socialAuth.scopes.filter(s => s !== scope)
        : [...settings.socialAuth.scopes, scope],
      updatedAt: new Date().toISOString(),
    });
  };

  const rotateTokens = () => {
    update('socialAuth', {
      ...settings.socialAuth,
      tokenVersion: settings.socialAuth.tokenVersion + 1,
      updatedAt: new Date().toISOString(),
    });
  };

  const update = <K extends keyof typeof settings>(key: K, value: typeof settings[K]) => {
    setSettings(s => ({ ...s, [key]: value }));
  };

  const save = () => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: settings });
    onClose();
  };

  const toggleSource = (id: string) => {
    const curr = settings.enabledSources;
    const next = curr.includes(id) ? curr.filter(s => s !== id) : [...curr, id];
    update('enabledSources', next);
  };

  const addLocalMedia = () => {
    if (!localForm.name.trim() || !localForm.url.trim()) return;
    const idBase = localForm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const id = `local-${idBase || 'source'}-${Date.now().toString().slice(-5)}`;
    const nextSource = {
      id,
      name: localForm.name.trim(),
      url: localForm.url.trim(),
      country: localForm.country.trim() || 'Local',
      city: localForm.city.trim() || '',
      sourceType: localForm.sourceType,
      tier: 'tier2' as const,
    };
    update('localMediaSources', [...settings.localMediaSources, nextSource]);
    update('enabledSources', [...settings.enabledSources, id]);
    setLocalForm({ name: '', url: '', country: '', city: '', sourceType: 'independent' });
  };

  const removeLocalMedia = (id: string) => {
    update('localMediaSources', settings.localMediaSources.filter(s => s.id !== id));
    update('enabledSources', settings.enabledSources.filter(sid => sid !== id));
  };

  const detectLocalSources = async () => {
    if (!localForm.country && !localForm.city) return;
    setDetectLoading(true);
    try {
      const res = await fetchWithSettings('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: 'flash-lite',
          prompt: `Return a JSON array of 3 well-known local or regional news RSS feed sources for "${localForm.city ? localForm.city + ', ' : ''}${localForm.country}". Each object must have: { "name": string, "url": string (valid RSS URL), "country": string, "city": string }. Only include sources with known working RSS feeds. Return only the raw JSON array with no other text.`,
          cacheKey: `detect-local:${localForm.city}:${localForm.country}`,
          ttl: 86400,
        }),
      });
      const data = await res.json();
      const raw: string = data.result ?? '';
      const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      const suggestions: Array<{ name: string; url: string; country: string; city: string }> = JSON.parse(cleaned);
      const newSources: typeof settings.localMediaSources = [];
      const newIds: string[] = [];
      for (const s of suggestions) {
        if (!s.name || !s.url) continue;
        const id = `local-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-5)}`;
        newSources.push({ id, name: s.name, url: s.url, country: s.country || localForm.country, city: s.city || localForm.city, sourceType: 'mainstream' as const, tier: 'tier2' as const });
        newIds.push(id);
      }
      update('localMediaSources', [...settings.localMediaSources, ...newSources]);
      update('enabledSources', [...settings.enabledSources, ...newIds]);
    } catch (e) {
      console.error('[Settings] AI detect failed:', e);
    } finally {
      setDetectLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface border border-border rounded-lg shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-mono font-semibold text-sm text-white">Settings</span>
          <button onClick={onClose} className="text-dim hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Section title="Integrations" icon={<Database size={13} />}>
            <div className="space-y-2">
              {INTEGRATION_ROWS.map(row => (
                <div key={row.name} className="rounded border border-border bg-white/[0.03] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-mono text-white">{row.name}</span>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-accent">{row.mode}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-dim leading-relaxed">{row.note}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Security" icon={<Link size={13} />}>
            <div className="text-[11px] text-dim leading-relaxed">
              Integration credentials entered here are stored locally in this browser profile and sent only to this app's `/api/*` routes.
              Server env vars still work as defaults, but user-provided settings now override them for your session.
            </div>
          </Section>

          <Section title="AI Providers" icon={<Sparkles size={13} />}>
            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-mono text-dim mb-1">Primary AI Provider</label>
                <select
                  value={settings.aiProvider}
                  onChange={e => update('aiProvider', e.target.value as typeof settings.aiProvider)}
                  className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-accent"
                >
                  <option value="gemini-flash">Gemini Flash</option>
                  <option value="gemini-flash-lite">Gemini Flash-Lite</option>
                  <option value="groq">Groq</option>
                  <option value="browser-t5">Browser T5 fallback</option>
                </select>
              </div>
              <Field
                label="Gemini API Key"
                hint="Used for AI analysis, keyword generation, history synthesis, and embeddings."
                type="password"
                value={settings.geminiKey}
                onChange={v => update('geminiKey', v)}
                placeholder="AIza..."
              />
              <Field
                label="Groq API Key"
                hint="Fallback LLM provider when Gemini is rate-limited or unavailable."
                type="password"
                value={settings.groqKey}
                onChange={v => update('groqKey', v)}
                placeholder="gsk_..."
              />
            </div>
          </Section>

          <Section title="API Credentials" icon={<Link size={13} />}>
            <div className="space-y-2.5">
              <Field
                label="MarketStack API Key"
                hint="Required for finance EOD, FX, and ticker search calls."
                type="password"
                value={settings.marketstackKey}
                onChange={v => update('marketstackKey', v)}
                placeholder="marketstack key"
              />
              <Field
                label="NewsData.io API Key"
                hint="Optional news enrichment and fallback article discovery."
                type="password"
                value={settings.newsdataKey}
                onChange={v => update('newsdataKey', v)}
                placeholder="newsdata key"
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field
                  label="ACLED Email"
                  hint="Used for ACLED OAuth token exchange."
                  type="email"
                  value={settings.acledEmail}
                  onChange={v => update('acledEmail', v)}
                  placeholder="you@example.com"
                />
                <Field
                  label="ACLED Password"
                  hint="Stored locally and forwarded only to this app's API route."
                  type="password"
                  value={settings.acledPassword}
                  onChange={v => update('acledPassword', v)}
                  placeholder="ACLED password"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field
                  label="Upstash Redis URL"
                  hint="Enables caching, tone baselines, and history persistence."
                  value={settings.upstashUrl}
                  onChange={v => update('upstashUrl', v)}
                  placeholder="https://...upstash.io"
                />
                <Field
                  label="Upstash Redis Token"
                  hint="Required with the Upstash URL."
                  type="password"
                  value={settings.upstashToken}
                  onChange={v => update('upstashToken', v)}
                  placeholder="upstash token"
                />
              </div>
            </div>
          </Section>

          <Section title="Social OAuth" icon={<Link size={13} />}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['x', 'X'],
                  ['reddit', 'Reddit'],
                  ['meta', 'Meta'],
                  ['tiktok', 'TikTok'],
                ] as const).map(([provider, label]) => {
                  const connected = settings.socialAuth[provider];
                  return (
                    <button
                      key={provider}
                      onClick={() => toggleAuth(provider)}
                      className={`px-3 py-2 text-xs font-mono rounded border transition-colors text-left ${
                        connected
                          ? 'border-green-500/40 bg-green-500/10 text-green-300'
                          : 'border-border text-dim hover:text-white hover:border-accent/40'
                      }`}
                    >
                      <div>{label}</div>
                      <div className="text-[10px] opacity-80">{connected ? 'Connected' : 'Connect'}</div>
                    </button>
                  );
                })}
              </div>

              <div>
                <div className="text-[11px] font-mono text-dim mb-1">Consent scopes</div>
                <div className="flex gap-1.5 flex-wrap">
                  {['read:public', 'read:private', 'read:messages', 'profile:email'].map(scope => (
                    <button
                      key={scope}
                      onClick={() => toggleScope(scope)}
                      className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                        settings.socialAuth.scopes.includes(scope)
                          ? 'border-accent/50 text-accent bg-accent/10'
                          : 'border-border text-dim hover:text-white'
                      }`}
                    >
                      {scope}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={rotateTokens}
                  className="px-3 py-1.5 text-xs font-mono rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                >
                  Rotate tokens
                </button>
                <button
                  onClick={() => update('socialAuth', { x: false, reddit: false, meta: false, tiktok: false, scopes: ['read:public'], tokenVersion: settings.socialAuth.tokenVersion + 1, updatedAt: new Date().toISOString() })}
                  className="px-3 py-1.5 text-xs font-mono rounded border border-red-500/40 text-red-300 hover:bg-red-500/10"
                >
                  Disconnect all
                </button>
                <span className="text-[10px] text-dim font-mono">
                  token v{settings.socialAuth.tokenVersion}
                  {settings.socialAuth.updatedAt ? ` · ${new Date(settings.socialAuth.updatedAt).toLocaleString()}` : ''}
                </span>
              </div>
            </div>
          </Section>

          {/* Local media sources */}
          <Section title="Local Media Sources" icon={<Plus size={13} />}>
            <div className="space-y-2.5">
              <Field
                label="Display Name"
                value={localForm.name}
                onChange={v => setLocalForm(s => ({ ...s, name: v }))}
                placeholder="MTV Lebanon / City News"
              />
              <Field
                label="RSS/API Link"
                hint="Paste RSS URL or API feed URL"
                value={localForm.url}
                onChange={v => setLocalForm(s => ({ ...s, url: v }))}
                placeholder="https://example.com/rss.xml"
              />
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Country"
                  value={localForm.country}
                  onChange={v => setLocalForm(s => ({ ...s, country: v }))}
                  placeholder="Lebanon"
                />
                <Field
                  label="City"
                  value={localForm.city}
                  onChange={v => setLocalForm(s => ({ ...s, city: v }))}
                  placeholder="Beirut"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-dim mb-1">Source Type</label>
                <select
                  value={localForm.sourceType}
                  onChange={e => setLocalForm(s => ({ ...s, sourceType: e.target.value as typeof localForm.sourceType }))}
                  className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-accent"
                >
                  <option value="mainstream">Mainstream</option>
                  <option value="independent">Independent</option>
                  <option value="social">Social</option>
                  <option value="rumor">Rumor / Unverified</option>
                  <option value="state">State</option>
                </select>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={addLocalMedia}
                  className="px-3 py-1.5 text-xs font-mono rounded bg-accent text-black hover:bg-accent/90"
                >
                  Add Local Source
                </button>
                <button
                  onClick={detectLocalSources}
                  disabled={detectLoading || (!localForm.country && !localForm.city)}
                  className="px-3 py-1.5 text-xs font-mono rounded border border-accent/40 text-accent/80 hover:text-accent hover:border-accent disabled:opacity-40 transition-colors"
                >
                  {detectLoading ? 'Detecting…' : '🌐 AI Detect'}
                </button>
              </div>

              {settings.localMediaSources.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-border">
                  {settings.localMediaSources.map(src => (
                    <div key={src.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <div className="text-white font-mono truncate">{src.name}</div>
                        <div className="text-dim truncate">{src.city ? `${src.city}, ` : ''}{src.country}</div>
                      </div>
                      <button
                        onClick={() => removeLocalMedia(src.id)}
                        className="text-red-400 hover:text-red-300"
                        title="Remove source"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {/* News Sources */}
          <Section title="Active Sources" icon={<Database size={13} />}>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => update('enabledSources', allSources.map(s => s.id))}
                className="px-2 py-1 text-[10px] font-mono rounded bg-white/10 text-white hover:bg-white/20 transition-colors"
              >All</button>
              <button
                onClick={() => update('enabledSources', [])}
                className="px-2 py-1 text-[10px] font-mono rounded bg-white/10 text-white hover:bg-white/20 transition-colors"
              >None</button>
            </div>
            <div className="space-y-1">
              {allSources.map(src => (
                <label key={src.id} className="flex items-center gap-2.5 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded">
                  <input
                    type="checkbox"
                    checked={settings.enabledSources.includes(src.id)}
                    onChange={() => toggleSource(src.id)}
                    className="accent-green-400"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono text-white">{src.name}</span>
                    <span className="text-[9px] text-dim ml-2">{src.country} · {src.bias}</span>
                  </div>
                </label>
              ))}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-dim hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-1.5 text-xs font-mono font-semibold bg-accent text-black rounded hover:bg-accent/90 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-border">
      <h3 className="flex items-center gap-2 text-[11px] font-mono font-semibold text-dim uppercase tracking-wider mb-3">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, hint, type = 'text', value, onChange, placeholder }: {
  label: string; hint?: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-mono text-dim mb-1">{label}</label>
      {hint && <p className="text-[10px] text-dim/60 mb-1">{hint}</p>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder-dim/40 focus:outline-none focus:border-accent transition-colors"
      />
    </div>
  );
}
