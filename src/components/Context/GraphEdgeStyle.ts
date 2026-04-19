/**
 * GraphEdgeStyle.ts
 *
 * Derives stroke styling from a GraphEdge + optional perspective filter.
 * All graph types imported through the adapter surface.
 */

import type { GraphEdge, GraphEdgeRelation } from '../../services/history-graph-adapter';
import { isUniversalEdge } from '../../services/history-graph-adapter';

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  labelColor?: string;
}

const RELATION_STYLES: Record<GraphEdgeRelation, Pick<EdgeStyle, 'stroke' | 'strokeWidth' | 'strokeDasharray'>> = {
  'caused-by':           { stroke: '#ef4444', strokeWidth: 2 },
  'precursor-to':        { stroke: '#ef4444', strokeWidth: 2 },
  'escalated':           { stroke: '#f97316', strokeWidth: 1.5 },
  'retaliated-to':       { stroke: '#f97316', strokeWidth: 1.5 },
  'diplomatic-response': { stroke: '#3b82f6', strokeWidth: 1.5 },
  'background-context':  { stroke: '#6b7280', strokeWidth: 1,   strokeDasharray: '4 3' },
  'contradicts':         { stroke: '#ef4444', strokeWidth: 1,   strokeDasharray: '4 3' },
  'disputed-by':         { stroke: '#ef4444', strokeWidth: 1,   strokeDasharray: '4 3' },
  'corroborates':        { stroke: '#10b981', strokeWidth: 1.5 },
  'supports':            { stroke: '#10b981', strokeWidth: 1.5 },
  'about':               { stroke: '#4b5563', strokeWidth: 1 },
  'perspective-on':      { stroke: '#4b5563', strokeWidth: 1 },
  'located-in':          { stroke: '#4b5563', strokeWidth: 1 },
  'territorial-shift':   { stroke: '#4b5563', strokeWidth: 1 },
};

export function getEdgeStyle(edge: GraphEdge, _activePerspectiveKeys?: string[]): EdgeStyle {
  const base = RELATION_STYLES[edge.relation] ?? { stroke: '#4b5563', strokeWidth: 1 };

  const universal = isUniversalEdge(edge);

  if (universal) {
    return {
      stroke:          base.stroke,
      strokeWidth:     base.strokeWidth,
      strokeDasharray: base.strokeDasharray,
      labelColor:      base.stroke,
    };
  }

  // Partisan edge — reduce weight and prepend "2 2" dash
  const dasharray = base.strokeDasharray
    ? `2 2 ${base.strokeDasharray}`
    : '2 2';

  return {
    stroke:          base.stroke,
    strokeWidth:     Math.max(0.5, base.strokeWidth - 0.5),
    strokeDasharray: dasharray,
    labelColor:      base.stroke,
  };
}
