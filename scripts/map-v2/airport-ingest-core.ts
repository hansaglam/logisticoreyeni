import { createHash } from 'node:crypto';

import {
  classifyAirportTags,
  mergeAirportClusterClassification,
  readIata,
  readIcao,
  isMilitaryAirportTags,
  AIRPORT_CITY_ASSOCIATION_POLICY_VERSION,
  AIRPORT_CLASSIFICATION_POLICY_VERSION,
  AIRPORT_CLUSTER_POLICY_VERSION,
  AIRPORT_INGEST_PROCESSING_VERSION,
  AIRPORT_CARGO_POLICY_VERSION,
} from '../../src/mapV2/geo/airportClassPolicy';
import { associateCityToAirports } from '../../src/mapV2/geo/airportCityAssociation';
import { applyOfficialCargoQaToDraft, selectPassengerAndLogisticsPrimaries } from '../../src/mapV2/geo/airportCargoPolicy';
import { DHMI_IATA_SET, DHMI_IDENTITY_QA_ROWS } from '../../src/mapV2/geo/dhmiAirportQa';
import type {
  AirportCityAssociation,
  AirportQaIssue,
  AirportRunwayRecord,
  CityAirportAssociationSummary,
  GeoAirport,
  GeoAirportEvidence,
} from '../../src/mapV2/geo/geoAirport';
import { AIRPORT_VERIFIED_CRITERIA, DHMI_QA_STATUS } from '../../src/mapV2/geo/geoAirport';
import { haversineMeters, polylineLengthMeters } from '../../src/mapV2/geo/wgs84Distance';
import { projectWgs84ToNormalizedMercator, type GeoCoordinateWgs84 } from '../../src/mapV2/geo/webMercator';

export const AIRPORT_POLICY_IDS = {
  classification: AIRPORT_CLASSIFICATION_POLICY_VERSION,
  cluster: AIRPORT_CLUSTER_POLICY_VERSION,
  processing: AIRPORT_INGEST_PROCESSING_VERSION,
  city: AIRPORT_CITY_ASSOCIATION_POLICY_VERSION,
  cargo: AIRPORT_CARGO_POLICY_VERSION,
  verifiedCriteria: AIRPORT_VERIFIED_CRITERIA,
} as const;

export type OsmAirportFeature = {
  type: 'Feature';
  id?: string | number;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
};

export type AirportCandidate = {
  sourceId: string;
  tags: Record<string, unknown>;
  name: string | null;
  operator: string | null;
  iata: string | null;
  icao: string | null;
  position: GeoCoordinateWgs84;
  vertices: GeoCoordinateWgs84[];
  geometryKind: 'POINT' | 'POLYGON' | 'LINE';
  aeroway: string;
  classification: ReturnType<typeof classifyAirportTags>;
};

const SAME_NAME_MERGE_METERS = 4_000;
const CONTAINMENT_MERGE_METERS = 900;
const SUPPORT_ATTACH_METERS = 1_200;
const DISTINCT_KEEP_APART_METERS = 2_500;

