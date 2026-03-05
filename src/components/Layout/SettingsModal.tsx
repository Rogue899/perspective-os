import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { NEWS_SOURCES } from '../../config/sources';
import { X, Key, Database, Brain } from 'lucide-react';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [settings, setSettings] = useState(state.settings);

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
          {/* API Keys */}
          <Section title="API Keys" icon={<Key size={13} />}>
            <div className="space-y-3">
              <Field
                label="Gemini API Key"
                hint="aistudio.google.com — free, no credit card"
                type="password"
                value={settings.geminiKey}
                onChange={v => update('geminiKey', v)}
                placeholder="AIza..."
              />
              <Field
                label="Groq API Key"
                hint="console.groq.com — 14,400 req/day free fallback"
                type="password"
                value={settings.groqKey}
                onChange={v => update('groqKey', v)}
                placeholder="gsk_..."
              />
              <Field
                label="ACLED Access Token"
                hint="acleddata.com — free academic registration"
                type="password"
                value={settings.acledKey}
                onChange={v => update('acledKey', v)}
                placeholder="token..."
              />
              <Field
                label="Upstash Redis URL"
                hint="upstash.com — 10K commands/day free cache"
                value={settings.upstashUrl}
                onChange={v => update('upstashUrl', v)}
                placeholder="https://xxx.upstash.io"
              />
              <Field
                label="Upstash Redis Token"
                type="password"
                value={settings.upstashToken}
                onChange={v => update('upstashToken', v)}
                placeholder="token..."
              />
            </div>
          </Section>

          {/* AI Provider */}
          <Section title="AI Provider" icon={<Brain size={13} />}>
            <div className="space-y-1.5">
              {(['gemini-flash', 'gemini-flash-lite', 'groq', 'browser-t5'] as const).map(p => (
                <label key={p} className="flex items-center gap-2.5 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded">
                  <input
                    type="radio"
                    name="aiProvider"
                    checked={settings.aiProvider === p}
                    onChange={() => update('aiProvider', p)}
                    className="accent-green-400"
                  />
                  <span className="text-xs font-mono text-white">{p}</span>
                  {p === 'gemini-flash' && <span className="text-[9px] text-dim ml-auto">recommended</span>}
                  {p === 'browser-t5' && <span className="text-[9px] text-dim ml-auto">offline, basic</span>}
                </label>
              ))}
            </div>
          </Section>

          {/* News Sources */}
          <Section title="Active Sources" icon={<Database size={13} />}>
            <div className="space-y-1">
              {NEWS_SOURCES.map(src => (
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
