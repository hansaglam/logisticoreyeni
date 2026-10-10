/**
 * ROAD→SEA→ROAD fixture builder. Consumes multimodal foundation + SEA *build report*
 * diagnostics. Player visual turkey-sea-corridors.json is not routing truth.
 */
import type { TurkeyPortPackageV1 } from '../geo/geoPort';
import {
  MULTIMODAL_DOMAIN_POLICY_VERSION,
  MULTIMODAL_DOMAIN_SCHEMA_VERSION,
  portPlanningNodeId,
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
  SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND,
  SOURCE_BACKED_SEA_DISTANCE_KIND,
} from './multimodalRuntime';
import { getTurkeyRoadTransferAccessArtifact } from '../world/multimodalRoadTransferAccessLoader';

export const SEA_SLICE_ROUTE_ALGORITHM_VERSION = 'dijkstra-length-gridweight-undirected-v1' as const;
export const SEA_SLICE_ROUTE_COST_POLICY_VERSION = 'sea-trunk-channel-local-near-endpoint-v1' as const;

export type SeaRouteDiagnosticPair = {
  fromLegacyCityId: string;
  toLegacyCityId: string;
  fromPortName: string;
  toPortName: string;
  fromSeaAccessId: string;
  toSeaAccessId: string;
  associationFrom: 'DIRECT' | 'REGIONAL';
  associationTo: 'DIRECT' | 'REGIONAL';
  sourceRouteLengthMeters: number;
  regions: string[];
  channels: string[];
  routeAlgorithmVersion: typeof SEA_SLICE_ROUTE_ALGORITHM_VERSION;
  routeCostPolicyVersion: typeof SEA_SLICE_ROUTE_COST_POLICY_VERSION;
  sourceSeaPackageHash: string;
  diagnosticBuildId: string;
};

export type SeaRouteDiagnosticsV1 = {
  sourceSeaPackageHash: string;
  sourcePortsArtifactHash: string;
  routeAlgorithmVersion: typeof SEA_SLICE_ROUTE_ALGORITHM_VERSION;
  routeCostPolicyVersion: typeof SEA_SLICE_ROUTE_COST_POLICY_VERSION;
  eligibleCities: string[];
  resolved: SeaRouteDiagnosticPair[];
};

type RawSeaReport = {
  sourceSeaPackageHash: string;
  sourcePortsArtifactHash: string;
  eligibleCities: string[];
  corridors: Array<{
    id: string;
    fromLegacyCityId: string;
    toLegacyCityId: string;
    fromPort: string;
    toPort: string;
    fromAccessNode: string;
    toAccessNode: string;
    associationFrom: 'DIRECT' | 'REGIONAL';
    associationTo: 'DIRECT' | 'REGIONAL';
    status: string;
    routeLengthMeters: number;
    regions: string[];
    channels: string[];
  }>;
};

export function parseSeaRouteDiagnostics(raw: RawSeaReport): SeaRouteDiagnosticsV1 {
  return {
    sourceSeaPackageHash: raw.sourceSeaPackageHash,
    sourcePortsArtifactHash: raw.sourcePortsArtifactHash,
    routeAlgorithmVersion: SEA_SLICE_ROUTE_ALGORITHM_VERSION,
    routeCostPolicyVersion: SEA_SLICE_ROUTE_COST_POLICY_VERSION,
    eligibleCities: [...raw.eligibleCities],
    resolved: raw.corridors
      .filter(
        (row) =>
          row.status === 'PROVISIONAL_SOURCE_PATH' &&
          row.routeLengthMeters > 0 &&
          Boolean(row.fromAccessNode) &&
          Boolean(row.toAccessNode),
      )
      .map((row) => ({
        fromLegacyCityId: row.fromLegacyCityId,
        toLegacyCityId: row.toLegacyCityId,
        fromPortName: row.fromPort,
        toPortName: row.toPort,
        fromSeaAccessId: row.fromAccessNode,
        toSeaAccessId: row.toAccessNode,
        associationFrom: row.associationFrom,
        associationTo: row.associationTo,
        sourceRouteLengthMeters: row.routeLengthMeters,
        regions: [...row.regions],
        channels: [...row.channels],
        routeAlgorithmVersion: SEA_SLICE_ROUTE_ALGORITHM_VERSION,
        routeCostPolicyVersion: SEA_SLICE_ROUTE_COST_POLICY_VERSION,
        sourceSeaPackageHash: raw.sourceSeaPackageHash,
        diagnosticBuildId: row.id,
      })),
  };
}

export function findSeaDiagnosticPair(
  diagnostics: SeaRouteDiagnosticsV1,
  origin: string,
  destination: string,
): SeaRouteDiagnosticPair | null {
  return (
    diagnostics.resolved.find(
      (row) =>
        (row.fromLegacyCityId === origin && row.toLegacyCityId === destination) ||
        (row.fromLegacyCityId === destination && row.toLegacyCityId === origin),
    ) ?? null
  );
}

