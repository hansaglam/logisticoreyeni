import type { GeoCoordinateWgs84 } from './webMercator';
import { haversineMeters } from './wgs84Distance';
import { pointInProjectedPolygons, type ProjectedPolygon } from './geometry';
import { projectWgs84ToNormalizedMercator } from './webMercator';

export const MARITIME_GRAPH_POLICY_VERSION = 'map-v2-maritime-hybrid-grid-v2' as const;
export const MARITIME_LAND_MASK_VERSION = 'map-v2-maritime-land-ne10m-osm-harbour-v2' as const;
export const MARITIME_INGEST_PROCESSING_VERSION = 'map-v2-maritime-osm-2' as const;

export const MARITIME_REGIONS = ['BLACK_SEA', 'MARMARA', 'AEGEAN', 'MEDITERRANEAN'] as const;
export type MaritimeRegionId = (typeof MARITIME_REGIONS)[number];

export const MARITIME_CHANNELS = ['BOSPHORUS', 'DARDANELLES'] as const;
export type MaritimeChannelId = (typeof MARITIME_CHANNELS)[number];

export const PORT_SEA_ACCESS_FAILURE_REASONS = [
  'NO_NAVIGABLE_WATER_NEARBY',
  'PORT_GEOMETRY_AMBIGUOUS',
  'LAND_INTERSECTION',
  'CLUSTER_AMBIGUITY',
  'INSUFFICIENT_SOURCE',
  'HARBOUR_GEOMETRY_MISSING',
  'SOURCE_POSITION_SUSPECT',
  'UNKNOWN',
  'LAND_MASK_COARSE',
  'HARBOUR_WATER_MISSING',
  'NO_APPROACH_PATH',
  'NO_TRUNK_CONNECTION',
  'PORT_POSITION_INLAND',
  'SOURCE_AMBIGUOUS',
] as const;
export type PortSeaAccessFailureReason = (typeof PORT_SEA_ACCESS_FAILURE_REASONS)[number];

export const PORT_SEA_ACCESS_SEARCH_RADII_METERS = [250, 500, 1000, 2000, 5000] as const;
export const PORT_SEA_ACCESS_SAMPLE_METERS = 400;
export const MARITIME_MAX_EDGE_METERS = 22_000;
export const MARITIME_COARSE_GAP_FILL_METERS = 40_000;
export const PORT_CLUSTER_SPAN_QA_METERS = 12_000;

export const MARITIME_AOI = { west: 25.5, south: 35.75, east: 42.2, north: 42.45 } as const;
export const MARITIME_COARSE_STEP_DEG = 0.12;

export const BOSPHORUS_WINDOW = { west: 28.97, south: 40.99, east: 29.16, north: 41.24 } as const;
export const BOSPHORUS_STEP_DEG = 0.006;
export const DARDANELLES_WINDOW = { west: 26.17, south: 39.99, east: 26.75, north: 40.43 } as const;
export const DARDANELLES_STEP_DEG = 0.008;
export const BOSPHORUS_NORTH_APPROACH = { west: 28.9, south: 41.24, east: 29.55, north: 41.7 } as const;
export const BOSPHORUS_SOUTH_APPROACH = { west: 28.4, south: 40.62, east: 29.35, north: 40.99 } as const;
export const DARDANELLES_NORTH_APPROACH = { west: 26.2, south: 40.43, east: 27.2, north: 40.85 } as const;
export const DARDANELLES_SOUTH_APPROACH = { west: 25.9, south: 39.7, east: 26.55, north: 39.99 } as const;
export const MARMARA_FILL = { west: 26.55, south: 40.38, east: 29.35, north: 40.95 } as const;
export const APPROACH_STEP_DEG = 0.02;
export const PORT_LOCAL_STEP_DEG = 0.008;
export const PORT_LOCAL_WINDOW_DEG = 0.11;
export const IZMIR_GULF = { west: 26.35, south: 38.22, east: 27.35, north: 38.72 } as const;
export const ANTALYA_BIGHT = { west: 30.35, south: 36.7, east: 31.15, north: 37.05 } as const;
export const ISKENDERUN_GULF = { west: 35.55, south: 36.52, east: 36.35, north: 36.95 } as const;
export const TRABZON_COAST = { west: 39.45, south: 40.92, east: 40.15, north: 41.18 } as const;
export const PORT_REGIONAL_APPROACH_BOXES = [IZMIR_GULF, ANTALYA_BIGHT, ISKENDERUN_GULF, TRABZON_COAST] as const;

export function bboxAround(longitude: number, latitude: number, halfDeg: number): LonLatBbox {
  return {
    west: longitude - halfDeg,
    south: latitude - halfDeg,
    east: longitude + halfDeg,
    north: latitude + halfDeg,
  };
}

