/**
 * Production multimodal shipment persistence foundation (Map V2 Step 22).
 *
 * Additive save field only. Not a live gameplay module.
 * Do not import Map V2 screens, Skia, or prototype runtime from here.
 */

/**
 * Persistence rollout default. Live env is resolved via multimodalFeatureRollout
 * (EXPO_PUBLIC_MULTIMODAL_ROLLOUT). Missing/invalid → MULTIMODAL_OFF.
 * Do not treat this constant as INTERNAL_TEST; public default stays off.
 */

import { resolveMultimodalFeatureRollout } from './multimodalFeatureRollout';

export const SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION = 1 as const;

/** Nested document version — independent of SAVE_GAME_VERSION (ADR 0012). */
export const MULTIMODAL_SHIPMENT_SCHEMA_VERSION = SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION;

export const MULTIMODAL_FEATURE_ROLLOUT = resolveMultimodalFeatureRollout();

/** INTERNAL_TEST safety cap — not a future product concurrency limit. */
export const MAX_ACTIVE_MULTIMODAL_SHIPMENTS_INTERNAL = 1;

/** Safety cap: this array is not an unbounded history log. */
export const MAX_PERSISTED_MULTIMODAL_SHIPMENTS = 24;

const MAX_UNREADABLE_OPAQUE_JSON_CHARS = 12_000;
const MAX_ID_LENGTH = 128;
const MAX_ROUTE_REFERENCE_LENGTH = 256;
const MAX_LEGS = 8;
const MAX_TRANSFERS = 8;

export type PersistedTransportMode = 'ROAD' | 'RAIL' | 'SEA' | 'AIR';

export type PersistedMultimodalShipmentStatus =
  | 'PLANNED'
  | 'ACTIVE'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'COMPLETED_UNSETTLED'
  | 'FAILED'
  | 'CANCELLED';

export type PersistedMultimodalLegStatus =
  | 'PLANNED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type PersistedMultimodalTransferStatus =
  | 'PENDING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'BLOCKED';

