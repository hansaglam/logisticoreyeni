/**
 * ROAD→AIR→ROAD fixture builder. Consumes multimodal foundation + AIR *build report*
 * diagnostics. Player visual turkey-air-corridors.json is not routing truth.
 * AIR is a logistics simulation abstraction, not a filed flight / ATC / airway route.
 */
import {
  MULTIMODAL_DOMAIN_POLICY_VERSION,
  MULTIMODAL_DOMAIN_SCHEMA_VERSION,
  airportPlanningNodeId,
  roadOperationalNodeId,
  transferNodeIdForPair,
  type MultimodalFoundationView,
  type MultimodalShipmentPlan,
  type TransferNode,
  type TransportLeg,
} from '../domain/multimodal';
import { cityHasCapability } from './multimodalFoundation';
import { findRoadTransferAccess } from '../../domain/multimodalRoadAccess';
import {
  SOURCE_BACKED_AIR_DISTANCE_KIND,
  SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND,
} from './multimodalRuntime';
import { getTurkeyRoadTransferAccessArtifact } from '../world/multimodalRoadTransferAccessLoader';

export const AIR_SLICE_GEODESIC_ALGORITHM_VERSION = 'map-v2-spherical-slerp-v1' as const;
export const AIR_SLICE_CARGO_QA_POLICY_VERSION = 'map-v2-airport-cargo-qa-v1' as const;
export const AIR_SLICE_SEMANTICS = 'LOGISTICS_SIMULATION_NOT_FLIGHT_PLAN' as const;

/** Compact IATA→ICAO for READY logistics primaries. Not an airport-catalog load. */
const LOGISTICS_IATA_ICAO: Record<string, string> = {
  ADB: 'LTBJ',
  IST: 'LTFM',
  ESB: 'LTAC',
  AYT: 'LTAI',
  COV: 'LTDB',
  DIY: 'LTCC',
  TZX: 'LTCG',
};

export type AirRouteDiagnosticPair = {
  fromLegacyCityId: string;
  toLegacyCityId: string;
  fromIata: string;
  toIata: string;
  fromIcao: string | null;
  toIcao: string | null;
  geodesicDistanceMeters: number;
  sampleCount: number;
  geodesicAlgorithmVersion: typeof AIR_SLICE_GEODESIC_ALGORITHM_VERSION;
  cargoQaPolicyVersion: typeof AIR_SLICE_CARGO_QA_POLICY_VERSION;
  sourceAirportArtifactHash: string;
  cargoCapabilityFrom: 'VERIFIED_SUPPORTED';
  cargoCapabilityTo: 'VERIFIED_SUPPORTED';
  readinessFrom: 'READY';
  readinessTo: 'READY';
  status: 'VERIFIED_ENDPOINTS_PREVIEW';
  diagnosticBuildId: string;
};

export type AirRouteDiagnosticsV1 = {
  sourceAirportArtifactHash: string;
  geodesicAlgorithmVersion: typeof AIR_SLICE_GEODESIC_ALGORITHM_VERSION;
  cargoQaPolicyVersion: typeof AIR_SLICE_CARGO_QA_POLICY_VERSION;
  resolved: AirRouteDiagnosticPair[];
  rejected: Array<{ fromLegacyCityId: string; toLegacyCityId: string; reason: string }>;
};

type RawAirReport = {
  sourceAirportArtifactHash: string;
  rows: Array<{
    id: string;
    pair: string;
    iata?: string;
    status: string;
    reason?: string;
    geodesicDistanceMeters?: number;
    sampleCount?: number;
    readiness?: string;
    cargo?: string;
  }>;
};

function splitPair(pair: string): { fromLegacyCityId: string; toLegacyCityId: string } | null {
  const idx = pair.indexOf('-');
  if (idx <= 0 || idx === pair.length - 1) return null;
  return { fromLegacyCityId: pair.slice(0, idx), toLegacyCityId: pair.slice(idx + 1) };
}

function parseReadyCargo(value: string | undefined, expected: 'READY' | 'VERIFIED_SUPPORTED'): boolean {
  if (!value) return false;
  const [left, right] = value.split('/');
  return left === expected && right === expected;
}