export function listRoadSeaRoadEligiblePairs(
  foundation: MultimodalFoundationView,
  diagnostics: SeaRouteDiagnosticsV1,
): Array<{ origin: string; destination: string }> {
  const pairs: Array<{ origin: string; destination: string }> = [];
  for (const row of diagnostics.resolved) {
    if (!cityHasCapability(foundation, row.fromLegacyCityId, 'ROAD_TO_SEA')) continue;
    if (!cityHasCapability(foundation, row.toLegacyCityId, 'ROAD_TO_SEA')) continue;
    pairs.push({ origin: row.fromLegacyCityId, destination: row.toLegacyCityId });
    pairs.push({ origin: row.toLegacyCityId, destination: row.fromLegacyCityId });
  }
  return pairs.sort((a, b) => `${a.origin}.${a.destination}`.localeCompare(`${b.origin}.${b.destination}`));
}

export type RoadSeaRoadPreview = {
  originCityId: string;
  originRoadNodeId: string;
  originTransferId: string;
  originGeoPortId: string;
  originGeoPortName: string;
  originPortAssociation: 'DIRECT' | 'REGIONAL';
  originSeaAccessId: string;
  originSeaAccessStatus: 'PROVISIONAL';
  destinationGeoPortId: string;
  destinationGeoPortName: string;
  destinationPortAssociation: 'DIRECT' | 'REGIONAL';
  destinationSeaAccessId: string;
  destinationSeaAccessStatus: 'PROVISIONAL';
  destinationTransferId: string;
  destinationRoadNodeId: string;
  destinationCityId: string;
  legCount: 3;
  transferCount: 2;
  seaDistanceMeters: number;
  seaRouteReference: string;
  regions: string[];
  channels: string[];
  sourceSeaPackageHash: string;
  sourcePortsArtifactHash: string;
  routeAlgorithmVersion: typeof SEA_SLICE_ROUTE_ALGORITHM_VERSION;
  routeCostPolicyVersion: typeof SEA_SLICE_ROUTE_COST_POLICY_VERSION;
  sourceBacked: true;
  optionalVisualCorridorId: string | null;
};