const TRANSPORT_MODES = new Set<string>(['ROAD', 'RAIL', 'SEA', 'AIR']);
const SHIPMENT_STATUSES = new Set<string>([
  'PLANNED',
  'ACTIVE',
  'BLOCKED',
  'COMPLETED',
  'COMPLETED_UNSETTLED',
  'FAILED',
  'CANCELLED',
]);
const LEG_STATUSES = new Set<string>([
  'PLANNED',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
const TRANSFER_STATUSES = new Set<string>([
  'PENDING',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'BLOCKED',
]);

const SUPPORTED_TRANSFER_PAIRS = new Set<string>([
  'ROAD|RAIL',
  'RAIL|ROAD',
  'ROAD|SEA',
  'SEA|ROAD',
  'ROAD|AIR',
  'AIR|ROAD',
]);

const IN_FLIGHT_STATUSES = new Set<PersistedMultimodalShipmentStatus>([
  'PLANNED',
  'ACTIVE',
  'BLOCKED',
]);

const DEV_OR_GEOMETRY_KEYS = new Set([
  'DEV_SIMULATION_SPEEDS',
  'DEV_SIMULATED_ROAD_CARRIER',
  'simulatorSpeedMultiplier',
  'simulationSpeedMultiplier',
  'devTransitionControls',
  'failureInjection',
  'temporaryUiState',
  'uiState',
  'paused',
  'simulatorPaused',
  'geometry',
  'sampledGeometry',
  'edges',
  'graphEdges',
  'corridorArrays',
  'playerCorridors',
  'skia',
]);

export type PersistedMultimodalRouteReference = {
  /** Compact route id — never geometry, graph edges, or corridor JSON. */
  routeReference: string;
  mode: PersistedTransportMode;
  routePolicyVersion?: string;
  sourcePackageHash?: string;
};

/** Immutable plan snapshot (logical itinerary). */
export type PersistedMultimodalLegPlan = {
  legId: string;
  mode: PersistedTransportMode;
  fromNodeId: string;
  toNodeId: string;
  fromInfrastructureId?: string;
  toInfrastructureId?: string;
  route: PersistedMultimodalRouteReference;
  distanceMeters?: number;
};

/** Mutable execution fields for a leg. */
export type PersistedMultimodalLegRuntime = {
  status: PersistedMultimodalLegStatus;
  progress?: number;
  startedAt?: number;
  completedAt?: number;
  assignedAssetId?: string;
};

export type PersistedMultimodalLeg = PersistedMultimodalLegPlan & PersistedMultimodalLegRuntime;

export type PersistedMultimodalTransferPlan = {
  transferId: string;
  transferNodeId: string;
  fromMode: PersistedTransportMode;
  toMode: PersistedTransportMode;
};

export type PersistedMultimodalTransferRuntime = {
  status: PersistedMultimodalTransferStatus;
  progress?: number;
  startedAt?: number;
  completedAt?: number;
};

export type PersistedMultimodalTransfer = PersistedMultimodalTransferPlan &
  PersistedMultimodalTransferRuntime;

/** Reserved — Step 22 does not compute fees or rewards. */
export type PersistedMultimodalEconomicSnapshot = {
  capturedAt?: number;
  currency?: 'USD_GAME' | 'USD_GAME_INTEGER';
  policyVersion?: string;
  playerPayment?: number;
  railCarrierCost?: number;
  expectedGrossMargin?: number;
  /** Planning estimate only — Step 29B does not charge this. */
  estimatedRoadOperatingCost?: number;
};

export type PersistedMultimodalDurationSnapshot = {
  policyVersion?: string;
  totalDurationGameSeconds?: number;
  movementDurationGameSeconds?: number;
  transferDurationGameSeconds?: number;
  firstMileGameSeconds?: number;
  originTransferGameSeconds?: number;
  railLinehaulGameSeconds?: number;
  destinationTransferGameSeconds?: number;
  lastMileGameSeconds?: number;
};

export type PersistedMultimodalDeadlineSnapshot = {
  policyVersion?: string;
  deadlineGameSeconds?: number;
};

export type PersistedMultimodalRailTariffSnapshot = {
  policyVersion?: string;
  routeReference?: string;
  distanceMeters?: number;
  cargoQuantity?: number;
  railCarrierCost?: number;
};

export type PersistedMultimodalRoadAccessSnapshot = {
  firstMileRouteReference?: string;
  firstMileDistanceMeters?: number;
  lastMileRouteReference?: string;
  lastMileDistanceMeters?: number;
};

export type PersistedMultimodalAssignmentSnapshot = {
  firstMileTruckId?: string;
  firstMileDriverId?: string;
  firstMileTrailerId?: string | null;
  lastMileTruckId?: string;
  lastMileDriverId?: string;
  lastMileTrailerId?: string | null;
};

export type PersistedMultimodalCargoSnapshot = {
  productId?: string;
  quantity?: number;
  quantityUnit?: string;
};

/**
 * Optional persisted copy of derived identities. Step 23 does not require
 * storing these: `settlementId` / completion identity are derived from
 * `shipmentId`. Do not execute settlement from this module.
 *
 * Future accepted-shipment duration snapshot (Step 24 contract, not a live
 * save field yet): `{ policyVersion, totalDurationGameSeconds,
 * movementDurationGameSeconds, transferDurationGameSeconds, legDurations,
 * transferDurations }`. Resume must consume the snapshot, not recompute the
 * current policy. Left out of SAVE_GAME_VERSION 6 until shipment creation.
 */
export type PersistedMultimodalSettlementReserve = {
  settlementId?: string;
  settledAt?: number;
  settlementAuthority?: string;
  revenueTransactionId?: string;
  expenseTransactionId?: string;
  completionId?: string;
};

export type PersistedMultimodalShipmentProvenance = {
  modeSequence?: PersistedTransportMode[];
  routePolicyVersion?: string;
  sourcePackageHash?: string;
};

export type PersistedReadableMultimodalShipment = {
  shipmentSchemaVersion: typeof SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION;
  unreadable?: false;
  shipmentId: string;
  contractId: string;
  originCityId: string;
  destinationCityId: string;
  status: PersistedMultimodalShipmentStatus;
  /** Immutable itinerary + mutable per-leg runtime, stored together. */
  legs: PersistedMultimodalLeg[];
  transfers: PersistedMultimodalTransfer[];
  currentStepIndex: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  lastProgressedRealAtMs?: number;
  settlement?: PersistedMultimodalSettlementReserve;
  economicSnapshot?: PersistedMultimodalEconomicSnapshot;
  provenance?: PersistedMultimodalShipmentProvenance;
  sourceOfferId?: string;
  transportPattern?: string;
  acceptedAtGameHours?: number;
  executionPolicyVersion?: string;
  executionStage?: string;
  currentStageElapsedGameSeconds?: number;
  totalElapsedGameSeconds?: number;
  completedStages?: string[];
  durationSnapshot?: PersistedMultimodalDurationSnapshot;
  deadlineSnapshot?: PersistedMultimodalDeadlineSnapshot;
  railTariffSnapshot?: PersistedMultimodalRailTariffSnapshot;
  roadAccessSnapshot?: PersistedMultimodalRoadAccessSnapshot;
  assignmentSnapshot?: PersistedMultimodalAssignmentSnapshot;
  cargoSnapshot?: PersistedMultimodalCargoSnapshot;
  settlementState?:
    | 'NOT_SETTLED'
    | 'SETTLEMENT_PENDING'
    | 'SETTLED'
    | 'SETTLEMENT_FAILED'
    | 'SERVER_CONFIRMATION_PENDING';
  fuelPolicy?: string;
  canonicalAuthority?:
    | 'SERVER_ACCOUNT_AUTHORITY'
    | 'LOCAL_GUEST_AUTHORITY'
    | 'LEGACY_CLIENT_ONLY_AUTHORITY';
  canonicalAcceptedAtMs?: number;
};

/**
 * Future nested schema the current client cannot interpret.
 * Preserved so a later rewrite does not silently drop it; never executed.
 */
export type PersistedUnreadableMultimodalShipment = {
  shipmentSchemaVersion: number;
  unreadable: true;
  unreadReason: 'UNSUPPORTED_SHIPMENT_SCHEMA_VERSION';
  shipmentId?: string;
  opaque: Record<string, unknown>;
};

export type PersistedMultimodalShipment =
  | PersistedReadableMultimodalShipment
  | PersistedUnreadableMultimodalShipment;

export function createEmptyMultimodalShipments(): PersistedMultimodalShipment[] {
  return [];
}

export function isUnreadablePersistedMultimodalShipment(
  shipment: PersistedMultimodalShipment,
): shipment is PersistedUnreadableMultimodalShipment {
  return shipment.unreadable === true;
}

export function isExecutablePersistedMultimodalShipment(
  shipment: PersistedMultimodalShipment,
): shipment is PersistedReadableMultimodalShipment {
  return (
    !isUnreadablePersistedMultimodalShipment(shipment) &&
    shipment.shipmentSchemaVersion === SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION
  );
}

export function selectMultimodalShipments(state: {
  multimodalShipments?: PersistedMultimodalShipment[];
}): PersistedMultimodalShipment[] {
  return Array.isArray(state.multimodalShipments) ? state.multimodalShipments : [];
}

export function selectActiveMultimodalShipments(state: {
  multimodalShipments?: PersistedMultimodalShipment[];
}): PersistedReadableMultimodalShipment[] {
  return selectMultimodalShipments(state).filter(
    (shipment): shipment is PersistedReadableMultimodalShipment =>
      isExecutablePersistedMultimodalShipment(shipment) && IN_FLIGHT_STATUSES.has(shipment.status),
  );
}

export function normalizeMultimodalShipments(value: unknown): PersistedMultimodalShipment[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    logSanitize('multimodalShipments is not an array; defaulting to []');
    return [];
  }

  const out: PersistedMultimodalShipment[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    if (out.length >= MAX_PERSISTED_MULTIMODAL_SHIPMENTS) {
      logSanitize('multimodalShipments exceeded cap; dropping extra entries');
      break;
    }
    const normalized = normalizeOneShipment(entry);
    if (!normalized) {
      continue;
    }
    const id = shipmentIdentity(normalized);
    if (id && seenIds.has(id)) {
      logSanitize(`duplicate shipmentId omitted: ${id}`);
      continue;
    }
    if (id) {
      seenIds.add(id);
    }
    out.push(normalized);
  }

  return out;
}

function shipmentIdentity(shipment: PersistedMultimodalShipment): string | null {
  if (typeof shipment.shipmentId === 'string' && shipment.shipmentId.length > 0) {
    return shipment.shipmentId;
  }
  return null;
}

function normalizeOneShipment(entry: unknown): PersistedMultimodalShipment | null {
  if (!isRecord(entry)) {
    logSanitize('omitting non-object multimodal shipment entry');
    return null;
  }

  const schemaVersion = entry.shipmentSchemaVersion ?? entry.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion) || schemaVersion < 1) {
    logSanitize('omitting shipment without a valid shipmentSchemaVersion');
    return null;
  }

  if (schemaVersion > SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION) {
    return preserveUnreadableShipment(entry, schemaVersion);
  }

  if (schemaVersion !== SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION) {
    logSanitize(`omitting shipment with unsupported schema ${schemaVersion}`);
    return null;
  }

  if (entry.unreadable === true) {
    return preserveUnreadableShipment(entry, schemaVersion);
  }

  const shipmentId = readId(entry.shipmentId);
  const contractId = readId(entry.contractId);
  const originCityId = readId(entry.originCityId);
  const destinationCityId = readId(entry.destinationCityId);
  if (!shipmentId || !contractId || !originCityId || !destinationCityId) {
    logSanitize('omitting shipment missing required string ids');
    return null;
  }

  if (typeof entry.status !== 'string' || !SHIPMENT_STATUSES.has(entry.status)) {
    logSanitize(`omitting shipment ${shipmentId} with invalid status`);
    return null;
  }

  const createdAt = readFiniteNumber(entry.createdAt);
  if (createdAt == null) {
    logSanitize(`omitting shipment ${shipmentId} without createdAt`);
    return null;
  }

  const currentStepIndex = readFiniteNumber(entry.currentStepIndex);
  if (currentStepIndex == null || currentStepIndex < 0) {
    logSanitize(`omitting shipment ${shipmentId} with invalid currentStepIndex`);
    return null;
  }

  if (!Array.isArray(entry.legs) || !Array.isArray(entry.transfers)) {
    logSanitize(`omitting shipment ${shipmentId} without legs/transfers arrays`);
    return null;
  }

  const legs: PersistedMultimodalLeg[] = [];
  for (const leg of entry.legs.slice(0, MAX_LEGS)) {
    const normalizedLeg = normalizeLeg(leg);
    if (!normalizedLeg) {
      logSanitize(`omitting shipment ${shipmentId} because a leg was malformed`);
      return null;
    }
    legs.push(normalizedLeg);
  }

  const transfers: PersistedMultimodalTransfer[] = [];
  for (const transfer of entry.transfers.slice(0, MAX_TRANSFERS)) {
    const normalizedTransfer = normalizeTransfer(transfer);
    if (!normalizedTransfer) {
      logSanitize(`omitting shipment ${shipmentId} because a transfer was malformed`);
      return null;
    }
    transfers.push(normalizedTransfer);
  }

  const readable: PersistedReadableMultimodalShipment = {
    shipmentSchemaVersion: SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION,
    shipmentId,
    contractId,
    originCityId,
    destinationCityId,
    status: entry.status as PersistedMultimodalShipmentStatus,
    legs,
    transfers,
    currentStepIndex,
    createdAt,
  };

  const startedAt = readFiniteNumber(entry.startedAt);
  if (startedAt != null) {
    readable.startedAt = startedAt;
  }
  const completedAt = readFiniteNumber(entry.completedAt);
  if (completedAt != null) {
    readable.completedAt = completedAt;
  }
  const lastProgressedRealAtMs = readFiniteNumber(entry.lastProgressedRealAtMs);
  if (lastProgressedRealAtMs != null) {
    readable.lastProgressedRealAtMs = lastProgressedRealAtMs;
  }

  const settlement = normalizeSettlement(entry.settlement);
  if (settlement) {
    readable.settlement = settlement;
  }
  const economicSnapshot = normalizeEconomicSnapshot(entry.economicSnapshot);
  if (economicSnapshot) {
    readable.economicSnapshot = economicSnapshot;
  }
  const provenance = normalizeProvenance(entry.provenance);
  if (provenance) {
    readable.provenance = provenance;
  }

  const sourceOfferId = readOptionalId(entry.sourceOfferId);
  if (sourceOfferId) readable.sourceOfferId = sourceOfferId;
  const transportPattern = readOptionalId(entry.transportPattern);
  if (transportPattern) readable.transportPattern = transportPattern;
  const acceptedAtGameHours = readFiniteNumber(entry.acceptedAtGameHours);
  if (acceptedAtGameHours != null) readable.acceptedAtGameHours = acceptedAtGameHours;
  const executionPolicyVersion = readOptionalId(entry.executionPolicyVersion);
  if (executionPolicyVersion) readable.executionPolicyVersion = executionPolicyVersion;
  const executionStage = readOptionalId(entry.executionStage);
  if (executionStage) readable.executionStage = executionStage;
  const currentStageElapsedGameSeconds = readFiniteNumber(entry.currentStageElapsedGameSeconds);
  if (currentStageElapsedGameSeconds != null) {
    readable.currentStageElapsedGameSeconds = Math.max(0, Math.floor(currentStageElapsedGameSeconds));
  }
  const totalElapsedGameSeconds = readFiniteNumber(entry.totalElapsedGameSeconds);
  if (totalElapsedGameSeconds != null) {
    readable.totalElapsedGameSeconds = Math.max(0, Math.floor(totalElapsedGameSeconds));
  }
  if (Array.isArray(entry.completedStages)) {
    readable.completedStages = entry.completedStages
      .filter((row): row is string => typeof row === 'string')
      .slice(0, 8);
  }
  const durationSnapshot = normalizeDurationSnapshot(entry.durationSnapshot);
  if (durationSnapshot) readable.durationSnapshot = durationSnapshot;
  const deadlineSnapshot = normalizeDeadlineSnapshot(entry.deadlineSnapshot);
  if (deadlineSnapshot) readable.deadlineSnapshot = deadlineSnapshot;
  const railTariffSnapshot = normalizeRailTariffSnapshot(entry.railTariffSnapshot);
  if (railTariffSnapshot) readable.railTariffSnapshot = railTariffSnapshot;
  const roadAccessSnapshot = normalizeRoadAccessSnapshot(entry.roadAccessSnapshot);
  if (roadAccessSnapshot) readable.roadAccessSnapshot = roadAccessSnapshot;
  const assignmentSnapshot = normalizeAssignmentSnapshot(entry.assignmentSnapshot);
  if (assignmentSnapshot) readable.assignmentSnapshot = assignmentSnapshot;
  const cargoSnapshot = normalizeCargoSnapshot(entry.cargoSnapshot);
  if (cargoSnapshot) readable.cargoSnapshot = cargoSnapshot;
  if (
    entry.canonicalAuthority === 'SERVER_ACCOUNT_AUTHORITY' ||
    entry.canonicalAuthority === 'LOCAL_GUEST_AUTHORITY' ||
    entry.canonicalAuthority === 'LEGACY_CLIENT_ONLY_AUTHORITY'
  ) {
    readable.canonicalAuthority = entry.canonicalAuthority;
  }
  const canonicalAcceptedAtMs = readFiniteNumber(entry.canonicalAcceptedAtMs);
  if (canonicalAcceptedAtMs != null) {
    readable.canonicalAcceptedAtMs = Math.max(0, Math.floor(canonicalAcceptedAtMs));
  }
  if (
    entry.settlementState === 'NOT_SETTLED' ||
    entry.settlementState === 'SETTLED' ||
    entry.settlementState === 'SETTLEMENT_PENDING' ||
    entry.settlementState === 'SETTLEMENT_FAILED' ||
    entry.settlementState === 'SERVER_CONFIRMATION_PENDING'
  ) {
    readable.settlementState = entry.settlementState;
  }
  const fuelPolicy = readOptionalId(entry.fuelPolicy);
  if (fuelPolicy) readable.fuelPolicy = fuelPolicy;

  return readable;
}

