/**
 * Canonical ROAD delivery-wear authority (Map V2 Step 29M).
 *
 * Successful, incident-free canonical deliveries only.
 * Client never supplies wear or condition. No cash. Pure. No React. No Firebase.
 */

import { PRODUCT_BY_ID } from '../data/products';
import { getRoute } from '../data/routes';
import { STARTER_DRIVER } from '../data/drivers';
import { calculateConditionLoss } from '../simulation/delivery';
import { clamp } from '../utils/math';
import type { Truck } from '../types/game';
import {
  CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
  classifyCanonicalFleetSelection,
  truckFromCanonicalFleetAsset,
  type CanonicalFleetAssetDocument,
} from './canonicalRoadFleet';
import type { CanonicalRoadExecutionEconomicsSnapshot } from './canonicalRoadExecutionEconomics';

export const CANONICAL_FLEET_CONDITION_WEAR_AUTHORITY_STATUS =
  'CANONICAL_FLEET_CONDITION_WEAR_AUTHORITY_PASS_SUCCESS_ONLY' as const;

export const CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION =
  'canonical-road-delivery-wear-v1' as const;

/** Step 29AG: wear with the accept-time canonical driver attention instead of attention 100. */
export const CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION_V2 =
  'canonical-road-delivery-wear-v2' as const;

export type CanonicalRoadDeliveryWearPolicyVersion =
  | typeof CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION
  | typeof CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION_V2;

/** v1 wear driver attention (no trusted driver). */
export const CANONICAL_WEAR_V1_DRIVER_ATTENTION = 100 as const;

export const CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION =
  'canonicalFleetMutationReceipts' as const;

export const CANONICAL_DELIVERY_WEAR_DRIVER_POLICY =
  'CANONICAL_DELIVERY_WEAR_INTERNAL_DRIVER_POLICY_ONLY' as const;

export const INCIDENT_WEAR_AUTHORITY_MISSING = 'INCIDENT_WEAR_AUTHORITY_MISSING' as const;

export const FAILED_DELIVERY_WEAR_AUTHORITY_UNRESOLVED =
  'FAILED_DELIVERY_WEAR_AUTHORITY_UNRESOLVED' as const;

export const TRAILER_ROAD_WEAR_POLICY = 'TRAILER_CONDITION_NOT_MUTATED_ON_ROAD_DELIVERY' as const;

export const CANONICAL_CONDITION_BOUNDS = {
  min: 0,
  max: 100,
  rounding: 'FLOAT_CLAMP_NO_INTEGER_ROUND',
} as const;

export const CANONICAL_WEAR_OPERATION_TYPE = 'ROAD_DELIVERY_WEAR' as const;

export type CanonicalDeliveryWearEligibility =
  | 'CANONICAL_DELIVERY_WEAR_READY'
  | 'INTERNAL_FIXTURE_READY'
  | 'PRODUCTION_CANONICAL_READY'
  | 'LEGACY_FLEET_UNVERIFIED'
  | 'DELIVERY_NOT_COMPLETED'
  | 'FAILED_AUTHORITY_UNRESOLVED'
  | 'INCIDENT_AUTHORITY_UNRESOLVED'
  | 'REVISION_CONFLICT'
  | 'ASSET_RESERVED_BY_OTHER_DELIVERY'
  | 'ALREADY_APPLIED'
  | 'SCHEMA_UNSUPPORTED'
  | 'CANCELLATION_NO_WEAR';

export type CanonicalFleetWearMutationReceipt = {
  operationId: string;
  operationType: typeof CANONICAL_WEAR_OPERATION_TYPE;
  assetId: string;
  ownerUid: string;
  sourceDeliveryId: string;
  revisionBefore: number;
  revisionAfter: number;
  conditionBefore: number;
  wearAmount: number;
  conditionAfter: number;
  policyVersion: CanonicalRoadDeliveryWearPolicyVersion;
  wearDriverAttention?: number;
  createdAtMs: number;
  authoritySource: CanonicalFleetAssetDocument['authoritySource'];
  canonicalSchemaVersion: typeof CANONICAL_FLEET_ASSET_SCHEMA_VERSION;
};

export type CanonicalRoadWearDeliveryView = {
  deliveryId?: string | null;
  ownerUid?: string | null;
  lifecycleState?: string | null;
  completionOutcome?: string | null;
  wearApplicationState?: 'NOT_APPLIED' | 'APPLIED' | 'NOT_ELIGIBLE' | null;
  incidentConditionAuthority?: 'NONE' | 'UNRESOLVED' | 'RESOLVED' | null;
  failureAuthorityClass?: string | null;
  executionEconomicsSnapshot?: CanonicalRoadExecutionEconomicsSnapshot | null;
};

