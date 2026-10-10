/**
 * Offline player AIR corridor generation (geodesic, build-time only).
 * Run: npx tsx scripts/map-v2/build-turkey-air-corridors.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AIRPORT_CARGO_POLICY_VERSION } from '../../src/mapV2/geo/airportClassPolicy';
import { GEODESIC_ALGORITHM_VERSION, sampleGeodesicPolyline } from '../../src/mapV2/geo/geodesic';
import type { TurkeyAirportPackageV1 } from '../../src/mapV2/geo/geoAirport';
import {
  AIR_ALLOW_PREVIEW_ONLY_ENDPOINTS,
  EXPECTED_AIR_SOURCE_AIRPORT_HASH,
  PLAYER_AIR_CORRIDOR_POLICY_VERSION,
  PLAYER_AIR_CORRIDOR_QUANTIZE,
  PLAYER_AIR_CORRIDOR_SCHEMA_VERSION,
  PLAYER_AIR_EXCLUDED_LEGACY_CITY_IDS,
  PLAYER_FACING_AIR_CORRIDOR_CANDIDATES,
  airCorridorIdForPair,
  type CompactPlayerAirCorridor,
  type PlayerFacingAirCorridorArtifactV1,
  type UnresolvedAirCorridorCandidate,
} from '../../src/mapV2/geo/playerFacingAirCorridor';
import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import { WEB_MERCATOR_PROJECTION_VERSION, projectWgs84ToNormalizedMercator } from '../../src/mapV2/geo/webMercator';
import { quantizeProjectedPoint } from '../../src/mapV2/geo/transportGeometry';
import { deltaEncodeQuantized } from '../../src/mapV2/geo/roadRuntimePackage';
import { geoCityIdForGameplayCity } from '../../src/mapV2/world/countryCityLoader';

const root = resolve(__dirname, '../..');
const airportsPath = resolve(root, 'src/mapV2/generated/infrastructure/turkey-airports.json');
const outDir = resolve(root, 'src/mapV2/generated/countryOverview');
const artifactPath = resolve(outDir, 'turkey-air-corridors.json');
const reportPath = resolve(outDir, 'turkey-air-corridors.report.json');
const lineagePath = resolve(outDir, 'turkey-air-corridors.lineage.json');

function hashCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function endpointFailure(airport: TurkeyAirportPackageV1['airports'][number] | undefined, cityId: string): string | null {
  if (!airport) return `${cityId}: missing logistics primary airport`;
  if (airport.operationalStatus !== 'OPERATIONAL') return `${cityId}: ${airport.iataCode} not operational`;
  if (airport.airLogisticsReadiness !== 'READY') return `${cityId}: readiness ${airport.airLogisticsReadiness}`;
  if (airport.cargoCapability !== 'VERIFIED_SUPPORTED') return `${cityId}: cargo ${airport.cargoCapability}`;
  if (airport.logisticsEligibility !== 'LOGISTICS_ELIGIBLE') return `${cityId}: eligibility ${airport.logisticsEligibility}`;
  if (airport.civilUse === 'MILITARY') return `${cityId}: military-only`;
  if (!Number.isFinite(airport.position.longitude) || !Number.isFinite(airport.position.latitude)) {
    return `${cityId}: non-finite coordinates`;
  }
  return null;
}

export function buildTurkeyAirCorridors(): {
  artifact: PlayerFacingAirCorridorArtifactV1;
  bytes: number;
  report: Record<string, unknown>;
} {
  const airports = JSON.parse(readFileSync(airportsPath, 'utf8')) as TurkeyAirportPackageV1;
  if (airports.contentHash !== EXPECTED_AIR_SOURCE_AIRPORT_HASH) {
    throw new Error(`Airport artifact hash mismatch: ${airports.contentHash}`);
  }
  const byId = new Map(airports.airports.map((row) => [row.id, row]));
  const assoc = Object.fromEntries(airports.cityAssociations.map((row) => [row.gameplayCityId, row]));
  const corridors: CompactPlayerAirCorridor[] = [];
  const unresolved: UnresolvedAirCorridorCandidate[] = [];
  const reportRows: Record<string, unknown>[] = [];
  const lineage: Record<string, unknown> = {};

  for (const candidate of PLAYER_FACING_AIR_CORRIDOR_CANDIDATES) {
    const [left, right] =
      candidate.fromLegacyCityId < candidate.toLegacyCityId
        ? [candidate.fromLegacyCityId, candidate.toLegacyCityId]
        : [candidate.toLegacyCityId, candidate.fromLegacyCityId];
    const id = airCorridorIdForPair(left, right);
    if (PLAYER_AIR_EXCLUDED_LEGACY_CITY_IDS.includes(left as 'bursa') || PLAYER_AIR_EXCLUDED_LEGACY_CITY_IDS.includes(right as 'bursa')) {
      unresolved.push({ fromLegacyCityId: left, toLegacyCityId: right, reason: 'Bursa is NOT_READY; no silent substitute endpoint.' });
      reportRows.push({ id, pair: `${left}-${right}`, status: 'UNRESOLVED', reason: 'bursa-excluded' });
      continue;
    }
    if (candidate.optional) {
      reportRows.push({
        id,
        pair: `${left}-${right}`,
        status: 'REJECTED',
        reason: 'optional-duplicate-coverage: Ankara already covers both inland READY cities; keep skeleton ≤7',
      });
      continue;
    }
    const fromAssoc = assoc[left];
    const toAssoc = assoc[right];
    const fromAirport = byId.get(fromAssoc?.primaryLogisticsAirportCandidateId ?? '');
    const toAirport = byId.get(toAssoc?.primaryLogisticsAirportCandidateId ?? '');
    const fromFail = endpointFailure(fromAirport, left);
    const toFail = endpointFailure(toAirport, right);
    const fromGeoCityId = geoCityIdForGameplayCity(left);
    const toGeoCityId = geoCityIdForGameplayCity(right);
    if (fromFail || toFail || !fromAirport || !toAirport || !fromGeoCityId || !toGeoCityId) {
      const reason = fromFail ?? toFail ?? 'endpoint or geo city failed';
      unresolved.push({ fromLegacyCityId: left, toLegacyCityId: right, reason });
      reportRows.push({ id, pair: `${left}-${right}`, status: 'UNRESOLVED', reason });
      continue;
    }
    const wgs84 = sampleGeodesicPolyline(fromAirport.position, toAirport.position);
    const projected = wgs84.map((point) => projectWgs84ToNormalizedMercator(point.longitude, point.latitude));
    if (projected.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      unresolved.push({ fromLegacyCityId: left, toLegacyCityId: right, reason: 'non-finite projected geodesic' });
      reportRows.push({ id, pair: `${left}-${right}`, status: 'UNRESOLVED', reason: 'non-finite projected geodesic' });
      continue;
    }
    const quantized: number[] = [];
    for (const point of projected) {
      quantized.push(...quantizeProjectedPoint(point, PLAYER_AIR_CORRIDOR_QUANTIZE));
    }
    const geodesicDistanceMeters = Math.round(haversineMeters(fromAirport.position, toAirport.position));
    corridors.push({
      id,
      fromLegacyCityId: left,
      toLegacyCityId: right,
      fromGeoCityId,
      toGeoCityId,
      fromAirportId: fromAirport.id,
      toAirportId: toAirport.id,
      fromIata: fromAirport.iataCode,
      toIata: toAirport.iataCode,
      fromIcao: fromAirport.icaoCode,
      toIcao: toAirport.icaoCode,
      endpointCargoCapabilityFrom: fromAirport.cargoCapability,
      endpointCargoCapabilityTo: toAirport.cargoCapability,
      endpointReadinessFrom: fromAirport.airLogisticsReadiness,
      endpointReadinessTo: toAirport.airLogisticsReadiness,
      status: 'VERIFIED_ENDPOINTS_PREVIEW',
      displayPriority: candidate.displayPriority,
      geodesicDistanceMeters,
      sampleCount: wgs84.length,
      q: deltaEncodeQuantized(quantized),
    });
    lineage[id] = {
      fromAirportId: fromAirport.id,
      toAirportId: toAirport.id,
      fromOsmIds: fromAirport.sourceIds,
      toOsmIds: toAirport.sourceIds,
      fromCargoEvidenceRefs: fromAirport.cargoEvidence.map((row) => row.sourceReference),
      toCargoEvidenceRefs: toAirport.cargoEvidence.map((row) => row.sourceReference),
    };
    reportRows.push({
      id,
      pair: `${left}-${right}`,
      iata: `${fromAirport.iataCode}-${toAirport.iataCode}`,
      status: 'VERIFIED_ENDPOINTS_PREVIEW',
      geodesicDistanceMeters,
      sampleCount: wgs84.length,
      projectedVertexCount: projected.length,
      readiness: `${fromAirport.airLogisticsReadiness}/${toAirport.airLogisticsReadiness}`,
      cargo: `${fromAirport.cargoCapability}/${toAirport.cargoCapability}`,
    });
  }

  corridors.sort((a, b) => a.id.localeCompare(b.id));
  const body: Omit<PlayerFacingAirCorridorArtifactV1, 'contentHash'> = {
    schemaVersion: PLAYER_AIR_CORRIDOR_SCHEMA_VERSION,
    countryId: 'country.tur',
    mode: 'AIR',
    sourceAirportArtifactHash: airports.contentHash,
    cargoQaPolicyVersion: AIRPORT_CARGO_POLICY_VERSION,
    geodesicAlgorithmVersion: GEODESIC_ALGORITHM_VERSION,
    corridorPolicyVersion: PLAYER_AIR_CORRIDOR_POLICY_VERSION,
    projectionVersion: WEB_MERCATOR_PROJECTION_VERSION,
    quantization: PLAYER_AIR_CORRIDOR_QUANTIZE,
    allowPreviewOnlyEndpoints: AIR_ALLOW_PREVIEW_ONLY_ENDPOINTS,
    corridors,
    unresolved,
  };
  const artifact: PlayerFacingAirCorridorArtifactV1 = { ...body, contentHash: hashCanonical(body) };
  const report = {
    contentHash: artifact.contentHash,
    sourceAirportArtifactHash: airports.contentHash,
    corridorCount: corridors.length,
    unresolvedCount: unresolved.length,
    bytes: 0,
    rows: reportRows,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`);
  report.bytes = statSync(artifactPath).size;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(lineagePath, `${JSON.stringify(lineage, null, 2)}\n`);
  return { artifact, bytes: report.bytes, report };
}

if (process.argv[1] && process.argv[1].endsWith('build-turkey-air-corridors.ts')) {
  const result = buildTurkeyAirCorridors();
  console.log(JSON.stringify({ bytes: result.bytes, contentHash: result.artifact.contentHash, corridors: result.artifact.corridors.length }, null, 2));
}