function preserveUnreadableShipment(
  entry: Record<string, unknown>,
  schemaVersion: number,
): PersistedUnreadableMultimodalShipment | null {
  const opaque = cloneOpaque(entry);
  if (!opaque) {
    logSanitize('dropping future-schema shipment that could not be cloned safely');
    return null;
  }
  const shipmentId = typeof entry.shipmentId === 'string' ? readId(entry.shipmentId) : undefined;
  logSanitize(
    `preserving unreadable shipment schema ${schemaVersion}${shipmentId ? ` (${shipmentId})` : ''}; will not execute`,
  );
  return {
    shipmentSchemaVersion: schemaVersion,
    unreadable: true,
    unreadReason: 'UNSUPPORTED_SHIPMENT_SCHEMA_VERSION',
    ...(shipmentId ? { shipmentId } : {}),
    opaque,
  };
}

function normalizeLeg(value: unknown): PersistedMultimodalLeg | null {
  if (!isRecord(value)) {
    return null;
  }
  const legId = readId(value.legId ?? value.id);
  const mode = readMode(value.mode);
  const fromNodeId = readId(value.fromNodeId);
  const toNodeId = readId(value.toNodeId);
  const status =
    typeof value.status === 'string' && LEG_STATUSES.has(value.status)
      ? (value.status as PersistedMultimodalLegStatus)
      : null;
  const route = normalizeRouteReference(value.route ?? value, mode);
  if (!legId || !mode || !fromNodeId || !toNodeId || !status || !route) {
    return null;
  }

  const leg: PersistedMultimodalLeg = {
    legId,
    mode,
    fromNodeId,
    toNodeId,
    route,
    status,
  };
  const fromInfrastructureId = readOptionalId(value.fromInfrastructureId);
  if (fromInfrastructureId) {
    leg.fromInfrastructureId = fromInfrastructureId;
  }
  const toInfrastructureId = readOptionalId(value.toInfrastructureId);
  if (toInfrastructureId) {
    leg.toInfrastructureId = toInfrastructureId;
  }
  const distanceMeters = readFiniteNumber(value.distanceMeters);
  if (distanceMeters != null && distanceMeters >= 0) {
    leg.distanceMeters = distanceMeters;
  }
  const progress = readFiniteNumber(value.progress);
  if (progress != null) {
    leg.progress = Math.max(0, Math.min(1, progress));
  }
  const startedAt = readFiniteNumber(value.startedAt ?? value.startedAtGameHours);
  if (startedAt != null) {
    leg.startedAt = startedAt;
  }
  const completedAt = readFiniteNumber(value.completedAt ?? value.completedAtGameHours);
  if (completedAt != null) {
    leg.completedAt = completedAt;
  }
  const assignedAssetId = readOptionalId(value.assignedAssetId);
  if (assignedAssetId) {
    leg.assignedAssetId = assignedAssetId;
  }
  return leg;
}

