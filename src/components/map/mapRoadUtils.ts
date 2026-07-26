import {
  MAP_ROAD_SEGMENTS,
  type MapRoadPoint,
} from '../../data/mapRoadNetwork';
import { normalizeCityId } from '../../data/networkPositions';
import { getWorldMapCityPosition } from '../../data/worldMapPositions';

const POINT_EPS = 0.0001;

function pointDistance(a: MapRoadPoint, b: MapRoadPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointsEqual(a: MapRoadPoint, b: MapRoadPoint): boolean {
  return Math.abs(a.x - b.x) < POINT_EPS && Math.abs(a.y - b.y) < POINT_EPS;
}

export function clampProgress(progress: number): number {
  return Math.max(0, Math.min(1, progress));
}

/** 0–1 ve 0–100 progress formatlarını güvenli normalize eder. */
export function normalizeMapDeliveryProgress(progress: number | undefined | null): number {
  if (progress == null || Number.isNaN(Number(progress))) {
    return 0;
  }
  const value = Number(progress);
  if (value > 1) {
    return clampProgress(value / 100);
  }
  return clampProgress(value);
}

export function getTruckPositionAlongRoadRoute(
  roadRoute: MapRoadPoint[],
  progress: number | undefined | null,
): PointAlongPolylineResult {
  return getPointAlongPolyline(roadRoute, normalizeMapDeliveryProgress(progress));
}

export function getPolylineSegmentLengths(points: MapRoadPoint[]): number[] {
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    lengths.push(pointDistance(points[i - 1], points[i]));
  }
  return lengths;
}

export function getPolylineTotalLength(points: MapRoadPoint[]): number {
  return getPolylineSegmentLengths(points).reduce((sum, len) => sum + len, 0);
}

export interface PointAlongPolylineResult {
  point: MapRoadPoint;
  angleRadians: number;
  segmentIndex: number;
}

export function getPointAlongPolyline(
  points: MapRoadPoint[],
  progress: number,
): PointAlongPolylineResult {
  if (points.length === 0) {
    return { point: { x: 0, y: 0 }, angleRadians: 0, segmentIndex: 0 };
  }
  if (points.length === 1) {
    return { point: points[0], angleRadians: 0, segmentIndex: 0 };
  }

  const t = normalizeMapDeliveryProgress(progress);
  const segmentLengths = getPolylineSegmentLengths(points);
  const totalLength = segmentLengths.reduce((sum, len) => sum + len, 0);

  if (totalLength <= 0) {
    return { point: points[0], angleRadians: 0, segmentIndex: 0 };
  }

  let remaining = t * totalLength;

  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];
    if (remaining <= segLen || i === segmentLengths.length - 1) {
      const ratio = segLen > 0 ? remaining / segLen : 0;
      const p0 = points[i];
      const p1 = points[i + 1];
      return {
        point: {
          x: p0.x + (p1.x - p0.x) * ratio,
          y: p0.y + (p1.y - p0.y) * ratio,
        },
        angleRadians: Math.atan2(p1.y - p0.y, p1.x - p0.x),
        segmentIndex: i,
      };
    }
    remaining -= segLen;
  }

  const lastIdx = points.length - 1;
  const p0 = points[lastIdx - 1];
  const p1 = points[lastIdx];
  return {
    point: points[lastIdx],
    angleRadians: Math.atan2(p1.y - p0.y, p1.x - p0.x),
    segmentIndex: lastIdx - 1,
  };
}

export function splitPolylineAtProgress(
  points: MapRoadPoint[],
  progress: number,
): { completedPoints: MapRoadPoint[]; remainingPoints: MapRoadPoint[] } {
  if (points.length === 0) {
    return { completedPoints: [], remainingPoints: [] };
  }
  if (points.length === 1) {
    return { completedPoints: [...points], remainingPoints: [...points] };
  }

  const t = normalizeMapDeliveryProgress(progress);
  if (t <= 0) {
    return { completedPoints: [points[0]], remainingPoints: [...points] };
  }
  if (t >= 1) {
    return { completedPoints: [...points], remainingPoints: [points[points.length - 1]] };
  }

  const { point, segmentIndex } = getPointAlongPolyline(points, t);
  return {
    completedPoints: [...points.slice(0, segmentIndex + 1), point],
    remainingPoints: [point, ...points.slice(segmentIndex + 1)],
  };
}

export function normalizeAngleRadians(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= 2 * Math.PI;
  while (normalized < -Math.PI) normalized += 2 * Math.PI;
  return normalized;
}

export function shortestAngleDelta(from: number, to: number): number {
  const a = normalizeAngleRadians(from);
  const b = normalizeAngleRadians(to);
  let delta = b - a;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

export function getDirectRoadSegment(fromCityId: string, toCityId: string): MapRoadPoint[] | null {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);

  const segment = MAP_ROAD_SEGMENTS.find(
    (item) =>
      (normalizeCityId(item.fromCityId) === from && normalizeCityId(item.toCityId) === to) ||
      (normalizeCityId(item.fromCityId) === to && normalizeCityId(item.toCityId) === from),
  );

  if (!segment) return null;

  const forward = normalizeCityId(segment.fromCityId) === from;
  return forward ? [...segment.points] : [...segment.points].reverse();
}

