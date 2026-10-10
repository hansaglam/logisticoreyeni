/**
 * ROAD→RAIL→ROAD fixture builder. Consumes multimodal foundation + rail build diagnostics.
 * Player visual corridor geometry is not routing truth.
 */
import {
  MULTIMODAL_DOMAIN_POLICY_VERSION,
  MULTIMODAL_DOMAIN_SCHEMA_VERSION,
  railAccessPlanningNodeId,
  roadOperationalNodeId,
  transferNodeIdForPair,
  type MultimodalFoundationView,
  type MultimodalShipmentPlan,
  type TransferNode,
  type TransportLeg,
} from '../domain/multimodal';
import { findRoadTransferAccess } from '../../domain/multimodalRoadAccess';
import {
  estimateMultimodalRailTariff,
  RAIL_TARIFF_CARGO_QUANTITY_UNIT,
  RAIL_TARIFF_DISTANCE_AUTHORITY,
  type MultimodalRailTariffEstimate,
} from '../../domain/multimodalRailTariff';
import { cityHasCapability } from './multimodalFoundation';
import {
  SOURCE_BACKED_RAIL_DISTANCE_KIND,
  SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND,
} from './multimodalRuntime';
import { getTurkeyRoadTransferAccessArtifact } from '../world/multimodalRoadTransferAccessLoader';

export type RailRouteDiagnosticPair = {
  fromLegacyCityId: string;
  toLegacyCityId: string;
  fromAccess: {
    name: string | null;
    nodeId: string;
    status: string;
    kind: string | null;
    distanceMeters: number | null;
  };
  toAccess: {
    name: string | null;
    nodeId: string;
    status: string;
    kind: string | null;
    distanceMeters: number | null;
  };
  sourceRouteLengthMeters: number;
  sourceEdgeCount: number;
  componentId: string;
  routeAlgorithmVersion: string;
  sourceRailPackageHash: string;
  diagnosticBuildId: string;
};

export type RailRouteDiagnosticsV1 = {
  sourceRailPackageHash: string;
  routeAlgorithmVersion: string;
  access: ReadonlyArray<{
    legacyCityId: string;
    nodeId: string | null;
    status: string;
    accessName: string | null;
    accessKind: string | null;
    distanceMeters: number | null;
  }>;
  resolved: RailRouteDiagnosticPair[];
};

type RawReport = {
  sourceRailPackageHash: string;
  routeAlgorithmVersion: string;
  access: RailRouteDiagnosticsV1['access'];
  resolved: Array<{
    id: string;
    fromLegacyCityId: string;
    toLegacyCityId: string;
    fromAccess: RailRouteDiagnosticPair['fromAccess'];
    toAccess: RailRouteDiagnosticPair['toAccess'];
    sourceRouteLengthMeters: number;
    sourceEdgeCount: number;
    componentId: string;
    status: string;
  }>;
};

export function parseRailRouteDiagnostics(raw: RawReport): RailRouteDiagnosticsV1 {
  return {
    sourceRailPackageHash: raw.sourceRailPackageHash,
    routeAlgorithmVersion: raw.routeAlgorithmVersion,
    access: raw.access,
    resolved: raw.resolved
      .filter((row) => row.status === 'PROVISIONAL_SOURCE_PATH' && row.sourceRouteLengthMeters > 0)
      .map((row) => ({
        fromLegacyCityId: row.fromLegacyCityId,
        toLegacyCityId: row.toLegacyCityId,
        fromAccess: row.fromAccess,
        toAccess: row.toAccess,
        sourceRouteLengthMeters: row.sourceRouteLengthMeters,
        sourceEdgeCount: row.sourceEdgeCount,
        componentId: row.componentId,
        routeAlgorithmVersion: raw.routeAlgorithmVersion,
        sourceRailPackageHash: raw.sourceRailPackageHash,
        diagnosticBuildId: row.id,
      })),
  };
}

export function findRailDiagnosticPair(
  diagnostics: RailRouteDiagnosticsV1,
  origin: string,
  destination: string,
): RailRouteDiagnosticPair | null {
  return (
    diagnostics.resolved.find(
      (row) =>
        (row.fromLegacyCityId === origin && row.toLegacyCityId === destination) ||
        (row.fromLegacyCityId === destination && row.toLegacyCityId === origin),
    ) ?? null
  );
}