function normalizeTransfer(value: unknown): PersistedMultimodalTransfer | null {
  if (!isRecord(value)) {
    return null;
  }
  const transferId = readId(value.transferId ?? value.id);
  const transferNodeId = readId(value.transferNodeId);
  const fromMode = readMode(value.fromMode);
  const toMode = readMode(value.toMode);
  const status =
    typeof value.status === 'string' && TRANSFER_STATUSES.has(value.status)
      ? (value.status as PersistedMultimodalTransferStatus)
      : null;
  if (!transferId || !transferNodeId || !fromMode || !toMode || !status) {
    return null;
  }
  if (!SUPPORTED_TRANSFER_PAIRS.has(`${fromMode}|${toMode}`)) {
    return null;
  }
  const transfer: PersistedMultimodalTransfer = {
    transferId,
    transferNodeId,
    fromMode,
    toMode,
    status,
  };
  const progress = readFiniteNumber(value.progress);
  if (progress != null) {
    transfer.progress = Math.max(0, Math.min(1, progress));
  }
  const startedAt = readFiniteNumber(value.startedAt);
  if (startedAt != null) {
    transfer.startedAt = startedAt;
  }
  const completedAt = readFiniteNumber(value.completedAt);
  if (completedAt != null) {
    transfer.completedAt = completedAt;
  }
  return transfer;
}

