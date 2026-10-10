import { createHash } from 'node:crypto';

import {
  classifyPortTags,
  mergeCapabilities,
  mergeClusterClassification,
  PORT_CLASSIFICATION_POLICY_VERSION,
  PORT_CLUSTER_POLICY_VERSION,
  PORT_INGEST_PROCESSING_VERSION,
} from '../../src/mapV2/geo/portClassPolicy';
import { associateCityToPorts } from '../../src/mapV2/geo/portCityAssociation';
import { resolvePortDisplayName } from '../../src/mapV2/geo/maritimeNavigability';
import type {
  CityPortAssociationSummary,
  GeoPort,
  GeoPortEvidence,
  PortQaIssue,
  PortSeaAccess,
} from '../../src/mapV2/geo/geoPort';
import { OFFICIAL_PORT_QA_STATUS } from '../../src/mapV2/geo/geoPort';
import { pointInProjectedPolygons, type ProjectedPolygon } from '../../src/mapV2/geo/geometry';
import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import { projectWgs84ToNormalizedMercator, type GeoCoordinateWgs84 } from '../../src/mapV2/geo/webMercator';

export type OsmPortFeature = {
  type: 'Feature';
  id?: string | number;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
};

export type PortCandidate = {
  sourceId: string;
  tags: Record<string, unknown>;
  name: string | null;
  operator: string | null;
  position: GeoCoordinateWgs84;
  vertices: GeoCoordinateWgs84[];
  geometryKind: 'POINT' | 'POLYGON' | 'LINE';
  classification: ReturnType<typeof classifyPortTags>;
};

const SAME_NAME_MERGE_METERS = 3_500;
const CONTAINMENT_MERGE_METERS = 250;
const DISTINCT_NAME_KEEP_APART_METERS = 800;

export function extractOsmPortFeatureId(feature: OsmPortFeature): string | null {
  const props = feature.properties ?? {};
  const osmType = props['@type'] ?? props.type;
  const osmId = props['@id'] ?? props.id ?? feature.id;
  if (osmType && osmId != null && String(osmId) !== '') {
    const type = String(osmType).replace(/^osm:/, '');
    if (['node', 'way', 'relation'].includes(type)) return `${type}/${osmId}`;
  }
  return null;
}

function asCoord(pair: unknown): GeoCoordinateWgs84 | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const longitude = Number(pair[0]);
  const latitude = Number(pair[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

function flattenCoords(geometry: { type: string; coordinates: unknown } | null): GeoCoordinateWgs84[] {
  if (!geometry) return [];
  const walk = (value: unknown, out: GeoCoordinateWgs84[]): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number') {
      const coord = asCoord(value);
      if (coord) out.push(coord);
      return;
    }
    for (const child of value) walk(child, out);
  };
  const out: GeoCoordinateWgs84[] = [];
  walk(geometry.coordinates, out);
  return out;
}

function representative(vertices: GeoCoordinateWgs84[], kind: 'POINT' | 'POLYGON' | 'LINE'): GeoCoordinateWgs84 {
  if (vertices.length === 0) return { longitude: 0, latitude: 0 };
  if (kind === 'POINT') return vertices[0];
  const sum = vertices.reduce(
    (acc, point) => ({ longitude: acc.longitude + point.longitude, latitude: acc.latitude + point.latitude }),
    { longitude: 0, latitude: 0 },
  );
  return { longitude: sum.longitude / vertices.length, latitude: sum.latitude / vertices.length };
}