export function extractOsmAirportFeatureId(feature: OsmAirportFeature): string | null {
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

export function normalizeAirportName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLocaleLowerCase('tr-TR')
    .replace(/uluslararası|international|havaalanı|havalimanı|airport|airfield|aerodrome/g, ' ')
    .replace(/[^a-z0-9ğüşöçıâîû\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesSimilar(a: string | null, b: string | null): boolean {
  const left = normalizeAirportName(a);
  const right = normalizeAirportName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function aerowayOf(tags: Record<string, unknown>): string {
  return String(tags.aeroway ?? '').trim().toLowerCase();
}

export function collectAirportCandidates(features: readonly OsmAirportFeature[]): AirportCandidate[] {
  const out: AirportCandidate[] = [];
  for (const feature of features) {
    const sourceId = extractOsmAirportFeatureId(feature);
    if (!sourceId) continue;
    const tags = feature.properties ?? {};
    const classified = classifyAirportTags(tags);
    const aeroway = aerowayOf(tags);
    if (!classified.includeAsGeoAirport && !classified.supportGeometry) continue;
    if (classified.classification === 'HELIPORT' && !classified.includeAsGeoAirport) continue;
    const vertices = flattenCoords(feature.geometry);
    if (vertices.length === 0) continue;
    const geometryKind: AirportCandidate['geometryKind'] =
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
      iata: readIata(tags),
      icao: readIcao(tags),
      position: representative(vertices, geometryKind),
      vertices,
      geometryKind,
      aeroway,
      classification: classified,
    });
  }
  out.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const unique: AirportCandidate[] = [];
  const seen = new Set<string>();
  for (const row of out) {
    if (seen.has(row.sourceId)) continue;
    seen.add(row.sourceId);
    unique.push(row);
  }
  return unique;
}

function conflictingIdentity(a: AirportCandidate, b: AirportCandidate): boolean {
  if (a.iata && b.iata && a.iata !== b.iata) return true;
  if (a.icao && b.icao && a.icao !== b.icao) return true;
  return false;
}

function shouldMergeSeeds(a: AirportCandidate, b: AirportCandidate): boolean {
  if (conflictingIdentity(a, b)) return false;
  const distance = haversineMeters(a.position, b.position);
  if (a.icao && b.icao && a.icao === b.icao) return true;
  if (a.iata && b.iata && a.iata === b.iata) return true;
  const aInB = a.vertices.some((point) => haversineMeters(point, b.position) < CONTAINMENT_MERGE_METERS);
  const bInA = b.vertices.some((point) => haversineMeters(point, a.position) < CONTAINMENT_MERGE_METERS);
  if ((a.geometryKind === 'POLYGON' && bInA) || (b.geometryKind === 'POLYGON' && aInB)) return true;
  if (namesSimilar(a.name, b.name) && distance <= SAME_NAME_MERGE_METERS) return true;
  if (!a.name && !b.name && distance <= CONTAINMENT_MERGE_METERS) return true;
  if (a.name && b.name && !namesSimilar(a.name, b.name) && distance > DISTINCT_KEEP_APART_METERS) return false;
  if (distance <= CONTAINMENT_MERGE_METERS) return true;
  return false;
}

function shouldAttachSupport(seed: AirportCandidate, support: AirportCandidate): boolean {
  if (conflictingIdentity(seed, support)) return false;
  if (seed.icao && support.icao && seed.icao === support.icao) return true;
  if (seed.iata && support.iata && seed.iata === support.iata) return true;
  const distance = haversineMeters(seed.position, support.position);
  if (seed.geometryKind === 'POLYGON' && support.vertices.some((point) => haversineMeters(point, seed.position) < CONTAINMENT_MERGE_METERS)) {
    return true;
  }
  if (distance <= SUPPORT_ATTACH_METERS) return true;
  if (namesSimilar(seed.name, support.name) && distance <= SAME_NAME_MERGE_METERS) return true;
  return false;
}

function unionFind(count: number): { parent: number[]; find: (i: number) => number; union: (a: number, b: number) => void } {
  const parent = Array.from({ length: count }, (_, index) => index);
  const find = (i: number): number => {
    let cur = i;
    while (parent[cur] !== cur) {
      parent[cur] = parent[parent[cur]];
      cur = parent[cur];
    }
    return cur;
  };
  const union = (a: number, b: number): void => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[Math.max(pa, pb)] = Math.min(pa, pb);
  };
  return { parent, find, union };
}

export function clusterAirportCandidates(candidates: readonly AirportCandidate[]): AirportCandidate[][] {
  const seeds = candidates.filter((row) => row.classification.includeAsGeoAirport);
  const support = candidates.filter((row) => !row.classification.includeAsGeoAirport && row.classification.supportGeometry);
  const { find, union } = unionFind(seeds.length);
  for (let i = 0; i < seeds.length; i += 1) {
    for (let j = i + 1; j < seeds.length; j += 1) {
      if (shouldMergeSeeds(seeds[i], seeds[j])) union(i, j);
    }
  }
  const groups = new Map<number, AirportCandidate[]>();
  seeds.forEach((seed, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(seed);
    groups.set(root, list);
  });
  const clustered = [...groups.values()];
  for (const row of support) {
    let bestIndex = -1;
    let bestDist = SUPPORT_ATTACH_METERS + 1;
    clustered.forEach((group, index) => {
      for (const seed of group) {
        if (!shouldAttachSupport(seed, row)) continue;
        const dist = haversineMeters(seed.position, row.position);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = index;
        }
      }
    });
    if (bestIndex >= 0) clustered[bestIndex].push(row);
  }
  return clustered
    .map((group) => [...group].sort((a, b) => a.sourceId.localeCompare(b.sourceId)))
    .sort((a, b) => a[0].sourceId.localeCompare(b[0].sourceId));
}