export type LonLatBbox = { west: number; south: number; east: number; north: number };

export function pointInLonLatBbox(longitude: number, latitude: number, box: LonLatBbox): boolean {
  return longitude >= box.west && longitude <= box.east && latitude >= box.south && latitude <= box.north;
}

export function classifyMaritimeRegion(longitude: number, latitude: number): MaritimeRegionId | null {
  if (pointInLonLatBbox(longitude, latitude, BOSPHORUS_WINDOW)) {
    return latitude >= 41.2 ? 'BLACK_SEA' : 'MARMARA';
  }
  if (pointInLonLatBbox(longitude, latitude, DARDANELLES_WINDOW)) {
    return latitude >= 40.25 ? 'MARMARA' : 'AEGEAN';
  }
  if (longitude >= 26.55 && longitude <= 29.55 && latitude >= 40.32 && latitude <= 41.12) return 'MARMARA';
  if (latitude >= 40.92 && longitude >= 29.05) return 'BLACK_SEA';
  if (latitude >= 41.12 && longitude >= 27.4) return 'BLACK_SEA';
  if (latitude <= 36.85 || (longitude >= 28.9 && latitude <= 37.15) || (longitude >= 32.0 && latitude <= 37.4)) {
    return 'MEDITERRANEAN';
  }
  if (longitude <= 28.4 && latitude >= 36.4 && latitude <= 40.45) return 'AEGEAN';
  if (longitude >= 27.2 && latitude <= 37.5) return 'MEDITERRANEAN';
  return null;
}

export function classifyMaritimeChannel(longitude: number, latitude: number): MaritimeChannelId | null {
  if (pointInLonLatBbox(longitude, latitude, BOSPHORUS_WINDOW)) return 'BOSPHORUS';
  if (pointInLonLatBbox(longitude, latitude, DARDANELLES_WINDOW)) return 'DARDANELLES';
  return null;
}

export type MaritimeNavigabilityQuery = {
  neLand: ProjectedPolygon[];
  osmMarine: ProjectedPolygon[];
};

export function isNeLand(longitude: number, latitude: number, neLand: ProjectedPolygon[]): boolean {
  return pointInProjectedPolygons(projectWgs84ToNormalizedMercator(longitude, latitude), neLand);
}

export function isOsmMarine(longitude: number, latitude: number, osmMarine: ProjectedPolygon[]): boolean {
  if (osmMarine.length === 0) return false;
  return pointInProjectedPolygons(projectWgs84ToNormalizedMercator(longitude, latitude), osmMarine);
}

/** Navigable iff outside Natural Earth land, or inside OSM marine/strait polygons (opens Bosphorus). */
export function isNavigableWater(longitude: number, latitude: number, query: MaritimeNavigabilityQuery): boolean {
  if (isOsmMarine(longitude, latitude, query.osmMarine)) return true;
  return !isNeLand(longitude, latitude, query.neLand);
}

export function sampleSegment(
  a: GeoCoordinateWgs84,
  b: GeoCoordinateWgs84,
  sampleMeters: number,
): GeoCoordinateWgs84[] {
  const length = haversineMeters(a, b);
  const steps = Math.max(1, Math.ceil(length / Math.max(sampleMeters, 50)));
  const out: GeoCoordinateWgs84[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    out.push({
      longitude: a.longitude + (b.longitude - a.longitude) * t,
      latitude: a.latitude + (b.latitude - a.latitude) * t,
    });
  }
  return out;
}

export function segmentHitsLand(
  a: GeoCoordinateWgs84,
  b: GeoCoordinateWgs84,
  query: MaritimeNavigabilityQuery,
  sampleMeters = PORT_SEA_ACCESS_SAMPLE_METERS,
): boolean {
  return sampleSegment(a, b, sampleMeters).some((point) => !isNavigableWater(point.longitude, point.latitude, query));
}

export type MaritimeGraphNode = {
  nodeId: string;
  longitude: number;
  latitude: number;
  region: MaritimeRegionId | null;
  channel: MaritimeChannelId | null;
  kind: 'COARSE' | 'CHANNEL' | 'APPROACH' | 'PORT_ACCESS' | 'LOCAL';
};

export type MaritimeGraphEdge = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  lengthMeters: number;
  channel: MaritimeChannelId | null;
};

export function maritimeNodeId(kind: 'c' | 'b' | 'd' | 'p' | 'a' | 'l', longitude: number, latitude: number): string {
  const lon = Math.round(longitude * 10000);
  const lat = Math.round(latitude * 10000);
  return `tn.tur.sea.${kind}.${lon}.${lat}`;
}

