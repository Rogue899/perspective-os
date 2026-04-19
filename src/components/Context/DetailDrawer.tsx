/**
 * DetailDrawer.tsx
 *
 * Right-side drawer showing details for the selected graph node.
 * Sections: header, summary/metadata, confidence, caused-by edges, sources, evidence.
 * All types and helpers imported through the adapter surface.
 */

import type {
  EventNode,
  ClaimNode,
  EventGraphBundle,
} from '../../services/history-graph-adapter';
import {
  getEdgeAsserters,
  isUniversalEdge,
  getConfidenceTier,
  getNodeConfidence,
} from '../../services/history-graph-adapter';

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[9px] font-mono uppercase tracking-widest text-dim mb-1.5 mt-3 first:mt-0">
      {children}
    </h3>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const filled = Math.round(value * 4);
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2, 3].map(i => (
        <div
          key={i}
          className={`w-4 h-1.5 rounded-sm ${i < filled ? 'bg-accent' : 'bg-border'}`}
        />
      ))}
      <span className="ml-1.5 text-[10px] font-mono text-dim">{Math.round(value * 100)}%</span>
    </div>
  );
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
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DetailDrawerProps {
  node: EventNode | ClaimNode;
  bundle: EventGraphBundle;
  onClose: () => void;
}

export function DetailDrawer({ node, bundle, onClose }: DetailDrawerProps) {
  const isEvent = node.nodeType === 'event';
  const confidence = getNodeConfidence(node);
  const tier = getConfidenceTier(node);
  const tierCls = TIER_COLORS[tier] ?? TIER_COLORS.unknown;

  const dateLabel = isEvent
    ? formatDate((node as EventNode).startedAt)
    : typeof node.metadata?.date === 'string'
    ? formatDate(node.metadata.date)
    : '';

  // ── Caused-by groups (events only) ────────────────────────────────────────
  const causedByGroups = isEvent
    ? (() => {
        const incomingEdges = bundle.edges.filter(
          e => e.targetId === node.id &&
               (e.relation === 'caused-by' || e.relation === 'precursor-to' || e.relation === 'retaliated-to'),
        );

        const universalEdges = incomingEdges.filter(isUniversalEdge);
        const partisanEdges  = incomingEdges.filter(e => !isUniversalEdge(e));

        // Map source IDs to labels
        const eventMap = new Map(bundle.events.map(ev => [ev.id, ev.label]));

        const universalSources = universalEdges.map(e => eventMap.get(e.sourceId) ?? e.sourceId);

        // Group partisan by asserter key string
        const partisanGroupMap = new Map<string, { groupLabel: string; sources: string[] }>();
        for (const edge of partisanEdges) {
          const asserters = getEdgeAsserters(edge);
          if (!asserters || asserters.length === 0) continue;
          const groupKey  = asserters.map(l => l.key).join('+');
          const groupLabel = asserters.map(l => l.label).join(', ');
          const existing = partisanGroupMap.get(groupKey);
          const source = eventMap.get(edge.sourceId) ?? edge.sourceId;
          if (existing) {
            existing.sources.push(source);
          } else {
            partisanGroupMap.set(groupKey, { groupLabel, sources: [source] });
          }
        }

        return { universalSources, partisanGroups: [...partisanGroupMap.values()] };
      })()
    : null;

  // ── Source documents ───────────────────────────────────────────────────────
  const sourceDocIds = isEvent
    ? (node as EventNode).sourceDocumentIds
    : (node as ClaimNode).evidenceIds; // for claims, link via evidenceIds if needed

  const relatedSources = bundle.sourceDocuments.filter(sd =>
    isEvent
      ? (node as EventNode).sourceDocumentIds.includes(sd.id)
      : false,
  );

  // ── Evidence (claims only) ─────────────────────────────────────────────────
  const claimEvidence = !isEvent
    ? bundle.evidence.filter(ev =>
        (node as ClaimNode).evidenceIds.includes(ev.id),
      )
    : [];

  return (
    <div
      className="absolute top-0 right-0 h-full w-96 bg-surface border-l border-border flex flex-col z-30 shadow-xl"
      style={{ width: 384 }}
    >
      {/* Header */}
      <div className="flex items-start gap-2 px-4 pt-4 pb-3 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-fg font-medium leading-snug line-clamp-2">{node.label}</p>
          {dateLabel && (
            <span className="text-[10px] font-mono text-dim mt-0.5 block">{dateLabel}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-dim hover:text-fg transition-colors text-xs mt-0.5"
          aria-label="Close detail drawer"
        >
          ✕
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-0">

        {/* Summary */}
        <SectionHeading>Summary</SectionHeading>
        {node.summary ? (
          <p className="text-[11px] text-fg/80 leading-relaxed">{node.summary}</p>
        ) : node.metadata ? (
          <div className="text-[10px] font-mono text-dim space-y-0.5">
            {Object.entries(node.metadata).map(([k, v]) => (
              <div key={k}>
                <span className="text-fg/60">{k}:</span>{' '}
                <span>{String(v)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-dim italic">No summary available.</p>
        )}

        {/* Confidence */}
        <SectionHeading>Confidence</SectionHeading>
        <div className="space-y-1.5">
          <ConfidenceBar value={confidence} />
          <span
            className={`text-[9px] font-mono uppercase tracking-wide border rounded-sm px-1 leading-[14px] ${tierCls}`}
          >
            {tier}
          </span>
          {node.confidence.explanation.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {node.confidence.explanation.map((exp, i) => (
                <li key={i} className="text-[10px] text-dim leading-snug">
                  • {exp}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Caused by (events only) */}
        {isEvent && causedByGroups && (
          (causedByGroups.universalSources.length > 0 || causedByGroups.partisanGroups.length > 0) && (
            <>
              <SectionHeading>Caused by</SectionHeading>

              {causedByGroups.universalSources.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] text-dim italic mb-1">Shared across perspectives.</p>
                  <ul className="space-y-0.5">
                    {causedByGroups.universalSources.map((src, i) => (
                      <li key={i} className="text-[11px] text-fg/80">• {src}</li>
                    ))}
                  </ul>
                </div>
              )}

              {causedByGroups.partisanGroups.map((grp, i) => (
                <div key={i} className="mb-2">
                  <p className="text-[10px] font-mono text-dim italic mb-1">
                    Per {grp.groupLabel} perspective
                  </p>
                  <ul className="space-y-0.5">
                    {grp.sources.map((src, j) => (
                      <li key={j} className="text-[11px] text-fg/80">• {src}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )
        )}

        {/* Sources */}
        {relatedSources.length > 0 && (
          <>
            <SectionHeading>Sources</SectionHeading>
            <ul className="space-y-2">
              {relatedSources.map(sd => (
                <li key={sd.id} className="flex items-start gap-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-fg/90 leading-snug truncate">{sd.label}</p>
                    <p className="text-[10px] text-dim font-mono">
                      {sd.publisher ?? sd.sourceName}
                      {sd.biasLabel && (
                        <span className="ml-1.5 text-dim/60">[{sd.biasLabel}]</span>
                      )}
                    </p>
                  </div>
                  <a
                    href={sd.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-dim hover:text-accent transition-colors text-[11px] mt-0.5"
                    aria-label="Open source"
                  >
                    ↗
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Evidence (claims only) */}
        {!isEvent && claimEvidence.length > 0 && (
          <>
            <SectionHeading>Evidence</SectionHeading>
            <ul className="space-y-2">
              {claimEvidence.map(ev => (
                <li key={ev.id} className="text-[11px] text-fg/80 leading-snug border-l-2 border-border pl-2">
                  {ev.excerpt}
                  {ev.contradiction && (
                    <span className="ml-1.5 text-red-400 text-[9px] font-mono">[contradicts]</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Unused variable reference to satisfy the import (sourceDocIds used conditionally) */}
        {sourceDocIds.length === 0 && relatedSources.length === 0 && claimEvidence.length === 0 && (
          <p className="text-[10px] text-dim italic mt-2">No linked sources or evidence.</p>
        )}

      </div>
    </div>
  );
}