function normalizeRouteReference(
  value: unknown,
  fallbackMode: PersistedTransportMode | null,
): PersistedMultimodalRouteReference | null {
  if (!isRecord(value)) {
    return null;
  }
  const routeReference = readRouteReference(value.routeReference);
  const mode = readMode(value.mode) ?? fallbackMode;
  if (!routeReference || !mode) {
    return null;
  }
  const route: PersistedMultimodalRouteReference = { routeReference, mode };
  const routePolicyVersion = readOptionalId(value.routePolicyVersion);
  if (routePolicyVersion) {
    route.routePolicyVersion = routePolicyVersion;
  }
  const sourcePackageHash = readOptionalId(value.sourcePackageHash);
  if (sourcePackageHash) {
    route.sourcePackageHash = sourcePackageHash;
  }
  return route;
}

function normalizeSettlement(value: unknown): PersistedMultimodalSettlementReserve | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const settlementId = readOptionalId(value.settlementId);
  const settledAt = readFiniteNumber(value.settledAt ?? value.settledAtGameHours);
  const settlementAuthority = readOptionalId(value.settlementAuthority);
  const revenueTransactionId = readOptionalId(value.revenueTransactionId);
  const expenseTransactionId = readOptionalId(value.expenseTransactionId);
  const completionId = readOptionalId(value.completionId);
  if (!settlementId && settledAt == null && !settlementAuthority) {
    return undefined;
  }
  return {
    ...(settlementId ? { settlementId } : {}),
    ...(settledAt != null ? { settledAt } : {}),
    ...(settlementAuthority ? { settlementAuthority } : {}),
    ...(revenueTransactionId ? { revenueTransactionId } : {}),
    ...(expenseTransactionId ? { expenseTransactionId } : {}),
    ...(completionId ? { completionId } : {}),
  };
}

