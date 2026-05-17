import type { BiasColor, BiasLabel, EventCategory } from './index';

export type GraphMetadataValue = string | number | boolean | null;

export type SourceAccessClass = 'open' | 'free-tier' | 'paid' | 'internal';

export type SourceEvidenceClass =
  | 'official'
  | 'mainstream'
  | 'independent'
  | 'state-media'
  | 'osint'
  | 'social'
  | 'open-dataset'
  | 'archive'
  | 'encyclopedia'
  | 'ai-generated'
  | 'internal';

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'mixed' | 'unknown';

export interface ConfidenceDimensions {
  existence?: number;
  attribution?: number;
  quantitative?: number;
  linkage?: number;
  perspective?: number;
  provenance?: number;
}

export interface ConfidenceSignals {
  sourceCount?: number;
  crossIdeologyCount?: number;
  contradictionCount?: number;
  citationCount?: number;
  structuredSourceCount?: number;
  aiInferencePenalty?: number;
}

export interface ConfidenceProfile {
  overall: number;
  tier: ConfidenceTier;
  dimensions: ConfidenceDimensions;
  explanation: string[];
  signals: ConfidenceSignals;
}

export interface GraphGeoPoint {
  lat: number;
  lng: number;
  name: string;
}

export type GraphNodeType =
  | 'event'
  | 'claim'
  | 'entity'
  | 'place'
  | 'source-document'
  | 'evidence'
  | 'perspective-view';

export interface GraphNodeBase {
  id: string;
  nodeType: GraphNodeType;
  label: string;
  summary?: string;
  metadata?: Record<string, GraphMetadataValue>;
  confidence: ConfidenceProfile;
}

export interface EventNode extends GraphNodeBase {
  nodeType: 'event';
  category: EventCategory;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  startedAt?: string;
  updatedAt?: string;
  current: boolean;
  tags: string[];
  placeIds: string[];
  entityIds: string[];
  claimIds: string[];
  sourceDocumentIds: string[];
  geo?: GraphGeoPoint;
  canonicalKey: string;
}

export interface EntityNode extends GraphNodeBase {
  nodeType: 'entity';
  entityType: 'state' | 'person' | 'organization' | 'media' | 'alliance' | 'militia' | 'doctrine' | 'unknown';
  canonicalKey: string;
}

export interface PlaceNode extends GraphNodeBase {
  nodeType: 'place';
  placeType: 'country' | 'city' | 'region' | 'facility' | 'chokepoint' | 'unknown';
  canonicalKey: string;
  geo?: GraphGeoPoint;
}

export interface PerspectiveLens {
  axis: 'actor-country' | 'media-ideology';
  key: string;
  label: string;
  biasLabel?: BiasLabel | 'neutral';
  biasColor?: BiasColor;
  sourceIds?: string[];
  entityId?: string;
  placeId?: string;
}

export interface ClaimNode extends GraphNodeBase {
  nodeType: 'claim';
  eventId: string;
  claimType:
    | 'event-existence'
    | 'shared-fact'
    | 'reported-detail'
    | 'perspective-frame'
    | 'historical-context'
    | 'structured-signal'
    | 'quantitative';
  text: string;
  evidenceIds: string[];
  contradictionEvidenceIds: string[];
  entityIds: string[];
  placeIds: string[];
  perspectiveLens?: PerspectiveLens;
}

export interface SourceDocumentNode extends GraphNodeBase {
  nodeType: 'source-document';
  sourceId: string;
  sourceName: string;
  sourceClass: SourceEvidenceClass;
  accessClass: SourceAccessClass;
  publisher?: string;
  url: string;
  publishedAt?: string;
  excerpt?: string;
  biasLabel?: BiasLabel;
  biasColor?: BiasColor;
}

export interface EvidenceNode extends GraphNodeBase {
  nodeType: 'evidence';
  claimId: string;
  sourceDocumentId: string;
  accessClass: SourceAccessClass;
  sourceClass: SourceEvidenceClass;
  excerpt: string;
  locator?: string;
  retrievedAt: string;
  generated: boolean;
  contradiction: boolean;
}

export interface PerspectiveViewNode extends GraphNodeBase {
  nodeType: 'perspective-view';
  eventId: string;
  axis: 'actor-country' | 'media-ideology' | 'combined';
  lenses: PerspectiveLens[];
  claimIds: string[];
  edgeIds: string[];
  comparedAgainstViewIds: string[];
}

export type GraphEdgeRelation =
  | 'about'
  | 'supports'
  | 'contradicts'
  | 'background-context'
  | 'perspective-on'
  | 'located-in'
  | 'caused-by'
  | 'escalated'
  | 'retaliated-to'
  | 'precursor-to'
  | 'diplomatic-response'
  | 'territorial-shift'
  | 'disputed-by'
  | 'corroborates';

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: GraphEdgeRelation;
  confidence: ConfidenceProfile;
  metadata?: Record<string, GraphMetadataValue>;
}

export interface EventGraphBundle {
  events: EventNode[];
  claims: ClaimNode[];
  entities: EntityNode[];
  places: PlaceNode[];
  sourceDocuments: SourceDocumentNode[];
  evidence: EvidenceNode[];
  edges: GraphEdge[];
  perspectiveViews: PerspectiveViewNode[];
}

export interface HistoricalContextItem {
  provider: 'wikipedia' | 'wikidata' | 'gdelt' | 'internet-archive' | 'official-record' | 'manual';
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string | Date;
  excerpt?: string;
  accessClass?: SourceAccessClass;
  sourceClass?: SourceEvidenceClass;
  metadata?: Record<string, GraphMetadataValue>;
}