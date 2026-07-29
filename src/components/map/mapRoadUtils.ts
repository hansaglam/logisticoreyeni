import { getResolvedMapDebugFlags } from '../../config/debug';
import { debugLog, debugWarn } from '../../utils/debugLog';
import {
  buildMapRoadSegmentCheck,
  findDuplicateMapRoadCityPairs,
  findDuplicateMapRoadSegmentIds,
  isMapRoadSegmentRoutable,
  isValidMapRoadPoint,
  MAP_ROAD_SEGMENTS,
  type MapRoadPoint,
  type MapRoadSegment,
} from '../../data/mapRoadNetwork';
import { normalizeCityId } from '../../data/networkPositions';
import { getWorldMapCityPosition } from '../../data/worldMapPositions';

const POINT_EPS = 0.0001;
export const DEFAULT_ROUTE_HEADING_LOOK_AHEAD_DISTANCE = 0.008;

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
  options?: RouteSamplingOptions,
): PointAlongPolylineResult {
  return getPointAlongPolyline(roadRoute, normalizeMapDeliveryProgress(progress), options);
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
  headingDeg: number;
  segmentIndex: number;
}

interface PolylineMetrics {
  segmentLengths: number[];
  totalLength: number;
}

function getPolylineMetrics(points: MapRoadPoint[]): PolylineMetrics {
  const segmentLengths = getPolylineSegmentLengths(points);
  return {
    segmentLengths,
    totalLength: segmentLengths.reduce((sum, length) => sum + length, 0),
  };
}

function getPointAtPolylineDistance(
  points: MapRoadPoint[],
  metrics: PolylineMetrics,
  distance: number,
): Pick<PointAlongPolylineResult, 'point' | 'segmentIndex'> {
  if (points.length === 0) {
    return { point: { x: 0, y: 0 }, segmentIndex: 0 };
  }
  if (points.length === 1 || metrics.totalLength <= POINT_EPS) {
    return { point: points[0], segmentIndex: 0 };
  }

  const targetDistance = Math.max(0, Math.min(metrics.totalLength, distance));
  const firstValidSegment = metrics.segmentLengths.findIndex((length) => length > POINT_EPS);
  let lastValidSegment = firstValidSegment >= 0 ? firstValidSegment : 0;
  for (let index = metrics.segmentLengths.length - 1; index >= 0; index -= 1) {
    if (metrics.segmentLengths[index] > POINT_EPS) {
      lastValidSegment = index;
      break;
    }
  }

  if (targetDistance <= 0) {
    return { point: points[0], segmentIndex: firstValidSegment >= 0 ? firstValidSegment : 0 };
  }
  if (targetDistance >= metrics.totalLength) {
    return { point: points[points.length - 1], segmentIndex: lastValidSegment };
  }

  let traversed = 0;
  for (let index = 0; index < metrics.segmentLengths.length; index += 1) {
    const segmentLength = metrics.segmentLengths[index];
    if (segmentLength <= POINT_EPS) continue;

    if (targetDistance <= traversed + segmentLength) {
      const ratio = Math.max(0, Math.min(1, (targetDistance - traversed) / segmentLength));
      const start = points[index];
      const end = points[index + 1];
      return {
        point: {
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
        },
        segmentIndex: index,
      };
    }
    traversed += segmentLength;
  }

  return { point: points[points.length - 1], segmentIndex: lastValidSegment };
}

function normalizeHeadingDegrees(headingDeg: number): number {
  if (!Number.isFinite(headingDeg)) return 0;
  let normalized = headingDeg;
  while (normalized > 180) normalized -= 360;
  while (normalized <= -180) normalized += 360;
  return normalized;
}

export interface RouteHeadingAtProgressParams {
  points: MapRoadPoint[];
  progress: number | undefined | null;
  lookAheadDistance?: number;
  fallbackHeadingDeg?: number;
  coordinateScaleX?: number;
  coordinateScaleY?: number;
}

export type RouteSamplingOptions = Omit<RouteHeadingAtProgressParams, 'points' | 'progress'>;