function normalizeEconomicSnapshot(
  value: unknown,
): PersistedMultimodalEconomicSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const capturedAt = readFiniteNumber(value.capturedAt ?? value.capturedAtGameHours);
  const policyVersion = readOptionalId(value.policyVersion);
  const currency =
    value.currency === 'USD_GAME' || value.currency === 'USD_GAME_INTEGER'
      ? value.currency
      : undefined;
  const playerPayment = readFiniteNumber(value.playerPayment);
  const railCarrierCost = readFiniteNumber(value.railCarrierCost);
  const expectedGrossMargin = readFiniteNumber(value.expectedGrossMargin);
  const estimatedRoadOperatingCost = readFiniteNumber(value.estimatedRoadOperatingCost);
  if (capturedAt == null && !policyVersion && !currency && playerPayment == null) {
    return undefined;
  }
  return {
    ...(capturedAt != null ? { capturedAt } : {}),
    ...(currency ? { currency } : {}),
    ...(policyVersion ? { policyVersion } : {}),
    ...(playerPayment != null ? { playerPayment } : {}),
    ...(railCarrierCost != null ? { railCarrierCost } : {}),
    ...(expectedGrossMargin != null ? { expectedGrossMargin } : {}),
    ...(estimatedRoadOperatingCost != null ? { estimatedRoadOperatingCost } : {}),
  };
}