export function normalizePortName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLocaleLowerCase('tr-TR')
    .replace(/yat limanı|yat limani|marina/g, ' ')
    .replace(/limanı|limani|liman|harbour|harbor|port|iskele(si)?|vapur|terminal/g, ' ')
    .replace(/[^a-z0-9ğüşöçıâîû\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesSimilar(a: string | null, b: string | null): boolean {
  const left = normalizePortName(a);
  const right = normalizePortName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function collectPortCandidates(features: readonly OsmPortFeature[]): PortCandidate[] {
  const out: PortCandidate[] = [];
  for (const feature of features) {
    const sourceId = extractOsmPortFeatureId(feature);
    if (!sourceId) continue;
    const tags = feature.properties ?? {};
    const classified = classifyPortTags(tags);
    if (!classified.includeAsGeoPort) continue;
    const vertices = flattenCoords(feature.geometry);
    if (vertices.length === 0) continue;
    const geometryKind: PortCandidate['geometryKind'] =
      feature.geometry?.type === 'Point'
        ? 'POINT'
        : feature.geometry?.type === 'LineString' || feature.geometry?.type === 'MultiLineString'
          ? 'LINE'
          : 'POLYGON';
    out.push({
      sourceId,
      tags,
      name: typeof tags.name === 'string' && tags.name.trim() ? tags.name.trim() : null,
      operator: typeof tags.operator === 'string' && tags.operator.trim() ? tags.operator.trim() : null,
      position: representative(vertices, geometryKind),
      vertices,
      geometryKind,
      classification: classified,
    });
  }
  out.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const unique: PortCandidate[] = [];
  const seen = new Set<string>();
  for (const row of out) {
    if (seen.has(row.sourceId)) continue;
    seen.add(row.sourceId);
    unique.push(row);
  }
  return unique;
}

function shouldMerge(a: PortCandidate, b: PortCandidate): boolean {
  const distance = haversineMeters(a.position, b.position);
  const aInB = a.vertices.some((point) => haversineMeters(point, b.position) < CONTAINMENT_MERGE_METERS);
  const bInA = b.vertices.some((point) => haversineMeters(point, a.position) < CONTAINMENT_MERGE_METERS);
  if ((a.geometryKind === 'POLYGON' && bInA) || (b.geometryKind === 'POLYGON' && aInB)) return true;
  if (namesSimilar(a.name, b.name) && distance <= SAME_NAME_MERGE_METERS) return true;
  if (!a.name && !b.name && distance <= CONTAINMENT_MERGE_METERS) return true;
  if (a.name && b.name && !namesSimilar(a.name, b.name) && distance > DISTINCT_NAME_KEEP_APART_METERS) return false;
  if (distance <= CONTAINMENT_MERGE_METERS) return true;
  return false;
}

export function clusterPortCandidates(candidates: readonly PortCandidate[]): PortCandidate[][] {
  const parent = candidates.map((_, index) => index);
  const find = (i: number): number => {
    let cur = i;
    while (parent[cur] !== cur) {
      parent[cur] = parent[parent[cur]];
      cur = parent[cur];
    }
    return cur;
  };
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (shouldMerge(candidates[i], candidates[j])) {
        const pa = find(i);
        const pb = find(j);
        if (pa !== pb) parent[Math.max(pa, pb)] = Math.min(pa, pb);
      }
    }
  }
  const groups = new Map<number, PortCandidate[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(candidate);
    groups.set(root, list);
  });
  return [...groups.values()]
    .map((group) => [...group].sort((a, b) => a.sourceId.localeCompare(b.sourceId)))
    .sort((a, b) => a[0].sourceId.localeCompare(b[0].sourceId));
}

export function geoPortIdForSourceIds(sourceIds: readonly string[]): string {
  const digest = createHash('sha256').update([...sourceIds].sort().join('|')).digest('hex').slice(0, 12);
  return `infra.tur.port.${digest}`;
}

function pickDisplayName(group: PortCandidate[]): { displayName: string; sourceName: string | null } {
  return resolvePortDisplayName(group.map((row) => row.name).filter((name): name is string => Boolean(name)));
}