export function listRoadRailRoadEligiblePairs(
  foundation: MultimodalFoundationView,
  diagnostics: RailRouteDiagnosticsV1,
): Array<{ origin: string; destination: string }> {
  const pairs: Array<{ origin: string; destination: string }> = [];
  for (const row of diagnostics.resolved) {
    if (!cityHasCapability(foundation, row.fromLegacyCityId, 'ROAD_TO_RAIL')) continue;
    if (!cityHasCapability(foundation, row.toLegacyCityId, 'ROAD_TO_RAIL')) continue;
    pairs.push({ origin: row.fromLegacyCityId, destination: row.toLegacyCityId });
    pairs.push({ origin: row.toLegacyCityId, destination: row.fromLegacyCityId });
  }
  return pairs.sort((a, b) => `${a.origin}.${a.destination}`.localeCompare(`${b.origin}.${b.destination}`));
}

export type RoadRailRoadPreview = {
  originCityId: string;
  originRoadNodeId: string;
  originTransferId: string;
  originRailAccessId: string;
  originRailAccessName: string | null;
  originRoadAccessMeters: number;
  originRoadRouteReference: string;
  destinationRailAccessId: string;
  destinationRailAccessName: string | null;
  destinationTransferId: string;
  destinationRoadNodeId: string;
  destinationCityId: string;
  destinationRoadAccessMeters: number;
  destinationRoadRouteReference: string;
  legCount: 3;
  transferCount: 2;
  railDistanceMeters: number;
  railRouteReference: string;
  sourceRailPackageHash: string;
  routeAlgorithmVersion: string;
};

