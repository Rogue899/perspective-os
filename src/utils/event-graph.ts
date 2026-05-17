import { getSourceById } from '../config/sources';
import type {
  BiasColor,
  BiasLabel,
  EventCategory,
  GdeltEvent,
  HistoricalContextItem,
  EventGraphBundle,
  EventNode,
  ClaimNode,
  EntityNode,
  PlaceNode,
  SourceDocumentNode,
  EvidenceNode,
  GraphEdge,
  PerspectiveViewNode,
  ConfidenceDimensions,
  ConfidenceProfile,
  ConfidenceSignals,
  PerspectiveLens,
  ScoredArticle,
  SourceAccessClass,
  SourceEvidenceClass,
  StoryCluster,
  SourcePerspective,
} from '../types';

const EMPTY_BUNDLE: EventGraphBundle = {
  events: [],
  claims: [],
  entities: [],
  places: [],
  sourceDocuments: [],
  evidence: [],
  edges: [],
  perspectiveViews: [],
};

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function toIso(value?: Date | string | null): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function confidenceTier(score: number): ConfidenceProfile['tier'] {
  if (score >= 0.8) return 'high';
  if (score >= 0.6) return 'medium';
  if (score > 0) return 'low';
  return 'unknown';
}

function createConfidenceProfile(
  dimensions: ConfidenceDimensions,
  explanation: string[],
  signals: ConfidenceSignals = {},
): ConfidenceProfile {
  const values = Object.values(dimensions).filter((value): value is number => typeof value === 'number');
  const overall = values.length > 0
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : 0;

  return {
    overall,
    tier: confidenceTier(overall),
    dimensions,
    explanation,
    signals,
  };
}

function classifySource(sourceId: string, url: string): {
  accessClass: SourceAccessClass;
  sourceClass: SourceEvidenceClass;
  biasLabel?: BiasLabel;
  biasColor?: BiasColor;
} {
  const source = getSourceById(sourceId);

  if (sourceId === 'gdelt') {
    return { accessClass: 'open', sourceClass: 'open-dataset' };
  }

  if (sourceId === 'wikipedia' || url.includes('wikipedia.org')) {
    return { accessClass: 'open', sourceClass: 'encyclopedia' };
  }

  if (sourceId === 'wikidata' || url.includes('wikidata.org')) {
    return { accessClass: 'open', sourceClass: 'open-dataset' };
  }

  if (sourceId === 'internet-archive' || url.includes('web.archive.org')) {
    return { accessClass: 'open', sourceClass: 'archive' };
  }

  if (source?.sourceType === 'state') {
    return {
      accessClass: 'open',
      sourceClass: 'state-media',
      biasLabel: source.bias,
      biasColor: source.biasColor,
    };
  }

  if (source?.sourceType === 'social' || source?.sourceType === 'rumor') {
    return {
      accessClass: 'open',
      sourceClass: 'social',
      biasLabel: source.bias,
      biasColor: source.biasColor,
    };
  }

  if (source?.sourceType === 'intelligence') {
    return {
      accessClass: 'open',
      sourceClass: 'osint',
      biasLabel: source.bias,
      biasColor: source.biasColor,
    };
  }

  if (source?.sourceType === 'independent') {
    return {
      accessClass: 'open',
      sourceClass: 'independent',
      biasLabel: source.bias,
      biasColor: source.biasColor,
    };
  }

  return {
    accessClass: 'open',
    sourceClass: source ? 'mainstream' : 'open-dataset',
    biasLabel: source?.bias,
    biasColor: source?.biasColor,
  };
}

function inferEntityType(name: string): EntityNode['entityType'] {
  const lower = name.toLowerCase();
  if (/(government|ministry|agency|state|administration|office)/.test(lower)) return 'organization';
  if (/(news|times|post|reuters|bbc|media|monitor)/.test(lower)) return 'media';
  if (/(hezbollah|hamas|militia|brigade|forces)/.test(lower)) return 'militia';
  if (/(treaty|doctrine|policy|agreement|sanctions)/.test(lower)) return 'doctrine';
  if (name.includes(' ') && /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(name)) return 'person';
  return 'state';
}

