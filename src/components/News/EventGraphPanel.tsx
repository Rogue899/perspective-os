import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, GitBranch, Link2, Loader2, Network, ScrollText, Sparkles, X } from 'lucide-react';
import { useEventGraphSubject } from '../../hooks/useEventGraph';
import type { ClaimNode, EventGraphBundle, StoryCluster } from '../../types';

export interface GraphFocusTarget {
  type: 'claim' | 'view' | 'source-document';
  id: string;
}

const CLAIM_TYPE_LABELS: Record<ClaimNode['claimType'], string> = {
  'event-existence': 'Event',
  'shared-fact': 'Shared Fact',
  'reported-detail': 'Detail',
  'perspective-frame': 'Perspective',
  'historical-context': 'History',
  'structured-signal': 'Structured',
  quantitative: 'Quant',
};

const EDGE_LABELS: Record<string, string> = {
  about: 'about',
  supports: 'supports',
  contradicts: 'contradicts',
  'background-context': 'background',
  'perspective-on': 'frames',
  'located-in': 'located in',
  'caused-by': 'caused by',
  escalated: 'escalated',
  'retaliated-to': 'retaliated to',
  'precursor-to': 'precursor to',
  'diplomatic-response': 'diplomatic response',
  'territorial-shift': 'territorial shift',
  'disputed-by': 'disputed by',
  corroborates: 'corroborates',
};

function formatDate(date?: string): string {
  if (!date) return 'Unknown';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleString();
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded border border-border bg-white/[0.03] px-3 py-2">
      <div className="text-[9px] font-mono uppercase tracking-wider text-dim">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
      {hint && <div className="mt-1 text-[10px] text-dim">{hint}</div>}
    </div>
  );
}