export function parseAirRouteDiagnostics(raw: RawAirReport): AirRouteDiagnosticsV1 {
  const rejected: AirRouteDiagnosticsV1['rejected'] = [];
  const resolved: AirRouteDiagnosticPair[] = [];
  for (const row of raw.rows) {
    const cities = splitPair(row.pair);
    if (!cities) continue;
    if (row.status === 'REJECTED') {
      rejected.push({ ...cities, reason: row.reason ?? 'rejected' });
      continue;
    }
    if (row.status !== 'VERIFIED_ENDPOINTS_PREVIEW') continue;
    if (!row.iata || !row.geodesicDistanceMeters || row.geodesicDistanceMeters <= 0) continue;
    if (!parseReadyCargo(row.readiness, 'READY')) continue;
    if (!parseReadyCargo(row.cargo, 'VERIFIED_SUPPORTED')) continue;
    const dash = row.iata.indexOf('-');
    if (dash <= 0) continue;
    const fromIata = row.iata.slice(0, dash);
    const toIata = row.iata.slice(dash + 1);
    resolved.push({
      fromLegacyCityId: cities.fromLegacyCityId,
      toLegacyCityId: cities.toLegacyCityId,
      fromIata,
      toIata,
      fromIcao: LOGISTICS_IATA_ICAO[fromIata] ?? null,
      toIcao: LOGISTICS_IATA_ICAO[toIata] ?? null,
      geodesicDistanceMeters: row.geodesicDistanceMeters,
      sampleCount: row.sampleCount ?? 0,
      geodesicAlgorithmVersion: AIR_SLICE_GEODESIC_ALGORITHM_VERSION,
      cargoQaPolicyVersion: AIR_SLICE_CARGO_QA_POLICY_VERSION,
      sourceAirportArtifactHash: raw.sourceAirportArtifactHash,
      cargoCapabilityFrom: 'VERIFIED_SUPPORTED',
      cargoCapabilityTo: 'VERIFIED_SUPPORTED',
      readinessFrom: 'READY',
      readinessTo: 'READY',
      status: 'VERIFIED_ENDPOINTS_PREVIEW',
      diagnosticBuildId: row.id,
    });
  }
  return {
    sourceAirportArtifactHash: raw.sourceAirportArtifactHash,
    geodesicAlgorithmVersion: AIR_SLICE_GEODESIC_ALGORITHM_VERSION,
    cargoQaPolicyVersion: AIR_SLICE_CARGO_QA_POLICY_VERSION,
    resolved,
    rejected,
  };
}

export function findAirDiagnosticPair(
  diagnostics: AirRouteDiagnosticsV1,
  origin: string,
  destination: string,
): AirRouteDiagnosticPair | null {
  return (
    diagnostics.resolved.find(
      (row) =>
        (row.fromLegacyCityId === origin && row.toLegacyCityId === destination) ||
        (row.fromLegacyCityId === destination && row.toLegacyCityId === origin),
    ) ?? null
  );
}

export function listRoadAirRoadEligiblePairs(
  foundation: MultimodalFoundationView,
  diagnostics: AirRouteDiagnosticsV1,
): Array<{ origin: string; destination: string }> {
  const pairs: Array<{ origin: string; destination: string }> = [];
  for (const row of diagnostics.resolved) {
    if (!cityHasCapability(foundation, row.fromLegacyCityId, 'ROAD_TO_AIR')) continue;
    if (!cityHasCapability(foundation, row.toLegacyCityId, 'ROAD_TO_AIR')) continue;
    pairs.push({ origin: row.fromLegacyCityId, destination: row.toLegacyCityId });
    pairs.push({ origin: row.toLegacyCityId, destination: row.fromLegacyCityId });
  }
  return pairs.sort((a, b) => `${a.origin}.${a.destination}`.localeCompare(`${b.origin}.${b.destination}`));
}

