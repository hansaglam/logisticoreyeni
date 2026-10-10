/**
 * OSM RAIL ingest core. Fail-closed: no invented track. Topology identity is WGS84 7 d.p.,
 * independent of render quantization. Way/node OSM IDs used when `@id`+`@type` exist.
 */
import { createHash } from 'node:crypto';

import {
  isExcludedOsmRailway,
  isLogisticsOsmRailway,
  isOsmRailStationTag,
  isOsmRailTerminalTag,
  isRailServiceDetail,
  RAIL_CLASS_POLICY_ID,
} from '../../src/mapV2/geo/railClassPolicy';
import { RAIL_LOD_POLICY_ID, RAIL_SIMPLIFY_TOLERANCE, railLodForAttributes } from '../../src/mapV2/geo/railLodPolicy';
import { simplifyOpenPolyline } from '../../src/mapV2/geo/simplifyPolyline';
import { projectLineString, quantizeProjectedPoint } from '../../src/mapV2/geo/transportGeometry';
import type {
  CityTransportAccess,
  GeoTransportEdgeRecord,
  GeoTransportNetworkPackageV1,
  GeoTransportNodeKindRuntime,
  GeoTransportNodeRecord,
} from '../../src/mapV2/geo/transportNetwork';
import { TRANSPORT_NETWORK_SCHEMA_VERSION, WEB_MERCATOR_TRANSPORT_PROJECTION } from '../../src/mapV2/geo/transportNetwork';
import { measureConnectivity, validateTransportNetwork } from '../../src/mapV2/geo/validateTransportNetwork';
import { pointInProjectedPolygons, type ProjectedPolygon } from '../../src/mapV2/geo/geometry';
import { projectWgs84ToNormalizedMercator, WEB_MERCATOR_PROJECTION_VERSION, type GeoCoordinateWgs84, type ProjectedBoundingBox } from '../../src/mapV2/geo/webMercator';
import { buildRailComponents } from '../../src/mapV2/geo/railConnectivityAudit';
import { haversineMeters, polylineLengthMeters } from '../../src/mapV2/geo/wgs84Distance';
import type { MapSourceManifest } from '../../src/mapData/mapSourcePolicy';
import type { GeoCityRecord } from '../../src/mapV2/geo/cityPackage';
import {
  MIN_EDGE_LENGTH_METERS,
  ROAD_RENDER_QUANTIZE,
  ROAD_TOPOLOGY_WGS84_DECIMALS,
  extractOsmFeatureId,
  normalizeConsecutiveCoordinates,
  splitClosedRingIfNeeded,
  topologyNodeKey,
} from './road-ingest-core';

export const RAIL_INGEST_PROCESSING_VERSION = 'map-v2-rail-osm-2';
export const RAIL_BORDER_POLICY = 'CLIP_TO_TURKEY_BBOX_KEEP_DOMESTIC' as const;
export const RAIL_CITY_ACCESS_STATION_RADIUS_METERS = 25000;
export const RAIL_CITY_ACCESS_JUNCTION_RADIUS_METERS = 20000;
export const RAIL_STATION_ASSOCIATION_METERS = 250;
export const RAIL_STATION_NEAR_EDGE_METERS = 80;
export const RAIL_RENDER_QUANTIZE = ROAD_RENDER_QUANTIZE;
export const RAIL_TOPOLOGY_WGS84_DECIMALS = ROAD_TOPOLOGY_WGS84_DECIMALS;

export const PRESERVED_OSM_RAIL_TAGS = [
  'railway',
  'usage',
  'service',
  'operator',
  'name',
  'ref',
  'electrified',
  'voltage',
  'frequency',
  'gauge',
  'maxspeed',
  'tracks',
  'bridge',
  'tunnel',
  'embankment',
  'cutting',
  'access',
  'construction',
  'disused',
  'abandoned',
  'network',
  'passenger',
  'freight',
  'oneway',
] as const;

export type OsmRailFeature = {
  type: 'Feature';
  id?: string | number;
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates: unknown } | null;
};

export type OsmRailCollection = {
  type: 'FeatureCollection';
  features: OsmRailFeature[];
};