function normalizeDurationSnapshot(value: unknown): PersistedMultimodalDurationSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const out: PersistedMultimodalDurationSnapshot = {};
  const policyVersion = readOptionalId(value.policyVersion);
  if (policyVersion) out.policyVersion = policyVersion;
  for (const key of [
    'totalDurationGameSeconds',
    'movementDurationGameSeconds',
    'transferDurationGameSeconds',
    'firstMileGameSeconds',
    'originTransferGameSeconds',
    'railLinehaulGameSeconds',
    'destinationTransferGameSeconds',
    'lastMileGameSeconds',
  ] as const) {
    const num = readFiniteNumber(value[key]);
    if (num != null && num >= 0) out[key] = Math.floor(num);
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeDeadlineSnapshot(value: unknown): PersistedMultimodalDeadlineSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const policyVersion = readOptionalId(value.policyVersion);
  const deadlineGameSeconds = readFiniteNumber(value.deadlineGameSeconds);
  if (!policyVersion && deadlineGameSeconds == null) return undefined;
  return {
    ...(policyVersion ? { policyVersion } : {}),
    ...(deadlineGameSeconds != null ? { deadlineGameSeconds: Math.floor(deadlineGameSeconds) } : {}),
  };
}

function normalizeRailTariffSnapshot(value: unknown): PersistedMultimodalRailTariffSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const policyVersion = readOptionalId(value.policyVersion);
  const routeReference = readOptionalId(value.routeReference);
  const distanceMeters = readFiniteNumber(value.distanceMeters);
  const cargoQuantity = readFiniteNumber(value.cargoQuantity);
  const railCarrierCost = readFiniteNumber(value.railCarrierCost);
  if (!policyVersion && !routeReference && distanceMeters == null) return undefined;
  return {
    ...(policyVersion ? { policyVersion } : {}),
    ...(routeReference ? { routeReference } : {}),
    ...(distanceMeters != null ? { distanceMeters } : {}),
    ...(cargoQuantity != null ? { cargoQuantity } : {}),
    ...(railCarrierCost != null ? { railCarrierCost } : {}),
  };
}

function normalizeRoadAccessSnapshot(value: unknown): PersistedMultimodalRoadAccessSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const firstMileRouteReference = readOptionalId(value.firstMileRouteReference);
  const lastMileRouteReference = readOptionalId(value.lastMileRouteReference);
  const firstMileDistanceMeters = readFiniteNumber(value.firstMileDistanceMeters);
  const lastMileDistanceMeters = readFiniteNumber(value.lastMileDistanceMeters);
  if (!firstMileRouteReference && !lastMileRouteReference) return undefined;
  return {
    ...(firstMileRouteReference ? { firstMileRouteReference } : {}),
    ...(lastMileRouteReference ? { lastMileRouteReference } : {}),
    ...(firstMileDistanceMeters != null ? { firstMileDistanceMeters } : {}),
    ...(lastMileDistanceMeters != null ? { lastMileDistanceMeters } : {}),
  };
}

function normalizeAssignmentSnapshot(value: unknown): PersistedMultimodalAssignmentSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const firstMileTruckId = readOptionalId(value.firstMileTruckId);
  const lastMileTruckId = readOptionalId(value.lastMileTruckId);
  if (!firstMileTruckId && !lastMileTruckId) return undefined;
  return {
    ...(firstMileTruckId ? { firstMileTruckId } : {}),
    ...(readOptionalId(value.firstMileDriverId) ? { firstMileDriverId: readOptionalId(value.firstMileDriverId) } : {}),
    firstMileTrailerId: readOptionalId(value.firstMileTrailerId) ?? (value.firstMileTrailerId === null ? null : undefined),
    ...(lastMileTruckId ? { lastMileTruckId } : {}),
    ...(readOptionalId(value.lastMileDriverId) ? { lastMileDriverId: readOptionalId(value.lastMileDriverId) } : {}),
    lastMileTrailerId: readOptionalId(value.lastMileTrailerId) ?? (value.lastMileTrailerId === null ? null : undefined),
  };
}

function normalizeCargoSnapshot(value: unknown): PersistedMultimodalCargoSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const productId = readOptionalId(value.productId);
  const quantity = readFiniteNumber(value.quantity);
  const quantityUnit = readOptionalId(value.quantityUnit);
  if (!productId && quantity == null) return undefined;
  return {
    ...(productId ? { productId } : {}),
    ...(quantity != null ? { quantity } : {}),
    ...(quantityUnit ? { quantityUnit } : {}),
  };
}

