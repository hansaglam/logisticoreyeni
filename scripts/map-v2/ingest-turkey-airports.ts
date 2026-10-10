/**
 * Ingest OSM airport extract into turkey-airports.json. Does not invent facilities.
 * Run: npx tsx scripts/map-v2/ingest-turkey-airports.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TURKEY_AIRPORT_AUTHORITY_SOURCE } from '../../src/mapData/mapSourcePolicy';
import {
  GEO_AIRPORT_SCHEMA_VERSION,
  DHMI_QA_STATUS,
  type TurkeyAirportPackageV1,
} from '../../src/mapV2/geo/geoAirport';
import { TURKEY_AIRPORTS_GEOJSON_RAW_REL, TURKEY_OSM_PBF_RAW_REL } from '../../src/mapV2/geo/airportRawSource';
import { dequantizePolygons } from '../../src/mapV2/geo/worldBoundaryPackage';
import { projectWgs84ToNormalizedMercator } from '../../src/mapV2/geo/webMercator';
import { pointInProjectedPolygons, type ProjectedPolygon, type ProjectedRing } from '../../src/mapV2/geo/geometry';
import { geoCityIdForGameplayCity, getTurkeyCityPackage } from '../../src/mapV2/world/countryCityLoader';
import { getCountryRecord } from '../../src/mapV2/world/worldBoundaryLoader';
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../../src/mapV2/domain/ids';
import { classifyAirportTags } from '../../src/mapV2/geo/airportClassPolicy';
import {
  AIRPORT_POLICY_IDS,
  buildGeoAirportsFromClusters,
  clusterAirportCandidates,
  collectAirportCandidates,
  type OsmAirportFeature,
} from './airport-ingest-core';

const root = resolve(__dirname, '../..');
const geoPath = resolve(root, TURKEY_AIRPORTS_GEOJSON_RAW_REL);
const pbfPath = resolve(root, TURKEY_OSM_PBF_RAW_REL);
const outDir = resolve(root, 'src/mapV2/generated/infrastructure');
const artifactPath = resolve(outDir, 'turkey-airports.json');
const reportPath = resolve(outDir, 'turkey-airports.report.json');

function hashFile(path: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function hashCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function distToRing(point: { x: number; y: number }, ring: ProjectedRing): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < ring.length; i += 1) {
    const ax = ring[i - 1].x;
    const ay = ring[i - 1].y;
    const bx = ring[i].x;
    const by = ring[i].y;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-18;
    const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    min = Math.min(min, Math.hypot(point.x - px, point.y - py));
  }
  return min;
}

function inTurkeyScope(longitude: number, latitude: number, land: ProjectedPolygon[]): boolean {
  if (longitude < 25.6 || longitude > 45 || latitude < 35.8 || latitude > 42.4) return false;
  const projected = projectWgs84ToNormalizedMercator(longitude, latitude);
  if (pointInProjectedPolygons(projected, land)) return true;
  for (const polygon of land) {
    if (distToRing(projected, polygon.exterior) < 0.0006) return true;
  }
  return false;
}

export function ingestTurkeyAirportsFromDisk(): { artifact: TurkeyAirportPackageV1; bytes: number; report: Record<string, unknown> } {
  if (!existsSync(geoPath) || !existsSync(pbfPath)) {
    throw new Error('AIRPORT_FOUNDATION_BLOCKED_SOURCE');
  }
  const fc = JSON.parse(readFileSync(geoPath, 'utf8')) as { features?: OsmAirportFeature[] };
  const features = fc.features ?? [];
  const turkey = getCountryRecord('country.tur');
  if (!turkey) throw new Error('Missing Türkiye country geometry');
  const land = dequantizePolygons(turkey.lods.COUNTRY_HIGH.polygons);
  const candidatesAll = collectAirportCandidates(features);
  const candidates = candidatesAll.filter((row) => inTurkeyScope(row.position.longitude, row.position.latitude, land));
  const heliportExcludedCount = features.filter((feature) => classifyAirportTags(feature.properties ?? {}).classification === 'HELIPORT').length;
  const clusters = clusterAirportCandidates(candidates);
  const cityPkg = getTurkeyCityPackage();
  const cities = LEGACY_STABLE_GAMEPLAY_CITY_IDS.map((gameplayCityId) => {
    const geoCityId = geoCityIdForGameplayCity(gameplayCityId)!;
    const city = cityPkg.cities.find((row) => row.geoCityId === geoCityId)!;
    return {
      gameplayCityId,
      geoCityId,
      longitude: city.coordinate.longitude,
      latitude: city.coordinate.latitude,
    };
  });
  const built = buildGeoAirportsFromClusters(clusters, cities);
  const sourceHash = hashFile(pbfPath);
  const commercialCount = built.airports.filter((row) =>
    ['COMMERCIAL_AIRPORT', 'INTERNATIONAL_AIRPORT', 'DOMESTIC_AIRPORT', 'CARGO_AIRPORT'].includes(row.classification),
  ).length;
  const stats = {
    sourceFeatureCount: features.length,
    candidateObjectCount: candidates.length,
    logicalAirportCount: built.airports.length,
    commercialCount,
    logisticsEligibleCount: built.airports.filter((row) => row.logisticsEligibility === 'LOGISTICS_ELIGIBLE').length,
    passengerOnlyCount: built.airports.filter((row) => row.logisticsEligibility === 'PASSENGER_ONLY').length,
    militaryRestrictedCount: built.airports.filter((row) => row.logisticsEligibility === 'MILITARY_RESTRICTED').length,
    heliportExcludedCount,
    closedCount: built.airports.filter((row) => row.classification === 'CLOSED_OR_INACTIVE').length,
    provisionalCount: built.airports.filter((row) => row.verificationStatus === 'PROVISIONAL').length,
    unresolvedCount: built.airports.filter((row) => row.verificationStatus === 'UNRESOLVED').length,
    iataCount: built.airports.filter((row) => row.iataCode).length,
    icaoCount: built.airports.filter((row) => row.icaoCode).length,
    cargoVerifiedCount: built.airports.filter((row) => row.cargoCapability === 'VERIFIED_SUPPORTED').length,
    cargoProvisionalCount: built.airports.filter((row) => row.cargoCapability === 'PROVISIONAL_SUPPORTED').length,
    cargoUnknownCount: built.airports.filter((row) => row.cargoCapability === 'UNKNOWN').length,
    cargoUnavailableCount: built.airports.filter((row) => row.cargoCapability === 'KNOWN_UNAVAILABLE').length,
    logisticsPreviewCount: built.airports.filter((row) => row.logisticsEligibility === 'LOGISTICS_ELIGIBLE_PREVIEW').length,
    airReadyCount: built.airports.filter((row) => row.airLogisticsReadiness === 'READY').length,
  };
  const body: Omit<TurkeyAirportPackageV1, 'contentHash'> = {
    schemaVersion: GEO_AIRPORT_SCHEMA_VERSION,
    countryId: 'country.tur',
    mode: 'AIR',
    packageId: 'map-v2.country.tur.airports.v1',
    classificationPolicyVersion: AIRPORT_POLICY_IDS.classification,
    clusterPolicyVersion: AIRPORT_POLICY_IDS.cluster,
    processingVersion: AIRPORT_POLICY_IDS.processing,
    cargoPolicyVersion: AIRPORT_POLICY_IDS.cargo,
    officialQaStatus: DHMI_QA_STATUS,
    turkeyAirportAuthoritySource: TURKEY_AIRPORT_AUTHORITY_SOURCE,
    sourceManifest: {
      sourceName: 'OpenStreetMap-derived Türkiye aeroways (offline extract)',
      sourceURL: 'https://www.openstreetmap.org/copyright',
      license: 'ODbL 1.0',
      licenseURL: 'https://opendatacommons.org/licenses/odbl/1-0/',
      rawSourceFile: TURKEY_OSM_PBF_RAW_REL,
      sourceHash,
      retrievedAt: '2026-09-16',
      attributionRequired: true,
      productionApproved: false,
      notes:
        'GeoAirport catalog + DHMİ cargo QA. AIR route graph SOURCE_PENDING. Cargo UNKNOWN is not unavailable. Warehouse type=airport is not GeoAirport. Future AIR corridors only between READY logistics primaries.',
    },
    stats,
    airports: built.airports,
    cityAssociations: built.cityAssociations,
    issues: built.issues,
  };
  const artifact: TurkeyAirportPackageV1 = { ...body, contentHash: hashCanonical(body) };
  const report = {
    sourceHash,
    contentHash: artifact.contentHash,
    stats,
    cityAssociations: built.cityAssociations.map((row) => ({
      gameplayCityId: row.gameplayCityId,
      associationType: row.associationType,
      primaryAirportCandidateId: row.primaryAirportCandidateId,
      primaryPassengerAirportCandidateId: row.primaryPassengerAirportCandidateId,
      primaryLogisticsAirportCandidateId: row.primaryLogisticsAirportCandidateId,
      airLogisticsReadiness: row.airLogisticsReadiness,
      airportIds: row.airportIds,
    })),
    classificationBreakdown: Object.fromEntries(
      [...new Set(built.airports.map((row) => row.classification))].map((cls) => [
        cls,
        built.airports.filter((row) => row.classification === cls).length,
      ]),
    ),
    iataSample: built.airports
      .filter((row) => row.iataCode)
      .slice(0, 80)
      .map((row) => ({ id: row.id, iata: row.iataCode, name: row.displayName, class: row.classification })),
    issueCount: built.issues.length,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { artifact, bytes: statSync(artifactPath).size, report };
}

if (process.argv[1] && process.argv[1].endsWith('ingest-turkey-airports.ts')) {
  try {
    const result = ingestTurkeyAirportsFromDisk();
    console.log(JSON.stringify({ bytes: result.bytes, contentHash: result.artifact.contentHash, stats: result.artifact.stats }, null, 2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