export function createCanonicalDeliveryWearOperationId(
  assetId: string,
  deliveryId: string,
): string {
  return `fleet:${assetId}:delivery-wear:${deliveryId}`;
}

export function hasOnlyCanonicalRoadWearKeys(data: Record<string, unknown>): boolean {
  const forbidden = [
    'wear',
    'wearAmount',
    'condition',
    'conditionBefore',
    'conditionAfter',
    'conditionDelta',
    'maintenanceCost',
    'upgrades',
    'economicRevision',
    'cashDelta',
    'payment',
  ];
  if (forbidden.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['deliveryId', 'canonicalSchemaVersion'].includes(key),
  );
}

export function applyCanonicalWearToCondition(conditionBefore: number, wearAmount: number): number {
  return clamp(conditionBefore - wearAmount, CANONICAL_CONDITION_BOUNDS.min, CANONICAL_CONDITION_BOUNDS.max);
}

export function deriveCanonicalDeliveryWear(input: {
  originCityId: string;
  destinationCityId: string;
  productId: string;
  amount: number;
  distanceKm: number;
  truck: Truck;
  driverAttention?: number;
}): { ok: true; wear: number } | { ok: false; reason: string } {
  const route = getRoute(input.originCityId, input.destinationCityId);
  const product = PRODUCT_BY_ID[input.productId as keyof typeof PRODUCT_BY_ID];
  if (!route || !product) return { ok: false, reason: 'UNSUPPORTED_ROUTE' };
  const wear = calculateConditionLoss(
    {
      id: 'canonical-wear',
      originCityId: input.originCityId,
      destinationCityId: input.destinationCityId,
      productId: product.id,
      amount: input.amount,
      cargoWeight: input.amount,
      payment: 0,
      deadlineHours: 1,
      distanceKm: input.distanceKm,
      urgency: 0,
      status: 'active',
      createdAt: 0,
      expiresAt: 1,
      requiredLevel: 1,
      contractType: 'standard',
      riskLevel: 'low',
    },
    input.truck,
    { ...STARTER_DRIVER, attention: input.driverAttention ?? CANONICAL_WEAR_V1_DRIVER_ATTENTION },
    route,
    product,
  );
  if (!Number.isFinite(wear) || wear < 0) return { ok: false, reason: 'WEAR_AUTHORITY_MISSING' };
  return { ok: true, wear };
}

export function deriveCanonicalDeliveryWearFromFrozenSnapshot(
  snapshot: CanonicalRoadExecutionEconomicsSnapshot,
  contract: {
    originCityId: string;
    destinationCityId: string;
    productId: string;
    amount: number;
    distanceKm: number;
  },
  asset: CanonicalFleetAssetDocument,
  driverAttention?: number,
): { ok: true; wear: number } | { ok: false; reason: string } {
  const truck = truckFromCanonicalFleetAsset(asset);
  truck.condition = snapshot.truckEconomicProfile.condition;
  truck.upgrades = { ...snapshot.truckEconomicProfile.upgrades };
  truck.capacity = snapshot.truckEconomicProfile.capacity;
  return deriveCanonicalDeliveryWear({
    originCityId: contract.originCityId,
    destinationCityId: contract.destinationCityId,
    productId: contract.productId,
    amount: contract.amount,
    distanceKm: contract.distanceKm,
    truck,
    driverAttention,
  });
}

