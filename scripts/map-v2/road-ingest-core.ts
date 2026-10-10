import { createHash } from 'node:crypto';

import { isExcludedOsmHighway, isPrototypeOsmHighway, ROAD_CLASS_POLICY_ID } from '../../src/mapV2/geo/roadClassPolicy';
import { ROAD_LOD_POLICY_ID, ROAD_SIMPLIFY_TOLERANCE, roadLodForHighway } from '../../src/mapV2/geo/roadLodPolicy';
import { simplifyOpenPolyline } from '../../src/mapV2/geo/simplifyPolyline';
import { projectLineString, quantizeProjectedPoint } from '../../src/mapV2/geo/transportGeometry';
import type {
  GeoTransportEdgeRecord,
  GeoTransportNetworkPackageV1,
  GeoTransportNodeRecord,
} from '../../src/mapV2/geo/transportNetwork';
import { TRANSPORT_NETWORK_SCHEMA_VERSION, WEB_MERCATOR_TRANSPORT_PROJECTION } from '../../src/mapV2/geo/transportNetwork';
import { measureConnectivity, validateTransportNetwork } from '../../src/mapV2/geo/validateTransportNetwork';
import { pointInProjectedPolygons, type ProjectedPolygon } from '../../src/mapV2/geo/geometry';
import { projectWgs84ToNormalizedMercator, type GeoCoordinateWgs84 } from '../../src/mapV2/geo/webMercator';
import { WEB_MERCATOR_PROJECTION_VERSION } from '../../src/mapV2/geo/webMercator';
import { polylineLengthMeters } from '../../src/mapV2/geo/wgs84Distance';
import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import { proposeCityTransportAccess } from '../../src/mapV2/geo/cityTransportAccess';
import type { CityTransportAccess } from '../../src/mapV2/geo/transportNetwork';
import type { MapSourceManifest } from '../../src/mapData/mapSourcePolicy';
import type { GeoCityRecord } from '../../src/mapV2/geo/cityPackage';

export const ROAD_INGEST_PROCESSING_VERSION = 'map-v2-roads-osm-2e-3';
export const ROAD_BORDER_POLICY = 'REJECT_PARTIAL_FOREIGN' as const;
export const CITY_ACCESS_CANDIDATE_RADIUS_METERS = 15000;
/** Topology identity: 7 decimal degrees ≈ 1.1 cm. Not render quantization. Old ingest used TRANSPORT_QUANTIZE 1e5 (~400 m). */
export const ROAD_TOPOLOGY_WGS84_DECIMALS = 7;
/** Render polyline quantization in normalized world space (~0.4 m). Independent of topology keys. */
export const ROAD_RENDER_QUANTIZE = 100_000_000;
export const MIN_EDGE_LENGTH_METERS = 0.05;

export const PRESERVED_OSM_TAGS = [
  'highway',
  'name',
  'ref',
  'oneway',
  'bridge',
  'tunnel',
  'surface',
  'lanes',
  'maxspeed',
  'access',
  'motor_vehicle',
  'hgv',
  'toll',
] as const;

export type OsmRoadFeature = {
  type: 'Feature';
  id?: string | number;
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates: unknown } | null;
};

export type OsmRoadCollection = {
  type: 'FeatureCollection';
  features: OsmRoadFeature[];
};

export type RoadIngestStats = {
  rawFeatureCount: number;
  acceptedFeatureCount: number;
  rejectedFeatureCount: number;
  rejectedByReason: Record<string, number>;
  nodeCount: number;
  edgeCount: number;
  verticesBeforeSimplify: number;
  verticesAfterSimplify: number;
  edgesLow: number;
  edgesMedium: number;
  edgesHigh: number;
  consecutiveDuplicateCoordinatesRemoved: number;
  collapsedSegmentsSkipped: number;
  zeroLengthSegmentsSkipped: number;
  trueDuplicateSegmentsMerged: number;
  parallelSegmentsPreserved: number;
};