export type RoadSeaRoadFixture =
  | {
      ok: true;
      plan: MultimodalShipmentPlan;
      transferNodes: [TransferNode, TransferNode];
      preview: RoadSeaRoadPreview;
      legDistances: [
        { distanceMeters: number; distanceKind: typeof SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
        { distanceMeters: number; distanceKind: typeof SOURCE_BACKED_SEA_DISTANCE_KIND },
        { distanceMeters: number; distanceKind: typeof SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
      ];
    }
    | { ok: false; reason: string };

function orientedEnds(pair: SeaRouteDiagnosticPair, origin: string) {
  const originIsFrom = pair.fromLegacyCityId === origin;
  return {
    originSeaAccessId: originIsFrom ? pair.fromSeaAccessId : pair.toSeaAccessId,
    destSeaAccessId: originIsFrom ? pair.toSeaAccessId : pair.fromSeaAccessId,
    originAssociation: originIsFrom ? pair.associationFrom : pair.associationTo,
    destAssociation: originIsFrom ? pair.associationTo : pair.associationFrom,
  };
}

export function buildRoadSeaRoadFixture(
  origin: string,
  destination: string,
  foundation: MultimodalFoundationView,
  diagnostics: SeaRouteDiagnosticsV1,
  ports: TurkeyPortPackageV1,
): RoadSeaRoadFixture {
  if (origin === destination) return { ok: false, reason: 'origin and destination must differ' };
  if (!cityHasCapability(foundation, origin, 'ROAD_TO_SEA')) {
    return { ok: false, reason: 'NO_ROAD_SEA_TRANSFER_AT_ORIGIN' };
  }
  if (!cityHasCapability(foundation, destination, 'ROAD_TO_SEA')) {
    return { ok: false, reason: 'NO_ROAD_SEA_TRANSFER_AT_DESTINATION' };
  }
  const seaPair = findSeaDiagnosticPair(diagnostics, origin, destination);
  if (!seaPair) {
    return { ok: false, reason: `no source-backed maritime route between ${origin} and ${destination}` };
  }
  const originTransfer = foundation.transferNodes.find((node) => node.id === transferNodeIdForPair(origin, 'road-sea'));
  const destTransfer = foundation.transferNodes.find((node) => node.id === transferNodeIdForPair(destination, 'road-sea'));
  const originPortId = originTransfer?.lineage.geoPortId ?? null;
  const destPortId = destTransfer?.lineage.geoPortId ?? null;
  if (!originTransfer || !originPortId) {
    return { ok: false, reason: 'NO_ROAD_SEA_TRANSFER_AT_ORIGIN' };
  }
  if (!destTransfer || !destPortId) {
    return { ok: false, reason: 'NO_ROAD_SEA_TRANSFER_AT_DESTINATION' };
  }
  const originPort = ports.ports.find((port) => port.id === originPortId);
  const destPort = ports.ports.find((port) => port.id === destPortId);
  if (!originPort) return { ok: false, reason: 'origin GeoPort unresolved' };
  if (!destPort) return { ok: false, reason: 'destination GeoPort unresolved' };
  if (originPort.seaAccess.status !== 'PROVISIONAL' || !originPort.seaAccess.graphNodeId) {
    return { ok: false, reason: 'origin PortSeaAccess not usable' };
  }
  if (destPort.seaAccess.status !== 'PROVISIONAL' || !destPort.seaAccess.graphNodeId) {
    return { ok: false, reason: 'destination PortSeaAccess not usable' };
  }
  const oriented = orientedEnds(seaPair, origin);
  if (originPort.seaAccess.graphNodeId !== oriented.originSeaAccessId) {
    return { ok: false, reason: 'origin sea access mismatch between GeoPort and source-backed route' };
  }
  if (destPort.seaAccess.graphNodeId !== oriented.destSeaAccessId) {
    return { ok: false, reason: 'destination sea access mismatch between GeoPort and source-backed route' };
  }
  const accessArtifact = getTurkeyRoadTransferAccessArtifact();
  const originRoad = findRoadTransferAccess(accessArtifact, origin, 'SEA', originPortId);
  const destRoad = findRoadTransferAccess(accessArtifact, destination, 'SEA', destPortId);
  if (!originRoad || originRoad.status !== 'READY') {
    return { ok: false, reason: 'ROAD_ACCESS_UNRESOLVED' };
  }
  if (!destRoad || destRoad.status !== 'READY') {
    return { ok: false, reason: 'ROAD_ACCESS_UNRESOLVED' };
  }
  const left = origin < destination ? origin : destination;
  const right = origin < destination ? destination : origin;
  const seaRouteReference = `domain.canonical.sea.${left}.${right}`;
  const planId = `plan.tur.r3s.${origin}.${destination}.v1`;
  const road1: TransportLeg = {
    id: `${planId}.leg.road1`,
    mode: 'ROAD',
    fromNodeId: roadOperationalNodeId(origin),
    toNodeId: originTransfer.id,
    fromInfrastructureId: origin,
    toInfrastructureId: originPortId,
    routeReference: originRoad.routeReference,
    status: 'PLANNED',
  };
  const sea: TransportLeg = {
    id: `${planId}.leg.sea`,
    mode: 'SEA',
    fromNodeId: portPlanningNodeId(origin),
    toNodeId: portPlanningNodeId(destination),
    fromInfrastructureId: originPort.seaAccess.graphNodeId,
    toInfrastructureId: destPort.seaAccess.graphNodeId,
    routeReference: seaRouteReference,
    status: 'PLANNED',
  };
  const road2: TransportLeg = {
    id: `${planId}.leg.road2`,
    mode: 'ROAD',
    fromNodeId: destTransfer.id,
    toNodeId: roadOperationalNodeId(destination),
    fromInfrastructureId: destPortId,
    toInfrastructureId: destination,
    routeReference: destRoad.routeReference,
    status: 'PLANNED',
  };
  const plan: MultimodalShipmentPlan = {
    id: planId,
    schemaVersion: MULTIMODAL_DOMAIN_SCHEMA_VERSION,
    originCityId: origin,
    destinationCityId: destination,
    legs: [road1, sea, road2],
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
      originGeoPortId: originPortId,
      originGeoPortName: originPort.displayName,
      originPortAssociation: oriented.originAssociation,
      originSeaAccessId: originPort.seaAccess.graphNodeId,
      originSeaAccessStatus: 'PROVISIONAL',
      destinationGeoPortId: destPortId,
      destinationGeoPortName: destPort.displayName,
      destinationPortAssociation: oriented.destAssociation,
      destinationSeaAccessId: destPort.seaAccess.graphNodeId,
      destinationSeaAccessStatus: 'PROVISIONAL',
      destinationTransferId: destTransfer.id,
      destinationRoadNodeId: road2.toNodeId,
      destinationCityId: destination,
      legCount: 3,
      transferCount: 2,
      seaDistanceMeters: seaPair.sourceRouteLengthMeters,
      seaRouteReference,
      regions: [...seaPair.regions],
      channels: [...seaPair.channels],
      sourceSeaPackageHash: seaPair.sourceSeaPackageHash,
      sourcePortsArtifactHash: diagnostics.sourcePortsArtifactHash,
      routeAlgorithmVersion: seaPair.routeAlgorithmVersion,
      routeCostPolicyVersion: seaPair.routeCostPolicyVersion,
      sourceBacked: true,
      optionalVisualCorridorId: seaPair.diagnosticBuildId,
    },
    legDistances: [
      { distanceMeters: originRoad.distanceMeters, distanceKind: SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
      { distanceMeters: seaPair.sourceRouteLengthMeters, distanceKind: SOURCE_BACKED_SEA_DISTANCE_KIND },
      { distanceMeters: destRoad.distanceMeters, distanceKind: SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND },
    ],
  };
}
