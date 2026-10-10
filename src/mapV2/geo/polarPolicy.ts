import { WEB_MERCATOR_MAX_LATITUDE } from './webMercator';
import { dropClosingVertex, type LonLat } from './wgs84Clip';

/** LogistiCore V1: Web Mercator cannot represent pole-enclosing polygons. */
export const POLAR_RENDER_POLICY = 'OMIT_UNREPRESENTABLE_POLAR_FEATURE' as const;
export type PolarRenderPolicy = typeof POLAR_RENDER_POLICY;

export const WEB_MERCATOR_LAYER_INCLUDED = 'INCLUDED' as const;
export const WEB_MERCATOR_LAYER_OMITTED_POLAR = 'OMITTED_UNREPRESENTABLE_POLAR' as const;
export type WebMercatorLayerStatus =
  | typeof WEB_MERCATOR_LAYER_INCLUDED
  | typeof WEB_MERCATOR_LAYER_OMITTED_POLAR;

export const MAX_PLAUSIBLE_RENDER_SEGMENT_DX = 0.35;
export const WORLD_STRIP_MIN_WIDTH = 0.85;

export type OmittedPolarFeature = {
  geoCountryId: string;
  sourceFeatureId: string;
  sourceDisplayName: string;
  sourceIso3?: string;
  reason: string;
};

function walkGeoJsonRings(
  geometry: { type: string; coordinates: unknown },
  visit: (ring: LonLat[]) => void,
): void {
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates as LonLat[][]) visit(ring);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates as LonLat[][][]) {
      for (const ring of polygon) visit(ring);
    }
  }
}

export function ringEnclosesUnrepresentablePole(ring: LonLat[]): boolean {
  const open = dropClosingVertex(ring);
  if (open.length < 3) return false;
  const lats = open.map((point) => point[1]);
  const lons = open.map((point) => point[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lonSpan = Math.max(...lons) - Math.min(...lons);
  const southPolar = open.filter((point) => point[1] <= -89);
  const northPolar = open.filter((point) => point[1] >= 89);
  if (southPolar.length >= 3) {
    const polarLons = southPolar.map((point) => point[0]);
    if (Math.max(...polarLons) - Math.min(...polarLons) >= 180) return true;
  }
  if (northPolar.length >= 3) {
    const polarLons = northPolar.map((point) => point[0]);
    if (Math.max(...polarLons) - Math.min(...polarLons) >= 180) return true;
  }
  if (minLat < -WEB_MERCATOR_MAX_LATITUDE && lonSpan >= 300) return true;
  if (maxLat > WEB_MERCATOR_MAX_LATITUDE && lonSpan >= 300) return true;
  return false;
}

export function geoJsonEnclosesUnrepresentablePole(geometry: {
  type: string;
  coordinates: unknown;
}): boolean {
  let enclosed = false;
  walkGeoJsonRings(geometry, (ring) => {
    if (ringEnclosesUnrepresentablePole(ring)) enclosed = true;
  });
  return enclosed;
}

export function polarOmitReason(geometry: { type: string; coordinates: unknown }): string | null {
  if (!geoJsonEnclosesUnrepresentablePole(geometry)) return null;
  return 'source polygon encloses a pole; Web Mercator clip still yields a world-spanning strip';
}
