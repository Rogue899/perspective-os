import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { StoryCluster } from '../../types';
import { buildClusterGraph, getAncestorChain } from '../../services/history-graph-adapter';
import { useApp } from '../../context/AppContext';

export function HistoricalAncestorStrip({ storyCluster }: { storyCluster: StoryCluster }) {
  const { dispatch } = useApp();
  const [open, setOpen] = useState(false);

  const { bundle, primaryEventId, ancestors } = useMemo(() => {
    try {
      const b = buildClusterGraph(storyCluster);
      const primaryId = b.events[0]?.id ?? '';
      const chain = primaryId ? getAncestorChain(b, primaryId, 5) : [];
      return { bundle: b, primaryEventId: primaryId, ancestors: chain };
    } catch {
      return { bundle: null, primaryEventId: '', ancestors: [] };
    }
  }, [storyCluster]);

  const handleOpenTree = () => {
    try {
      dispatch({ type: 'SET_HISTORY_QUERY', payload: storyCluster.headline });
      dispatch({ type: 'SET_HISTORY_SELECTED_NODE', payload: primaryEventId });
      dispatch({ type: 'SET_ACTIVE_PANEL', payload: 'context' });
    } catch {
      // silent swallow — still allow navigation attempt
    }
  };

  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    } catch {
      return '—';
    }
  };

  return (
    <div className="border-t border-border px-3 py-2">
      {/* Accordion header */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between hover:bg-white/[0.02] transition-colors py-0.5"
      >
        <span className="text-[10px] font-mono uppercase tracking-wider text-dim flex items-center gap-1.5">
          <ChevronDown
            size={11}
            className={`text-dim/50 transition-transform duration-150 shrink-0 ${open ? '' : '-rotate-90'}`}
          />
          Historical Context
        </span>
        <button
          onClick={e => { e.stopPropagation(); handleOpenTree(); }}
          className="text-[11px] text-accent hover:underline font-mono"
        >
          Open full tree →
        </button>
      </button>

      {/* Accordion body */}
      {open && (
        <div className="mt-1.5">
          {ancestors.length === 0 ? (
            <p className="text-[10px] font-mono text-dim/60 italic py-1">
              No historical ancestors yet — click &apos;Open full tree&apos; to generate context.
            </p>
          ) : (
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {ancestors.map((ancestor, i) => (
                <div key={ancestor.id} className="flex items-center gap-1 shrink-0">
                  {i > 0 && <ChevronRight size={10} className="text-dim/40 shrink-0" />}
                  <div className="bg-surface border border-border rounded px-2 py-1 w-[140px]">
                    <div className="text-[10px] font-mono text-dim/70 truncate">
                      {formatDate(ancestor.startedAt)}
                    </div>
                    <div className="text-[10px] font-mono text-white/80 leading-tight line-clamp-2">
                      {ancestor.label}
                    </div>
                  </div>
                </div>
              ))}

              {/* Separator before current cluster card */}
              {ancestors.length > 0 && (
                <ChevronRight size={10} className="text-dim/40 shrink-0" />
              )}

              {/* Current cluster card */}
              {bundle && (
                <div className="bg-accent/10 border border-accent/30 rounded px-2 py-1 w-[140px] shrink-0">
                  <div className="text-[10px] font-mono text-accent/70 truncate">
                    {formatDate(storyCluster.publishedAt.toISOString())}
                  </div>
                  <div className="text-[10px] font-mono text-white/90 leading-tight line-clamp-2">
                    {storyCluster.headline}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
