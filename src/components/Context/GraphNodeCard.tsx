/**
 * GraphNodeCard.tsx
 *
 * Custom react-flow node component for EventNode and ClaimNode.
 * Imported types and helpers come through the adapter surface only.
 */

import { Handle, Position } from 'reactflow';
import type {
  EventNode,
  ClaimNode,
  EventGraphBundle,
} from '../../services/history-graph-adapter';
import {
  getNodeConfidence,
  getConfidenceTier,
  computeContestedness,
} from '../../services/history-graph-adapter';

export interface GraphNodeCardData {
  node: EventNode | ClaimNode;
  bundle: EventGraphBundle;
  activePerspectiveKeys?: string[];
}

const TIER_COLORS: Record<string, string> = {
  high:    'text-green-400  border-green-500/40',
  medium:  'text-accent     border-accent/40',
  low:     'text-yellow-400 border-yellow-500/40',
  mixed:   'text-orange-400 border-orange-500/40',
  unknown: 'text-dim        border-border',
};

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export function GraphNodeCard({ data }: { data: GraphNodeCardData }) {
  const { node, bundle, activePerspectiveKeys } = data;

  const isEvent = node.nodeType === 'event';
  const confidence = getNodeConfidence(node);
  const tier = getConfidenceTier(node);
  const tierCls = TIER_COLORS[tier] ?? TIER_COLORS.unknown;

  // Filled segments out of 4
  const filledSegments = Math.round(confidence * 4);

  const contested =
    isEvent &&
    computeContestedness(bundle, node.id, activePerspectiveKeys) > 0.5;

  const lowConfidence = confidence < 0.55;

  const dateLabel = isEvent
    ? formatDate((node as EventNode).startedAt)
    : formatDate(
        typeof node.metadata?.date === 'string' ? node.metadata.date : undefined,
      );

  const bgCls = isEvent ? 'bg-surface' : 'bg-bg';
  const width = isEvent ? 'w-[220px] min-h-[96px]' : 'w-[200px] min-h-[80px]';

  return (
    <div
      className={`${bgCls} ${width} rounded border border-border px-3 py-2 relative flex flex-col gap-1.5 select-none`}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'rgb(var(--color-border))' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'rgb(var(--color-border))' }} />

      {/* Top row: date + icons */}
      <div className="flex items-center justify-between gap-1 min-h-[14px]">
        <span className="text-[9px] font-mono text-dim leading-none truncate">{dateLabel}</span>
        <span className="flex items-center gap-0.5 shrink-0">
          {contested && (
            <span className="text-[10px] leading-none" title="Contested event">⚖</span>
          )}
          {lowConfidence && (
            <span className="text-[10px] leading-none text-yellow-400" title="Low confidence">⚠</span>
          )}
        </span>
      </div>

      {/* Label */}
      <p className="text-[11px] text-fg leading-snug line-clamp-2">{node.label}</p>

      {/* Confidence bar + tier badge */}
      <div className="flex items-center gap-1.5 mt-0.5">
        {/* 4-segment bar */}
        <div className="flex items-center gap-0.5">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`w-3 h-1 rounded-sm ${i < filledSegments ? 'bg-accent' : 'bg-border'}`}
            />
          ))}
        </div>

        {/* Tier badge */}
        <span
          className={`text-[8px] font-mono uppercase tracking-wide border rounded-sm px-1 leading-[14px] ${tierCls}`}
        >
          {tier}
        </span>
      </div>
    </div>
  );
}