export function geoAirportIdForSourceIds(sourceIds: readonly string[]): string {
  const digest = createHash('sha256').update([...sourceIds].sort().join('|')).digest('hex').slice(0, 12);
  return `infra.tur.airport.${digest}`;
}

function pickDisplayName(group: AirportCandidate[]): { displayName: string; sourceName: string | null } {
  const seeds = group.filter((row) => row.classification.includeAsGeoAirport);
  const named = (seeds.length ? seeds : group)
    .map((row) => row.name)
    .filter((name): name is string => Boolean(name))
    .filter((name) => !/hangar|apron|gate|terminal binası|technic/i.test(name));
  const preferred = named.filter((name) => /havalimanı|havaalanı|airport|aerodrome|hava meydan/i.test(name));
  const pool = preferred.length ? preferred : named;
  pool.sort((a, b) => a.length - b.length || a.localeCompare(b, 'tr'));
  const sourceName = pool[0] ?? group.map((row) => row.name).find(Boolean) ?? null;
  const iata = group.map((row) => row.iata).find(Boolean) ?? null;
  const icao = group.map((row) => row.icao).find(Boolean) ?? null;
  if (sourceName) return { displayName: sourceName, sourceName };
  if (iata || icao) return { displayName: [iata, icao].filter(Boolean).join(' / '), sourceName: null };
  return { displayName: `Aerodrome ${group[0].sourceId}`, sourceName: null };
}

function pickPosition(group: AirportCandidate[]): GeoCoordinateWgs84 {
  const node = group.find((row) => row.geometryKind === 'POINT' && row.classification.includeAsGeoAirport);
  if (node) return node.position;
  const poly = group.find((row) => row.geometryKind === 'POLYGON' && row.classification.includeAsGeoAirport);
  if (poly) return poly.position;
  const seed = group.find((row) => row.classification.includeAsGeoAirport) ?? group[0];
  return seed.position;
}

function boundsOf(group: AirportCandidate[]): GeoAirport['bounds'] {
  const verts = group.flatMap((row) => row.vertices);
  if (verts.length === 0) return null;
  return {
    west: Math.min(...verts.map((row) => row.longitude)),
    south: Math.min(...verts.map((row) => row.latitude)),
    east: Math.max(...verts.map((row) => row.longitude)),
    north: Math.max(...verts.map((row) => row.latitude)),
  };
}