function getRouteHeadingWithMetrics(
  params: RouteHeadingAtProgressParams,
  metrics: PolylineMetrics,
): number {
  const fallbackHeadingDeg = normalizeHeadingDegrees(params.fallbackHeadingDeg ?? 0);
  if (params.points.length < 2 || metrics.totalLength <= POINT_EPS) {
    return fallbackHeadingDeg;
  }

  const progress = normalizeMapDeliveryProgress(params.progress);
  const centerDistance = progress * metrics.totalLength;
  const requestedLookAhead = Number(params.lookAheadDistance);
  const lookAheadDistance =
    Number.isFinite(requestedLookAhead) && requestedLookAhead > POINT_EPS
      ? requestedLookAhead
      : DEFAULT_ROUTE_HEADING_LOOK_AHEAD_DISTANCE;
  const beforeDistance = Math.max(0, centerDistance - lookAheadDistance);
  const afterDistance = Math.min(metrics.totalLength, centerDistance + lookAheadDistance);
  const previous = getPointAtPolylineDistance(params.points, metrics, beforeDistance).point;
  const next = getPointAtPolylineDistance(params.points, metrics, afterDistance).point;
  const coordinateScaleX =
    Number.isFinite(params.coordinateScaleX) && Number(params.coordinateScaleX) > 0
      ? Number(params.coordinateScaleX)
      : 1;
  const coordinateScaleY =
    Number.isFinite(params.coordinateScaleY) && Number(params.coordinateScaleY) > 0
      ? Number(params.coordinateScaleY)
      : 1;
  const dx = (next.x - previous.x) * coordinateScaleX;
  const dy = (next.y - previous.y) * coordinateScaleY;

  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) <= POINT_EPS) {
    return fallbackHeadingDeg;
  }

  // React Native ekran koordinatlarında Y aşağı doğru arttığı için atan2(dy, dx) doğrudur.
  const headingDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return Number.isFinite(headingDeg) ? normalizeHeadingDegrees(headingDeg) : fallbackHeadingDeg;
}

export function getRouteHeadingAtProgress(params: RouteHeadingAtProgressParams): number {
  return getRouteHeadingWithMetrics(params, getPolylineMetrics(params.points));
}

export function getPointAlongPolyline(
  points: MapRoadPoint[],
  progress: number,
  options?: RouteSamplingOptions,
): PointAlongPolylineResult {
  if (points.length === 0) {
    const headingDeg = normalizeHeadingDegrees(options?.fallbackHeadingDeg ?? 0);
    return { point: { x: 0, y: 0 }, angleRadians: (headingDeg * Math.PI) / 180, headingDeg, segmentIndex: 0 };
  }
  if (points.length === 1) {
    const headingDeg = normalizeHeadingDegrees(options?.fallbackHeadingDeg ?? 0);
    return { point: points[0], angleRadians: (headingDeg * Math.PI) / 180, headingDeg, segmentIndex: 0 };
  }

  const t = normalizeMapDeliveryProgress(progress);
  const metrics = getPolylineMetrics(points);
  const position = getPointAtPolylineDistance(points, metrics, t * metrics.totalLength);
  const headingDeg = getRouteHeadingWithMetrics(
    {
      points,
      progress: t,
      lookAheadDistance: options?.lookAheadDistance,
      fallbackHeadingDeg: options?.fallbackHeadingDeg,
      coordinateScaleX: options?.coordinateScaleX,
      coordinateScaleY: options?.coordinateScaleY,
    },
    metrics,
  );
  return {
    ...position,
    angleRadians: (headingDeg * Math.PI) / 180,
    headingDeg,
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

export function findDirectRoadSegment(
  fromCityId: string,
  toCityId: string,
): MapRoadSegment | null {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);

  const matches = MAP_ROAD_SEGMENTS.filter(
    (item) =>
      (normalizeCityId(item.fromCityId) === from && normalizeCityId(item.toCityId) === to) ||
      (normalizeCityId(item.fromCityId) === to && normalizeCityId(item.toCityId) === from),
  );

  if (matches.length === 0) {
    return null;
  }

  const routable = matches.filter(isMapRoadSegmentRoutable);
  if (routable.length === 0) {
    return null;
  }

  if (routable.length > 1) {
    debugWarn(getResolvedMapDebugFlags().roadWarnings, '[map-road] duplicate city pair segments — using first routable', {
      from,
      to,
      segmentIds: routable.map((segment) => segment.id),
    });
  }

  return routable[0] ?? null;
}

export function orientRoadSegmentPoints(
  segment: MapRoadSegment,
  fromCityId: string,
  toCityId: string,
): MapRoadPoint[] {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);
  const segFrom = normalizeCityId(segment.fromCityId);
  const segTo = normalizeCityId(segment.toCityId);
  const points = [...segment.points];

  if (points.length < 2) {
    return points;
  }

  if (from === segFrom && to === segTo) {
    return points;
  }
  if (from === segTo && to === segFrom) {
    return [...points].reverse();
  }

  return orientSegmentPointsByDistance(points, from, to);
}