function normalizeProvenance(value: unknown): PersistedMultimodalShipmentProvenance | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const modeSequence = Array.isArray(value.modeSequence)
    ? value.modeSequence
        .map((mode) => readMode(mode))
        .filter((mode): mode is PersistedTransportMode => mode != null)
        .slice(0, MAX_LEGS)
    : undefined;
  const routePolicyVersion = readOptionalId(value.routePolicyVersion);
  const sourcePackageHash = readOptionalId(value.sourcePackageHash);
  if ((!modeSequence || modeSequence.length === 0) && !routePolicyVersion && !sourcePackageHash) {
    return undefined;
  }
  return {
    ...(modeSequence && modeSequence.length > 0 ? { modeSequence } : {}),
    ...(routePolicyVersion ? { routePolicyVersion } : {}),
    ...(sourcePackageHash ? { sourcePackageHash } : {}),
  };
}

function cloneOpaque(entry: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const stripped: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(entry)) {
      if (DEV_OR_GEOMETRY_KEYS.has(key) || typeof nested === 'function') {
        continue;
      }
      stripped[key] = nested;
    }
    const json = JSON.stringify(stripped);
    if (!json || json.length > MAX_UNREADABLE_OPAQUE_JSON_CHARS) {
      return { truncated: true };
    }
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) {
    return null;
  }
  return trimmed;
}

function readOptionalId(value: unknown): string | undefined {
  return readId(value) ?? undefined;
}

function readRouteReference(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ROUTE_REFERENCE_LENGTH) {
    return null;
  }
  if (trimmed.includes('corridors.json')) {
    return null;
  }
  return trimmed;
}

function readMode(value: unknown): PersistedTransportMode | null {
  return typeof value === 'string' && TRANSPORT_MODES.has(value)
    ? (value as PersistedTransportMode)
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function logSanitize(message: string): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(`[multimodalShipmentPersistence] ${message}`);
  }
}

/** Test-only compact ROAD→RAIL→ROAD fixture. Not used by live gameplay. */
export function createTestPersistedMultimodalShipment(
  overrides: Partial<PersistedReadableMultimodalShipment> = {},
): PersistedReadableMultimodalShipment {
  return {
    shipmentSchemaVersion: SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION,
    shipmentId: 'mms_test_izmir_ankara_1',
    contractId: 'contract_test_mm_1',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    status: 'ACTIVE',
    currentStepIndex: 1,
    createdAt: 48,
    startedAt: 48.2,
    lastProgressedRealAtMs: 1_700_000_000_000,
    legs: [
      {
        legId: 'leg_origin_road',
        mode: 'ROAD',
        fromNodeId: 'planning.tur.road.izmir.v1',
        toNodeId: 'planning.tur.rail.izmir.v1',
        route: {
          routeReference: 'road.access.izmir.station.v1',
          mode: 'ROAD',
          routePolicyVersion: 'road-access-1',
        },
        status: 'COMPLETED',
        progress: 1,
        startedAt: 48.2,
        completedAt: 49,
      },
      {
        legId: 'leg_rail',
        mode: 'RAIL',
        fromNodeId: 'planning.tur.rail.izmir.v1',
        toNodeId: 'planning.tur.rail.ankara.v1',
        route: {
          routeReference: 'rail.canonical.izmir-ankara.v1',
          mode: 'RAIL',
          sourcePackageHash: 'rail-pkg-test',
        },
        status: 'IN_PROGRESS',
        progress: 0.4,
        startedAt: 49,
      },
      {
        legId: 'leg_dest_road',
        mode: 'ROAD',
        fromNodeId: 'planning.tur.rail.ankara.v1',
        toNodeId: 'planning.tur.road.ankara.v1',
        route: {
          routeReference: 'road.access.ankara.station.v1',
          mode: 'ROAD',
        },
        status: 'PLANNED',
      },
    ],
    transfers: [
      {
        transferId: 'xfer_izmir_road_rail',
        transferNodeId: 'transfer.tur.izmir.road_rail.v1',
        fromMode: 'ROAD',
        toMode: 'RAIL',
        status: 'COMPLETED',
        completedAt: 49,
      },
      {
        transferId: 'xfer_ankara_rail_road',
        transferNodeId: 'transfer.tur.ankara.rail_road.v1',
        fromMode: 'RAIL',
        toMode: 'ROAD',
        status: 'PENDING',
      },
    ],
    provenance: {
      modeSequence: ['ROAD', 'RAIL', 'ROAD'],
      routePolicyVersion: 'multimodal-plan-1',
    },
    economicSnapshot: {
      capturedAt: 48,
      currency: 'USD_GAME',
      policyVersion: 'reserved',
    },
    ...overrides,
  };
}
