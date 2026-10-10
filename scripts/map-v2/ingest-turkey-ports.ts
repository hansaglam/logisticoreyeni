/**
 * Ingest OSM port extract into turkey-ports.json. Does not invent facilities.
 * Run: npx tsx scripts/map-v2/ingest-turkey-ports.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TURKEY_PORT_AUTHORITY_SOURCE } from '../../src/mapData/mapSourcePolicy';
import {
  GEO_PORT_SCHEMA_VERSION,
  OFFICIAL_PORT_QA_STATUS,
  type TurkeyPortPackageV1,
} from '../../src/mapV2/geo/geoPort';
import { TURKEY_OSM_PBF_RAW_REL, TURKEY_PORTS_GEOJSON_RAW_REL } from '../../src/mapV2/geo/portRawSource';
import { dequantizePolygons } from '../../src/mapV2/geo/worldBoundaryPackage';
import { projectWgs84ToNormalizedMercator } from '../../src/mapV2/geo/webMercator';
import { pointInProjectedPolygons, type ProjectedPolygon, type ProjectedRing } from '../../src/mapV2/geo/geometry';
import { geoCityIdForGameplayCity, getTurkeyCityPackage } from '../../src/mapV2/world/countryCityLoader';
import { getCountryRecord } from '../../src/mapV2/world/worldBoundaryLoader';
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../../src/mapV2/domain/ids';
import {
  buildGeoPortsFromClusters,
  clusterPortCandidates,
  collectPortCandidates,
  PORT_POLICY_IDS,
  type OsmPortFeature,
} from './port-ingest-core';

const root = resolve(__dirname, '../..');
const geoPath = resolve(root, TURKEY_PORTS_GEOJSON_RAW_REL);
const pbfPath = resolve(root, TURKEY_OSM_PBF_RAW_REL);
const outDir = resolve(root, 'src/mapV2/generated/infrastructure');
const artifactPath = resolve(outDir, 'turkey-ports.json');
const reportPath = resolve(outDir, 'turkey-ports.report.json');

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

function inTurkeyMaritimeScope(longitude: number, latitude: number, land: ProjectedPolygon[]): boolean {
  if (longitude < 25.6 || longitude > 45 || latitude < 35.8 || latitude > 42.4) return false;
  const projected = projectWgs84ToNormalizedMercator(longitude, latitude);
  if (pointInProjectedPolygons(projected, land)) return true;
  for (const polygon of land) {
    if (distToRing(projected, polygon.exterior) < 0.0004) return true;
  }
  return false;
}

export function ingestTurkeyPortsFromDisk(): { artifact: TurkeyPortPackageV1; bytes: number; report: Record<string, unknown> } {
  if (!existsSync(geoPath) || !existsSync(pbfPath)) {
    throw new Error('SEA_PORT_FOUNDATION_BLOCKED_SOURCE');
  }
  const fc = JSON.parse(readFileSync(geoPath, 'utf8')) as { features?: OsmPortFeature[] };
  const features = fc.features ?? [];
  const turkey = getCountryRecord('country.tur');
  if (!turkey) throw new Error('Missing Türkiye country geometry');
  const land = dequantizePolygons(turkey.lods.COUNTRY_HIGH.polygons);
  const candidatesAll = collectPortCandidates(features);
  const candidates = candidatesAll.filter((row) => inTurkeyMaritimeScope(row.position.longitude, row.position.latitude, land));
  const clusters = clusterPortCandidates(candidates);
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
  const built = buildGeoPortsFromClusters(clusters, land, cities);
  const sourceHash = hashFile(pbfPath);
  const stats = {
    sourceFeatureCount: features.length,
    candidateObjectCount: candidates.length,
    logicalPortCount: built.ports.length,
    logisticsEligibleCount: built.ports.filter((row) => row.logisticsEligibility === 'LOGISTICS_ELIGIBLE').length,
    passengerOnlyCount: built.ports.filter((row) => row.logisticsEligibility === 'PASSENGER_ONLY').length,
    localMaritimeCount: built.ports.filter((row) => row.logisticsEligibility === 'LOCAL_MARITIME').length,
    provisionalCount: built.ports.filter((row) => row.verificationStatus === 'PROVISIONAL').length,
    unresolvedCount: built.ports.filter((row) => row.verificationStatus === 'UNRESOLVED').length,
  };
  const body: Omit<TurkeyPortPackageV1, 'contentHash'> = {
    schemaVersion: GEO_PORT_SCHEMA_VERSION,
    countryId: 'country.tur',
    mode: 'SEA',
    packageId: 'map-v2.country.tur.ports.v1',
    classificationPolicyVersion: PORT_POLICY_IDS.classification,
    clusterPolicyVersion: PORT_POLICY_IDS.cluster,
    processingVersion: PORT_POLICY_IDS.processing,
    officialQaStatus: OFFICIAL_PORT_QA_STATUS,
    turkeyPortAuthoritySource: TURKEY_PORT_AUTHORITY_SOURCE,
    sourceManifest: {
      sourceName: 'OpenStreetMap-derived Türkiye ports/harbours (offline extract)',
      sourceURL: 'https://www.openstreetmap.org/copyright',
      license: 'ODbL 1.0',
      licenseURL: 'https://opendatacommons.org/licenses/odbl/1-0/',
      rawSourceFile: TURKEY_OSM_PBF_RAW_REL,
      sourceHash,
      retrievedAt: '2026-09-16',
      attributionRequired: true,
      productionApproved: false,
      notes:
        'GeoPort catalog only. SEA graph remains SOURCE_PENDING. TURKEY_PORT_AUTHORITY_SOURCE PENDING_VERIFICATION. Marinas/piers excluded from freight list. Player warehouse type=port is not GeoPort.',
    },
    stats,
    ports: built.ports,
    cityAssociations: built.cityAssociations,
    issues: built.issues,
  };
  const artifact: TurkeyPortPackageV1 = { ...body, contentHash: hashCanonical(body) };
  const report = {
    sourceHash,
    contentHash: artifact.contentHash,
    stats,
    cityAssociations: built.cityAssociations,
    logisticsSample: built.ports
      .filter((row) => row.logisticsEligibility === 'LOGISTICS_ELIGIBLE')
      .slice(0, 40)
      .map((row) => ({ id: row.id, name: row.displayName, class: row.classification })),
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { artifact, bytes: statSync(artifactPath).size, report };
}

if (process.argv[1] && process.argv[1].endsWith('ingest-turkey-ports.ts')) {
  try {
    const result = ingestTurkeyPortsFromDisk();
    console.log(JSON.stringify({ bytes: result.bytes, contentHash: result.artifact.contentHash, stats: result.artifact.stats }, null, 2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