function orientSegmentPointsByDistance(
  points: MapRoadPoint[],
  fromCityId: string,
  toCityId: string,
): MapRoadPoint[] {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);

  const forwardScore =
    pointDistanceToCity(points[0], from) + pointDistanceToCity(points[points.length - 1], to);
  const reverseScore =
    pointDistanceToCity(points[points.length - 1], from) + pointDistanceToCity(points[0], to);

  if (reverseScore < forwardScore) {
    return [...points].reverse();
  }

  return points;
}

/** @deprecated Use orientRoadSegmentPoints — kept for existing imports. */
export function orientSegmentPoints(
  segment: MapRoadSegment,
  fromCityId: string,
  toCityId: string,
): MapRoadPoint[] {
  return orientRoadSegmentPoints(segment, fromCityId, toCityId);
}

/** Normalize mesafe — şehir merkezi ile yol bağlantı noktası arası tolerans */
export const MAP_ROAD_ENDPOINT_TOLERANCE = 0.18;

function pointDistanceToCity(point: MapRoadPoint, cityId: string): number {
  const city = getWorldMapCityPosition(cityId);
  if (!city) {
    return Infinity;
  }
  return pointDistance(point, city);
}

export interface MapRoadEndpointCheck {
  segmentId: string;
  fromCityId: string;
  toCityId: string;
  firstPoint: MapRoadPoint;
  lastPoint: MapRoadPoint;
  fromCityPosition: MapRoadPoint | null;
  toCityPosition: MapRoadPoint | null;
  firstDistanceToFromCity: number;
  lastDistanceToToCity: number;
}

export function buildMapRoadEndpointCheck(
  segment: MapRoadSegment,
  orientedPoints: MapRoadPoint[],
): MapRoadEndpointCheck {
  const fromCityPosition = getWorldMapCityPosition(segment.fromCityId);
  const toCityPosition = getWorldMapCityPosition(segment.toCityId);
  const firstPoint = orientedPoints[0];
  const lastPoint = orientedPoints[orientedPoints.length - 1];

  return {
    segmentId: segment.id,
    fromCityId: segment.fromCityId,
    toCityId: segment.toCityId,
    firstPoint,
    lastPoint,
    fromCityPosition: fromCityPosition
      ? { x: fromCityPosition.x, y: fromCityPosition.y }
      : null,
    toCityPosition: toCityPosition ? { x: toCityPosition.x, y: toCityPosition.y } : null,
    firstDistanceToFromCity: pointDistanceToCity(firstPoint, segment.fromCityId),
    lastDistanceToToCity: pointDistanceToCity(lastPoint, segment.toCityId),
  };
}

