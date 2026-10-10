import type { GeometryLodId } from '../geo/geometry';
import { lodForScale, worldFitScale } from '../geo/worldCamera';
import type { WorldCountryRecord } from '../geo/worldBoundaryPackage';

export function resolveLoadedLod(
  lodOverride: GeometryLodId | 'AUTO',
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
): GeometryLodId {
  if (lodOverride !== 'AUTO') return lodOverride;
  return lodForScale(scale, worldFitScale(viewportWidth, viewportHeight));
}

export function worldPathCacheKey(geoCountryId: string, lod: GeometryLodId): string {
  return `${geoCountryId}::${lod}`;
}

export function selectDrawCountryIds(
  cullEnabled: boolean,
  visibleIds: readonly string[],
  allRenderableIds: readonly string[],
): string[] {
  return cullEnabled ? [...visibleIds] : [...allRenderableIds];
}

export function lodGeometryTotals(
  countries: readonly WorldCountryRecord[],
  lod: GeometryLodId,
): { paths: number; polygons: number; vertices: number } {
  let polygons = 0;
  let vertices = 0;
  for (const country of countries) {
    polygons += country.lods[lod].polygonCount;
    vertices += country.lods[lod].vertexCount;
  }
  return { paths: countries.length, polygons, vertices };
}