export type RoadIngestResult = {
  network: Omit<GeoTransportNetworkPackageV1, 'contentHash'>;
  stats: RoadIngestStats;
  cityAccess: CityTransportAccess[];
  validationIssues: { code: string; detail: string }[];
};

function tagValue(props: Record<string, unknown> | null | undefined, key: string): string | number | boolean | null {
  if (!props) return null;
  const value = props[key];
  if (value == null || value === '') return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  return null;
}

/**
 * Osmium GeoJSON identity, in order:
 * feature.id, properties.id, properties.osm_id, properties["@id"]
 * Osmium default export observed in turkey-roads.geojson often omits all of these on ways.
 */
export function extractOsmFeatureId(feature: OsmRoadFeature): string | null {
  const props = feature.properties;
  const candidates: unknown[] = [feature.id, props?.id, props?.osm_id, props?.['@id'], props?.osm_way_id];
  for (const raw of candidates) {
    if (raw == null || raw === '') continue;
    const text = String(raw).trim();
    if (!text) continue;
    return text;
  }
  return null;
}

export function topologyNodeKey(coord: GeoCoordinateWgs84): string {
  return `${coord.longitude.toFixed(ROAD_TOPOLOGY_WGS84_DECIMALS)}_${coord.latitude.toFixed(ROAD_TOPOLOGY_WGS84_DECIMALS)}`;
}

export function nodeIdFromTopologyKey(key: string): string {
  return `tn.tur.road.n.${key}`;
}

export function normalizeConsecutiveCoordinates(coords: GeoCoordinateWgs84[]): {
  coords: GeoCoordinateWgs84[];
  removed: number;
} {
  if (coords.length === 0) return { coords, removed: 0 };
  const out: GeoCoordinateWgs84[] = [coords[0]];
  let removed = 0;
  for (let i = 1; i < coords.length; i += 1) {
    if (topologyNodeKey(coords[i]) === topologyNodeKey(out[out.length - 1])) {
      removed += 1;
      continue;
    }
    out.push(coords[i]);
  }
  return { coords: out, removed };
}

function geometryFingerprintWgs84(coords: GeoCoordinateWgs84[]): string {
  return coords.map((c) => topologyNodeKey(c)).join('|');
}