export function logMapRoadEndpointCheck(
  segment: MapRoadSegment,
  orientedPoints: MapRoadPoint[],
  routeFromCityId: string,
  routeToCityId: string,
): MapRoadEndpointCheck {
  const check = buildMapRoadEndpointCheck(segment, orientedPoints);
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return check;
  }

  const flags = getResolvedMapDebugFlags();
  const from = normalizeCityId(routeFromCityId);
  const to = normalizeCityId(routeToCityId);
  const routeOrientedCheck = {
    ...check,
    routeFromCityId: from,
    routeToCityId: to,
    firstDistanceToRouteFrom: pointDistanceToCity(check.firstPoint, from),
    lastDistanceToRouteTo: pointDistanceToCity(check.lastPoint, to),
  };

  debugLog(flags.roadEndpoint, '[map-road-endpoint-check]', routeOrientedCheck);

  if (
    routeOrientedCheck.firstDistanceToRouteFrom > MAP_ROAD_ENDPOINT_TOLERANCE ||
    routeOrientedCheck.lastDistanceToRouteTo > MAP_ROAD_ENDPOINT_TOLERANCE
  ) {
    debugWarn(flags.roadWarnings, '[map-road] segment endpoint mismatch', routeOrientedCheck);
  }

  return check;
}

export function getDirectRoadSegment(fromCityId: string, toCityId: string): MapRoadPoint[] | null {
  const segment = findDirectRoadSegment(fromCityId, toCityId);
  if (!segment) {
    return null;
  }
  return orientRoadSegmentPoints(segment, fromCityId, toCityId);
}

interface RoadEdge {
  toCityId: string;
  weight: number;
  points: MapRoadPoint[];
  segmentId: string;
}

function getRoadNetworkFingerprint(): string {
  return MAP_ROAD_SEGMENTS.map((segment) => {
    const coords = segment.points.map((point) => `${point.x},${point.y}`).join(';');
    return `${segment.id}:${segment.fromCityId}:${segment.toCityId}:${
      segment.isCalibrated === false ? 0 : 1
    }:${segment.points.length}:${coords}`;
  }).join('|');
}

function logDuplicateCityPairsInDev(): void {
  const flags = getResolvedMapDebugFlags();
  if (!flags.roadWarnings) {
    return;
  }

  const duplicatePairs = findDuplicateMapRoadCityPairs();
  for (const [pair, segmentIds] of duplicatePairs.entries()) {
    if (segmentIds.length > 1) {
      debugWarn(true, '[map-road] duplicate city pair in catalog', {
        pair,
        segmentIds,
      });
    }
  }
}

function buildRoadAdjacency(): Map<string, RoadEdge[]> {
  logDuplicateCityPairsInDev();

  const adjacency = new Map<string, RoadEdge[]>();
  const duplicateIds = findDuplicateMapRoadSegmentIds();

  const addEdge = (
    fromCityId: string,
    toCityId: string,
    points: MapRoadPoint[],
    segmentId: string,
  ) => {
    const weight = getPolylineTotalLength(points);
    const edges = adjacency.get(fromCityId) ?? [];
    edges.push({ toCityId, weight, points: [...points], segmentId });
    adjacency.set(fromCityId, edges);
  };

  for (const segment of MAP_ROAD_SEGMENTS) {
    const from = normalizeCityId(segment.fromCityId);
    const to = normalizeCityId(segment.toCityId);
    const routable = isMapRoadSegmentRoutable(segment);
    const flags = getResolvedMapDebugFlags();

    if (routable) {
      const forwardPoints = orientRoadSegmentPoints(segment, from, to);
      const reversePoints = orientRoadSegmentPoints(segment, to, from);
      addEdge(from, to, forwardPoints, segment.id);
      addEdge(to, from, reversePoints, segment.id);
    }

    if (flags.roadSegment) {
      const includedInGraph =
        routable &&
        (adjacency.get(from) ?? []).some((edge) => edge.toCityId === to);
      debugLog(
        true,
        '[map-road-segment-check]',
        buildMapRoadSegmentCheck(segment, includedInGraph, duplicateIds),
      );
    }

    if (flags.roadGraph) {
      debugLog(true, '[road-graph-segment]', {
        id: segment.id,
        isCalibrated: segment.isCalibrated !== false,
        pointCount: segment.points.length,
        includedInGraph: routable,
        fromCityId: from,
        toCityId: to,
      });
    }
  }

  return adjacency;
}