function createEntityNode(name: string): EntityNode {
  const canonicalKey = normalizeKey(name);
  return {
    id: `entity_${hashString(canonicalKey)}`,
    nodeType: 'entity',
    label: name,
    canonicalKey,
    entityType: inferEntityType(name),
    confidence: createConfidenceProfile(
      { provenance: 0.72 },
      ['Entity extracted from current reporting and graph normalization.'],
      { citationCount: 1 },
    ),
  };
}

function createPlaceNode(name: string, geo?: EventNode['geo']): PlaceNode {
  const canonicalKey = normalizeKey(name);
  return {
    id: `place_${hashString(canonicalKey)}`,
    nodeType: 'place',
    label: name,
    canonicalKey,
    placeType: geo?.name === name ? 'region' : 'unknown',
    geo,
    confidence: createConfidenceProfile(
      { provenance: 0.8, existence: 0.9 },
      ['Place is grounded by geo hints or explicit source references.'],
      { citationCount: 1 },
    ),
  };
}

function articleDocumentId(article: ScoredArticle): string {
  return `doc_${hashString(`${article.sourceId}|${article.url}`)}`;
}

function createSourceDocumentNode(article: ScoredArticle): SourceDocumentNode {
  const sourceMeta = classifySource(article.sourceId, article.url);
  return {
    id: articleDocumentId(article),
    nodeType: 'source-document',
    label: article.title,
    summary: article.description,
    sourceId: article.sourceId,
    sourceName: article.sourceName,
    sourceClass: sourceMeta.sourceClass,
    accessClass: sourceMeta.accessClass,
    publisher: article.sourceName,
    url: article.url,
    publishedAt: toIso(article.publishedAt),
    excerpt: article.description.slice(0, 280),
    biasLabel: sourceMeta.biasLabel,
    biasColor: sourceMeta.biasColor,
    confidence: createConfidenceProfile(
      { provenance: 0.78 },
      ['Source document is a direct reporting artifact in the live feed pipeline.'],
      { citationCount: 1 },
    ),
  };
}

function createEvidenceNode(
  claimId: string,
  document: SourceDocumentNode,
  excerpt: string,
  options?: { contradiction?: boolean; generated?: boolean; locator?: string },
): EvidenceNode {
  return {
    id: `evidence_${hashString(`${claimId}|${document.id}|${excerpt.slice(0, 80)}`)}`,
    nodeType: 'evidence',
    label: `${document.sourceName} evidence`,
    summary: excerpt,
    claimId,
    sourceDocumentId: document.id,
    accessClass: document.accessClass,
    sourceClass: document.sourceClass,
    excerpt,
    locator: options?.locator,
    retrievedAt: new Date().toISOString(),
    generated: options?.generated ?? false,
    contradiction: options?.contradiction ?? false,
    confidence: createConfidenceProfile(
      { provenance: 0.85, existence: 0.75 },
      ['Evidence node is anchored to a concrete source document excerpt.'],
      { citationCount: 1, contradictionCount: options?.contradiction ? 1 : 0 },
    ),
  };
}

function createGraphEdge(
  sourceId: string,
  targetId: string,
  relation: GraphEdge['relation'],
  explanation: string,
  metadata?: GraphEdge['metadata'],
): GraphEdge {
  return {
    id: `edge_${hashString(`${sourceId}|${relation}|${targetId}`)}`,
    sourceId,
    targetId,
    relation,
    metadata,
    confidence: createConfidenceProfile(
      { linkage: 0.68, provenance: 0.72 },
      [explanation],
      { citationCount: 1 },
    ),
  };
}

