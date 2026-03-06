import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getAllSources } from '../../config/sources';
import { X, Database, Link, Plus, Trash2 } from 'lucide-react';

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
      const res = await fetch('/api/ai', {
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
          {/* Security note */}
          <Section title="Security" icon={<Link size={13} />}>
            <div className="text-[11px] text-dim leading-relaxed">
              API keys are not editable or persisted in the browser UI anymore.
              Configure keys only in local server env (`.env.local`) for dev, or in Vercel project env for deploy.
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
