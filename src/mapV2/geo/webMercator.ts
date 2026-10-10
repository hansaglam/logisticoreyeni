/**
 * Normalized Web Mercator (EPSG:3857 semantics) in world space [0, 1]².
 * Source coordinates remain WGS84 degrees. Do not use this space for gameplay distance.
 */

export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
export const WEB_MERCATOR_PROJECTION_ID = 'WEB_MERCATOR' as const;
export const WEB_MERCATOR_EPSG = 3857;
export const NORMALIZED_WORLD_COORDINATE_SPACE = 'NORMALIZED_WORLD_0_1' as const;
export const WEB_MERCATOR_PROJECTION_VERSION = 1;

export type GeoCoordinateWgs84 = {
  longitude: number;
  latitude: number;
};

export type ProjectedWorldPoint = {
  x: number;
  y: number;
};

export type GeoBoundingBoxWgs84 = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type ProjectedBoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type WebMercatorProjectionMeta = {
  id: typeof WEB_MERCATOR_PROJECTION_ID;
  epsg: typeof WEB_MERCATOR_EPSG;
  coordinateSpace: typeof NORMALIZED_WORLD_COORDINATE_SPACE;
  latitudeClamp: typeof WEB_MERCATOR_MAX_LATITUDE;
  version: typeof WEB_MERCATOR_PROJECTION_VERSION;
  origin: 'top-left';
  wrapping: 'clamped-no-wrap';
};

export const WEB_MERCATOR_PROJECTION_META: WebMercatorProjectionMeta = {
  id: WEB_MERCATOR_PROJECTION_ID,
  epsg: WEB_MERCATOR_EPSG,
  coordinateSpace: NORMALIZED_WORLD_COORDINATE_SPACE,
  latitudeClamp: WEB_MERCATOR_MAX_LATITUDE,
  version: WEB_MERCATOR_PROJECTION_VERSION,
  origin: 'top-left',
  wrapping: 'clamped-no-wrap',
};

function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clampLatitudeWebMercator(latitude: number): number {
  return Math.min(WEB_MERCATOR_MAX_LATITUDE, Math.max(-WEB_MERCATOR_MAX_LATITUDE, latitude));
}

function projectLatitude(latitude: number): number {
  const latRad = (latitude * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return 0.5 - mercN / (2 * Math.PI);
}

/**
 * Dynamic / camera helper: clamps latitude so a single point is always defined.
 * Static country polygons must clip geometrically first — do not use this to flatten rings.
 */
export function projectWgs84ToNormalizedMercator(
  longitude: number,
  latitude: number,
): ProjectedWorldPoint {
  if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
    throw new Error('projectWgs84ToNormalizedMercator: non-finite coordinate');
  }
  const x = (longitude + 180) / 360;
  const y = projectLatitude(clampLatitudeWebMercator(latitude));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('projectWgs84ToNormalizedMercator: produced non-finite world point');
  }
  return { x, y };
}

/**
 * Polygon pipeline projector. Vertices must already lie in the Mercator envelope.
 */
export function projectWgs84ToNormalizedMercatorStrict(
  longitude: number,
  latitude: number,
): ProjectedWorldPoint {
  if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
    throw new Error('projectWgs84ToNormalizedMercatorStrict: non-finite coordinate');
  }
  if (latitude < -WEB_MERCATOR_MAX_LATITUDE || latitude > WEB_MERCATOR_MAX_LATITUDE) {
    throw new Error('projectWgs84ToNormalizedMercatorStrict: latitude outside Mercator envelope (clip first)');
  }
  const x = (longitude + 180) / 360;
  const y = projectLatitude(latitude);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('projectWgs84ToNormalizedMercatorStrict: produced non-finite world point');
  }
  return { x, y };
}

export function unprojectNormalizedMercatorToWgs84(
  x: number,
  y: number,
): GeoCoordinateWgs84 {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    throw new Error('unprojectNormalizedMercatorToWgs84: non-finite world point');
  }
  const longitude = x * 360 - 180;
  const mercN = (0.5 - y) * 2 * Math.PI;
  const latitude = ((2 * Math.atan(Math.exp(mercN)) - Math.PI / 2) * 180) / Math.PI;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error('unprojectNormalizedMercatorToWgs84: produced non-finite WGS84');
  }
  return { longitude, latitude };
}

export function expandProjectedBounds(
  bounds: ProjectedBoundingBox | null,
  point: ProjectedWorldPoint,
): ProjectedBoundingBox {
  if (!bounds) {
    return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  }
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

export function projectedBoundsIntersect(
  a: ProjectedBoundingBox,
  b: ProjectedBoundingBox,
): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