function createBaseEvent(cluster: StoryCluster, entityIds: string[], placeIds: string[], sourceDocumentIds: string[]): EventNode {
  const canonicalKey = normalizeKey([
    cluster.category,
    cluster.geoHint?.name ?? 'global',
    cluster.headline,
    toIso(cluster.publishedAt) ?? '',
  ].join('|'));

  return {
    id: `event_${hashString(canonicalKey)}`,
    nodeType: 'event',
    label: cluster.headline,
    summary: cluster.articles[0]?.description ?? cluster.headline,
    canonicalKey,
    category: cluster.category,
    severity: cluster.severity,
    startedAt: toIso(cluster.publishedAt),
    updatedAt: toIso(cluster.updatedAt),
    current: true,
    tags: [cluster.category, ...(cluster.geoHint?.name ? [cluster.geoHint.name] : [])],
    placeIds,
    entityIds,
    claimIds: [],
    sourceDocumentIds,
    geo: cluster.geoHint,
    metadata: {
      currentClusterId: cluster.id,
      perspectiveScore: Number(cluster.perspectiveScore.toFixed(2)),
      sourceCount: cluster.sourceIds.length,
    },
    confidence: createConfidenceProfile(
      {
        existence: Math.min(0.95, 0.55 + cluster.sourceIds.length * 0.08),
        provenance: Math.min(0.95, 0.5 + cluster.articles.length * 0.05),
        perspective: Math.min(0.95, 0.4 + cluster.perspectiveScore * 0.5),
      },
      ['Live event confidence is derived from multi-source clustering and reporting density.'],
      {
        sourceCount: cluster.sourceIds.length,
        citationCount: sourceDocumentIds.length,
        crossIdeologyCount: new Set(
          cluster.articles
            .map(article => getSourceById(article.sourceId)?.biasColor)
            .filter((value): value is BiasColor => Boolean(value)),
        ).size,
      },
    ),
  };
}

function createExistenceClaim(event: EventNode, cluster: StoryCluster): ClaimNode {
  return {
    id: `claim_${hashString(`${event.id}|existence`)}`,
    nodeType: 'claim',
    label: 'Event existence',
    summary: cluster.headline,
    eventId: event.id,
    claimType: 'event-existence',
    text: cluster.headline,
    evidenceIds: [],
    contradictionEvidenceIds: [],
    entityIds: event.entityIds,
    placeIds: event.placeIds,
    confidence: createConfidenceProfile(
      {
        existence: Math.min(0.95, 0.6 + cluster.sourceIds.length * 0.06),
        provenance: Math.min(0.95, 0.55 + cluster.articles.length * 0.04),
      },
      ['Event existence claim is backed by clustered reporting from multiple live sources.'],
      {
        sourceCount: cluster.sourceIds.length,
        citationCount: cluster.articles.length,
      },
    ),
  };
}

function createSharedFactClaim(event: EventNode, text: string, citationCount: number): ClaimNode {
  return {
    id: `claim_${hashString(`${event.id}|shared|${text}`)}`,
    nodeType: 'claim',
    label: 'Shared fact',
    summary: text,
    eventId: event.id,
    claimType: 'shared-fact',
    text,
    evidenceIds: [],
    contradictionEvidenceIds: [],
    entityIds: event.entityIds,
    placeIds: event.placeIds,
    confidence: createConfidenceProfile(
      { existence: 0.72, provenance: 0.7, attribution: 0.65 },
      ['Shared fact is derived from the current perspective-analysis consensus layer.'],
      { citationCount },
    ),
  };
}

function createPerspectiveClaim(eventId: string, perspective: SourcePerspective, lens: PerspectiveLens): ClaimNode {
  const text = perspective.mainFrame.trim();
  return {
    id: `claim_${hashString(`${eventId}|perspective|${perspective.sourceId}`)}`,
    nodeType: 'claim',
    label: `${perspective.sourceName} frame`,
    summary: text,
    eventId,
    claimType: 'perspective-frame',
    text,
    evidenceIds: [],
    contradictionEvidenceIds: [],
    entityIds: [],
    placeIds: [],
    perspectiveLens: lens,
    confidence: createConfidenceProfile(
      { perspective: 0.68, provenance: 0.64 },
      ['Perspective frame is a cited AI synthesis of how a source or lens frames the event.'],
      { citationCount: 1, aiInferencePenalty: 1 },
    ),
  };
}

