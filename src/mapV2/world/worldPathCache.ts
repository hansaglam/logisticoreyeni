import { Skia, type SkPath } from '@shopify/react-native-skia';

import type { GeometryLodId } from '../geo/geometry';
import { WEB_MERCATOR_LAYER_INCLUDED } from '../geo/polarPolicy';
import { dequantizePolygons } from '../geo/worldBoundaryPackage';
import { getWorldBoundaryPackage } from './worldBoundaryLoader';
import { worldPathCacheKey } from './worldViewerFrame';

const cache = new Map<string, SkPath>();

function cacheKey(geoCountryId: string, lod: GeometryLodId): string {
  return worldPathCacheKey(geoCountryId, lod);
}

export { worldPathCacheKey };

/**
 * SkPath cache keyed by geoCountryId + LOD.
 * Built lazily once per key. Cleared when the JS runtime reloads (not per frame).
 * Ownership: module singleton for the DEV world viewer process.
 */
export function getCountryPath(geoCountryId: string, lod: GeometryLodId): SkPath | null {
  const key = cacheKey(geoCountryId, lod);
  const existing = cache.get(key);
  if (existing) return existing;
  const country = getWorldBoundaryPackage().countries.find((c) => c.geoCountryId === geoCountryId);
  if (!country || country.webMercatorLayer !== WEB_MERCATOR_LAYER_INCLUDED) return null;
  const polygons = dequantizePolygons(country.lods[lod].polygons);
  const path = Skia.Path.Make();
  for (const polygon of polygons) {
    const ext = polygon.exterior;
    if (ext.length < 4) continue;
    path.moveTo(ext[0].x, ext[0].y);
    for (let i = 1; i < ext.length; i += 1) {
      path.lineTo(ext[i].x, ext[i].y);
    }
    path.close();
    for (const hole of polygon.holes) {
      if (hole.length < 4) continue;
      path.moveTo(hole[0].x, hole[0].y);
      for (let i = 1; i < hole.length; i += 1) {
        path.lineTo(hole[i].x, hole[i].y);
      }
      path.close();
    }
  }
  cache.set(key, path);
  return path;
}

export function warmLodPaths(lod: GeometryLodId, geoCountryIds: readonly string[]): void {
  for (const id of geoCountryIds) {
    getCountryPath(id, lod);
  }
}

export function pathCacheSize(): number {
  return cache.size;
}