export type RailIngestStats = {
  rawFeatureCount: number;
  acceptedFeatureCount: number;
  rejectedFeatureCount: number;
  rejectedByReason: Record<string, number>;
  railwayClassCounts: Record<string, number>;
  nodeCount: number;
  edgeCount: number;
  stationCount: number;
  haltCount: number;
  junctionCount: number;
  terminalCount: number;
  associatedStations: number;
  unassociatedStations: number;
  verticesBeforeSimplify: number;
  verticesAfterSimplify: number;
  edgesLow: number;
  edgesMedium: number;
  edgesHigh: number;
  identityOsmId: number;
  identityGeomFallback: number;
  trueDuplicateSegmentsMerged: number;
  parallelSegmentsPreserved: number;
  collapsedSegmentsSkipped: number;
  zeroLengthSegmentsSkipped: number;
  borderCrossingNodes: number;
  isolatedNodeCount: number;
  largestComponentNodes: number;
};

export type RailIngestResult = {
  network: Omit<GeoTransportNetworkPackageV1, 'contentHash'>;
  stats: RailIngestStats;
  cityAccess: CityTransportAccess[];
  validationIssues: { code: string; detail: string }[];
  componentMetrics: ReturnType<typeof measureConnectivity> & {
    largestComponentNodes: number;
    stationComponentCount: number;
  };
};

function tagValue(props: Record<string, unknown> | null | undefined, key: string): string | number | boolean | null {
  if (!props) return null;
  const value = props[key];
  if (value == null || value === '') return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  return null;
}

/** Prefer `@type/@id` from Osmium export config. Never invent OSM IDs. */
export function extractOsmRailFeatureId(feature: OsmRailFeature): string | null {
  const props = feature.properties;
  const osmType = tagValue(props, '@type');
  const osmId = tagValue(props, '@id');
  if (osmType && osmId != null) return `${osmType}/${osmId}`;
  return extractOsmFeatureId(feature);
}