export function classifyCanonicalDeliveryWear(input: {
  delivery: CanonicalRoadWearDeliveryView | null | undefined;
  asset: CanonicalFleetAssetDocument | null | undefined;
  callerUid: string;
}): CanonicalDeliveryWearEligibility {
  const delivery = input.delivery;
  const asset = input.asset;
  if (!delivery?.deliveryId) return 'DELIVERY_NOT_COMPLETED';
  if (delivery.wearApplicationState === 'APPLIED') return 'ALREADY_APPLIED';
  if (delivery.lifecycleState === 'CANCELLED') return 'CANCELLATION_NO_WEAR';
  if (
    delivery.lifecycleState === 'FAILED' ||
    delivery.completionOutcome === 'FAILED'
  ) {
    if (delivery.failureAuthorityClass !== 'SERVER_DERIVED_FAILURE') {
      return 'FAILED_AUTHORITY_UNRESOLVED';
    }
  } else {
    if (delivery.lifecycleState !== 'COMPLETION_REPORTED' && delivery.lifecycleState !== 'SETTLED') {
      return 'DELIVERY_NOT_COMPLETED';
    }
    if (delivery.completionOutcome !== 'COMPLETED') return 'DELIVERY_NOT_COMPLETED';
  }
  if (delivery.incidentConditionAuthority === 'UNRESOLVED') {
    return 'INCIDENT_AUTHORITY_UNRESOLVED';
  }
  if (!asset) return 'LEGACY_FLEET_UNVERIFIED';
  if (asset.canonicalFleetAssetSchemaVersion !== CANONICAL_FLEET_ASSET_SCHEMA_VERSION) {
    return 'SCHEMA_UNSUPPORTED';
  }
  if (asset.ownerUid !== input.callerUid) return 'LEGACY_FLEET_UNVERIFIED';
  const selection = classifyCanonicalFleetSelection(asset.assetId);
  if (selection === 'LEGACY') return 'LEGACY_FLEET_UNVERIFIED';
  const snapshot = delivery.executionEconomicsSnapshot;
  if (!snapshot) return 'SCHEMA_UNSUPPORTED';
  if (snapshot.truckEconomicProfile.truckId !== asset.assetId) {
    return 'REVISION_CONFLICT';
  }
  if (
    asset.activeCanonicalRoadDeliveryId &&
    asset.activeCanonicalRoadDeliveryId !== delivery.deliveryId
  ) {
    return 'ASSET_RESERVED_BY_OTHER_DELIVERY';
  }
  if (
    delivery.incidentConditionAuthority !== 'RESOLVED' &&
    (asset.economicRevision !== snapshot.truckEconomicProfile.economicRevision ||
      asset.economicCondition !== snapshot.truckEconomicProfile.condition)
  ) {
    return 'REVISION_CONFLICT';
  }
  if (selection === 'FIXTURE') return 'INTERNAL_FIXTURE_READY';
  if (selection === 'PRODUCTION_CANONICAL') return 'PRODUCTION_CANONICAL_READY';
  return 'LEGACY_FLEET_UNVERIFIED';
}

export function isCanonicalDeliveryWearReady(
  status: CanonicalDeliveryWearEligibility,
): status is 'INTERNAL_FIXTURE_READY' | 'PRODUCTION_CANONICAL_READY' {
  return status === 'INTERNAL_FIXTURE_READY' || status === 'PRODUCTION_CANONICAL_READY';
}

export function canonicalDeliveryWearReadyAlias(
  status: CanonicalDeliveryWearEligibility,
): CanonicalDeliveryWearEligibility {
  if (isCanonicalDeliveryWearReady(status)) return 'CANONICAL_DELIVERY_WEAR_READY';
  return status;
}

export function wearReceiptsConflict(
  existing: CanonicalFleetWearMutationReceipt,
  next: CanonicalFleetWearMutationReceipt,
): boolean {
  return (
    existing.assetId !== next.assetId ||
    existing.sourceDeliveryId !== next.sourceDeliveryId ||
    existing.revisionBefore !== next.revisionBefore ||
    existing.revisionAfter !== next.revisionAfter ||
    existing.conditionBefore !== next.conditionBefore ||
    existing.wearAmount !== next.wearAmount ||
    existing.conditionAfter !== next.conditionAfter ||
    existing.policyVersion !== next.policyVersion ||
    existing.operationType !== next.operationType
  );
}

export function buildCanonicalDeliveryWearReceipt(input: {
  asset: CanonicalFleetAssetDocument;
  deliveryId: string;
  wearAmount: number;
  nowMs: number;
  policyVersion?: CanonicalRoadDeliveryWearPolicyVersion;
  wearDriverAttention?: number;
}): CanonicalFleetWearMutationReceipt {
  const conditionAfter = applyCanonicalWearToCondition(input.asset.economicCondition, input.wearAmount);
  return {
    operationId: createCanonicalDeliveryWearOperationId(input.asset.assetId, input.deliveryId),
    operationType: CANONICAL_WEAR_OPERATION_TYPE,
    assetId: input.asset.assetId,
    ownerUid: input.asset.ownerUid,
    sourceDeliveryId: input.deliveryId,
    revisionBefore: input.asset.economicRevision,
    revisionAfter: input.asset.economicRevision + 1,
    conditionBefore: input.asset.economicCondition,
    wearAmount: input.wearAmount,
    conditionAfter,
    policyVersion: input.policyVersion ?? CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION,
    ...(input.wearDriverAttention != null ? { wearDriverAttention: input.wearDriverAttention } : {}),
    createdAtMs: input.nowMs,
    authoritySource: input.asset.authoritySource,
    canonicalSchemaVersion: CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
  };
}