function createPerspectiveViews(eventId: string, claims: ClaimNode[]): PerspectiveViewNode[] {
  const grouped = new Map<string, { lens: PerspectiveLens; claimIds: string[] }>();

  for (const claim of claims.filter(item => item.claimType === 'perspective-frame' && item.perspectiveLens)) {
    const lens = claim.perspectiveLens;
    if (!lens) continue;
    const key = `${lens.axis}:${lens.key}`;
    if (!grouped.has(key)) {
      grouped.set(key, { lens, claimIds: [] });
    }
    grouped.get(key)?.claimIds.push(claim.id);
  }

  const keys = [...grouped.keys()];
  const viewIds = keys.map(key => `view_${hashString(`${eventId}|${key}`)}`);

  return keys.map((key, index) => {
    const group = grouped.get(key)!;
    return {
      id: viewIds[index],
      nodeType: 'perspective-view',
      label: `${group.lens.label} perspective`,
      summary: `Native comparison view for ${group.lens.label}`,
      eventId,
      axis: group.lens.axis,
      lenses: [group.lens],
      claimIds: group.claimIds,
      edgeIds: [],
      comparedAgainstViewIds: viewIds.filter(id => id !== viewIds[index]),
      confidence: createConfidenceProfile(
        { perspective: 0.66, provenance: 0.62 },
        ['Perspective comparison view is derived over the shared event claim graph.'],
        { citationCount: group.claimIds.length, aiInferencePenalty: 1 },
      ),
      metadata: {
        nativeComparison: true,
        comparisonAxis: group.lens.axis,
      },
    };
  });
}

export function mergeEventGraphBundles(...bundles: EventGraphBundle[]): EventGraphBundle {
  const merged: EventGraphBundle = {
    events: [],
    claims: [],
    entities: [],
    places: [],
    sourceDocuments: [],
    evidence: [],
    edges: [],
    perspectiveViews: [],
  };

  const seen = {
    events: new Set<string>(),
    claims: new Set<string>(),
    entities: new Set<string>(),
    places: new Set<string>(),
    sourceDocuments: new Set<string>(),
    evidence: new Set<string>(),
    edges: new Set<string>(),
    perspectiveViews: new Set<string>(),
  };

  for (const bundle of bundles) {
    for (const key of Object.keys(merged) as Array<keyof EventGraphBundle>) {
      for (const item of bundle[key]) {
        if (!seen[key].has(item.id)) {
          seen[key].add(item.id);
          merged[key].push(item as never);
        }
      }
    }
  }

  return merged;
}

export function createEventGraphFromCluster(cluster: StoryCluster): EventGraphBundle {
  const documents = cluster.articles.map(createSourceDocumentNode);
  const documentMap = new Map(documents.map(document => [document.sourceId, document]));

  const entityNames = new Set<string>();
  for (const article of cluster.articles) {
    for (const entity of article.entities) {
      if (entity.trim()) entityNames.add(entity.trim());
    }
  }
  if (cluster.focalEntityName) entityNames.add(cluster.focalEntityName);
  if (cluster.geoHint?.name) entityNames.add(cluster.geoHint.name);

  const entities = [...entityNames].map(createEntityNode);
  const place = cluster.geoHint ? createPlaceNode(cluster.geoHint.name, cluster.geoHint) : null;
  const event = createBaseEvent(
    cluster,
    entities.map(entity => entity.id),
    place ? [place.id] : [],
    documents.map(document => document.id),
  );

  const claims: ClaimNode[] = [];
  const evidence: EvidenceNode[] = [];
  const edges: GraphEdge[] = [];

  const existenceClaim = createExistenceClaim(event, cluster);
  claims.push(existenceClaim);
  event.claimIds.push(existenceClaim.id);

  for (const document of documents) {
    const excerpt = document.excerpt || document.label;
    const evidenceNode = createEvidenceNode(existenceClaim.id, document, excerpt, { locator: document.url });
    existenceClaim.evidenceIds.push(evidenceNode.id);
    evidence.push(evidenceNode);
    edges.push(createGraphEdge(document.id, existenceClaim.id, 'supports', 'Source document supports the event-existence claim.'));
  }

  for (const fact of cluster.analysis?.sharedFacts ?? []) {
    const claim = createSharedFactClaim(event, fact, Math.min(3, documents.length));
    const supportingDocs = documents.slice(0, Math.min(3, documents.length));
    for (const document of supportingDocs) {
      const evidenceNode = createEvidenceNode(claim.id, document, document.excerpt || document.label, { locator: document.url });
      claim.evidenceIds.push(evidenceNode.id);
      evidence.push(evidenceNode);
      edges.push(createGraphEdge(document.id, claim.id, 'supports', 'Reporting document supports a shared-fact claim.'));
    }
    claims.push(claim);
    event.claimIds.push(claim.id);
  }

  const perspectiveClaims: ClaimNode[] = [];
  for (const perspective of cluster.analysis?.sourceAnalyses ?? []) {
    const lens: PerspectiveLens = {
      axis: 'media-ideology',
      key: perspective.biasLabel,
      label: perspective.biasLabel,
      biasLabel: perspective.biasLabel,
      biasColor: perspective.biasColor,
      sourceIds: [perspective.sourceId],
    };
    const claim = createPerspectiveClaim(event.id, perspective, lens);
    const document = documentMap.get(perspective.sourceId);
    if (document) {
      const evidenceNode = createEvidenceNode(claim.id, document, document.excerpt || document.label, {
        locator: document.url,
        generated: true,
      });
      claim.evidenceIds.push(evidenceNode.id);
      evidence.push(evidenceNode);
      edges.push(createGraphEdge(document.id, claim.id, 'supports', 'Source document supports the perspective-frame claim.', { generated: true }));
    }
    perspectiveClaims.push(claim);
    claims.push(claim);
    event.claimIds.push(claim.id);
    edges.push(createGraphEdge(claim.id, event.id, 'perspective-on', 'Perspective claim is a lens over the shared event graph.'));
  }

  const perspectiveViews = createPerspectiveViews(event.id, perspectiveClaims);

  if (place) {
    edges.push(createGraphEdge(event.id, place.id, 'located-in', 'Event is anchored to a mapped place or geo hint.'));
  }

  return {
    events: [event],
    claims,
    entities,
    places: place ? [place] : [],
    sourceDocuments: documents,
    evidence,
    edges,
    perspectiveViews,
  };
}

