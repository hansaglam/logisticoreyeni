import type { GeoCoordinateWgs84 } from './webMercator';
import { haversineMeters } from './wgs84Distance';

export const GEODESIC_ALGORITHM_VERSION = 'map-v2-spherical-slerp-v1' as const;
export const AIR_GEODESIC_SAMPLE_METERS = 40_000;
export const AIR_GEODESIC_MIN_VERTICES = 8;
export const AIR_GEODESIC_MAX_VERTICES = 32;

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

type Vec3 = { x: number; y: number; z: number };

function lonLatToVec(point: GeoCoordinateWgs84): Vec3 {
  const lon = toRad(point.longitude);
  const lat = toRad(point.latitude);
  const cosLat = Math.cos(lat);
  return { x: cosLat * Math.cos(lon), y: cosLat * Math.sin(lon), z: Math.sin(lat) };
}

function vecToLonLat(vec: Vec3): GeoCoordinateWgs84 {
  const length = Math.hypot(vec.x, vec.y, vec.z) || 1;
  const x = vec.x / length;
  const y = vec.y / length;
  const z = vec.z / length;
  return {
    longitude: toDeg(Math.atan2(y, x)),
    latitude: toDeg(Math.asin(Math.max(-1, Math.min(1, z)))),
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function scale(vec: Vec3, k: number): Vec3 {
  return { x: vec.x * k, y: vec.y * k, z: vec.z * k };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Spherical interpolation on the unit sphere. t=0 → from, t=1 → to. */
export function interpolateGeodesic(from: GeoCoordinateWgs84, to: GeoCoordinateWgs84, t: number): GeoCoordinateWgs84 {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const u = lonLatToVec(from);
  const v = lonLatToVec(to);
  const cosOmega = Math.max(-1, Math.min(1, dot(u, v)));
  const omega = Math.acos(cosOmega);
  if (omega < 1e-12) return from;
  const sinOmega = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / sinOmega;
  const b = Math.sin(t * omega) / sinOmega;
  return vecToLonLat(add(scale(u, a), scale(v, b)));
}

export function sampleGeodesicPolyline(
  from: GeoCoordinateWgs84,
  to: GeoCoordinateWgs84,
  sampleMeters = AIR_GEODESIC_SAMPLE_METERS,
): GeoCoordinateWgs84[] {
  const distance = haversineMeters(from, to);
  if (!Number.isFinite(distance) || distance < 1) return [from];
  const byInterval = Math.round(distance / sampleMeters) + 1;
  const vertices = Math.max(AIR_GEODESIC_MIN_VERTICES, Math.min(AIR_GEODESIC_MAX_VERTICES, byInterval));
  const out: GeoCoordinateWgs84[] = [];
  for (let i = 0; i < vertices; i += 1) {
    out.push(interpolateGeodesic(from, to, i / (vertices - 1)));
  }
  return out;
}