export function EventGraphPanel({
  cluster,
  clusters,
  onClose,
  initialFocus,
  title,
  subtitle,
}: {
  cluster?: StoryCluster;
  clusters?: StoryCluster[];
  onClose: () => void;
  initialFocus?: GraphFocusTarget | null;
  title?: string;
  subtitle?: string;
}) {
  const subject = useMemo(() => {
    if (clusters && clusters.length > 0) return clusters;
    return cluster ?? null;
  }, [cluster, clusters]);
  const subjectClusters = useMemo(
    () => subject ? (Array.isArray(subject) ? subject : [subject]) : [],
    [subject],
  );
  const primaryCluster = subjectClusters[0] ?? null;
  const [focusTarget, setFocusTarget] = useState<GraphFocusTarget | null>(initialFocus ?? null);
  const {
    searchTerms,
    graph,
    historyItems,
    aiSummary,
    loading,
    synthLoading,
    runHistorySynthesis,
  } = useEventGraphSubject(subject, { loadHistorical: true });
  const eventNode = graph.events[0];
  const heading = title ?? (subjectClusters.length > 1
    ? `${primaryCluster?.geoHint?.name ?? 'Area'} Event Graph`
    : primaryCluster?.headline ?? 'Event Graph');
  const dek = subtitle ?? (subjectClusters.length > 1
    ? 'Merged nearby events with shared claims, evidence, and historical context.'
    : 'Canonical event with attached claims, evidence, and merged historical context.');
  const locationBadge = subjectClusters.length > 1
    ? `${subjectClusters.length} nearby clusters`
    : primaryCluster?.geoHint?.name ?? null;

  const nodeLabels = useMemo(() => {
    const entries = [
      ...graph.events,
      ...graph.claims,
      ...graph.entities,
      ...graph.places,
      ...graph.sourceDocuments,
      ...graph.evidence,
      ...graph.perspectiveViews,
    ].map(node => [node.id, node.label] as const);
    return new Map(entries);
  }, [graph]);

  const evidenceByClaim = useMemo(() => {
    const grouped = new Map<string, typeof graph.evidence>();
    for (const item of graph.evidence) {
      const current = grouped.get(item.claimId) ?? [];
      current.push(item);
      grouped.set(item.claimId, current);
    }
    return grouped;
  }, [graph]);

  const claimsBySourceDocument = useMemo(() => {
    const grouped = new Map<string, typeof graph.claims>();
    for (const claim of graph.claims) {
      for (const evidenceId of claim.evidenceIds) {
        const evidence = graph.evidence.find(item => item.id === evidenceId);
        if (!evidence) continue;
        const current = grouped.get(evidence.sourceDocumentId) ?? [];
        if (!current.some(item => item.id === claim.id)) {
          current.push(claim);
        }
        grouped.set(evidence.sourceDocumentId, current);
      }
    }
    return grouped;
  }, [graph.claims, graph.evidence]);

  const focusedClaim = useMemo(
    () => (focusTarget?.type === 'claim' ? graph.claims.find(claim => claim.id === focusTarget.id) ?? null : null),
    [graph.claims, focusTarget],
  );
  const focusedView = useMemo(
    () => (focusTarget?.type === 'view' ? graph.perspectiveViews.find(view => view.id === focusTarget.id) ?? null : null),
    [graph.perspectiveViews, focusTarget],
  );
  const focusedSourceDocument = useMemo(
    () => (focusTarget?.type === 'source-document'
      ? graph.sourceDocuments.find(document => document.id === focusTarget.id) ?? null
      : null),
    [graph.sourceDocuments, focusTarget],
  );
  const focusedViewClaims = useMemo(
    () => focusedView ? graph.claims.filter(claim => focusedView.claimIds.includes(claim.id)) : [],
    [focusedView, graph.claims],
  );

  useEffect(() => {
    setFocusTarget(initialFocus ?? null);
  }, [initialFocus, primaryCluster?.id, subjectClusters.length]);

  if (!primaryCluster) return null;

  const resolveEdgeFocus = (edge: EventGraphBundle['edges'][number]): GraphFocusTarget | null => {
    const candidates = [
      { type: 'claim' as const, id: edge.targetId },
      { type: 'claim' as const, id: edge.sourceId },
      { type: 'source-document' as const, id: edge.targetId },
      { type: 'source-document' as const, id: edge.sourceId },
    ];

    for (const candidate of candidates) {
      if (candidate.type === 'claim' && graph.claims.some(claim => claim.id === candidate.id)) {
        return candidate;
      }
      if (candidate.type === 'source-document' && graph.sourceDocuments.some(document => document.id === candidate.id)) {
        return candidate;
      }
    }

    return null;
  };

  const topClaims = graph.claims
    .slice()
    .sort((a, b) => {
      if (focusedClaim?.id === a.id) return -1;
      if (focusedClaim?.id === b.id) return 1;
      return b.confidence.overall - a.confidence.overall || b.evidenceIds.length - a.evidenceIds.length;
    });

  const topDocuments = graph.sourceDocuments
    .slice()
    .sort((a, b) => {
      if (focusedSourceDocument?.id === a.id) return -1;
      if (focusedSourceDocument?.id === b.id) return 1;
      return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
    });

  return (
    <div className="absolute inset-0 bg-surface z-50 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Network size={14} className="text-accent shrink-0" />
          <span className="text-sm font-mono font-semibold text-white">Event Graph Inspector</span>
          <span className="text-[9px] font-mono text-accent/70">{graph.claims.length} claims</span>
        </div>
        <button onClick={onClose} className="text-dim hover:text-white transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-border bg-white/[0.02] shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-snug">{heading}</p>
            <p className="mt-1 text-[11px] text-dim leading-snug">
              {dek}
            </p>
          </div>
          <button
            onClick={runHistorySynthesis}
            disabled={synthLoading || loading}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border border-accent/40 text-accent hover:text-accent hover:border-accent hover:bg-accent/10 transition-colors disabled:opacity-50 shrink-0"
          >
            {synthLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            Analyze History
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {locationBadge && (
            <span className="text-[9px] font-mono text-accent bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded">
              {locationBadge}
            </span>
          )}
          {searchTerms.map(term => (
            <span key={term} className="text-[8px] font-mono text-dim border border-border/40 px-1.5 py-0.5 rounded">
              {term}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 size={20} className="text-accent animate-spin" />
            <span className="text-[11px] font-mono text-dim">Gathering historical sources and graph evidence…</span>
          </div>
        )}

        {!loading && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
              <StatCard label="Claims" value={graph.claims.length} hint="Live + historical" />
              <StatCard label="Evidence" value={graph.evidence.length} hint="Cited excerpts" />
              <StatCard label="Sources" value={graph.sourceDocuments.length} hint="Reporting + archive" />
              <StatCard label="Views" value={graph.perspectiveViews.length} hint={graph.perspectiveViews.length ? 'Native comparison ready' : 'Run perspective analysis for more'} />
            </div>

            {eventNode && (
              <section className="rounded border border-border bg-white/[0.02] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[11px] font-mono uppercase tracking-wider text-accent">Canonical Event</h3>
                    <p className="mt-2 text-sm font-semibold text-white">{eventNode.label}</p>
                    <p className="mt-1 text-[12px] text-white/80 leading-relaxed">{eventNode.summary}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] font-mono text-dim uppercase tracking-wider">Confidence</div>
                    <div className="mt-1 text-lg font-semibold text-white">{Math.round(eventNode.confidence.overall * 100)}%</div>
                    <div className="text-[10px] font-mono text-dim">{eventNode.confidence.tier}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {eventNode.tags.map(tag => (
                    <span key={tag} className="text-[9px] font-mono text-dim bg-white/5 px-1.5 py-0.5 rounded border border-border/50">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-dim">
                  <div>Started: {formatDate(eventNode.startedAt)}</div>
                  <div>Updated: {formatDate(eventNode.updatedAt)}</div>
                </div>
              </section>
            )}

            {(focusedClaim || focusedView || focusedSourceDocument) && (
              <section className="rounded border border-accent/30 bg-accent/[0.06] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Network size={13} className="text-accent" />
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-accent">
                    {focusedClaim ? 'Focused Claim' : focusedView ? 'Focused Perspective View' : 'Focused Source Document'}
                  </h3>
                </div>

                {focusedClaim && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-accent/80">
                        {CLAIM_TYPE_LABELS[focusedClaim.claimType]}
                      </span>
                      <span className="text-[10px] font-mono text-white">{Math.round(focusedClaim.confidence.overall * 100)}%</span>
                    </div>
                    <p className="text-[12px] text-white leading-relaxed">{focusedClaim.text}</p>
                    {(evidenceByClaim.get(focusedClaim.id) ?? []).slice(0, 2).map(item => (
                      <div key={item.id} className="rounded border border-border/50 bg-black/10 px-2.5 py-2">
                        <div className="text-[10px] font-mono text-dim">{nodeLabels.get(item.sourceDocumentId) ?? 'Source'}</div>
                        <p className="mt-1 text-[11px] text-white/80 leading-relaxed">{item.excerpt}</p>
                      </div>
                    ))}
                  </div>
                )}

                {focusedView && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-accent/80">{focusedView.axis}</span>
                      <span className="text-[10px] font-mono text-white">{Math.round(focusedView.confidence.overall * 100)}%</span>
                    </div>
                    <p className="text-[12px] font-semibold text-white">{focusedView.label}</p>
                    <p className="text-[10px] text-dim">{focusedView.summary}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {focusedView.lenses.map(lens => (
                        <span key={`${focusedView.id}-${lens.key}`} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border bg-white/5 text-white/75">
                          {lens.label}
                        </span>
                      ))}
                    </div>
                    {focusedViewClaims.length > 0 && (
                      <div className="space-y-1.5">
                        {focusedViewClaims.slice(0, 3).map(claim => (
                          <div key={claim.id} className="rounded border border-border/50 bg-black/10 px-2.5 py-2">
                            <div className="text-[9px] font-mono uppercase tracking-wider text-dim">{CLAIM_TYPE_LABELS[claim.claimType]}</div>
                            <p className="mt-1 text-[11px] text-white/80 leading-relaxed">{claim.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {focusedSourceDocument && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-accent/80">{focusedSourceDocument.sourceName}</span>
                      <span className="text-[10px] font-mono text-white">{Math.round(focusedSourceDocument.confidence.overall * 100)}%</span>
                    </div>
                    <a
                      href={focusedSourceDocument.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-white hover:text-accent transition-colors"
                    >
                      {focusedSourceDocument.label}
                      <ExternalLink size={10} />
                    </a>
                    {focusedSourceDocument.excerpt && (
                      <p className="text-[11px] text-white/80 leading-relaxed">{focusedSourceDocument.excerpt}</p>
                    )}
                    {(claimsBySourceDocument.get(focusedSourceDocument.id) ?? []).length > 0 && (
                      <div className="space-y-1.5">
                        {(claimsBySourceDocument.get(focusedSourceDocument.id) ?? []).slice(0, 3).map(claim => (
                          <button
                            key={claim.id}
                            onClick={() => setFocusTarget({ type: 'claim', id: claim.id })}
                            className="w-full text-left rounded border border-border/50 bg-black/10 px-2.5 py-2 hover:border-accent/40 transition-colors"
                          >
                            <div className="text-[9px] font-mono uppercase tracking-wider text-dim">{CLAIM_TYPE_LABELS[claim.claimType]}</div>
                            <p className="mt-1 text-[11px] text-white/80 leading-relaxed">{claim.text}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {aiSummary && (
              <section className="rounded border border-border bg-white/[0.02] p-4">
                <div className="flex items-center gap-2">
                  <BookOpen size={13} className="text-accent" />
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-accent">Historical Synthesis</h3>
                </div>
                <pre className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-white/85 font-sans">{aiSummary}</pre>
                <p className="mt-2 text-[9px] font-mono text-dim">AI-generated summary with cited graph context.</p>
              </section>
            )}

            <section className="rounded border border-border bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-3">
                <GitBranch size={13} className="text-cyan-300" />
                <h3 className="text-[11px] font-mono uppercase tracking-wider text-cyan-300">Claims</h3>
              </div>
              <div className="space-y-2.5">
                {topClaims.map(claim => {
                  const claimEvidence = evidenceByClaim.get(claim.id) ?? [];
                  return (
                    <div key={claim.id} className="rounded border border-border/70 bg-black/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[9px] font-mono uppercase tracking-wider text-accent/80">
                              {CLAIM_TYPE_LABELS[claim.claimType]}
                            </span>
                            {claim.perspectiveLens && (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border bg-white/5 text-dim">
                                {claim.perspectiveLens.label}
                              </span>
                            )}
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border bg-white/5 text-dim">
                              {claimEvidence.length} evidence
                            </span>
                          </div>
                          <p className="mt-2 text-[12px] text-white leading-relaxed">{claim.text}</p>
                          {claim.confidence.explanation.length > 0 && (
                            <p className="mt-2 text-[10px] text-dim">{claim.confidence.explanation[0]}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] font-mono text-white">{Math.round(claim.confidence.overall * 100)}%</div>
                          <div className="text-[9px] font-mono text-dim">{claim.confidence.tier}</div>
                        </div>
                      </div>
                      {claimEvidence.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {claimEvidence.slice(0, 2).map(item => (
                            <div key={item.id} className="rounded border border-border/50 bg-white/[0.03] px-2.5 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-mono text-dim">{nodeLabels.get(item.sourceDocumentId) ?? 'Source'}</span>
                                {item.generated && (
                                  <span className="text-[9px] font-mono text-amber-300">AI-linked</span>
                                )}
                              </div>
                              <p className="mt-1 text-[11px] text-white/80 leading-relaxed">{item.excerpt}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid xl:grid-cols-2 gap-4">
              <div className="rounded border border-border bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Link2 size={13} className="text-orange-300" />
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-orange-300">Graph Relations</h3>
                </div>
                <div className="space-y-2">
                  {graph.edges.slice(0, 12).map(edge => {
                    const nextFocus = resolveEdgeFocus(edge);
                    return (
                    <button
                      key={edge.id}
                      onClick={() => {
                        if (nextFocus) setFocusTarget(nextFocus);
                      }}
                      className="w-full text-left rounded border border-border/60 bg-black/10 px-2.5 py-2 hover:border-accent/40 hover:bg-accent/[0.04] transition-colors"
                      disabled={!nextFocus}
                    >
                      <p className="text-[11px] text-white leading-snug">
                        <span className="text-accent">{nodeLabels.get(edge.sourceId) ?? edge.sourceId}</span>
                        <span className="mx-1 text-dim">{EDGE_LABELS[edge.relation] ?? edge.relation}</span>
                        <span className="text-white/80">{nodeLabels.get(edge.targetId) ?? edge.targetId}</span>
                      </p>
                    </button>
                  )})}
                </div>
              </div>

              <div className="rounded border border-border bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ScrollText size={13} className="text-green-300" />
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-green-300">Sources And Timeline</h3>
                </div>
                <div className="space-y-2">
                  {topDocuments
                    .slice(0, 10)
                    .map(document => (
                      <div
                        key={document.id}
                        className="block rounded border border-border/60 bg-black/10 px-2.5 py-2 hover:border-accent/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            onClick={() => setFocusTarget({ type: 'source-document', id: document.id })}
                            className="min-w-0 text-left flex-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-mono text-dim">{document.sourceName}</span>
                              <span className="text-[9px] font-mono text-dim">{formatDate(document.publishedAt)}</span>
                            </div>
                            <p className="mt-1 text-[11px] text-white line-clamp-2 hover:text-accent transition-colors">{document.label}</p>
                          </button>
                          <a
                            href={document.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-dim hover:text-accent transition-colors mt-0.5"
                            title="Open source document"
                          >
                            <ExternalLink size={11} />
                          </a>
                        </div>
                        {document.excerpt && (
                          <p className="mt-1 text-[10px] text-white/65 line-clamp-2">{document.excerpt}</p>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </section>

            <section className="rounded border border-border bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen size={13} className="text-purple-300" />
                <h3 className="text-[11px] font-mono uppercase tracking-wider text-purple-300">Historical Inputs</h3>
              </div>
              {historyItems.length === 0 ? (
                <p className="text-[11px] text-dim">No external historical context was found for this cluster yet.</p>
              ) : (
                <div className="space-y-2">
                  {historyItems.map((item, index) => (
                    <a
                      key={`${item.provider}-${item.url}-${index}`}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded border border-border/60 bg-black/10 px-2.5 py-2 hover:border-accent/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-dim">{item.provider}</span>
                        <ExternalLink size={10} className="text-dim" />
                      </div>
                      <p className="mt-1 text-[11px] text-white">{item.title}</p>
                      <p className="mt-1 text-[10px] text-white/70 line-clamp-3">{item.snippet}</p>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}