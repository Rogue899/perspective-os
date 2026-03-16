/**
 * Focal Point Detection
 *
 * After clustering, scans all clusters for shared geoHint locations.
 * If a geo entity (country/region) appears in FOCAL_THRESHOLD or more clusters,
 * those clusters are marked as focal points ("hot zones").
 *
 * This surfaces which regions are dominating the current news cycle.
 */

import type { StoryCluster } from '../types';

const FOCAL_THRESHOLD = 3; // geo must appear in at least this many clusters

export interface FocalPoint {
  name: string;
  clusterCount: number;
}

/**
 * Marks clusters whose geoHint appears in FOCAL_THRESHOLD+ clusters.
 * Returns the annotated cluster list + a sorted focal-points summary.
 */
export function detectFocalPoints(clusters: StoryCluster[]): {
  clusters: StoryCluster[];
  focalPoints: FocalPoint[];
} {
  // Count how many clusters each geo name appears in
  const geoCount = new Map<string, number>();
  for (const c of clusters) {
    if (c.geoHint?.name) {
      geoCount.set(c.geoHint.name, (geoCount.get(c.geoHint.name) ?? 0) + 1);
    }
  }

  // Identify which geo names cross the threshold
  const hotGeos = new Set<string>();
  const focalPoints: FocalPoint[] = [];
  for (const [name, count] of geoCount) {
    if (count >= FOCAL_THRESHOLD) {
      hotGeos.add(name);
      focalPoints.push({ name, clusterCount: count });
    }
  }

  // Annotate matching clusters
  const marked = clusters.map(c => {
    if (c.geoHint?.name && hotGeos.has(c.geoHint.name)) {
      return { ...c, isFocalPoint: true, focalEntityName: c.geoHint.name };
    }
    return c;
  });

  return {
    clusters: marked,
    focalPoints: focalPoints.sort((a, b) => b.clusterCount - a.clusterCount),
  };
}
