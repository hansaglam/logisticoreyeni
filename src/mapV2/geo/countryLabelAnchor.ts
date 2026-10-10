import {
  pointInProjectedPolygons,
  ringAreaAbs,
  type ProjectedPolygon,
  type ProjectedRing,
} from './geometry';
import type { ProjectedWorldPoint } from './webMercator';
import { dequantizePolygons, type WorldCountryRecord } from './worldBoundaryPackage';

export type CountryLabelAnchorMethod = 'centroid' | 'grid' | 'bbox-fallback';

export type CountryLabelAnchor = {
  geoCountryId: string;
  projected: ProjectedWorldPoint;
  method: CountryLabelAnchorMethod;
  /** Set when the centroid of the main landmass is outside the polygon. */
  exception?: string;
};

const cache = new Map<string, CountryLabelAnchor>();

function ringCentroid(ring: ProjectedRing): ProjectedWorldPoint {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  for (let i = 0; i < n - 1; i += 1) {
    const x0 = ring[i].x;
    const y0 = ring[i].y;
    const x1 = ring[i + 1].x;
    const y1 = ring[i + 1].y;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-18) {
    return { x: ring[0].x, y: ring[0].y };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

function minDistToRing(point: ProjectedWorldPoint, ring: ProjectedRing): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const ax = ring[i].x;
    const ay = ring[i].y;
    const bx = ring[i + 1].x;
    const by = ring[i + 1].y;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let t = ((point.x - ax) * dx + (point.y - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    min = Math.min(min, Math.hypot(point.x - px, point.y - py));
  }
  return min;
}

function rankedPolygons(polygons: ProjectedPolygon[]): ProjectedPolygon[] {
  return [...polygons].sort((a, b) => ringAreaAbs(b.exterior) - ringAreaAbs(a.exterior));
}

function largestPolygon(polygons: ProjectedPolygon[]): ProjectedPolygon | null {
  const ranked = rankedPolygons(polygons);
  if (ranked.length === 0) return null;
  const primary = ranked[0];
  const primaryCentroid = ringCentroid(primary.exterior);
  const secondary = ranked[1];
  if (secondary && primaryCentroid.y < 0.24) {
    const primaryArea = ringAreaAbs(primary.exterior);
    const secondaryArea = ringAreaAbs(secondary.exterior);
    if (secondaryArea >= primaryArea * 0.22) {
      return secondary;
    }
  }
  return primary;
}

function bboxOfRing(ring: ProjectedRing): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = ring[0].x;
  let minY = ring[0].y;
  let maxX = ring[0].x;
  let maxY = ring[0].y;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Stable interior label point from the largest landmass.
 * World-spanning overseas fragments are ignored by using the largest polygon only.
 * High-latitude secondary: if the largest mass sits north of ~60° (y < 0.24)
 * and a substantial second mass exists (USA Alaska vs CONUS), use the second.
 */
export function countryLabelAnchorFromPolygons(
  geoCountryId: string,
  polygons: ProjectedPolygon[],
): CountryLabelAnchor {
  const main = largestPolygon(polygons);
  if (!main) {
    return { geoCountryId, projected: { x: 0.5, y: 0.5 }, method: 'bbox-fallback', exception: 'empty-geometry' };
  }
  const centroid = ringCentroid(main.exterior);
  if (pointInProjectedPolygons(centroid, [main])) {
    return { geoCountryId, projected: centroid, method: 'centroid' };
  }
  const box = bboxOfRing(main.exterior);
  const cols = 7;
  const rows = 7;
  let best: ProjectedWorldPoint | null = null;
  let bestScore = -1;
  for (let iy = 1; iy < rows; iy += 1) {
    for (let ix = 1; ix < cols; ix += 1) {
      const sample = {
        x: box.minX + ((box.maxX - box.minX) * ix) / cols,
        y: box.minY + ((box.maxY - box.minY) * iy) / rows,
      };
      if (!pointInProjectedPolygons(sample, [main])) continue;
      const score = minDistToRing(sample, main.exterior);
      if (score > bestScore) {
        bestScore = score;
        best = sample;
      }
    }
  }
  if (best) {
    return {
      geoCountryId,
      projected: best,
      method: 'grid',
      exception: 'centroid-outside-main-polygon',
    };
  }
  return {
    geoCountryId,
    projected: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    method: 'bbox-fallback',
    exception: 'no-interior-sample',
  };
}

export function getCountryLabelAnchor(country: WorldCountryRecord): CountryLabelAnchor {
  const hit = cache.get(country.geoCountryId);
  if (hit) return hit;
  const polygons = dequantizePolygons(country.lods.WORLD_LOW.polygons);
  const next = countryLabelAnchorFromPolygons(country.geoCountryId, polygons);
  cache.set(country.geoCountryId, next);
  return next;
}

export function resetCountryLabelAnchorCacheForTests(): void {
  cache.clear();
}
