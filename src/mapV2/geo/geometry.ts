import { MAX_PLAUSIBLE_RENDER_SEGMENT_DX } from './polarPolicy';
import {
  expandProjectedBounds,
  projectWgs84ToNormalizedMercatorStrict,
  type ProjectedBoundingBox,
  type ProjectedWorldPoint,
} from './webMercator';
import { prepareWgs84RingForMercator, type LonLat } from './wgs84Clip';

/**
 * Winding in projected top-left space after Web Mercator Y flip:
 * exterior rings are stored as source order (not rewritten unless open).
 * Fill rule at render: even-odd so interior rings punch holes regardless of winding.
 * Closed rings must repeat the first vertex as the last.
 */
export const RING_WINDING_CONVENTION = 'SOURCE_ORDER_EVEN_ODD_FILL' as const;

export type GeometryLodId = 'WORLD_LOW' | 'WORLD_MEDIUM' | 'COUNTRY_HIGH';

export const GEOMETRY_LOD_IDS: readonly GeometryLodId[] = [
  'WORLD_LOW',
  'WORLD_MEDIUM',
  'COUNTRY_HIGH',
];

export type ProjectedRing = ProjectedWorldPoint[];

export type ProjectedPolygon = {
  exterior: ProjectedRing;
  holes: ProjectedRing[];
};

export type CountryGeometryFeature = {
  geoCountryId: string;
  sourceFeatureId: string;
  identityStatus: 'RESOLVED' | 'UNRESOLVED';
  polygons: ProjectedPolygon[];
  projectedBounds: ProjectedBoundingBox;
  lod: GeometryLodId;
};

export type CountryIdentityRecord = {
  geoCountryId: string;
  identityStatus: 'RESOLVED' | 'UNRESOLVED';
  sourceFeatureId: string;
  sourceIso2?: string;
  sourceIso3?: string;
  sourceDisplayName: string;
  notes?: string;
};

function isClosed(ring: ProjectedRing): boolean {
  if (ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.x === last.x && first.y === last.y;
}

export function closeRing(ring: ProjectedRing): ProjectedRing {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.x === last.x && first.y === last.y) return ring;
  return [...ring, { x: first.x, y: first.y }];
}

export function validateProjectedRing(ring: ProjectedRing): string | null {
  const closed = closeRing(ring);
  if (closed.length < 4) return 'ring-too-short';
  for (const p of closed) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'non-finite';
  }
  if (!isClosed(closed)) return 'not-closed';
  return null;
}

export function ringAreaAbs(ring: ProjectedRing): number {
  const closed = closeRing(ring);
  let sum = 0;
  for (let i = 0; i < closed.length - 1; i += 1) {
    sum += closed[i].x * closed[i + 1].y - closed[i + 1].x * closed[i].y;
  }
  return Math.abs(sum) / 2;
}

export function boundsOfPolygons(polygons: ProjectedPolygon[]): ProjectedBoundingBox | null {
  let bounds: ProjectedBoundingBox | null = null;
  for (const polygon of polygons) {
    for (const p of polygon.exterior) {
      bounds = expandProjectedBounds(bounds, p);
    }
  }
  return bounds;
}

export function pointInRing(point: ProjectedWorldPoint, ring: ProjectedRing): boolean {
  const closed = closeRing(ring);
  let inside = false;
  for (let i = 0, j = closed.length - 1; i < closed.length; j = i, i += 1) {
    const xi = closed[i].x;
    const yi = closed[i].y;
    const xj = closed[j].x;
    const yj = closed[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Even-odd across exterior + holes. */
export function pointInProjectedPolygons(
  point: ProjectedWorldPoint,
  polygons: ProjectedPolygon[],
): boolean {
  let hits = 0;
  for (const polygon of polygons) {
    if (pointInRing(point, polygon.exterior)) hits += 1;
    for (const hole of polygon.holes) {
      if (pointInRing(point, hole)) hits += 1;
    }
  }
  return hits % 2 === 1;
}

export function projectLonLatRing(lonLat: LonLat[]): ProjectedRing {
  return lonLat.map(([lon, lat]) => projectWgs84ToNormalizedMercatorStrict(lon, lat));
}

function maxSegmentDx(ring: ProjectedRing): number {
  const closed = closeRing(ring);
  let max = 0;
  for (let i = 0; i < closed.length - 1; i += 1) {
    max = Math.max(max, Math.abs(closed[i].x - closed[i + 1].x));
  }
  return max;
}

/**
 * GeoJSON polygon: clip to Mercator latitudes, split at the dateline, then project.
 * Vertices are never latitude-clamped.
 */
export function projectGeoJsonPolygon(rings: LonLat[][]): ProjectedPolygon[] {
  if (rings.length === 0) return [];
  const exteriorParts = prepareWgs84RingForMercator(rings[0]).map((part) => closeRing(projectLonLatRing(part)));
  const holes: ProjectedRing[] = [];
  for (const hole of rings.slice(1)) {
    for (const part of prepareWgs84RingForMercator(hole)) {
      const projected = closeRing(projectLonLatRing(part));
      if (validateProjectedRing(projected) == null) holes.push(projected);
    }
  }
  const polygons: ProjectedPolygon[] = [];
  for (const exterior of exteriorParts) {
    if (validateProjectedRing(exterior) != null) continue;
    if (maxSegmentDx(exterior) >= MAX_PLAUSIBLE_RENDER_SEGMENT_DX) continue;
    const ownedHoles = holes.filter((hole) => {
      const sample = hole[0];
      return pointInRing(sample, exterior);
    });
    polygons.push({ exterior, holes: ownedHoles });
  }
  return polygons;
}

export function projectGeoJsonGeometry(geometry: {
  type: string;
  coordinates: unknown;
}): ProjectedPolygon[] {
  if (geometry.type === 'Polygon') {
    return projectGeoJsonPolygon(geometry.coordinates as LonLat[][]);
  }
  if (geometry.type === 'MultiPolygon') {
    const polygons: ProjectedPolygon[] = [];
    for (const polygon of geometry.coordinates as LonLat[][][]) {
      polygons.push(...projectGeoJsonPolygon(polygon));
    }
    return polygons;
  }
  return [];
}