export type RoadAirRoadPreview = {
  originCityId: string;
  originRoadNodeId: string;
  originTransferId: string;
  originAirportId: string;
  originIata: string;
  originIcao: string | null;
  originCargoCapability: 'VERIFIED_SUPPORTED';
  originReadiness: 'READY';
  destinationAirportId: string;
  destinationIata: string;
  destinationIcao: string | null;
  destinationCargoCapability: 'VERIFIED_SUPPORTED';
  destinationReadiness: 'READY';
  destinationTransferId: string;
  destinationRoadNodeId: string;
  destinationCityId: string;
  legCount: 3;
  transferCount: 2;
  airDistanceMeters: number;
  airRouteReference: string;
  sampleCount: number;
  geodesicAlgorithmVersion: typeof AIR_SLICE_GEODESIC_ALGORITHM_VERSION;
  cargoQaPolicyVersion: typeof AIR_SLICE_CARGO_QA_POLICY_VERSION;
  sourceAirportArtifactHash: string;
  sourceBacked: true;
  airSemantics: typeof AIR_SLICE_SEMANTICS;
  optionalVisualCorridorId: string | null;
};

export type RoadAirRoadFixture =
  | {
      ok: true;
      plan: MultimodalShipmentPlan;
      transferNodes: [TransferNode, TransferNode];
      preview: RoadAirRoadPreview;
      legDistances: [
        { distanceMeters: number; distanceKind: typeof SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
        { distanceMeters: number; distanceKind: typeof SOURCE_BACKED_AIR_DISTANCE_KIND },
        { distanceMeters: number; distanceKind: typeof SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
      ];
    }
    | { ok: false; reason: string };

function oriented(pair: AirRouteDiagnosticPair, origin: string) {
  const originIsFrom = pair.fromLegacyCityId === origin;
  return {
    originIata: originIsFrom ? pair.fromIata : pair.toIata,
    destIata: originIsFrom ? pair.toIata : pair.fromIata,
    originIcao: originIsFrom ? pair.fromIcao : pair.toIcao,
    destIcao: originIsFrom ? pair.toIcao : pair.fromIcao,
  };
}

export function buildRoadAirRoadFixture(
  origin: string,
  destination: string,
  foundation: MultimodalFoundationView,
  diagnostics: AirRouteDiagnosticsV1,
): RoadAirRoadFixture {
  if (origin === destination) return { ok: false, reason: 'origin and destination must differ' };
  if (!cityHasCapability(foundation, origin, 'ROAD_TO_AIR')) {
    return { ok: false, reason: 'NO_READY_AIR_LOGISTICS_TRANSFER_AT_ORIGIN' };
  }
  if (!cityHasCapability(foundation, destination, 'ROAD_TO_AIR')) {
    return { ok: false, reason: 'NO_READY_AIR_LOGISTICS_TRANSFER_AT_DESTINATION' };
  }
  const airPair = findAirDiagnosticPair(diagnostics, origin, destination);
  if (!airPair) {
    return { ok: false, reason: `no source-backed air route between ${origin} and ${destination}` };
  }
  const ends = oriented(airPair, origin);
  const originTransfer = foundation.transferNodes.find(
    (node) => node.id === transferNodeIdForPair(origin, 'road-air', ends.originIata.toLowerCase()),
  );
  const destTransfer = foundation.transferNodes.find(
    (node) => node.id === transferNodeIdForPair(destination, 'road-air', ends.destIata.toLowerCase()),
  );
  const originAirportId = originTransfer?.lineage.geoAirportId ?? null;
  const destAirportId = destTransfer?.lineage.geoAirportId ?? null;
  if (!originTransfer || !originAirportId) {
    return { ok: false, reason: 'NO_READY_AIR_LOGISTICS_TRANSFER_AT_ORIGIN' };
  }
  if (!destTransfer || !destAirportId) {
    return { ok: false, reason: 'NO_READY_AIR_LOGISTICS_TRANSFER_AT_DESTINATION' };
  }
  if (airPair.cargoCapabilityFrom !== 'VERIFIED_SUPPORTED' || airPair.cargoCapabilityTo !== 'VERIFIED_SUPPORTED') {
    return { ok: false, reason: 'AIR cargo capability gate failed' };
  }
  if (airPair.readinessFrom !== 'READY' || airPair.readinessTo !== 'READY') {
    return { ok: false, reason: 'AIR readiness gate failed' };
  }
  const accessArtifact = getTurkeyRoadTransferAccessArtifact();
  const originRoad = findRoadTransferAccess(accessArtifact, origin, 'AIR', originAirportId);
  const destRoad = findRoadTransferAccess(accessArtifact, destination, 'AIR', destAirportId);
  if (!originRoad || originRoad.status !== 'READY') {
    return { ok: false, reason: 'ROAD_ACCESS_UNRESOLVED' };
  }
  if (!destRoad || destRoad.status !== 'READY') {
    return { ok: false, reason: 'ROAD_ACCESS_UNRESOLVED' };
  }
  const left = origin < destination ? origin : destination;
  const right = origin < destination ? destination : origin;
  const airRouteReference = `domain.canonical.air.${left}.${right}`;
  const planId = `plan.tur.r3a.${origin}.${destination}.v1`;
  const road1: TransportLeg = {
    id: `${planId}.leg.road1`,
    mode: 'ROAD',
    fromNodeId: roadOperationalNodeId(origin),
    toNodeId: originTransfer.id,
    fromInfrastructureId: origin,
    toInfrastructureId: originAirportId,
    routeReference: originRoad.routeReference,
    status: 'PLANNED',
  };
  const air: TransportLeg = {
    id: `${planId}.leg.air`,
    mode: 'AIR',
    fromNodeId: airportPlanningNodeId(origin),
    toNodeId: airportPlanningNodeId(destination),
    fromInfrastructureId: originAirportId,
    toInfrastructureId: destAirportId,
    routeReference: airRouteReference,
    status: 'PLANNED',
  };
  const road2: TransportLeg = {
    id: `${planId}.leg.road2`,
    mode: 'ROAD',
    fromNodeId: destTransfer.id,
    toNodeId: roadOperationalNodeId(destination),
    fromInfrastructureId: destAirportId,
    toInfrastructureId: destination,
    routeReference: destRoad.routeReference,
    status: 'PLANNED',
  };
  const plan: MultimodalShipmentPlan = {
    id: planId,
    schemaVersion: MULTIMODAL_DOMAIN_SCHEMA_VERSION,
    originCityId: origin,
    destinationCityId: destination,
    legs: [road1, air, road2],
    transfers: [originTransfer, destTransfer],
    status: 'PLANNED',
    provenance: {
      policyVersion: MULTIMODAL_DOMAIN_POLICY_VERSION,
      note: 'DEV_FIXTURE_ONLY_NOT_PERSISTED',
    },
  };
  return {
    ok: true,
    plan,
    transferNodes: [originTransfer, destTransfer],
    preview: {
      originCityId: origin,
      originRoadNodeId: road1.fromNodeId,
      originTransferId: originTransfer.id,
      originAirportId,
      originIata: ends.originIata,
      originIcao: ends.originIcao,
      originCargoCapability: 'VERIFIED_SUPPORTED',
      originReadiness: 'READY',
      destinationAirportId: destAirportId,
      destinationIata: ends.destIata,
      destinationIcao: ends.destIcao,
      destinationCargoCapability: 'VERIFIED_SUPPORTED',
      destinationReadiness: 'READY',
      destinationTransferId: destTransfer.id,
      destinationRoadNodeId: road2.toNodeId,
      destinationCityId: destination,
      legCount: 3,
      transferCount: 2,
      airDistanceMeters: airPair.geodesicDistanceMeters,
      airRouteReference,
      sampleCount: airPair.sampleCount,
      geodesicAlgorithmVersion: airPair.geodesicAlgorithmVersion,
      cargoQaPolicyVersion: airPair.cargoQaPolicyVersion,
      sourceAirportArtifactHash: airPair.sourceAirportArtifactHash,
      sourceBacked: true,
      airSemantics: AIR_SLICE_SEMANTICS,
      optionalVisualCorridorId: airPair.diagnosticBuildId,
    },
    legDistances: [
      { distanceMeters: originRoad.distanceMeters, distanceKind: SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
      { distanceMeters: airPair.geodesicDistanceMeters, distanceKind: SOURCE_BACKED_AIR_DISTANCE_KIND },
      { distanceMeters: destRoad.distanceMeters, distanceKind: SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
    ],
  };
}