export type RoadRailRoadFixture =
  | {
      ok: true;
      plan: MultimodalShipmentPlan;
      transferNodes: [TransferNode, TransferNode];
      preview: RoadRailRoadPreview;
      railTariff: MultimodalRailTariffEstimate;
      legDistances: [
        { distanceMeters: number; distanceKind: typeof SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
        { distanceMeters: number; distanceKind: typeof SOURCE_BACKED_RAIL_DISTANCE_KIND },
        { distanceMeters: number; distanceKind: typeof SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
      ];
    }
    | { ok: false; reason: string };

export function buildRoadRailRoadFixture(
  origin: string,
  destination: string,
  foundation: MultimodalFoundationView,
  diagnostics: RailRouteDiagnosticsV1,
): RoadRailRoadFixture {
  if (origin === destination) return { ok: false, reason: 'origin and destination must differ' };
  if (!cityHasCapability(foundation, origin, 'ROAD_TO_RAIL')) {
    return { ok: false, reason: `${origin} has no ROAD↔RAIL transfer` };
  }
  if (!cityHasCapability(foundation, destination, 'ROAD_TO_RAIL')) {
    return { ok: false, reason: `${destination} has no ROAD↔RAIL transfer` };
  }
  const railPair = findRailDiagnosticPair(diagnostics, origin, destination);
  if (!railPair) {
    return { ok: false, reason: `no source-backed rail route between ${origin} and ${destination}` };
  }
  const originTransfer = foundation.transferNodes.find((node) => node.id === transferNodeIdForPair(origin, 'road-rail'));
  const destTransfer = foundation.transferNodes.find((node) => node.id === transferNodeIdForPair(destination, 'road-rail'));
  if (!originTransfer?.lineage.railAccessId || !destTransfer?.lineage.railAccessId) {
    return { ok: false, reason: 'missing ROAD↔RAIL transfer node' };
  }
  const originIsFrom = railPair.fromLegacyCityId === origin;
  const originAccess = originIsFrom ? railPair.fromAccess : railPair.toAccess;
  const destAccess = originIsFrom ? railPair.toAccess : railPair.fromAccess;
  if (originAccess.nodeId !== originTransfer.lineage.railAccessId || destAccess.nodeId !== destTransfer.lineage.railAccessId) {
    return { ok: false, reason: 'rail access mismatch between foundation and source-backed route' };
  }
  const accessArtifact = getTurkeyRoadTransferAccessArtifact();
  const originRoad = findRoadTransferAccess(accessArtifact, origin, 'RAIL', originTransfer.lineage.railAccessId);
  const destRoad = findRoadTransferAccess(accessArtifact, destination, 'RAIL', destTransfer.lineage.railAccessId);
  if (!originRoad || originRoad.status !== 'READY') {
    return { ok: false, reason: 'ROAD_ACCESS_UNRESOLVED' };
  }
  if (!destRoad || destRoad.status !== 'READY') {
    return { ok: false, reason: 'ROAD_ACCESS_UNRESOLVED' };
  }
  const left = origin < destination ? origin : destination;
  const right = origin < destination ? destination : origin;
  const railRouteReference = `domain.canonical.rail.${left}.${right}`;
  const planId = `plan.tur.r3r.${origin}.${destination}.v1`;
  const road1: TransportLeg = {
    id: `${planId}.leg.road1`,
    mode: 'ROAD',
    fromNodeId: roadOperationalNodeId(origin),
    toNodeId: originTransfer.id,
    fromInfrastructureId: origin,
    toInfrastructureId: originTransfer.lineage.railAccessId,
    routeReference: originRoad.routeReference,
    status: 'PLANNED',
  };
  const rail: TransportLeg = {
    id: `${planId}.leg.rail`,
    mode: 'RAIL',
    fromNodeId: railAccessPlanningNodeId(origin),
    toNodeId: railAccessPlanningNodeId(destination),
    fromInfrastructureId: originAccess.nodeId,
    toInfrastructureId: destAccess.nodeId,
    routeReference: railRouteReference,
    status: 'PLANNED',
  };
  const road2: TransportLeg = {
    id: `${planId}.leg.road2`,
    mode: 'ROAD',
    fromNodeId: destTransfer.id,
    toNodeId: roadOperationalNodeId(destination),
    fromInfrastructureId: destTransfer.lineage.railAccessId,
    toInfrastructureId: destination,
    routeReference: destRoad.routeReference,
    status: 'PLANNED',
  };
  const plan: MultimodalShipmentPlan = {
    id: planId,
    schemaVersion: MULTIMODAL_DOMAIN_SCHEMA_VERSION,
    originCityId: origin,
    destinationCityId: destination,
    legs: [road1, rail, road2],
    transfers: [originTransfer, destTransfer],
    status: 'PLANNED',
    provenance: {
      policyVersion: MULTIMODAL_DOMAIN_POLICY_VERSION,
      note: 'DEV_FIXTURE_ONLY_NOT_PERSISTED',
    },
  };
  const railTariff = estimateMultimodalRailTariff({
    routeReference: railRouteReference,
    distanceMeters: railPair.sourceRouteLengthMeters,
    distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
    cargoQuantity: 1,
    cargoQuantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
    sourceRailPackageHash: railPair.sourceRailPackageHash,
    intent: 'PLAN',
  });

  return {
    ok: true,
    plan,
    transferNodes: [originTransfer, destTransfer],
    railTariff,
    preview: {
      originCityId: origin,
      originRoadNodeId: road1.fromNodeId,
      originTransferId: originTransfer.id,
      originRailAccessId: originAccess.nodeId,
      originRailAccessName: originAccess.name,
      originRoadAccessMeters: originRoad.distanceMeters,
      originRoadRouteReference: originRoad.routeReference,
      destinationRailAccessId: destAccess.nodeId,
      destinationRailAccessName: destAccess.name,
      destinationTransferId: destTransfer.id,
      destinationRoadNodeId: road2.toNodeId,
      destinationCityId: destination,
      destinationRoadAccessMeters: destRoad.distanceMeters,
      destinationRoadRouteReference: destRoad.routeReference,
      legCount: 3,
      transferCount: 2,
      railDistanceMeters: railPair.sourceRouteLengthMeters,
      railRouteReference,
      sourceRailPackageHash: railPair.sourceRailPackageHash,
      routeAlgorithmVersion: railPair.routeAlgorithmVersion,
    },
    legDistances: [
      { distanceMeters: originRoad.distanceMeters, distanceKind: SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
      { distanceMeters: railPair.sourceRouteLengthMeters, distanceKind: SOURCE_BACKED_RAIL_DISTANCE_KIND },
      { distanceMeters: destRoad.distanceMeters, distanceKind: SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
    ],
  };
}