let cachedAdjacency: Map<string, RoadEdge[]> | null = null;
let cachedFingerprint: string | null = null;

export function invalidateRoadGraphCache(): void {
  cachedAdjacency = null;
  cachedFingerprint = null;
}

export function isRoadGraphPairConnected(fromCityId: string, toCityId: string): boolean {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);
  if (from === to) {
    return true;
  }
  const route = getRoadRoute(from, to);
  return route != null && route.length >= 2;
}

export function getRoadGraphAdjacency(): Map<string, RoadEdge[]> {
  const fingerprint = getRoadNetworkFingerprint();
  if (!cachedAdjacency || cachedFingerprint !== fingerprint) {
    cachedAdjacency = buildRoadAdjacency();
    cachedFingerprint = fingerprint;
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

export type RoadRouteResolutionKind = 'direct' | 'graph' | 'not-found';

export interface RoadRouteResolution {
  from: string;
  to: string;
  resolution: RoadRouteResolutionKind;
  segmentIds: string[];
  pointCount: number;
  totalLength: number;
  firstPoint?: MapRoadPoint;
  lastPoint?: MapRoadPoint;
}

const loggedRouteResolutions = new Set<string>();

export function logRoadRouteResolutionOnce(resolution: RoadRouteResolution): void {
  if (!getResolvedMapDebugFlags().roadResolution) {
    return;
  }

  const key = `${resolution.from}|${resolution.to}|${resolution.resolution}|${resolution.segmentIds.join(',')}`;
  if (loggedRouteResolutions.has(key)) {
    return;
  }
  loggedRouteResolutions.add(key);
  debugLog(true, '[map-road-route-resolution]', resolution);
}

export function resetRoadRouteResolutionLogsForTests(): void {
  loggedRouteResolutions.clear();
  invalidateRoadGraphCache();
}

export interface MapRoadRouteIntegrityCheck {
  fromCityId: string;
  toCityId: string;
  resolution: RoadRouteResolution['resolution'];
  segmentIds: string[];
  firstPoint: MapRoadPoint | undefined;
  lastPoint: MapRoadPoint | undefined;
  firstDistanceToOrigin: number;
  lastDistanceToDestination: number;
  valid: boolean;
}

export function buildMapRoadRouteIntegrityCheck(
  fromCityId: string,
  toCityId: string,
  route: MapRoadPoint[] | null,
  resolution: RoadRouteResolution,
): MapRoadRouteIntegrityCheck {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);
  const firstPoint = route?.[0];
  const lastPoint = route && route.length > 0 ? route[route.length - 1] : undefined;
  const firstDistanceToOrigin = firstPoint ? pointDistanceToCity(firstPoint, from) : Infinity;
  const lastDistanceToDestination = lastPoint ? pointDistanceToCity(lastPoint, to) : Infinity;
  const valid =
    route != null &&
    route.length >= 1 &&
    firstDistanceToOrigin <= MAP_ROAD_ENDPOINT_TOLERANCE &&
    lastDistanceToDestination <= MAP_ROAD_ENDPOINT_TOLERANCE;

  return {
    fromCityId: from,
    toCityId: to,
    resolution: resolution.resolution,
    segmentIds: resolution.segmentIds,
    firstPoint,
    lastPoint,
    firstDistanceToOrigin,
    lastDistanceToDestination,
    valid,
  };
}

function logMapRoadRouteIntegrity(
  fromCityId: string,
  toCityId: string,
  route: MapRoadPoint[] | null,
  resolution: RoadRouteResolution,
): MapRoadRouteIntegrityCheck {
  const check = buildMapRoadRouteIntegrityCheck(fromCityId, toCityId, route, resolution);
  const flags = getResolvedMapDebugFlags();
  if (!flags.roadResolution && !flags.roadEndpoint) {
    return check;
  }

  debugLog(flags.roadResolution, '[map-road-route-integrity]', check);
  if (!check.valid && route != null) {
    debugWarn(flags.roadWarnings, '[map-road] route endpoint mismatch', check);
  }
  return check;
}

function findGraphRoadRoute(fromCityId: string, toCityId: string): {
  route: MapRoadPoint[] | null;
  segmentIds: string[];
} {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);
  const adjacency = getRoadGraphAdjacency();
  const distances = new Map<string, number>();
  const previous = new Map<string, { cityId: string; points: MapRoadPoint[]; segmentId: string } | null>();
  const unvisited = new Set<string>();

  for (const cityId of adjacency.keys()) {
    distances.set(cityId, Infinity);
    previous.set(cityId, null);
    unvisited.add(cityId);
  }

  if (!unvisited.has(from) || !unvisited.has(to)) {
    return { route: null, segmentIds: [] };
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
        previous.set(edge.toCityId, {
          cityId: current,
          points: edge.points,
          segmentId: edge.segmentId,
        });
      }
    }
  }

  if ((distances.get(to) ?? Infinity) === Infinity) {
    return { route: null, segmentIds: [] };
  }

  const pathChunks: MapRoadPoint[][] = [];
  const segmentIds: string[] = [];
  let cursor: string | null = to;

  while (cursor != null && cursor !== from) {
    const step = previous.get(cursor);
    if (!step) return { route: null, segmentIds: [] };
    pathChunks.unshift(step.points);
    segmentIds.unshift(step.segmentId);
    cursor = step.cityId;
  }

  const route = mergeRoutePointLists(pathChunks);
  const originPos = getWorldMapCityPosition(from);
  const destPos = getWorldMapCityPosition(to);
  if (!originPos || !destPos || route.length === 0) {
    return { route: null, segmentIds: [] };
  }

  route[0] = { x: originPos.x, y: originPos.y };
  route[route.length - 1] = { x: destPos.x, y: destPos.y };

  return { route, segmentIds };
}

