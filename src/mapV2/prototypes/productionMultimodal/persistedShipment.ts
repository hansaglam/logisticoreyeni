/**
 * PRODUCTION SCHEMA PROTOTYPES — NOT RUNTIME.
 * Do not import from store, save, simulation, screens, or backend.
 * DEV audit only (Map V2 Step 21).
 */
export const PRODUCTION_MULTIMODAL_SHIPMENT_SCHEMA_VERSION = 1 as const;
export const PRODUCTION_MULTIMODAL_CONTRACT_SCHEMA_VERSION = 1 as const;

export type ProductionTransportMode = 'ROAD' | 'RAIL' | 'SEA' | 'AIR';

export type ProductionShipmentStatus =
  | 'PLANNED'
  | 'ACTIVE'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ProductionLegStatus =
  | 'PLANNED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ProductionTransferStatus =
  | 'PENDING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'BLOCKED';

/**
 * Immutable commercial fields captured at future acceptance.
 * Step 26 does not write this into live `multimodalShipments` (SAVE_GAME_VERSION stays 6).
 * `modeCharges.RAIL` is third-party carrier COST, never player reward.
 */
export type ProductionEconomicSnapshot = {
  capturedAtGameHours: number;
  /** Player reward — not the RAIL carrier cost. Step 27. */
  reward: number;
  deadlineHours: number;
  fuelPricePerLiterAssumption: number;
  roadTollAssumption: number;
  modeCharges: Partial<Record<ProductionTransportMode, number>>;
  transferFeeAssumptions: number[];
  currency: 'USD_GAME';
  balancePolicyVersion: string;
  /** Future freeze of multimodal-rail-tariff-v1; unused in live save. */
  railTariffPolicyVersion?: string;
};

export type ProductionAssignedAssets = {
  originRoadTruckId?: string;
  originRoadDriverId?: string;
  destinationRoadTruckId?: string;
  destinationRoadDriverId?: string;
  /** Third-party capacity booking ids — not player-owned vehicles in MVP. */
  purchasedCapacityIds?: string[];
};

export type ProductionPersistedLegPlan = {
  id: string;
  mode: ProductionTransportMode;
  fromNodeId: string;
  toNodeId: string;
  fromInfrastructureId?: string;
  toInfrastructureId?: string;
  routeReference: string;
  distanceMeters: number;
  distanceKind: string;
};

export type ProductionPersistedLegRuntime = {
  status: ProductionLegStatus;
  progress: number;
  startedAtGameHours: number | null;
  expectedCompleteAtGameHours: number | null;
  completedAtGameHours: number | null;
  assignedAssetId?: string;
};

export type ProductionPersistedTransferPlan = {
  transferNodeId: string;
  fromMode: ProductionTransportMode;
  toMode: ProductionTransportMode;
  infrastructureRefs: string[];
};

export type ProductionPersistedTransferRuntime = {
  status: ProductionTransferStatus;
  progress: number;
  startedAtGameHours: number | null;
  expectedCompleteAtGameHours: number | null;
  completedAtGameHours: number | null;
  handlingSnapshot?: { feeAssumption: number };
};

/**
 * Additive save field proposal (reference). Live types:
 * `src/domain/multimodalShipmentPersistence.ts`
 * Missing field ⇒ []. Never convert live Delivery into this shape automatically.
 */
export type PersistedProductionMultimodalShipment = {
  schemaVersion: typeof PRODUCTION_MULTIMODAL_SHIPMENT_SCHEMA_VERSION;
  shipmentId: string;
  contractId: string;
  originCityId: string;
  destinationCityId: string;
  legs: Array<ProductionPersistedLegPlan & ProductionPersistedLegRuntime>;
  transfers: Array<ProductionPersistedTransferPlan & ProductionPersistedTransferRuntime>;
  currentStepIndex: number;
  status: ProductionShipmentStatus;
  timestamps: {
    acceptedAtGameHours: number;
    startedAtGameHours: number | null;
    lastProgressedRealAtMs: number | null;
    completedAtGameHours: number | null;
  };
  assignedAssets: ProductionAssignedAssets;
  economicSnapshot: ProductionEconomicSnapshot;
  settlementId?: string;
  settledAtGameHours?: number;
  provenance: {
    policyVersion: string;
    sourceBacked: true;
    notVisualCorridorJson: true;
  };
};

export type ProductionMultimodalContractOffer = {
  schemaVersion: typeof PRODUCTION_MULTIMODAL_CONTRACT_SCHEMA_VERSION;
  id: string;
  originCityId: string;
  destinationCityId: string;
  pattern: 'ROAD_RAIL_ROAD' | 'ROAD_SEA_ROAD' | 'ROAD_AIR_ROAD';
  productId: string;
  cargoWeight: number;
  payment: number;
  deadlineHours: number;
  status: 'available' | 'accepted' | 'expired' | 'cancelled';
  createdAt: number;
  expiresAt: number;
  planPreview: {
    modes: ProductionTransportMode[];
    transferCount: number;
    routeReferences: string[];
  };
};
