/**
 * Multimodal logistics domain foundation (STEP 17).
 *
 * Separate from live Contract / Delivery. Not persisted. Not economy.
 * A shipment is legs + transfers, not one recolored route.
 *
 * Live gameplay remains truck + cityId + routes.ts distance.
 */
import type { MapV2TransportMode } from './transport';
import type { LegacyStableGameplayCityId } from './ids';

export const MULTIMODAL_DOMAIN_SCHEMA_VERSION = 1 as const;
export const MULTIMODAL_DOMAIN_POLICY_VERSION = 'map-v2-multimodal-logistics-foundation-v1' as const;
export const MULTIMODAL_MAX_TRANSPORT_LEGS = 4 as const;
export const LIVE_DELIVERY_IS_NOT_MULTIMODAL_SHIPMENT = true as const;

export const MODE_OPERATIONAL_READINESS = {
  ROAD: 'ACTIVE',
  RAIL: 'FOUNDATION_ONLY',
  SEA: 'FOUNDATION_ONLY',
  AIR: 'FOUNDATION_ONLY',
} as const satisfies Record<MapV2TransportMode, ModeOperationalReadiness>;

export type ModeOperationalReadiness = 'ACTIVE' | 'FOUNDATION_ONLY' | 'INACTIVE';

export type MultimodalReadiness = 'READY_FOR_DOMAIN' | 'READY_FOR_PREVIEW' | 'NOT_READY';

export type CityModeMatrixStatus = 'ACTIVE' | 'PROVISIONAL' | 'UNAVAILABLE' | 'NOT_READY';

export type TransferCapability =
  | 'ROAD_TO_RAIL'
  | 'RAIL_TO_ROAD'
  | 'ROAD_TO_SEA'
  | 'SEA_TO_ROAD'
  | 'ROAD_TO_AIR'
  | 'AIR_TO_ROAD'
  | 'RAIL_TO_SEA'
  | 'SEA_TO_RAIL'
  | 'RAIL_TO_AIR'
  | 'AIR_TO_RAIL';

export type TransferEvidenceType =
  | 'CITY_RAIL_ACCESS'
  | 'CITY_PORT_ASSOCIATION'
  | 'CITY_AIRPORT_LOGISTICS_PRIMARY'
  | 'SAME_CITY_COPRESENCE_INSUFFICIENT'
  | 'NO_INFRASTRUCTURE';

export type TransferVerificationStatus = 'VERIFIED' | 'PROVISIONAL' | 'UNRESOLVED';

export type TransportLegStatus =
  | 'PLANNED'
  | 'WAITING_TRANSFER'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type MultimodalShipmentStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type TransferRuntimeStatus = 'PENDING' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';

export type CargoConstraintFlag =
  | 'requiresColdChain'
  | 'hazardous'
  | 'oversized'
  | 'containerized'
  | 'timeCritical';

export type CargoTransportCompatibility = {
  cargoType: string;
  allowedModes: readonly MapV2TransportMode[];
  constraints: readonly CargoConstraintFlag[];
};

export const GENERIC_CARGO_COMPATIBILITY: CargoTransportCompatibility = {
  cargoType: 'GENERIC',
  allowedModes: ['ROAD', 'RAIL', 'SEA', 'AIR'],
  constraints: [],
};

export type TransferNodeEvidence = {
  infrastructureRefs: readonly string[];
  modePair: TransferCapability;
  evidenceType: TransferEvidenceType;
  status: TransferVerificationStatus;
  reason: string;
};

export type TransferNode = {
  id: string;
  geoCountryId: 'country.tur';
  gameplayCityId: LegacyStableGameplayCityId;
  geoCityId: string;
  supportedModes: readonly MapV2TransportMode[];
  infrastructureRefs: readonly string[];
  transferCapabilities: readonly TransferCapability[];
  verificationStatus: TransferVerificationStatus;
  localTransferDistanceMeters: number | null;
  evidence: readonly TransferNodeEvidence[];
  lineage: {
    legacyCityId: LegacyStableGameplayCityId;
    geoPortId: string | null;
    geoAirportId: string | null;
    railAccessId: string | null;
  };
};