export function resolveRoadRoute(fromCityId: string, toCityId: string): {
  route: MapRoadPoint[] | null;
  resolution: RoadRouteResolution;
} {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);

  if (from === to) {
    const pos = getWorldMapCityPosition(from);
    const route = pos ? [{ x: pos.x, y: pos.y }] : null;
    const resolution: RoadRouteResolution = {
      from,
      to,
      resolution: route ? 'direct' : 'not-found',
      segmentIds: [],
      pointCount: route?.length ?? 0,
      totalLength: 0,
    };
    return { route, resolution };
  }

  const directSegment = findDirectRoadSegment(from, to);
  if (directSegment) {
    const route = orientRoadSegmentPoints(directSegment, from, to);
    logMapRoadEndpointCheck(directSegment, route, from, to);
    const resolution: RoadRouteResolution = {
      from,
      to,
      resolution: 'direct',
      segmentIds: [directSegment.id],
      pointCount: route.length,
      totalLength: getPolylineTotalLength(route),
      firstPoint: route[0],
      lastPoint: route[route.length - 1],
    };
    logMapRoadRouteIntegrity(from, to, route, resolution);
    return { route, resolution };
  }

  const graphResult = findGraphRoadRoute(from, to);
  if (graphResult.route) {
    const resolution: RoadRouteResolution = {
      from,
      to,
      resolution: 'graph',
      segmentIds: graphResult.segmentIds,
      pointCount: graphResult.route.length,
      totalLength: getPolylineTotalLength(graphResult.route),
      firstPoint: graphResult.route[0],
      lastPoint: graphResult.route[graphResult.route.length - 1],
    };
    logMapRoadRouteIntegrity(from, to, graphResult.route, resolution);
    return { route: graphResult.route, resolution };
  }

  const resolution: RoadRouteResolution = {
    from,
    to,
    resolution: 'not-found',
    segmentIds: [],
    pointCount: 0,
    totalLength: 0,
  };
  return { route: null, resolution };
}

/** Direct segment öncelikli; yoksa Dijkstra graph routing. */
export function getRoadRoute(fromCityId: string, toCityId: string): MapRoadPoint[] | null {
  const { route, resolution } = resolveRoadRoute(fromCityId, toCityId);
  logRoadRouteResolutionOnce(resolution);
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

export { isValidMapRoadPoint };
