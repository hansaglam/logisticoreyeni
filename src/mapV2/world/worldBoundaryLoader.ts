import type { GeometryLodId, ProjectedPolygon } from '../geo/geometry';
import { WEB_MERCATOR_LAYER_INCLUDED } from '../geo/polarPolicy';
import { projectedBoundsIntersect, type ProjectedBoundingBox } from '../geo/webMercator';
import { dequantizePolygons, type WorldBoundaryPackageV1, type WorldCountryRecord } from '../geo/worldBoundaryPackage';

let cached: WorldBoundaryPackageV1 | null = null;

export function getWorldBoundaryPackage(): WorldBoundaryPackageV1 {
  if (cached) return cached;
  // Bundled DEV package. Not a production MapData release.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../generated/world/worldBoundaryPackage.json') as WorldBoundaryPackageV1;
  return cached;
}

export function getCountryRecord(geoCountryId: string): WorldCountryRecord | undefined {
  return getWorldBoundaryPackage().countries.find((c) => c.geoCountryId === geoCountryId);
}

export function getCountryGeometry(geoCountryId: string, lod: GeometryLodId): ProjectedPolygon[] {
  const country = getCountryRecord(geoCountryId);
  if (!country) return [];
  return dequantizePolygons(country.lods[lod].polygons);
}

export function getRenderableCountries(): WorldCountryRecord[] {
  return getWorldBoundaryPackage().countries.filter(
    (country) => country.webMercatorLayer === WEB_MERCATOR_LAYER_INCLUDED,
  );
}

export function getVisibleCountryGeometry(
  viewport: ProjectedBoundingBox,
  lod: GeometryLodId,
): WorldCountryRecord[] {
  return getRenderableCountries().filter((country) =>
    projectedBoundsIntersect(country.lods[lod].projectedBounds, viewport),
  );
}