export type TransportLeg = {
  id: string;
  mode: MapV2TransportMode;
  fromNodeId: string;
  toNodeId: string;
  fromInfrastructureId?: string;
  toInfrastructureId?: string;
  /** Domain/canonical availability — never a player visual corridor id as sole truth. */
  routeReference?: string;
  status: TransportLegStatus;
};

export type MultimodalShipmentPlan = {
  id: string;
  schemaVersion: typeof MULTIMODAL_DOMAIN_SCHEMA_VERSION;
  originCityId: string;
  destinationCityId: string;
  legs: readonly TransportLeg[];
  transfers: readonly TransferNode[];
  status: MultimodalShipmentStatus;
  provenance: {
    policyVersion: typeof MULTIMODAL_DOMAIN_POLICY_VERSION;
    note: 'DEV_FIXTURE_ONLY_NOT_PERSISTED';
  };
};

export type PlanningGraphNodeKind =
  | 'ROAD_OPERATIONAL'
  | 'RAIL_ACCESS'
  | 'PORT'
  | 'AIRPORT'
  | 'TRANSFER';

export type PlanningGraphEdgeKind = 'TRANSPORT_LEG' | 'TRANSFER';

export type MultimodalPlanningNode = {
  id: string;
  kind: PlanningGraphNodeKind;
  gameplayCityId: LegacyStableGameplayCityId;
  mode: MapV2TransportMode | null;
  transferNodeId?: string;
  infrastructureId?: string;
};

export type MultimodalPlanningEdge = {
  id: string;
  kind: PlanningGraphEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  mode?: MapV2TransportMode;
  transferNodeId?: string;
  /** Canonical/source-backed availability, not turkey-*-corridors.json. */
  routeReference: string;
};

export type CityModeMatrixRow = {
  gameplayCityId: LegacyStableGameplayCityId;
  ROAD: CityModeMatrixStatus;
  RAIL: CityModeMatrixStatus;
  SEA: CityModeMatrixStatus;
  AIR: CityModeMatrixStatus;
};

export type CityTransferMatrixRow = {
  gameplayCityId: LegacyStableGameplayCityId;
  capabilities: readonly TransferCapability[];
  unresolvedNotes: readonly string[];
};

export type MultimodalFoundationView = {
  schemaVersion: typeof MULTIMODAL_DOMAIN_SCHEMA_VERSION;
  policyVersion: typeof MULTIMODAL_DOMAIN_POLICY_VERSION;
  countryId: 'country.tur';
  multimodalReadiness: MultimodalReadiness;
  modeOperationalReadiness: typeof MODE_OPERATIONAL_READINESS;
  cityModeMatrix: readonly CityModeMatrixRow[];
  cityTransferMatrix: readonly CityTransferMatrixRow[];
  transferNodes: readonly TransferNode[];
  planningGraph: {
    nodes: readonly MultimodalPlanningNode[];
    edges: readonly MultimodalPlanningEdge[];
  };
  cargoCompatibility: readonly CargoTransportCompatibility[];
};

export function roadOperationalNodeId(legacyCityId: string): string {
  return `planning.tur.road.${legacyCityId}.v1`;
}

export function railAccessPlanningNodeId(legacyCityId: string): string {
  return `planning.tur.rail.${legacyCityId}.v1`;
}

export function portPlanningNodeId(legacyCityId: string): string {
  return `planning.tur.sea.${legacyCityId}.v1`;
}

export function airportPlanningNodeId(legacyCityId: string): string {
  return `planning.tur.air.${legacyCityId}.v1`;
}

export function transferNodeIdForPair(
  legacyCityId: string,
  pair: 'road-rail' | 'road-sea' | 'road-air' | 'rail-sea' | 'rail-air',
  qualifier?: string,
): string {
  const suffix = qualifier ? `.${qualifier.toLowerCase()}` : '';
  return `transfer.tur.${legacyCityId}.${pair}${suffix}.v1`;
}

export function formatModeSequence(modes: readonly MapV2TransportMode[]): string {
  return modes.join('→');
}
