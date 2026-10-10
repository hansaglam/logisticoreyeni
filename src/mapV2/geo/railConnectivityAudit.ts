/**
 * Rail connectivity audit helpers. DEV/offline only. Never auto-connect source gaps.
 */
import { createHash } from 'node:crypto';

import type { GeoTransportEdgeRecord, GeoTransportNodeRecord } from './transportNetwork';
import { haversineMeters, polylineLengthMeters } from './wgs84Distance';
import type { GeoCoordinateWgs84 } from './webMercator';

export const RAIL_NEAR_BREAK_RADII_METERS = [25, 50, 100, 250, 500] as const;

export const RAIL_BREAK_CLASSES = [
  'EXACT_SOURCE_DISCONNECT',
  'INGEST_SPLIT',
  'FILTER_SPLIT',
  'CLIP_SPLIT',
  'PRECISION_SPLIT',
  'ACCESS_SPLIT',
  'UNKNOWN',
] as const;
export type RailBreakClass = (typeof RAIL_BREAK_CLASSES)[number];

export const RAIL_QA_ISSUE_TYPES = [
  'SOURCE_GAP',
  'FILTER_POLICY',
  'INGEST_TOPOLOGY',
  'ACCESS_MAPPING',
  'STATION_ASSOCIATION',
  'CLIPPING',
  'UNKNOWN',
] as const;
export type RailQaIssueType = (typeof RAIL_QA_ISSUE_TYPES)[number];

export const RAIL_STATION_ASSOCIATION_STATUSES = ['ATTACHED_EXACT', 'PROVISIONAL_NEAR_EDGE', 'UNRESOLVED'] as const;
export type RailStationAssociationStatus = (typeof RAIL_STATION_ASSOCIATION_STATUSES)[number];

export type RailComponentRecord = {
  componentId: string;
  nodeCount: number;
  edgeCount: number;
  stationCount: number;
  isolated: boolean;
  borderNodeCount: number;
  bbox: { west: number; south: number; east: number; north: number } | null;
  usageClasses: string[];
  serviceClasses: string[];
  regionHint: string;
  minNodeId: string;
};

export type RailNearBreak = {
  fromNodeId: string;
  toNodeId: string;
  fromComponentId: string;
  toComponentId: string;
  distanceMeters: number;
  radiusBucket: number;
  from: GeoCoordinateWgs84;
  to: GeoCoordinateWgs84;
};

export type RailQaIssue = {
  id: string;
  type: RailQaIssueType;
  severity: 'info' | 'warning' | 'error';
  componentIds: string[];
  location?: GeoCoordinateWgs84;
  sourceEvidence: string;
  qaReference?: string;
  resolutionStatus: 'OPEN' | 'REPAIRED_INGEST' | 'WONT_REPAIR_SOURCE' | 'ACCESS_RECONCILED';
  breakClass?: RailBreakClass;
};

export type RailStationAssociation = {
  stationNodeId: string;
  candidateEdgeId: string | null;
  distanceMeters: number | null;
  status: RailStationAssociationStatus;
};

export function stableComponentId(minNodeId: string): string {
  return `rc.tur.rail.${createHash('sha256').update(minNodeId).digest('hex').slice(0, 12)}`;
}

export function unionFind(ids: string[]): {
  find: (id: string) => string;
  unite: (a: string, b: string) => void;
} {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let cur = parent.get(id) ?? id;
    while (parent.get(cur) !== cur) {
      parent.set(cur, parent.get(parent.get(cur) ?? cur) ?? cur);
      cur = parent.get(cur) ?? cur;
    }
    return cur;
  };
  const unite = (a: string, b: string) => {
    const pa = find(a);
    const pb = find(b);
    if (pa === pb) return;
    if (pa < pb) parent.set(pb, pa);
    else parent.set(pa, pb);
  };
  return { find, unite };
}

export function buildRailComponents(
  nodes: GeoTransportNodeRecord[],
  edges: GeoTransportEdgeRecord[],
): { byNode: Map<string, string>; records: RailComponentRecord[] } {
  const { find, unite } = unionFind(nodes.map((n) => n.nodeId));
  for (const edge of edges) unite(edge.fromNodeId, edge.toNodeId);
  const members = new Map<string, GeoTransportNodeRecord[]>();
  for (const node of nodes) {
    const root = find(node.nodeId);
    const list = members.get(root) ?? [];
    list.push(node);
    members.set(root, list);
  }
  const nodeById = new Map(nodes.map((n) => [n.nodeId, n]));
  const records: RailComponentRecord[] = [];
  const byNode = new Map<string, string>();
  for (const [, group] of members) {
    const minNodeId = group.map((n) => n.nodeId).sort()[0];
    const componentId = stableComponentId(minNodeId);
    const edgeCount = edges.filter((e) => find(e.fromNodeId) === find(group[0].nodeId)).length;
    const lons = group.map((n) => n.coordinate?.longitude).filter((v): v is number => typeof v === 'number');
    const lats = group.map((n) => n.coordinate?.latitude).filter((v): v is number => typeof v === 'number');
    const bbox =
      lons.length && lats.length
        ? { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) }
        : null;
    const usages = new Set<string>();
    const services = new Set<string>();
    for (const edge of edges) {
      if (find(edge.fromNodeId) !== find(group[0].nodeId)) continue;
      if (typeof edge.attributes.usage === 'string') usages.add(edge.attributes.usage);
      if (typeof edge.attributes.service === 'string') services.add(edge.attributes.service);
    }
    const record: RailComponentRecord = {
      componentId,
      nodeCount: group.length,
      edgeCount,
      stationCount: group.filter((n) => n.kind === 'RAIL_STATION' || n.kind === 'RAIL_TERMINAL').length,
      isolated: edgeCount === 0,
      borderNodeCount: group.filter((n) => n.kind === 'BORDER_CROSSING').length,
      bbox,
      usageClasses: [...usages].sort(),
      serviceClasses: [...services].sort(),
      regionHint: regionHint(bbox),
      minNodeId,
    };
    records.push(record);
    for (const node of group) byNode.set(node.nodeId, componentId);
    void nodeById;
  }
  records.sort((a, b) => b.nodeCount - a.nodeCount || a.componentId.localeCompare(b.componentId));
  return { byNode, records };
}