export function createHistoricalContextGraph(event: EventNode, items: HistoricalContextItem[]): EventGraphBundle {
  if (items.length === 0) return EMPTY_BUNDLE;

  const sourceDocuments: SourceDocumentNode[] = [];
  const claims: ClaimNode[] = [];
  const evidence: EvidenceNode[] = [];
  const edges: GraphEdge[] = [];

  for (const item of items) {
    const sourceMeta = classifySource(item.provider, item.url);
    const sourceDocument: SourceDocumentNode = {
      id: `doc_${hashString(`${item.provider}|${item.url}`)}`,
      nodeType: 'source-document',
      label: item.title,
      summary: item.snippet,
      sourceId: item.provider,
      sourceName: item.provider,
      sourceClass: item.sourceClass ?? sourceMeta.sourceClass,
      accessClass: item.accessClass ?? sourceMeta.accessClass,
      publisher: item.provider,
      url: item.url,
      publishedAt: toIso(item.publishedAt),
      excerpt: item.excerpt ?? item.snippet,
      confidence: createConfidenceProfile(
        { provenance: 0.8 },
        ['Historical source document is preserved as provenance for graph enrichment.'],
        { citationCount: 1 },
      ),
      metadata: item.metadata,
    };

    const claim: ClaimNode = {
      id: `claim_${hashString(`${event.id}|historical|${item.provider}|${item.title}`)}`,
      nodeType: 'claim',
      label: item.title,
      summary: item.snippet,
      eventId: event.id,
      claimType: item.provider === 'gdelt' ? 'structured-signal' : 'historical-context',
      text: item.snippet || item.title,
      evidenceIds: [],
      contradictionEvidenceIds: [],
      entityIds: event.entityIds,
      placeIds: event.placeIds,
      confidence: createConfidenceProfile(
        {
          provenance: item.provider === 'internet-archive' ? 0.88 : 0.76,
          linkage: 0.7,
          existence: item.provider === 'gdelt' ? 0.8 : 0.68,
        },
        ['Historical context claim is attached to the event through cited source material.'],
        { citationCount: 1, structuredSourceCount: item.provider === 'gdelt' ? 1 : 0 },
      ),
    };

    const evidenceNode = createEvidenceNode(claim.id, sourceDocument, sourceDocument.excerpt || sourceDocument.label, {
      locator: sourceDocument.url,
    });

    claim.evidenceIds.push(evidenceNode.id);
    sourceDocuments.push(sourceDocument);
    claims.push(claim);
    evidence.push(evidenceNode);
    edges.push(createGraphEdge(sourceDocument.id, claim.id, 'supports', 'Historical source document supports the attached claim.'));
    edges.push(createGraphEdge(claim.id, event.id, 'background-context', 'Historical claim provides background context for the event.'));
  }

  return {
    ...EMPTY_BUNDLE,
    sourceDocuments,
    claims,
    evidence,
    edges,
  };
}

