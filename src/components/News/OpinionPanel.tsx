/**
 * Opinion Panel — AI Perspective Simulation
 * Generates 4 editorial opinions from different political/ideological lenses.
 * CLEARLY LABELED as AI simulation — not real editorial output.
 *
 * Lenses: Conservative · Progressive · State Media · OSINT/Evidence-Based
 */

import { useState, useCallback } from 'react';
import {
  generateOpinionForLens,
  OPINION_LENS_LABELS,
  OPINION_LENS_COLORS,
  type OpinionLens,
} from '../../services/ai';
import type { StoryCluster } from '../../types';
import { Sparkles, X, AlertTriangle, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

const LENSES: OpinionLens[] = ['conservative', 'progressive', 'state-media', 'osint'];

interface OpinionState {
  text: string | null;
  loading: boolean;
  error: string | null;
}

interface OpinionPanelProps {
  cluster: StoryCluster;
  onClose: () => void;
}

export function OpinionPanel({ cluster, onClose }: OpinionPanelProps) {
  const [opinions, setOpinions] = useState<Record<OpinionLens, OpinionState>>({
    conservative:  { text: null, loading: false, error: null },
    progressive:   { text: null, loading: false, error: null },
    'state-media': { text: null, loading: false, error: null },
    osint:         { text: null, loading: false, error: null },
  });
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState<OpinionLens | null>(null);
  const [copiedLens, setCopiedLens] = useState<OpinionLens | null>(null);

  const generateAll = useCallback(async () => {
    if (generating) return;
    setGenerating(true);

    // Reset all states
    setOpinions({
      conservative:  { text: null, loading: true,  error: null },
      progressive:   { text: null, loading: true,  error: null },
      'state-media': { text: null, loading: true,  error: null },
      osint:         { text: null, loading: true,  error: null },
    });

    // Generate sequentially to avoid rate-limit bursts (Flash: 10 RPM)
    for (const lens of LENSES) {
      try {
        const cacheKey = `opinion:${cluster.id}:${lens}`;
        const text = await generateOpinionForLens(cluster.headline, lens, cacheKey);
        setOpinions(prev => ({ ...prev, [lens]: { text, loading: false, error: null } }));
      } catch (err: any) {
        setOpinions(prev => ({
          ...prev,
          [lens]: { text: null, loading: false, error: err?.message ?? 'Generation failed' },
        }));
      }
    }

    setGenerating(false);
  }, [cluster, generating]);

  const copyOpinion = useCallback((lens: OpinionLens, text: string) => {
    navigator.clipboard.writeText(`[${OPINION_LENS_LABELS[lens]}]\n\n${text}`).then(() => {
      setCopiedLens(lens);
      setTimeout(() => setCopiedLens(null), 2000);
    });
  }, []);

  const anyGenerated = LENSES.some(l => opinions[l].text !== null);

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[520px] bg-surface border-l border-border z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <span className="text-sm font-mono font-semibold text-white">Opinion Generator</span>
          <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
            AI Simulation
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-dim hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Disclaimer */}
      <div className="px-4 py-2.5 border-b border-border bg-amber-500/5 shrink-0">
        <div className="flex items-start gap-2">
          <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[10px] text-amber-300/80 leading-relaxed">
            These are <strong>AI-simulated editorial perspectives</strong>, not real opinions.
            They are generated to illustrate how different ideological lenses frame the same event.
            Do not treat as factual reporting.
          </p>
        </div>
      </div>

      {/* Story headline */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <p className="text-xs text-dim font-mono uppercase tracking-wider mb-1">About this story</p>
        <p className="text-sm text-white font-medium leading-snug line-clamp-3">
          {cluster.headline}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Generate button */}
        {!anyGenerated && !generating && (
          <div className="px-4 py-8 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Sparkles size={24} className="text-accent" />
            </div>
            <div>
              <p className="text-sm text-white font-medium mb-2">Generate 4 Political Perspectives</p>
              <p className="text-xs text-dim leading-relaxed max-w-sm">
                AI will write 120-word editorial opinions from 4 ideological lenses:
                Conservative, Progressive, State Media, and OSINT/Evidence-based.
                Each is authentic to that worldview.
              </p>
            </div>
            <button
              onClick={generateAll}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-black text-sm font-mono font-semibold rounded hover:bg-accent/90 transition-colors"
            >
              <Sparkles size={14} />
              Generate All 4 Lenses
            </button>
            <p className="text-[10px] text-dim font-mono">
              Uses Gemini Flash · ~15s total · results cached 2h
            </p>
          </div>
        )}

        {/* Opinion cards */}
        {(anyGenerated || generating) && (
          <div className="divide-y divide-border">
            {LENSES.map(lens => {
              const op = opinions[lens];
              const isExpanded = expanded === lens;

              return (
                <div key={lens} className="px-4 py-4">
                  {/* Lens header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono font-semibold ${OPINION_LENS_COLORS[lens]}`}>
                      {lens === 'conservative' && '🏛'}
                      {lens === 'progressive' && '✊'}
                      {lens === 'state-media' && '📺'}
                      {lens === 'osint' && '🔍'}
                      {OPINION_LENS_LABELS[lens]}
                    </div>
                    {op.text && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => copyOpinion(lens, op.text!)}
                          className="text-dim hover:text-white p-1 transition-colors"
                          title="Copy opinion"
                        >
                          {copiedLens === lens
                            ? <Check size={11} className="text-green-400" />
                            : <Copy size={11} />}
                        </button>
                        <button
                          onClick={() => setExpanded(isExpanded ? null : lens)}
                          className="text-dim hover:text-white p-1 transition-colors"
                        >
                          {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  {op.loading && (
                    <div className="space-y-2 animate-pulse">
                      <div className="h-2.5 bg-white/10 rounded w-full" />
                      <div className="h-2.5 bg-white/10 rounded w-5/6" />
                      <div className="h-2.5 bg-white/10 rounded w-4/5" />
                      <div className="h-2.5 bg-white/10 rounded w-full" />
                      <div className="h-2.5 bg-white/5 rounded w-3/4" />
                    </div>
                  )}

                  {op.error && (
                    <div className="text-xs text-red-400 p-2 bg-red-500/10 border border-red-500/20 rounded">
                      {op.error}
                    </div>
                  )}

                  {op.text && (
                    <p className={`text-xs text-white/85 leading-relaxed ${!isExpanded ? 'line-clamp-4' : ''}`}>
                      {op.text}
                    </p>
                  )}

                  {op.text && !isExpanded && op.text.length > 200 && (
                    <button
                      onClick={() => setExpanded(lens)}
                      className="text-[10px] text-accent font-mono hover:underline mt-1"
                    >
                      Read more
                    </button>
                  )}
                </div>
              );
            })}

            {/* Regenerate button */}
            {anyGenerated && !generating && (
              <div className="px-4 py-4 flex justify-center">
                <button
                  onClick={generateAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono text-dim border border-border rounded hover:text-white hover:border-accent transition-colors"
                >
                  <Sparkles size={10} />
                  Regenerate
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
