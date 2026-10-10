import { WEB_MERCATOR_MAX_LATITUDE } from './webMercator';

export type LonLat = [number, number];

const EPS = 1e-12;

function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

export function dropClosingVertex(ring: LonLat[]): LonLat[] {
  if (ring.length < 2) return ring.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (nearly(first[0], last[0]) && nearly(first[1], last[1])) {
    return ring.slice(0, -1);
  }
  return ring.slice();
}

export function closeLonLatRing(ring: LonLat[]): LonLat[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (nearly(first[0], last[0]) && nearly(first[1], last[1])) return ring;
  return [...ring, [first[0], first[1]]];
}

function lerp(a: LonLat, b: LonLat, t: number): LonLat {
  const u = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

function sutherlandHodgman(
  ring: LonLat[],
  inside: (point: LonLat) => boolean,
  intersect: (a: LonLat, b: LonLat) => LonLat,
): LonLat[] {
  const input = dropClosingVertex(ring);
  if (input.length < 3) return [];
  const output: LonLat[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const current = input[i];
    const previous = input[(i + input.length - 1) % input.length];
    const currentIn = inside(current);
    const previousIn = inside(previous);
    if (currentIn) {
      if (!previousIn) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousIn) {
      output.push(intersect(previous, current));
    }
  }
  return output;
}

function intersectAtLatitude(a: LonLat, b: LonLat, latitude: number): LonLat {
  const dy = b[1] - a[1];
  if (Math.abs(dy) < EPS) return [a[0], latitude];
  return lerp(a, b, (latitude - a[1]) / dy);
}

function intersectAtLongitude(a: LonLat, b: LonLat, longitude: number): LonLat {
  const dx = b[0] - a[0];
  if (Math.abs(dx) < EPS) return [longitude, a[1]];
  return lerp(a, b, (longitude - a[0]) / dx);
}

/**
 * Geometric clip against the Web Mercator latitude envelope.
 * Does not clamp vertices independently.
 */
export function clipRingToMercatorLatitude(
  ring: LonLat[],
  maxAbsLat = WEB_MERCATOR_MAX_LATITUDE,
): LonLat[] {
  const south = sutherlandHodgman(
    ring,
    (point) => point[1] >= -maxAbsLat,
    (a, b) => intersectAtLatitude(a, b, -maxAbsLat),
  );
  const clipped = sutherlandHodgman(
    south,
    (point) => point[1] <= maxAbsLat,
    (a, b) => intersectAtLatitude(a, b, maxAbsLat),
  );
  if (clipped.length < 3) return [];
  return closeLonLatRing(clipped);
}

export function unwrapRingLongitudes(ring: LonLat[]): LonLat[] {
  const open = dropClosingVertex(ring);
  if (open.length === 0) return [];
  const out: LonLat[] = [[open[0][0], open[0][1]]];
  for (let i = 1; i < open.length; i += 1) {
    let lon = open[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (prev - lon > 180) lon += 360;
    out.push([lon, open[i][1]]);
  }
  return closeLonLatRing(out);
}

export function clipRingToLonWindow(ring: LonLat[], west: number, east: number): LonLat[] {
  const eastClip = sutherlandHodgman(
    ring,
    (point) => point[0] <= east,
    (a, b) => intersectAtLongitude(a, b, east),
  );
  const westClip = sutherlandHodgman(
    eastClip,
    (point) => point[0] >= west,
    (a, b) => intersectAtLongitude(a, b, west),
  );
  if (westClip.length < 3) return [];
  return closeLonLatRing(westClip);
}

function normalizePrincipalLongitude(lon: number): number {
  let value = lon;
  while (value < -180) value += 360;
  while (value > 180) value -= 360;
  return value;
}

/**
 * Deterministic dateline split: unwrap, clip to each 360° world copy, then
 * fold back to [-180, 180]. No infinite wrapping.
 */
export function splitRingAtDateline(ring: LonLat[]): LonLat[][] {
  const unwrapped = unwrapRingLongitudes(ring);
  const open = dropClosingVertex(unwrapped);
  if (open.length < 3) return [];
  const lons = open.map((point) => point[0]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  if (maxLon - minLon < 180 && minLon >= -180 && maxLon <= 180) {
    return [closeLonLatRing(open)];
  }
  const kStart = Math.floor((minLon + 180) / 360);
  const kEnd = Math.floor((maxLon + 180) / 360);
  const parts: LonLat[][] = [];
  for (let k = kStart; k <= kEnd; k += 1) {
    const west = -180 + k * 360;
    const east = 180 + k * 360;
    const clipped = clipRingToLonWindow(unwrapped, west, east);
    const body = dropClosingVertex(clipped);
    if (body.length < 3) continue;
    const normalized = body.map(
      ([lon, lat]) => [normalizePrincipalLongitude(lon - k * 360), lat] as LonLat,
    );
    parts.push(closeLonLatRing(normalized));
  }
  return parts;
}

export function prepareWgs84RingForMercator(ring: LonLat[]): LonLat[][] {
  const clipped = clipRingToMercatorLatitude(ring);
  if (clipped.length < 4) return [];
  return splitRingAtDateline(clipped).filter((part) => dropClosingVertex(part).length >= 3);
}