export function createEventGraphFromGdeltEvent(event: GdeltEvent, category: EventCategory = 'conflict'): EventGraphBundle {
  const actorNames = [event.actor1, event.actor2].filter(Boolean);
  const entities = actorNames.map(createEntityNode);
  const structuredSummary = `${event.actor1 || 'Unknown'}${event.actor2 ? ` and ${event.actor2}` : ''} | code ${event.eventCode}`;
  const place = createPlaceNode('GDELT mapped location', {
    lat: event.lat,
    lng: event.lng,
    name: 'GDELT mapped location',
  });

  const eventNode: EventNode = {
    id: `event_${hashString(`gdelt|${event.id}`)}`,
    nodeType: 'event',
    label: `${event.actor1 || 'Unknown actor'} activity`,
    summary: structuredSummary,
    canonicalKey: normalizeKey(`gdelt-${event.id}`),
    category,
    severity: event.mentionCount > 30 ? 'high' : event.mentionCount > 10 ? 'medium' : 'low',
    startedAt: toIso(event.date),
    updatedAt: toIso(event.date),
    current: true,
    tags: [category, 'gdelt', event.eventCode],
    placeIds: [place.id],
    entityIds: entities.map(entity => entity.id),
    claimIds: [],
    sourceDocumentIds: [],
    geo: { lat: event.lat, lng: event.lng, name: place.label },
    metadata: {
      eventCode: event.eventCode,
      mentionCount: event.mentionCount,
      tone: Number(event.tone.toFixed(2)),
    },
    confidence: createConfidenceProfile(
      { existence: 0.82, provenance: 0.86, quantitative: 0.74 },
      ['Structured GDELT event carries higher existence confidence than inferred live clustering alone.'],
      { structuredSourceCount: 1, citationCount: 1 },
    ),
  };

  const sourceDocument: SourceDocumentNode = {
    id: `doc_${hashString(`gdelt|${event.id}|${event.sourceUrl}`)}`,
    nodeType: 'source-document',
    label: 'GDELT event record',
    summary: event.sourceUrl,
    sourceId: 'gdelt',
    sourceName: 'GDELT',
    sourceClass: 'open-dataset',
    accessClass: 'open',
    publisher: 'GDELT',
    url: event.sourceUrl,
    publishedAt: toIso(event.date),
    excerpt: `${event.actor1 || 'Unknown'}${event.actor2 ? ` vs ${event.actor2}` : ''} | mentions ${event.mentionCount}`,
    confidence: createConfidenceProfile(
      { provenance: 0.88 },
      ['Source document represents a structured open dataset record.'],
      { structuredSourceCount: 1, citationCount: 1 },
    ),
  };

  eventNode.sourceDocumentIds.push(sourceDocument.id);

  const claim: ClaimNode = {
    id: `claim_${hashString(`${eventNode.id}|gdelt-structured`)}`,
    nodeType: 'claim',
    label: 'Structured event signal',
    summary: structuredSummary,
    eventId: eventNode.id,
    claimType: 'structured-signal',
    text: structuredSummary,
    evidenceIds: [],
    contradictionEvidenceIds: [],
    entityIds: eventNode.entityIds,
    placeIds: eventNode.placeIds,
    confidence: createConfidenceProfile(
      { existence: 0.82, provenance: 0.86, attribution: 0.7 },
      ['Claim comes from a structured conflict/event backbone provider.'],
      { structuredSourceCount: 1, citationCount: 1 },
    ),
  };
  eventNode.claimIds.push(claim.id);

  const evidenceNode = createEvidenceNode(claim.id, sourceDocument, sourceDocument.excerpt || sourceDocument.label, {
    locator: sourceDocument.url,
  });
  claim.evidenceIds.push(evidenceNode.id);

  return {
    events: [eventNode],
    claims: [claim],
    entities,
    places: [place],
    sourceDocuments: [sourceDocument],
    evidence: [evidenceNode],
    edges: [
      createGraphEdge(sourceDocument.id, claim.id, 'supports', 'Structured document supports the GDELT claim.'),
      createGraphEdge(claim.id, eventNode.id, 'about', 'Structured claim describes the event node.'),
      createGraphEdge(eventNode.id, place.id, 'located-in', 'Structured event is anchored to a mapped place.'),
    ],
    perspectiveViews: [],
  };
}