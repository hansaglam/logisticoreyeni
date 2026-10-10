import type { GeoCoordinateWgs84 } from './webMercator';

const EARTH_RADIUS_METERS = 6371000;

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle length on WGS84 degrees. Not projected world distance. Not ROUTES.distanceKm. */
export function haversineMeters(a: GeoCoordinateWgs84, b: GeoCoordinateWgs84): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function polylineLengthMeters(coords: GeoCoordinateWgs84[]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i += 1) {
    sum += haversineMeters(coords[i - 1], coords[i]);
  }
  return sum;
}