function evidenceFor(group: PortCandidate[]): GeoPortEvidence {
  const tags: Record<string, string | number | boolean | null> = {};
  const names: string[] = [];
  const cargoTags: string[] = [];
  const harbourTags: string[] = [];
  const terminalTags: string[] = [];
  for (const row of group) {
    if (row.name) names.push(row.name);
    const keep = new Set([
      'name',
      'operator',
      'harbour',
      'landuse',
      'industrial',
      'amenity',
      'leisure',
      'port',
      'cargo',
      'ferry',
      'seamark:type',
      'seamark:harbour:category',
      'man_made',
    ]);
    for (const [key, value] of Object.entries(row.tags)) {
      if (!keep.has(key)) continue;
      if (value == null || value === '') continue;
      if (!(key in tags)) tags[key] = typeof value === 'object' ? String(value) : (value as string | number | boolean);
    }
    if (row.tags.cargo != null) cargoTags.push(String(row.tags.cargo));
    if (row.tags.harbour != null) harbourTags.push(String(row.tags.harbour));
    if (row.tags.amenity === 'ferry_terminal') terminalTags.push('ferry_terminal');
  }
  const kinds = new Set(group.map((row) => row.geometryKind));
  return {
    osmIds: group.map((row) => row.sourceId),
    sourceTags: tags,
    names: [...new Set(names)].sort((a, b) => a.localeCompare(b, 'tr')),
    operator: group.map((row) => row.operator).find((value) => value) ?? null,
    cargoTags: [...new Set(cargoTags)].sort(),
    harbourTags: [...new Set(harbourTags)].sort(),
    terminalTags: [...new Set(terminalTags)].sort(),
    geometryEvidence: kinds.size > 1 ? 'MIXED' : kinds.has('POLYGON') ? 'POLYGON' : kinds.has('LINE') ? 'LINE' : 'POINT',
    officialQaReference: OFFICIAL_PORT_QA_STATUS,
  };
}

export function resolveSeaAccess(
  portId: string,
  vertices: GeoCoordinateWgs84[],
  landPolygons: ProjectedPolygon[] | null,
): PortSeaAccess {
  const fallback = vertices[0] ?? { longitude: 0, latitude: 0 };
  if (!landPolygons || landPolygons.length === 0) {
    return {
      portId,
      position: fallback,
      projected: projectWgs84ToNormalizedMercator(fallback.longitude, fallback.latitude),
      status: 'UNRESOLVED',
      evidence: 'No land polygon available to validate navigable water. Sea access not inferred from city coordinates.',
      failureReason: 'INSUFFICIENT_SOURCE',
      maritimeRegion: null,
      graphNodeId: null,
      searchRadiusMeters: null,
      failureStage: null,
      approachKind: null,
    };
  }
  const water = vertices.find((point) => {
    const projected = projectWgs84ToNormalizedMercator(point.longitude, point.latitude);
    return !pointInProjectedPolygons(projected, landPolygons);
  });
  if (water) {
    return {
      portId,
      position: water,
      projected: projectWgs84ToNormalizedMercator(water.longitude, water.latitude),
      status: 'PROVISIONAL',
      evidence: 'Vertex lies outside COUNTRY_HIGH land polygon (candidate water). Not a routed sea corridor.',
      failureReason: null,
      maritimeRegion: null,
      graphNodeId: null,
      searchRadiusMeters: null,
      failureStage: null,
      approachKind: null,
    };
  }
  return {
    portId,
    position: fallback,
    projected: projectWgs84ToNormalizedMercator(fallback.longitude, fallback.latitude),
    status: 'UNRESOLVED',
    evidence: 'All sampled vertices lie on land polygon. Centroid is not assumed navigable. No synthetic offshore offset.',
    failureReason: 'HARBOUR_GEOMETRY_MISSING',
    maritimeRegion: null,
    graphNodeId: null,
    searchRadiusMeters: null,
    failureStage: null,
    approachKind: null,
  };
}

