import type { StoryCluster } from '../../types';
import { getSourceById, getBiasTextClass, getBiasBgClass } from '../../config/sources';
import { useApp } from '../../context/AppContext';
import { AlertTriangle, Eye, Clock, ShieldAlert } from 'lucide-react';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400 border-l-red-500',
  high:     'text-orange-400 border-l-orange-500',
  medium:   'text-yellow-400 border-l-yellow-600',
  low:      'text-dim border-l-border',
  info:     'text-dim border-l-border',
};

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function StoryCard({ cluster }: { cluster: StoryCluster }) {
  const { dispatch } = useApp();
  const sevColor = SEVERITY_COLORS[cluster.severity] ?? SEVERITY_COLORS.low;
  const hasMultipleViews = cluster.sourceIds.length >= 2;
  const perspectiveHigh = cluster.perspectiveScore >= 0.4;
  const hasUnverifiedLane = cluster.sourceIds.some(sid => {
    const src = getSourceById(sid);
    return src?.sourceType === 'social' || src?.sourceType === 'rumor';
  });

  return (
    <article
      className={`border-l-2 pl-3 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors rounded-r group ${sevColor}`}
      onClick={() => dispatch({ type: 'SELECT_CLUSTER', payload: cluster })}
    >
      {/* Severity + category tags */}
      <div className="flex items-center gap-2 mb-1.5">
        {cluster.severity === 'critical' && (
          <span className="flex items-center gap-1 text-[9px] font-mono text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20 uppercase tracking-wider">
            <AlertTriangle size={9} /> Critical
          </span>
        )}
        <span className="text-[9px] font-mono text-dim bg-white/5 px-1.5 py-0.5 rounded uppercase tracking-wider">
          {cluster.category}
        </span>
        {perspectiveHigh && (
          <span className="flex items-center gap-1 text-[9px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20 uppercase tracking-wider">
            <Eye size={9} /> High Bias
          </span>
        )}
        {hasUnverifiedLane && (
          <span className="flex items-center gap-1 text-[9px] font-mono text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/25 uppercase tracking-wider">
            <ShieldAlert size={9} /> Unverified lane
          </span>
        )}
      </div>

      {/* Headline */}
      <h3 className="text-sm font-medium text-white/90 leading-snug mb-2 group-hover:text-white transition-colors line-clamp-2">
        {cluster.headline}
      </h3>

      {/* Source chips */}
      <div className="flex items-center flex-wrap gap-1 mb-1.5">
        {cluster.sourceIds.slice(0, 6).map(sid => {
          const src = getSourceById(sid);
          if (!src) return null;
          return (
            <span
              key={sid}
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${getBiasBgClass(src.biasColor)} ${getBiasTextClass(src.biasColor)}`}
            >
              {src.name}
            </span>
          );
        })}
        {cluster.sourceIds.length > 6 && (
          <span className="text-[9px] font-mono text-dim">+{cluster.sourceIds.length - 6}</span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] text-dim font-mono">
          <Clock size={10} />
          {timeAgo(cluster.updatedAt)}
        </span>
        <span className="text-[10px] text-dim font-mono">
          {cluster.sourceIds.length} {cluster.sourceIds.length === 1 ? 'source' : 'sources'}
          {hasMultipleViews && (
            <span className="ml-1 text-accent">→ compare</span>
          )}
        </span>
      </div>
    </article>
  );
}