export function gridPoints(box: LonLatBbox, step: number): GeoCoordinateWgs84[] {
  const out: GeoCoordinateWgs84[] = [];
  const startLon = Math.ceil(box.west / step) * step;
  const startLat = Math.ceil(box.south / step) * step;
  for (let latitude = startLat; latitude <= box.north + 1e-12; latitude = Number((latitude + step).toFixed(6))) {
    for (let longitude = startLon; longitude <= box.east + 1e-12; longitude = Number((longitude + step).toFixed(6))) {
      out.push({ longitude, latitude });
    }
  }
  return out;
}

export function neighborOffsets(eightConnected: boolean): Array<[number, number]> {
  const cardinal: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  if (!eightConnected) return cardinal;
  return [...cardinal, [1, 1], [1, -1], [-1, 1], [-1, -1]];
}

export function dijkstraMaritime(
  nodes: readonly MaritimeGraphNode[],
  edges: readonly MaritimeGraphEdge[],
  fromId: string,
  toId: string,
): { nodeIds: string[]; meters: number; channels: MaritimeChannelId[] } | null {
  const adj = new Map<string, Array<{ to: string; meters: number; channel: MaritimeChannelId | null }>>();
  for (const node of nodes) adj.set(node.nodeId, []);
  for (const edge of edges) {
    adj.get(edge.fromNodeId)?.push({ to: edge.toNodeId, meters: edge.lengthMeters, channel: edge.channel });
    adj.get(edge.toNodeId)?.push({ to: edge.fromNodeId, meters: edge.lengthMeters, channel: edge.channel });
  }
  const dist = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, string>();
  const usedChannel = new Map<string, MaritimeChannelId | null>();
  const heap: Array<{ id: string; d: number }> = [{ id: fromId, d: 0 }];
  const seen = new Set<string>();
  while (heap.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < heap.length; i += 1) {
      if (heap[i].d < heap[bestIdx].d) bestIdx = i;
    }
    const [cur] = heap.splice(bestIdx, 1);
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    if (cur.id === toId) break;
    for (const step of adj.get(cur.id) ?? []) {
      if (seen.has(step.to)) continue;
      const next = cur.d + step.meters;
      if (next < (dist.get(step.to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(step.to, next);
        prev.set(step.to, cur.id);
        usedChannel.set(step.to, step.channel);
        heap.push({ id: step.to, d: next });
      }
    }
  }
  if (!dist.has(toId)) return null;
  const nodeIds = [toId];
  const channels = new Set<MaritimeChannelId>();
  let cur = toId;
  while (cur !== fromId) {
    const ch = usedChannel.get(cur);
    if (ch) channels.add(ch);
    const p = prev.get(cur);
    if (!p) return null;
    nodeIds.push(p);
    cur = p;
  }
  nodeIds.reverse();
  return { nodeIds, meters: Math.round(dist.get(toId)!), channels: [...channels].sort() };
}

export function offsetWgs84(origin: GeoCoordinateWgs84, meters: number, bearingDeg: number): GeoCoordinateWgs84 {
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.latitude * Math.PI) / 180;
  const lon1 = (origin.longitude * Math.PI) / 180;
  const ang = meters / 6_371_000;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(bearing));
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(bearing) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
  return { longitude: (lon2 * 180) / Math.PI, latitude: (lat2 * 180) / Math.PI };
}

export const PORT_ACCESS_BEARINGS_DEG = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] as const;

export function nearestNode(
  point: GeoCoordinateWgs84,
  nodes: readonly MaritimeGraphNode[],
  maxMeters: number,
): MaritimeGraphNode | null {
  let best: MaritimeGraphNode | null = null;
  let bestD = maxMeters;
  for (const node of nodes) {
    const d = haversineMeters(point, { longitude: node.longitude, latitude: node.latitude });
    if (d <= bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}

export function scorePortDisplayName(name: string): number {
  const trimmed = name.trim();
  if (!trimmed) return -100;
  if (/^\d/.test(trimmed)) return -40;
  if (/feribot|ferry|iskele|vapur/i.test(trimmed)) return -20;
  if (/\bliman|\bport\b/i.test(trimmed) && !/yat|marina/i.test(trimmed)) return 50 + Math.min(trimmed.length, 40);
  return Math.min(trimmed.length, 20);
}

export function resolvePortDisplayName(names: readonly string[]): { displayName: string; sourceName: string | null } {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return { displayName: 'Unnamed harbour', sourceName: null };
  const ranked = [...unique].sort((a, b) => scorePortDisplayName(b) - scorePortDisplayName(a) || a.localeCompare(b, 'tr'));
  return { displayName: ranked[0], sourceName: ranked[0] };
}

export const MARITIME_VERIFIED_CRITERIA = [
  'Official public list names the facility',
  'OSM cluster agrees within 5 km',
  'PortSeaAccess is PROVISIONAL or better with navigable graph node',
  'Human review recorded',
] as const;