export function regionHint(bbox: RailComponentRecord['bbox']): string {
  if (!bbox) return 'unknown';
  const lat = (bbox.south + bbox.north) / 2;
  const lon = (bbox.west + bbox.east) / 2;
  const ns = lat >= 40.2 ? 'north' : lat >= 38.2 ? 'central' : 'south';
  const ew = lon < 29.5 ? 'west' : lon < 33.5 ? 'west-central' : lon < 37.5 ? 'central' : lon < 41 ? 'east-central' : 'east';
  return `${ns}-${ew}`;
}

export function degreeMap(nodes: GeoTransportNodeRecord[], edges: GeoTransportEdgeRecord[]): Map<string, number> {
  const degree = new Map(nodes.map((n) => [n.nodeId, 0]));
  for (const edge of edges) {
    degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
    degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
  }
  return degree;
}

export function componentEndpoints(
  nodes: GeoTransportNodeRecord[],
  edges: GeoTransportEdgeRecord[],
  minComponentNodes: number,
): GeoTransportNodeRecord[] {
  const { byNode, records } = buildRailComponents(nodes, edges);
  const substantial = new Set(records.filter((r) => r.nodeCount >= minComponentNodes && !r.isolated).map((r) => r.componentId));
  const degree = degreeMap(nodes, edges);
  return nodes.filter((node) => substantial.has(byNode.get(node.nodeId) ?? '') && (degree.get(node.nodeId) ?? 0) === 1 && node.coordinate);
}

export function findNearBreaks(
  nodes: GeoTransportNodeRecord[],
  edges: GeoTransportEdgeRecord[],
  radii = RAIL_NEAR_BREAK_RADII_METERS,
  minComponentNodes = 25,
): RailNearBreak[] {
  const { byNode } = buildRailComponents(nodes, edges);
  const ends = componentEndpoints(nodes, edges, minComponentNodes);
  const out: RailNearBreak[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ends.length; i += 1) {
    const a = ends[i];
    if (!a.coordinate) continue;
    for (let j = i + 1; j < ends.length; j += 1) {
      const b = ends[j];
      if (!b.coordinate) continue;
      const ca = byNode.get(a.nodeId);
      const cb = byNode.get(b.nodeId);
      if (!ca || !cb || ca === cb) continue;
      const dist = haversineMeters(a.coordinate, b.coordinate);
      const bucket = radii.find((r) => dist <= r);
      if (bucket == null) continue;
      const key = [a.nodeId, b.nodeId].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        fromNodeId: a.nodeId,
        toNodeId: b.nodeId,
        fromComponentId: ca,
        toComponentId: cb,
        distanceMeters: dist,
        radiusBucket: bucket,
        from: a.coordinate,
        to: b.coordinate,
      });
    }
  }
  return out.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function classifyNearBreak(distanceMeters: number, filterHit: boolean, clipHit: boolean, sourceConnected: boolean | null): RailBreakClass {
  if (clipHit) return 'CLIP_SPLIT';
  if (filterHit) return 'FILTER_SPLIT';
  if (sourceConnected === true) {
    if (distanceMeters <= 0.15) return 'INGEST_SPLIT';
    if (distanceMeters <= 1.2) return 'PRECISION_SPLIT';
    return 'INGEST_SPLIT';
  }
  if (sourceConnected === false) return 'EXACT_SOURCE_DISCONNECT';
  return 'UNKNOWN';
}

/** Point-to-segment haversine approximation using vertex sampling. */
export function distanceToPolylineMeters(point: GeoCoordinateWgs84, line: GeoCoordinateWgs84[]): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const steps = Math.max(2, Math.min(8, Math.ceil(polylineLengthMeters([a, b]) / 40)));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const sample = {
        longitude: a.longitude + (b.longitude - a.longitude) * t,
        latitude: a.latitude + (b.latitude - a.latitude) * t,
      };
      best = Math.min(best, haversineMeters(point, sample));
    }
  }
  return best;
}

export function shouldPreferLargerComponent(candidateSize: number, largestInRadius: number): boolean {
  if (largestInRadius < 50) return false;
  return candidateSize * 8 < largestInRadius;
}

export function neverAutoConnectSourceGap(): true {
  return true;
}