function runwayRecords(group: AirportCandidate[]): AirportRunwayRecord[] {
  return group
    .filter((row) => row.aeroway === 'runway' && row.vertices.length >= 2)
    .map((row) => {
      const first = row.vertices[0];
      const last = row.vertices[row.vertices.length - 1];
      const p1 = projectWgs84ToNormalizedMercator(first.longitude, first.latitude);
      const p2 = projectWgs84ToNormalizedMercator(last.longitude, last.latitude);
      return {
        sourceId: row.sourceId,
        ref: typeof row.tags.ref === 'string' && row.tags.ref.trim() ? String(row.tags.ref).trim() : null,
        surface: typeof row.tags.surface === 'string' && row.tags.surface.trim() ? String(row.tags.surface).trim() : null,
        lengthMeters: Math.round(polylineLengthMeters(row.vertices)),
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
      };
    })
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

function evidenceFor(group: AirportCandidate[]): GeoAirportEvidence {
  const tags: Record<string, string | number | boolean | null> = {};
  const names: string[] = [];
  const keep = new Set([
    'name',
    'operator',
    'aeroway',
    'aerodrome:type',
    'iata',
    'icao',
    'international',
    'military',
    'access',
    'cargo',
    'disused',
    'abandoned',
  ]);
  for (const row of group) {
    if (!row.classification.includeAsGeoAirport) continue;
    if (row.name) names.push(row.name);
    for (const [key, value] of Object.entries(row.tags)) {
      if (!keep.has(key) || value == null || value === '') continue;
      if (!(key in tags)) tags[key] = typeof value === 'object' ? String(value) : (value as string | number | boolean);
    }
  }
  if (Object.keys(tags).length === 0) {
    for (const row of group) {
      if (row.name) names.push(row.name);
      for (const [key, value] of Object.entries(row.tags)) {
        if (!keep.has(key) || value == null || value === '') continue;
        if (!(key in tags)) tags[key] = typeof value === 'object' ? String(value) : (value as string | number | boolean);
      }
    }
  }
  const kinds = new Set(group.map((row) => row.geometryKind));
  return {
    osmIds: group.map((row) => row.sourceId),
    sourceTags: tags,
    names: [...new Set(names)].sort((a, b) => a.localeCompare(b, 'tr')),
    operator: group.map((row) => row.operator).find((value) => value) ?? null,
    geometryEvidence: kinds.size > 1 ? 'MIXED' : kinds.has('POLYGON') ? 'POLYGON' : kinds.has('LINE') ? 'LINE' : 'POINT',
    officialQaReference: DHMI_QA_STATUS,
  };
}

export function buildGeoAirportsFromClusters(
  clusters: readonly AirportCandidate[][],
  cities: ReadonlyArray<{ gameplayCityId: string; geoCityId: string; longitude: number; latitude: number }>,
): {
  airports: GeoAirport[];
  cityAssociations: CityAirportAssociationSummary[];
  issues: AirportQaIssue[];
  heliportExcludedCount: number;
} {
  const issues: AirportQaIssue[] = [];
  const airports: GeoAirport[] = [];
  for (const group of clusters) {
    const merged = mergeAirportClusterClassification(group.map((row) => row.classification));
    const named = pickDisplayName(group);
    const position = pickPosition(group);
    const projected = projectWgs84ToNormalizedMercator(position.longitude, position.latitude);
    const sourceIds = group.map((row) => row.sourceId).sort();
    const runways = runwayRecords(group);
    const terminals = group.filter((row) => row.aeroway === 'terminal').length;
    const iata = group.map((row) => row.iata).find(Boolean) ?? null;
    const icao = group.map((row) => row.icao).find(Boolean) ?? null;
    const qa = iata ? DHMI_IDENTITY_QA_ROWS.find((row) => row.iata === iata) : undefined;
    let classification = merged.classification;
    let eligibility = merged.eligibility;
    let operationalStatus: GeoAirport['operationalStatus'] =
      merged.classification === 'CLOSED_OR_INACTIVE' ? 'CLOSED_OR_INACTIVE' : merged.classification === 'UNKNOWN_AIRPORT' ? 'UNKNOWN' : 'OPERATIONAL';
    if (qa?.role === 'CLOSED') {
      classification = 'CLOSED_OR_INACTIVE';
      eligibility = 'NON_LOGISTICS';
      operationalStatus = 'CLOSED_OR_INACTIVE';
    } else if (qa) {
      if (eligibility === 'MILITARY_RESTRICTED' || classification === 'MILITARY_AIRFIELD' || classification === 'GENERAL_AVIATION' || classification === 'UNKNOWN_AIRPORT') {
        classification = qa.role === 'INTERNATIONAL' ? 'INTERNATIONAL_AIRPORT' : 'DOMESTIC_AIRPORT';
        eligibility = 'PASSENGER_ONLY';
        operationalStatus = 'OPERATIONAL';
      } else if (qa.role === 'INTERNATIONAL' && (classification === 'COMMERCIAL_AIRPORT' || classification === 'DOMESTIC_AIRPORT')) {
        classification = 'INTERNATIONAL_AIRPORT';
      }
    }
    const osmMilitary = group.some((row) => isMilitaryAirportTags(row.tags));
    const qaApplied = applyOfficialCargoQaToDraft({
      iataCode: iata,
      osmMilitary,
      classification,
      operationalStatus,
      eligibility,
      cargoCapability: merged.cargoCapability,
      hasDhmiCivilIdentity: Boolean(iata && DHMI_IATA_SET.has(iata) && DHMI_IDENTITY_QA_ROWS.find((row) => row.iata === iata)?.role !== 'CLOSED'),
    });
    if (qaApplied.operationalQaApplied && qaApplied.operationalStatus === 'CLOSED_OR_INACTIVE' && operationalStatus !== 'CLOSED_OR_INACTIVE') {
      issues.push({
        id: `qa.disc.op.${geoAirportIdForSourceIds(sourceIds)}`,
        type: 'AIRPORT_SOURCE_DISCREPANCY',
        airportId: geoAirportIdForSourceIds(sourceIds),
        evidence: `${iata}: OSM cluster operational; official QA marks closed/replaced. OSM geometry preserved; operational eligibility follows official QA.`,
        resolutionStatus: 'OPEN',
      });
    }
    airports.push({
      id: geoAirportIdForSourceIds(sourceIds),
      geoCountryId: 'country.tur',
      displayName: qa?.name ?? named.displayName,
      sourceName: named.sourceName,
      position,
      projected,
      bounds: boundsOf(group),
      iataCode: iata,
      icaoCode: icao,
      classification,
      logisticsEligibility: qaApplied.logisticsEligibility,
      cargoCapability: qaApplied.cargoCapability,
      civilUse: qaApplied.civilUse,
      airLogisticsReadiness: qaApplied.airLogisticsReadiness,
      readinessReason: qaApplied.readinessReason,
      cargoEvidence: qaApplied.cargoEvidence,
      cargoTonnesYtd: qaApplied.cargoTonnesYtd,
      operationalStatus: qaApplied.operationalStatus,
      runwayCount: runways.length,
      terminalCount: terminals,
      runways,
      sourceIds,
      provenance: {
        license: 'ODbL 1.0',
        sourceProvider: 'OpenStreetMap',
        officialQa: DHMI_QA_STATUS,
      },
      verificationStatus: 'PROVISIONAL',
      cityAssociations: [],
      primaryForGameplayCityIds: [],
      attributes: { operator: group.map((row) => row.operator).find(Boolean) ?? null },
      evidence: evidenceFor(group),
    });
  }
  airports.sort((a, b) => a.id.localeCompare(b.id));

  const assocInput = airports.map((row) => ({
    airportId: row.id,
    eligibility: row.logisticsEligibility,
    classification: row.classification,
    position: row.position,
    iataCode: row.iataCode,
  }));
  const dualInput = airports.map((row) => ({
    airportId: row.id,
    iataCode: row.iataCode,
    eligibility: row.logisticsEligibility,
    classification: row.classification,
    position: row.position,
    operationalStatus: row.operationalStatus,
    cargoCapability: row.cargoCapability,
    civilUse: row.civilUse,
    airLogisticsReadiness: row.airLogisticsReadiness,
    cargoTonnesYtd: row.cargoTonnesYtd,
  }));
  const cityAssociations: CityAirportAssociationSummary[] = cities.map((city) => {
    const result = associateCityToAirports(city, assocInput);
    const dual = selectPassengerAndLogisticsPrimaries(city, dualInput);
    const airAccess = result.matches.map((match) => ({
      legacyCityId: city.gameplayCityId,
      geoAirportId: match.airportId,
      associationType: match.associationType,
      distanceMeters: match.distanceMeters,
      status: 'PROVISIONAL' as const,
      reason: result.notes,
    }));
    return {
      gameplayCityId: city.gameplayCityId,
      geoCityId: city.geoCityId,
      associationType: result.associationType,
      airportIds: result.airportIds,
      primaryAirportCandidateId: dual.primaryPassengerAirportCandidateId,
      primaryPassengerAirportCandidateId: dual.primaryPassengerAirportCandidateId,
      primaryLogisticsAirportCandidateId: dual.primaryLogisticsAirportCandidateId,
      airLogisticsReadiness: dual.cityReadiness,
      readinessReason: dual.cityReadinessReason,
      airAccess,
      notes: `${result.notes} ${dual.cityReadinessReason}`,
    };
  });

  const byId = new Map(airports.map((row) => [row.id, row]));
  for (const summary of cityAssociations) {
    for (const access of summary.airAccess) {
      const airport = byId.get(access.geoAirportId);
      if (!airport) continue;
      const link: AirportCityAssociation = {
        gameplayCityId: summary.gameplayCityId,
        geoCityId: summary.geoCityId,
        associationType: access.associationType,
        distanceMeters: access.distanceMeters,
        evidence: access.reason,
        airportId: airport.id,
      };
      airport.cityAssociations.push(link);
    }
    if (summary.primaryPassengerAirportCandidateId) {
      byId.get(summary.primaryPassengerAirportCandidateId)?.primaryForGameplayCityIds.push(summary.gameplayCityId);
    }
  }

  const osmIata = new Set(airports.map((row) => row.iataCode).filter((code): code is string => Boolean(code)));
  for (const row of DHMI_IDENTITY_QA_ROWS) {
    if (row.role === 'CLOSED') continue;
    if (!osmIata.has(row.iata)) {
      issues.push({
        id: `qa.missing.${row.iata}`,
        type: 'AIRPORT_SOURCE_DISCREPANCY',
        airportId: null,
        evidence: `DHMİ/public civil IATA ${row.iata} (${row.name}) not present on clustered OSM aerodromes`,
        resolutionStatus: 'OPEN',
      });
    }
  }
  for (const airport of airports) {
    if (airport.iataCode && DHMI_IATA_SET.has(airport.iataCode)) {
      const qa = DHMI_IDENTITY_QA_ROWS.find((row) => row.iata === airport.iataCode);
      if (qa?.role === 'CLOSED' && airport.operationalStatus !== 'CLOSED_OR_INACTIVE') {
        issues.push({
          id: `qa.status.${airport.id}`,
          type: 'AIRPORT_OPERATIONAL_STATUS',
          airportId: airport.id,
          evidence: `${airport.iataCode} listed closed/inactive in DHMİ identity QA`,
          resolutionStatus: 'OPEN',
        });
      }
    }
    if (
      (airport.classification === 'INTERNATIONAL_AIRPORT' || airport.classification === 'COMMERCIAL_AIRPORT') &&
      airport.cargoCapability === 'UNKNOWN'
    ) {
      issues.push({
        id: `qa.cargo.${airport.id}`,
        type: 'AIRPORT_CARGO_CAPABILITY',
        airportId: airport.id,
        evidence: 'Cargo UNKNOWN: OSM cargo tags absent. Absence is not KNOWN_UNAVAILABLE.',
        resolutionStatus: 'OPEN',
      });
    }
    if (airport.logisticsEligibility === 'MILITARY_RESTRICTED' && airport.cityAssociations.length > 0) {
      issues.push({
        id: `qa.mil.${airport.id}`,
        type: 'AIRPORT_CITY_ASSOCIATION',
        airportId: airport.id,
        evidence: 'Military airfield associated to gameplay city',
        resolutionStatus: 'OPEN',
      });
    }
  }

  return {
    airports,
    cityAssociations,
    issues,
    heliportExcludedCount: 0,
  };
}