export function buildGeoPortsFromClusters(
  clusters: PortCandidate[][],
  landPolygons: ProjectedPolygon[] | null,
  cities: Array<{ gameplayCityId: string; geoCityId: string; longitude: number; latitude: number }>,
): { ports: GeoPort[]; cityAssociations: CityPortAssociationSummary[]; issues: PortQaIssue[] } {
  const ports: GeoPort[] = [];
  for (const group of clusters) {
    const sourceIds = [...new Set(group.map((row) => row.sourceId))].sort();
    const id = geoPortIdForSourceIds(sourceIds);
    const merged = mergeClusterClassification(group.map((row) => row.classification));
    const names = pickDisplayName(group);
    const vertices = group.flatMap((row) => row.vertices);
    const position = representative(vertices, group.some((row) => row.geometryKind === 'POLYGON') ? 'POLYGON' : group[0].geometryKind);
    const lons = vertices.map((point) => point.longitude);
    const lats = vertices.map((point) => point.latitude);
    ports.push({
      id,
      geoCountryId: 'country.tur',
      displayName: names.displayName,
      sourceName: names.sourceName,
      position,
      projected: projectWgs84ToNormalizedMercator(position.longitude, position.latitude),
      bounds: {
        west: Math.min(...lons),
        south: Math.min(...lats),
        east: Math.max(...lons),
        north: Math.max(...lats),
      },
      classification: merged.classification,
      logisticsEligibility: merged.eligibility,
      sourceIds,
      provenance: {
        license: 'ODbL 1.0',
        sourceProvider: 'OpenStreetMap',
        officialQa: OFFICIAL_PORT_QA_STATUS,
      },
      verificationStatus: 'PROVISIONAL',
      cityAssociations: [],
      primaryForGameplayCityIds: [],
      attributes: {
        operator: group.map((row) => row.operator).find((value) => value) ?? null,
        capabilities: mergeCapabilities(group.map((row) => row.classification.capabilities)),
      },
      evidence: evidenceFor(group),
      seaAccess: resolveSeaAccess(id, vertices, landPolygons),
    });
  }
  ports.sort((a, b) => a.id.localeCompare(b.id));

  const assocPorts = ports.map((port) => ({
    portId: port.id,
    eligibility: port.logisticsEligibility,
    position: port.position,
  }));
  const cityAssociations: CityPortAssociationSummary[] = cities.map((city) => {
    const result = associateCityToPorts(city, assocPorts);
    return {
      gameplayCityId: city.gameplayCityId,
      geoCityId: city.geoCityId,
      associationType: result.associationType,
      portIds: result.portIds,
      primaryPortCandidateId: result.primaryPortCandidateId,
      notes: result.notes,
    };
  });
  for (const summary of cityAssociations) {
    const city = cities.find((row) => row.gameplayCityId === summary.gameplayCityId);
    if (!city) continue;
    const result = associateCityToPorts(city, assocPorts);
    for (const match of result.matches) {
      const port = ports.find((row) => row.id === match.portId);
      if (!port) continue;
      port.cityAssociations.push({
        gameplayCityId: city.gameplayCityId,
        geoCityId: city.geoCityId,
        associationType: match.associationType,
        distanceMeters: match.distanceMeters,
        evidence: summary.notes,
        portId: port.id,
      });
    }
    if (summary.primaryPortCandidateId) {
      const primary = ports.find((row) => row.id === summary.primaryPortCandidateId);
      if (primary && !primary.primaryForGameplayCityIds.includes(summary.gameplayCityId)) {
        primary.primaryForGameplayCityIds.push(summary.gameplayCityId);
      }
    }
  }

  const issues: PortQaIssue[] = [];
  for (const port of ports) {
    if (port.logisticsEligibility === 'LOGISTICS_ELIGIBLE' && port.seaAccess.status === 'UNRESOLVED') {
      issues.push({
        id: `qa.port.sea-access.${port.id}`,
        type: 'PORT_SEA_ACCESS',
        portId: port.id,
        evidence: port.seaAccess.evidence,
        resolutionStatus: 'OPEN',
      });
    }
    if (!port.sourceName && port.logisticsEligibility === 'LOGISTICS_ELIGIBLE') {
      issues.push({
        id: `qa.port.name.${port.id}`,
        type: 'PORT_NAME',
        portId: port.id,
        evidence: 'LOGISTICS_ELIGIBLE cluster has no OSM name',
        resolutionStatus: 'OPEN',
      });
    }
  }
  issues.push({
    id: 'qa.port.official.pending',
    type: 'PORT_SOURCE_DISCREPANCY',
    portId: null,
    evidence: 'TURKEY_PORT_AUTHORITY_SOURCE=PENDING_VERIFICATION. OSM records remain PROVISIONAL. No official geometry ingested.',
    resolutionStatus: 'OPEN',
  });

  return { ports, cityAssociations, issues };
}

export const PORT_POLICY_IDS = {
  classification: PORT_CLASSIFICATION_POLICY_VERSION,
  cluster: PORT_CLUSTER_POLICY_VERSION,
  processing: PORT_INGEST_PROCESSING_VERSION,
} as const;