export function railNodeIdFromTopologyKey(key: string): string {
  return `tn.tur.rail.n.${key}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function geometryFingerprintWgs84(coords: GeoCoordinateWgs84[]): string {
  return coords.map((c) => topologyNodeKey(c)).join('|');
}

function canonicalGeometryFingerprint(coords: GeoCoordinateWgs84[]): string {
  const forward = geometryFingerprintWgs84(coords);
  const reverse = geometryFingerprintWgs84([...coords].reverse());
  return forward <= reverse ? forward : reverse;
}

function fallbackGeometrySourceId(coords: GeoCoordinateWgs84[]): string {
  return `geom.${shortHash(canonicalGeometryFingerprint(coords))}`;
}

function dropConsecutiveQuantized(quantized: number[]): number[] {
  if (quantized.length < 4) return quantized;
  const out = [quantized[0], quantized[1]];
  for (let i = 2; i + 1 < quantized.length; i += 2) {
    const px = out[out.length - 2];
    const py = out[out.length - 1];
    if (quantized[i] === px && quantized[i + 1] === py) continue;
    out.push(quantized[i], quantized[i + 1]);
  }
  return out;
}

function quantizeProjected(points: { x: number; y: number }[]): number[] {
  return dropConsecutiveQuantized(points.flatMap((p) => quantizeProjectedPoint(p, RAIL_RENDER_QUANTIZE)));
}

function canonicalQuantizedFingerprint(quantized: number[]): string {
  const forward = quantized.join(',');
  const reverseParts: number[] = [];
  for (let i = quantized.length - 2; i >= 0; i -= 2) {
    reverseParts.push(quantized[i], quantized[i + 1]);
  }
  const reverse = reverseParts.join(',');
  return forward <= reverse ? forward : reverse;
}

function toCoords(raw: unknown): GeoCoordinateWgs84[] {
  if (!Array.isArray(raw)) return [];
  const out: GeoCoordinateWgs84[] = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    out.push({ longitude: Number(pair[0]), latitude: Number(pair[1]) });
  }
  return out;
}

function readLineCoords(geometry: { type: string; coordinates: unknown }): GeoCoordinateWgs84[][] {
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return [toCoords(geometry.coordinates)];
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as unknown[]).map((part) => toCoords(part));
  }
  return [];
}

function readPoint(geometry: { type: string; coordinates: unknown }): GeoCoordinateWgs84 | null {
  if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) return null;
  const longitude = Number(geometry.coordinates[0]);
  const latitude = Number(geometry.coordinates[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function undirectedEndpointKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function mergeCompatibleAttribute(
  current: string | number | boolean | null,
  incoming: string | number | boolean | null,
): string | number | boolean | null {
  if (current == null) return incoming;
  if (incoming == null || incoming === current) return current;
  return current;
}

export function inTurkeyRailScope(
  coord: GeoCoordinateWgs84,
  turkeyPolygons: ProjectedPolygon[],
  countryBounds?: ProjectedBoundingBox | null,
): boolean {
  const projected = projectWgs84ToNormalizedMercator(coord.longitude, coord.latitude);
  if (pointInProjectedPolygons(projected, turkeyPolygons)) return true;
  if (!countryBounds) return false;
  return (
    projected.x >= countryBounds.minX &&
    projected.x <= countryBounds.maxX &&
    projected.y >= countryBounds.minY &&
    projected.y <= countryBounds.maxY
  );
}

function clipInsideTurkey(
  coords: GeoCoordinateWgs84[],
  turkeyPolygons: ProjectedPolygon[],
  countryBounds?: ProjectedBoundingBox | null,
): Array<{ coords: GeoCoordinateWgs84[]; cutStart: boolean; cutEnd: boolean }> {
  const inside = coords.map((c) => inTurkeyRailScope(c, turkeyPolygons, countryBounds));
  const runs: Array<{ coords: GeoCoordinateWgs84[]; cutStart: boolean; cutEnd: boolean }> = [];
  let start = -1;
  for (let i = 0; i <= inside.length; i += 1) {
    const on = i < inside.length && inside[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const slice = coords.slice(start, i);
      if (slice.length >= 2) {
        runs.push({ coords: slice, cutStart: start > 0, cutEnd: i < inside.length });
      }
      start = -1;
    }
  }
  return runs;
}

function isAccessEligibleNode(node: GeoTransportNodeRecord): boolean {
  if (node.kind === 'BORDER_CROSSING') return false;
  const usage = String(node.sourceMetadata.usage ?? '');
  const service = String(node.sourceMetadata.service ?? '');
  if (isRailServiceDetail(service)) return false;
  if (usage === 'industrial' || usage === 'military' || usage === 'tourism') return false;
  if (node.kind === 'RAIL_STATION' && node.sourceMetadata.associated !== true) return false;
  return true;
}

function isWeakServiceFragment(size: number, usageClasses: string[]): boolean {
  if (size >= 400) return false;
  return !usageClasses.includes('main') && !usageClasses.includes('branch');
}

export function selectRailCityAccess(
  city: GeoCityRecord,
  nodes: GeoTransportNodeRecord[],
  edges: GeoTransportEdgeRecord[],
): CityTransportAccess {
  const snapshot = JSON.stringify(city);
  const { byNode, records } = buildRailComponents(nodes, edges);
  const recById = new Map(records.map((row) => [row.componentId, row]));
  const pool = nodes.filter((node) => isAccessEligibleNode(node) && node.coordinate);
  const scored = pool
    .map((node) => {
      const componentId = byNode.get(node.nodeId);
      const rec = componentId ? recById.get(componentId) : undefined;
      const distanceMeters = haversineMeters(city.coordinate, node.coordinate!);
      const station = node.kind === 'RAIL_STATION';
      const radius = station ? RAIL_CITY_ACCESS_STATION_RADIUS_METERS : RAIL_CITY_ACCESS_JUNCTION_RADIUS_METERS;
      const typeRank = station ? 0 : node.sourceMetadata.incidentLod === 'NETWORK_LOW' ? 1 : 2;
      return { node, distanceMeters, radius, typeRank, size: rec?.nodeCount ?? 0, usage: rec?.usageClasses ?? [] };
    })
    .filter((row) => row.distanceMeters <= row.radius)
    .filter((row) => !isWeakServiceFragment(row.size, row.usage));
  const largest = scored.reduce((m, row) => Math.max(m, row.size), 0);
  if (largest < 50) {
    if (JSON.stringify(city) !== snapshot) {
      throw new Error('rail city access mutated GeoCity');
    }
    return {
      geoCityId: city.geoCityId,
      mode: 'RAIL',
      accessNodeIds: [],
      status: 'UNRESOLVED',
      notes: 'No suitable mainline-scale component within radius. Isolated fragments are not forced access.',
    };
  }
  const preferred = scored.filter((row) => row.size === largest);
  preferred.sort((a, b) => a.typeRank - b.typeRank || a.distanceMeters - b.distanceMeters);
  const best = preferred[0];
  if (JSON.stringify(city) !== snapshot) {
    throw new Error('rail city access mutated GeoCity');
  }
  if (!best) {
    return {
      geoCityId: city.geoCityId,
      mode: 'RAIL',
      accessNodeIds: [],
      status: 'UNRESOLVED',
      notes: 'No eligible RAIL station/junction candidate on a suitable component. No fake station.',
    };
  }
  return {
    geoCityId: city.geoCityId,
    mode: 'RAIL',
    accessNodeIds: [best.node.nodeId],
    status: 'PROVISIONAL',
    notes: `Candidate only (${best.node.kind}, component ${best.size}). ${Math.round(best.distanceMeters)} m. Not VERIFIED. Station ≠ freight terminal.`,
  };
}

export function ingestOsmRailCollection(
  collection: OsmRailCollection,
  turkeyPolygons: ProjectedPolygon[],
  cities: GeoCityRecord[],
  sourceManifest: MapSourceManifest,
  countryBounds?: ProjectedBoundingBox | null,
): RailIngestResult {
  const rejectedByReason: Record<string, number> = {};
  const railwayClassCounts: Record<string, number> = {};
  const acceptedLines: Array<{
    coords: GeoCoordinateWgs84[];
    sourceId: string;
    part: number;
    props: Record<string, unknown> | null | undefined;
    cutStart: boolean;
    cutEnd: boolean;
    osmId: boolean;
  }> = [];
  const stationPoints: Array<{
    coord: GeoCoordinateWgs84;
    sourceId: string;
    props: Record<string, unknown> | null | undefined;
    kind: 'RAIL_STATION' | 'RAIL_TERMINAL';
    osmId: boolean;
  }> = [];

  const rawFeatureCount = collection.features.length;
  let haltCount = 0;

  for (const feature of collection.features) {
    const geometry = feature.geometry;
    const railway = String(tagValue(feature.properties, 'railway') ?? '');
    bump(railwayClassCounts, railway || 'untagged');
    if (!geometry) {
      bump(rejectedByReason, 'missing-geometry');
      continue;
    }
    if (geometry.type === 'Point') {
      const coord = readPoint(geometry);
      if (!coord) {
        bump(rejectedByReason, 'invalid-point');
        continue;
      }
      if (!inTurkeyRailScope(coord, turkeyPolygons, countryBounds)) {
        bump(rejectedByReason, 'station-outside-turkey');
        continue;
      }
      const extracted = extractOsmRailFeatureId(feature);
      if (isOsmRailStationTag(railway)) {
        if (railway === 'halt') haltCount += 1;
        stationPoints.push({
          coord,
          sourceId: extracted ?? fallbackGeometrySourceId([coord, coord]),
          props: feature.properties,
          kind: 'RAIL_STATION',
          osmId: Boolean(extracted),
        });
        continue;
      }
      if (isOsmRailTerminalTag(railway)) {
        stationPoints.push({
          coord,
          sourceId: extracted ?? fallbackGeometrySourceId([coord, coord]),
          props: feature.properties,
          kind: 'RAIL_TERMINAL',
          osmId: Boolean(extracted),
        });
        continue;
      }
      bump(rejectedByReason, 'non-station-point');
      continue;
    }
    if (isExcludedOsmRailway(railway)) {
      bump(rejectedByReason, `excluded:${railway || 'class'}`);
      continue;
    }
    const usage = tagValue(feature.properties, 'usage');
    if (!isLogisticsOsmRailway(railway, typeof usage === 'string' ? usage : null)) {
      bump(rejectedByReason, railway ? `unlisted-class:${railway}` : 'unlisted-class');
      continue;
    }
    const parts = readLineCoords(geometry);
    if (parts.length === 0) {
      bump(rejectedByReason, 'unsupported-geometry');
      continue;
    }
    parts.forEach((rawCoords, part) => {
      if (rawCoords.some((c) => !Number.isFinite(c.longitude) || !Number.isFinite(c.latitude))) {
        bump(rejectedByReason, 'invalid-coords');
        return;
      }
      const normalized = normalizeConsecutiveCoordinates(rawCoords);
      if (normalized.coords.length < 2) {
        bump(rejectedByReason, 'too-short');
        return;
      }
      const clips = clipInsideTurkey(normalized.coords, turkeyPolygons, countryBounds);
      if (clips.length === 0) {
        bump(rejectedByReason, 'outside-turkey');
        return;
      }
      const extracted = extractOsmRailFeatureId(feature);
      clips.forEach((clip, clipIdx) => {
        acceptedLines.push({
          coords: clip.coords,
          sourceId: extracted ?? fallbackGeometrySourceId(clip.coords),
          part: part * 100 + clipIdx,
          props: feature.properties,
          cutStart: clip.cutStart,
          cutEnd: clip.cutEnd,
          osmId: Boolean(extracted),
        });
      });
    });
  }

  const vertexCount = new Map<string, number>();
  for (const line of acceptedLines) {
    const seen = new Set<string>();
    for (const coord of line.coords) {
      const key = topologyNodeKey(coord);
      if (seen.has(key)) continue;
      seen.add(key);
      vertexCount.set(key, (vertexCount.get(key) ?? 0) + 1);
    }
  }

  function isSplitVertex(key: string, index: number, last: number): boolean {
    return index === 0 || index === last || (vertexCount.get(key) ?? 0) > 1;
  }

  const nodeMap = new Map<string, GeoTransportNodeRecord>();
  const edgesByGeom = new Map<string, GeoTransportEdgeRecord>();
  const edgesByQuantized = new Map<string, string>();
  const endpointGeoms = new Map<string, Set<string>>();
  let collapsedSegmentsSkipped = 0;
  let zeroLengthSegmentsSkipped = 0;
  let trueDuplicateSegmentsMerged = 0;
  let parallelSegmentsPreserved = 0;
  let verticesBeforeSimplify = 0;
  let verticesAfterSimplify = 0;
  let identityOsmId = 0;
  let identityGeomFallback = 0;
  let borderCrossingNodes = 0;

  function ensureNode(
    key: string,
    coord: GeoCoordinateWgs84,
    kind: GeoTransportNodeKindRuntime,
    extra?: Record<string, string | number | boolean | null>,
  ): string {
    const nodeId = railNodeIdFromTopologyKey(key);
    const existing = nodeMap.get(key);
    if (!existing) {
      if (kind === 'BORDER_CROSSING') borderCrossingNodes += 1;
      nodeMap.set(key, {
        nodeId,
        mode: 'RAIL',
        kind,
        geoCountryId: 'country.tur',
        coordinate: coord,
        projected: projectWgs84ToNormalizedMercator(coord.longitude, coord.latitude),
        sourceMetadata: { topologyKey: key, ...extra },
      });
      return nodeId;
    }
    if (kind === 'BORDER_CROSSING' && existing.kind === 'RAIL_JUNCTION') {
      existing.kind = 'BORDER_CROSSING';
      borderCrossingNodes += 1;
    }
    if (kind === 'RAIL_STATION' && existing.kind !== 'RAIL_TERMINAL') {
      existing.kind = 'RAIL_STATION';
    }
    if (kind === 'RAIL_TERMINAL') existing.kind = 'RAIL_TERMINAL';
    if (extra) existing.sourceMetadata = { ...existing.sourceMetadata, ...extra };
    return existing.nodeId;
  }

  function mergeInto(existing: GeoTransportEdgeRecord, sourceId: string, props: Record<string, unknown> | null | undefined): void {
    const ids = new Set(existing.sourceFeatureIds ?? []);
    ids.add(sourceId);
    existing.sourceFeatureIds = [...ids].sort();
    existing.sourceMetadata = {
      ...existing.sourceMetadata,
      sourceFeatureIds: existing.sourceFeatureIds.join(','),
      lineage: existing.sourceFeatureIds.map((id) => `osm.${id}`).join('|'),
    };
    for (const tag of PRESERVED_OSM_RAIL_TAGS) {
      existing.attributes[tag] = mergeCompatibleAttribute(existing.attributes[tag] ?? null, tagValue(props, tag));
    }
    trueDuplicateSegmentsMerged += 1;
  }

  function emitSlice(slice: GeoCoordinateWgs84[], line: (typeof acceptedLines)[number], seg: number): void {
    const fromKey = topologyNodeKey(slice[0]);
    const toKey = topologyNodeKey(slice[slice.length - 1]);
    if (fromKey === toKey) {
      const parts = splitClosedRingIfNeeded(slice);
      if (parts.length <= 1) {
        collapsedSegmentsSkipped += 1;
        return;
      }
      parts.forEach((part, idx) => emitSlice(part, line, seg + idx));
      return;
    }
    const lengthMeters = polylineLengthMeters(slice);
    if (!(lengthMeters > MIN_EDGE_LENGTH_METERS)) {
      zeroLengthSegmentsSkipped += 1;
      return;
    }
    const fromKind: GeoTransportNodeKindRuntime = line.cutStart && seg === 0 ? 'BORDER_CROSSING' : 'RAIL_JUNCTION';
    const toKind: GeoTransportNodeKindRuntime =
      line.cutEnd && topologyNodeKey(slice[slice.length - 1]) === topologyNodeKey(line.coords[line.coords.length - 1])
        ? 'BORDER_CROSSING'
        : 'RAIL_JUNCTION';
    const fromId = ensureNode(fromKey, slice[0], fromKind);
    const toId = ensureNode(toKey, slice[slice.length - 1], toKind);
    if (fromId === toId) {
      collapsedSegmentsSkipped += 1;
      return;
    }
    const usage = typeof tagValue(line.props, 'usage') === 'string' ? String(tagValue(line.props, 'usage')) : null;
    const service = typeof tagValue(line.props, 'service') === 'string' ? String(tagValue(line.props, 'service')) : null;
    const lod = railLodForAttributes(usage, service);
    const projectedFull = slice.map((c) => projectWgs84ToNormalizedMercator(c.longitude, c.latitude));
    verticesBeforeSimplify += projectedFull.length;
    const simplified = simplifyOpenPolyline(projectedFull, RAIL_SIMPLIFY_TOLERANCE[lod]);
    let projectedQuantized = quantizeProjected(simplified);
    const fullQuantized = quantizeProjected(projectedFull);
    const geomFp = canonicalGeometryFingerprint(slice);
    const fullQFp = canonicalQuantizedFingerprint(fullQuantized);
    const existingByWgs = edgesByGeom.get(geomFp);
    if (existingByWgs) {
      mergeInto(existingByWgs, line.sourceId, line.props);
      return;
    }
    const existingByFullQ = edgesByQuantized.get(fullQFp);
    if (existingByFullQ) {
      const existing = edgesByGeom.get(existingByFullQ);
      if (existing) {
        mergeInto(existing, line.sourceId, line.props);
        return;
      }
    }
    let qFp = canonicalQuantizedFingerprint(projectedQuantized);
    const clashKey = edgesByQuantized.get(qFp);
    if (clashKey && clashKey !== geomFp) {
      projectedQuantized = fullQuantized;
      qFp = fullQFp;
    }
    if (projectedQuantized.length < 4) {
      zeroLengthSegmentsSkipped += 1;
      return;
    }
    verticesAfterSimplify += projectedQuantized.length / 2;
    const geometry = projectLineString(slice);
    geometry.projectedQuantized = projectedQuantized;
    const pairKey = undirectedEndpointKey(fromId, toId);
    const geomsForPair = endpointGeoms.get(pairKey) ?? new Set<string>();
    if (geomsForPair.size > 0 && !geomsForPair.has(geomFp)) parallelSegmentsPreserved += 1;
    geomsForPair.add(geomFp);
    endpointGeoms.set(pairKey, geomsForPair);

    const attributes: GeoTransportEdgeRecord['attributes'] = {};
    for (const tag of PRESERVED_OSM_RAIL_TAGS) {
      attributes[tag] = tagValue(line.props, tag);
    }
    attributes.railway = String(tagValue(line.props, 'railway') ?? 'rail');
    attributes.freightTerminalVerified = false;
    const edgeId = `te.tur.rail.e.${shortHash(geomFp)}`;
    const sourceFeatureIds = [line.sourceId];
    if (line.osmId) identityOsmId += 1;
    else identityGeomFallback += 1;
    edgesByGeom.set(geomFp, {
      edgeId,
      mode: 'RAIL',
      fromNodeId: fromId,
      toNodeId: toId,
      geometry,
      lengthMeters,
      networkLod: lod,
      attributes,
      sourceFeatureIds,
      sourceMetadata: {
        sourceFeatureIds: sourceFeatureIds.join(','),
        lineage: `osm.${line.sourceId}`,
        part: line.part,
        segment: seg,
        identity: line.osmId ? 'osm-id' : 'geom-fingerprint',
      },
    });
    edgesByQuantized.set(qFp, geomFp);
  }

  const sortedLines = [...acceptedLines].sort((a, b) => {
    const src = a.sourceId.localeCompare(b.sourceId);
    if (src !== 0) return src;
    if (a.part !== b.part) return a.part - b.part;
    return 0;
  });

  for (const line of sortedLines) {
    const keys = line.coords.map(topologyNodeKey);
    const last = keys.length - 1;
    let start = 0;
    let seg = 0;
    for (let i = 1; i <= last; i += 1) {
      if (!isSplitVertex(keys[i], i, last) && i !== last) continue;
      const slice = line.coords.slice(start, i + 1);
      start = i;
      if (slice.length < 2) continue;
      emitSlice(slice, line, seg);
      seg += 1;
    }
  }

  const nodeIndex = [...nodeMap.values()];
  const vertexGrid = new Map<string, GeoCoordinateWgs84[]>();
  const cellKey = (lon: number, lat: number) => `${Math.round(lon * 100)}_${Math.round(lat * 100)}`;
  for (const line of acceptedLines) {
    for (const coord of line.coords) {
      const key = cellKey(coord.longitude, coord.latitude);
      const bucket = vertexGrid.get(key) ?? [];
      bucket.push(coord);
      vertexGrid.set(key, bucket);
    }
  }
  const nearEdgeDistance = (coord: GeoCoordinateWgs84): number => {
    let best = Number.POSITIVE_INFINITY;
    const cx = Math.round(coord.longitude * 100);
    const cy = Math.round(coord.latitude * 100);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = vertexGrid.get(`${cx + dx}_${cy + dy}`) ?? [];
        for (const vertex of bucket) best = Math.min(best, haversineMeters(coord, vertex));
      }
    }
    return best;
  };
  let associatedStations = 0;
  let unassociatedStations = 0;
  for (const station of stationPoints.sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    let best: { key: string; dist: number } | null = null;
    for (const node of nodeIndex) {
      if (!node.coordinate) continue;
      const dist = haversineMeters(station.coord, node.coordinate);
      if (dist > RAIL_STATION_ASSOCIATION_METERS) continue;
      if (!best || dist < best.dist) best = { key: String(node.sourceMetadata.topologyKey), dist };
    }
    const nearEdge = best ? null : nearEdgeDistance(station.coord);
    const associationStatus = best
      ? 'ATTACHED_EXACT'
      : nearEdge != null && nearEdge <= RAIL_STATION_NEAR_EDGE_METERS
        ? 'PROVISIONAL_NEAR_EDGE'
        : 'UNRESOLVED';
    const extra = {
      stationSourceId: station.sourceId,
      stationName: tagValue(station.props, 'name'),
      operator: tagValue(station.props, 'operator'),
      ref: tagValue(station.props, 'ref'),
      network: tagValue(station.props, 'network'),
      passenger: tagValue(station.props, 'passenger'),
      freight: tagValue(station.props, 'freight'),
      usage: tagValue(station.props, 'usage'),
      service: tagValue(station.props, 'service'),
      freightCapable: 'UNVERIFIED',
      associated: Boolean(best),
      associationStatus,
      associationMeters: best ? Math.round(best.dist) : nearEdge != null && Number.isFinite(nearEdge) ? Math.round(nearEdge) : null,
    };
    if (best) {
      ensureNode(best.key, station.coord, station.kind, extra);
      associatedStations += 1;
    } else {
      ensureNode(topologyNodeKey(station.coord), station.coord, station.kind, extra);
      unassociatedStations += 1;
    }
  }

  const incidentLod = new Map<string, number>();
  const lodRank = (lod: string) => (lod === 'NETWORK_LOW' ? 0 : lod === 'NETWORK_MEDIUM' ? 1 : 2);
  for (const edge of edgesByGeom.values()) {
    incidentLod.set(edge.fromNodeId, Math.min(incidentLod.get(edge.fromNodeId) ?? 9, lodRank(edge.networkLod)));
    incidentLod.set(edge.toNodeId, Math.min(incidentLod.get(edge.toNodeId) ?? 9, lodRank(edge.networkLod)));
  }
  for (const node of nodeMap.values()) {
    const rank = incidentLod.get(node.nodeId);
    if (rank === 0) node.sourceMetadata.incidentLod = 'NETWORK_LOW';
    else if (rank === 1) node.sourceMetadata.incidentLod = 'NETWORK_MEDIUM';
    else if (rank === 2) node.sourceMetadata.incidentLod = 'NETWORK_HIGH';
  }

  const nodes = [...nodeMap.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const edges = [...edgesByGeom.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const metrics = measureConnectivity(nodes, edges);

  const parent = new Map(nodes.map((n) => [n.nodeId, n.nodeId]));
  const find = (id: string): string => {
    let cur = parent.get(id) ?? id;
    while (parent.get(cur) !== cur) {
      parent.set(cur, parent.get(parent.get(cur) ?? cur) ?? cur);
      cur = parent.get(cur) ?? cur;
    }
    return cur;
  };
  for (const edge of edges) {
    const a = find(edge.fromNodeId);
    const b = find(edge.toNodeId);
    if (a !== b) parent.set(a, b);
  }
  const sizes = new Map<string, number>();
  for (const node of nodes) {
    const root = find(node.nodeId);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  const largestComponentNodes = [...sizes.values()].reduce((a, b) => Math.max(a, b), 0);
  const stationRoots = new Set(
    nodes.filter((n) => n.kind === 'RAIL_STATION' || n.kind === 'RAIL_TERMINAL').map((n) => find(n.nodeId)),
  );

  const network: Omit<GeoTransportNetworkPackageV1, 'contentHash'> = {
    schemaVersion: TRANSPORT_NETWORK_SCHEMA_VERSION,
    packageId: 'map-v2.country.tur.transport.rail.v1',
    geoCountryId: 'country.tur',
    mode: 'RAIL',
    sourceStatus: 'PROTOTYPE',
    projection: WEB_MERCATOR_TRANSPORT_PROJECTION,
    sourceManifest,
    transformation: {
      processingVersion: RAIL_INGEST_PROCESSING_VERSION,
      projectionVersion: WEB_MERCATOR_PROJECTION_VERSION,
      simplificationVersion: RAIL_LOD_POLICY_ID,
      filtersApplied: [RAIL_CLASS_POLICY_ID, RAIL_BORDER_POLICY, 'topology-wgs84-7dp'],
      lodPolicyId: RAIL_LOD_POLICY_ID,
      quantize: RAIL_RENDER_QUANTIZE,
    },
    nodes,
    edges,
    stats: {
      nodeCount: metrics.nodeCount,
      edgeCount: metrics.edgeCount,
      componentCount: metrics.componentCount,
    },
    productionApproved: false,
  };

  const sealedForValidate = { ...network, contentHash: 'sha256:pending' as const };
  const validationIssues = validateTransportNetwork(sealedForValidate).filter((issue) => issue.code !== 'hash-format');

  const cityAccess: CityTransportAccess[] = cities.map((city) => selectRailCityAccess(city, nodes, edges));

  const rejectedFeatureCount = Object.values(rejectedByReason).reduce((a, b) => a + b, 0);
  const stationCount = nodes.filter((n) => n.kind === 'RAIL_STATION').length;
  const junctionCount = nodes.filter((n) => n.kind === 'RAIL_JUNCTION').length;
  const terminalCount = nodes.filter((n) => n.kind === 'RAIL_TERMINAL').length;
  const edgesLow = edges.filter((e) => e.networkLod === 'NETWORK_LOW').length;
  const edgesMedium = edges.filter((e) => e.networkLod === 'NETWORK_LOW' || e.networkLod === 'NETWORK_MEDIUM').length;

  return {
    network,
    stats: {
      rawFeatureCount,
      acceptedFeatureCount: acceptedLines.length,
      rejectedFeatureCount,
      rejectedByReason,
      railwayClassCounts,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      stationCount,
      haltCount,
      junctionCount,
      terminalCount,
      associatedStations,
      unassociatedStations,
      verticesBeforeSimplify,
      verticesAfterSimplify,
      edgesLow,
      edgesMedium,
      edgesHigh: edges.length,
      identityOsmId,
      identityGeomFallback,
      trueDuplicateSegmentsMerged,
      parallelSegmentsPreserved,
      collapsedSegmentsSkipped,
      zeroLengthSegmentsSkipped,
      borderCrossingNodes,
      isolatedNodeCount: metrics.isolatedNodeCount,
      largestComponentNodes,
    },
    cityAccess,
    validationIssues,
    componentMetrics: {
      ...metrics,
      largestComponentNodes,
      stationComponentCount: stationRoots.size,
    },
  };
}