interface RoadEdge {
  toCityId: string;
  weight: number;
  points: MapRoadPoint[];
}

function buildRoadAdjacency(): Map<string, RoadEdge[]> {
  const adjacency = new Map<string, RoadEdge[]>();

  const addEdge = (fromCityId: string, toCityId: string, points: MapRoadPoint[]) => {
    const weight = getPolylineTotalLength(points);
    const edges = adjacency.get(fromCityId) ?? [];
    edges.push({ toCityId, weight, points: [...points] });
    adjacency.set(fromCityId, edges);
  };

  for (const segment of MAP_ROAD_SEGMENTS) {
    const from = normalizeCityId(segment.fromCityId);
    const to = normalizeCityId(segment.toCityId);
    addEdge(from, to, segment.points);
    addEdge(to, from, [...segment.points].reverse());
  }

  return adjacency;
}

let cachedAdjacency: Map<string, RoadEdge[]> | null = null;

export function getRoadGraphAdjacency(): Map<string, RoadEdge[]> {
  if (!cachedAdjacency) {
    cachedAdjacency = buildRoadAdjacency();
  }
  return cachedAdjacency;
}

function mergeRoutePointLists(chunks: MapRoadPoint[][]): MapRoadPoint[] {
  const merged: MapRoadPoint[] = [];
  for (const chunk of chunks) {
    for (const point of chunk) {
      const last = merged[merged.length - 1];
      if (last && pointsEqual(last, point)) continue;
      merged.push(point);
    }
  }
  return merged;
}

/** Dijkstra — kenar ağırlığı polyline toplam normalize uzunluğu. */
export function getRoadRoute(fromCityId: string, toCityId: string): MapRoadPoint[] | null {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);

  if (from === to) {
    const pos = getWorldMapCityPosition(from);
    return pos ? [{ x: pos.x, y: pos.y }] : null;
  }

  const direct = getDirectRoadSegment(from, to);
  if (direct) return direct;

  const adjacency = getRoadGraphAdjacency();
  const distances = new Map<string, number>();
  const previous = new Map<string, { cityId: string; points: MapRoadPoint[] } | null>();
  const unvisited = new Set<string>();

  for (const cityId of adjacency.keys()) {
    distances.set(cityId, Infinity);
    previous.set(cityId, null);
    unvisited.add(cityId);
  }

  if (!unvisited.has(from) || !unvisited.has(to)) {
    return null;
  }

  distances.set(from, 0);

  while (unvisited.size > 0) {
    let current: string | null = null;
    let bestDistance = Infinity;

    for (const cityId of unvisited) {
      const dist = distances.get(cityId) ?? Infinity;
      if (dist < bestDistance) {
        bestDistance = dist;
        current = cityId;
      }
    }

    if (current == null || bestDistance === Infinity) break;

    if (current === to) break;

    unvisited.delete(current);

    for (const edge of adjacency.get(current) ?? []) {
      if (!unvisited.has(edge.toCityId)) continue;
      const alt = (distances.get(current) ?? Infinity) + edge.weight;
      if (alt < (distances.get(edge.toCityId) ?? Infinity)) {
        distances.set(edge.toCityId, alt);
        previous.set(edge.toCityId, { cityId: current, points: edge.points });
      }
    }
  }

  if ((distances.get(to) ?? Infinity) === Infinity) {
    return null;
  }

  const pathChunks: MapRoadPoint[][] = [];
  let cursor: string | null = to;

  while (cursor != null && cursor !== from) {
    const step = previous.get(cursor);
    if (!step) return null;
    pathChunks.unshift(step.points);
    cursor = step.cityId;
  }

  const route = mergeRoutePointLists(pathChunks);

  const originPos = getWorldMapCityPosition(from);
  const destPos = getWorldMapCityPosition(to);
  if (!originPos || !destPos || route.length === 0) return null;

  route[0] = { x: originPos.x, y: originPos.y };
  route[route.length - 1] = { x: destPos.x, y: destPos.y };

  return route;
}

export interface MapBounds {
  width: number;
  height: number;
}

export function normalizedPointToPixel(
  point: MapRoadPoint,
  bounds: MapBounds,
): { x: number; y: number } {
  return { x: point.x * bounds.width, y: point.y * bounds.height };
}

export function polylineToSvgPath(points: MapRoadPoint[], bounds: MapBounds): string {
  if (points.length === 0) return '';
  const first = normalizedPointToPixel(points[0], bounds);
  let path = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const pixel = normalizedPointToPixel(points[i], bounds);
    path += ` L ${pixel.x} ${pixel.y}`;
  }
  return path;
}