function canonicalGeometryFingerprint(coords: GeoCoordinateWgs84[]): string {
  const forward = geometryFingerprintWgs84(coords);
  const reverse = geometryFingerprintWgs84([...coords].reverse());
  return forward <= reverse ? forward : reverse;
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
  return dropConsecutiveQuantized(
    points.flatMap((p) => quantizeProjectedPoint(p, ROAD_RENDER_QUANTIZE)),
  );
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

/** Closed rings cannot be one edge (self-loop). Split at a deterministic interior vertex. */
export function splitClosedRingIfNeeded(coords: GeoCoordinateWgs84[]): GeoCoordinateWgs84[][] {
  if (coords.length < 3) return [coords];
  const startKey = topologyNodeKey(coords[0]);
  const endKey = topologyNodeKey(coords[coords.length - 1]);
  if (startKey !== endKey) return [coords];
  const mid = Math.floor(coords.length / 2);
  let split = -1;
  for (let d = 0; d < coords.length; d += 1) {
    const offset = d % 2 === 0 ? d / 2 : -Math.ceil(d / 2);
    const i = mid + offset;
    if (i <= 0 || i >= coords.length - 1) continue;
    if (topologyNodeKey(coords[i]) !== startKey) {
      split = i;
      break;
    }
  }
  if (split < 0) return [];
  return [coords.slice(0, split + 1), coords.slice(split)];
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function fallbackGeometrySourceId(coords: GeoCoordinateWgs84[]): string {
  return `geom.${shortHash(canonicalGeometryFingerprint(coords))}`;
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

function toCoords(raw: unknown): GeoCoordinateWgs84[] {
  if (!Array.isArray(raw)) return [];
  const out: GeoCoordinateWgs84[] = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const longitude = Number(pair[0]);
    const latitude = Number(pair[1]);
    out.push({ longitude, latitude });
  }
  return out;
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

export function ingestOsmRoadCollection(
  collection: OsmRoadCollection,
  turkeyPolygons: ProjectedPolygon[],
  cities: GeoCityRecord[],
  sourceManifest: MapSourceManifest,
): RoadIngestResult {
  const rejectedByReason: Record<string, number> = {};
  const acceptedLines: Array<{
    coords: GeoCoordinateWgs84[];
    highway: string;
    sourceId: string;
    part: number;
    props: Record<string, unknown> | null | undefined;
  }> = [];

  let consecutiveDuplicateCoordinatesRemoved = 0;
  const rawFeatureCount = collection.features.length;

  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (!geometry) {
      bump(rejectedByReason, 'missing-geometry');
      continue;
    }
    const highway = String(tagValue(feature.properties, 'highway') ?? '');
    if (isExcludedOsmHighway(highway) || !isPrototypeOsmHighway(highway)) {
      bump(rejectedByReason, isExcludedOsmHighway(highway) ? 'forbidden-class' : 'unlisted-class');
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
      consecutiveDuplicateCoordinatesRemoved += normalized.removed;
      const coords = normalized.coords;
      if (coords.length < 2) {
        bump(rejectedByReason, 'too-short');
        return;
      }
      const inside = coords.map((c) =>
        pointInProjectedPolygons(projectWgs84ToNormalizedMercator(c.longitude, c.latitude), turkeyPolygons),
      );
      if (inside.every((v) => !v)) {
        bump(rejectedByReason, 'outside-turkey');
        return;
      }
      if (inside.some((v) => !v)) {
        bump(rejectedByReason, 'partial-foreign');
        return;
      }
      const extracted = extractOsmFeatureId(feature);
      const sourceId = extracted ?? fallbackGeometrySourceId(coords);
      acceptedLines.push({ coords, highway, sourceId, part, props: feature.properties });
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

  function ensureNode(key: string, coord: GeoCoordinateWgs84): string {
    const nodeId = nodeIdFromTopologyKey(key);
    if (!nodeMap.has(key)) {
      nodeMap.set(key, {
        nodeId,
        mode: 'ROAD',
        kind: 'ROAD_JUNCTION',
        geoCountryId: 'country.tur',
        coordinate: coord,
        projected: projectWgs84ToNormalizedMercator(coord.longitude, coord.latitude),
        sourceMetadata: { topologyKey: key },
      });
    }
    return nodeId;
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
    for (const tag of PRESERVED_OSM_TAGS) {
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
    const fromId = ensureNode(fromKey, slice[0]);
    const toId = ensureNode(toKey, slice[slice.length - 1]);
    if (fromId === toId) {
      collapsedSegmentsSkipped += 1;
      return;
    }
    const lod = roadLodForHighway(line.highway);
    const projectedFull = slice.map((c) => projectWgs84ToNormalizedMercator(c.longitude, c.latitude));
    verticesBeforeSimplify += projectedFull.length;
    const simplified = simplifyOpenPolyline(projectedFull, ROAD_SIMPLIFY_TOLERANCE[lod]);
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
    if (geomsForPair.size > 0 && !geomsForPair.has(geomFp)) {
      parallelSegmentsPreserved += 1;
    }
    geomsForPair.add(geomFp);
    endpointGeoms.set(pairKey, geomsForPair);

    const attributes: GeoTransportEdgeRecord['attributes'] = {};
    for (const tag of PRESERVED_OSM_TAGS) {
      attributes[tag] = tagValue(line.props, tag);
    }
    attributes.highway = line.highway;
    attributes.truckAccess = 'UNVERIFIED';
    const edgeId = `te.tur.road.e.${shortHash(geomFp)}`;
    const sourceFeatureIds = [line.sourceId];
    edgesByGeom.set(geomFp, {
      edgeId,
      mode: 'ROAD',
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
      },
    });
    edgesByQuantized.set(qFp, geomFp);
  }

  const sortedLines = [...acceptedLines].sort((a, b) => {
    const src = a.sourceId.localeCompare(b.sourceId);
    if (src !== 0) return src;
    if (a.part !== b.part) return a.part - b.part;
    return a.highway.localeCompare(b.highway);
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

  const nodes = [...nodeMap.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const edges = [...edgesByGeom.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const metrics = measureConnectivity(nodes, edges);
  const edgesLow = edges.filter((e) => e.networkLod === 'NETWORK_LOW').length;
  const edgesMedium = edges.filter((e) => e.networkLod === 'NETWORK_LOW' || e.networkLod === 'NETWORK_MEDIUM').length;

  const network: Omit<GeoTransportNetworkPackageV1, 'contentHash'> = {
    schemaVersion: TRANSPORT_NETWORK_SCHEMA_VERSION,
    packageId: 'map-v2.country.tur.transport.road.v1',
    geoCountryId: 'country.tur',
    mode: 'ROAD',
    sourceStatus: 'PROTOTYPE',
    projection: WEB_MERCATOR_TRANSPORT_PROJECTION,
    sourceManifest,
    transformation: {
      processingVersion: ROAD_INGEST_PROCESSING_VERSION,
      projectionVersion: WEB_MERCATOR_PROJECTION_VERSION,
      simplificationVersion: ROAD_LOD_POLICY_ID,
      filtersApplied: [ROAD_CLASS_POLICY_ID, ROAD_BORDER_POLICY, 'topology-wgs84-7dp'],
      lodPolicyId: ROAD_LOD_POLICY_ID,
      quantize: ROAD_RENDER_QUANTIZE,
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

  const cityAccess: CityTransportAccess[] = cities.map((city) => {
    const proposed = proposeCityTransportAccess(city, 'ROAD', nodes, 1);
    const candidate = proposed.candidates[0];
    const node = candidate ? nodes.find((n) => n.nodeId === candidate.nodeId) : undefined;
    if (!candidate || !node?.coordinate) {
      return {
        geoCityId: city.geoCityId,
        mode: 'ROAD',
        accessNodeIds: [],
        status: 'UNRESOLVED',
        notes: 'No ROAD node within candidate radius.',
      };
    }
    const distanceMeters = haversineMeters(city.coordinate, node.coordinate);
    if (distanceMeters > CITY_ACCESS_CANDIDATE_RADIUS_METERS) {
      return {
        geoCityId: city.geoCityId,
        mode: 'ROAD',
        accessNodeIds: [],
        status: 'UNRESOLVED',
        notes: `Nearest node ${Math.round(distanceMeters)} m exceeds ${CITY_ACCESS_CANDIDATE_RADIUS_METERS} m.`,
      };
    }
    return {
      geoCityId: city.geoCityId,
      mode: 'ROAD',
      accessNodeIds: [candidate.nodeId],
      status: 'PROVISIONAL',
      notes: `Candidate only. ${Math.round(distanceMeters)} m. Not VERIFIED. Not a truck-legal claim.`,
    };
  });

  const rejectedFeatureCount = Object.values(rejectedByReason).reduce((a, b) => a + b, 0);
  return {
    network,
    stats: {
      rawFeatureCount,
      acceptedFeatureCount: acceptedLines.length,
      rejectedFeatureCount,
      rejectedByReason,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      verticesBeforeSimplify,
      verticesAfterSimplify,
      edgesLow,
      edgesMedium,
      edgesHigh: edges.length,
      consecutiveDuplicateCoordinatesRemoved,
      collapsedSegmentsSkipped,
      zeroLengthSegmentsSkipped,
      trueDuplicateSegmentsMerged,
      parallelSegmentsPreserved,
    },
    cityAccess,
    validationIssues,
  };
}
