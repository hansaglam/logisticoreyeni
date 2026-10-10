/**
 * Canonical fleet repair / upgrade authority (Map V2 Step 29N).
 *
 * INTERNAL_TEST / foundation only. Server derives cost and mutation.
 * Client cannot supply money or economic outputs. Pure. No React. No Firebase.
 */

import { calculateTruckRepairCost } from '../simulation/delivery';
import {
  MAX_UPGRADE_LEVEL,
  TRUCK_UPGRADE_TYPES,
  applyTruckUpgrade,
  canUpgradeTruck,
  getTruckUpgradeCost,
  type TruckUpgradeType,
} from '../simulation/truckUpgrades';
import type { TruckUpgrades } from '../types/game';
import {
  CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
  CANONICAL_FLEET_ASSETS_COLLECTION,
  classifyCanonicalFleetSelection,
  parseCanonicalFleetAsset,
  truckFromCanonicalFleetAsset,
  type CanonicalFleetAssetDocument,
} from './canonicalRoadFleet';
import { CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION } from './canonicalFleetConditionWear';
import { resolveAssetTrustClass } from './canonicalProductionFleet';

export const CANONICAL_FLEET_REPAIR_UPGRADE_AUTHORITY_STATUS =
  'CANONICAL_FLEET_REPAIR_UPGRADE_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const CANONICAL_FLEET_REPAIR_POLICY_VERSION = 'canonical-fleet-repair-v1' as const;
export const CANONICAL_FLEET_UPGRADE_POLICY_VERSION = 'canonical-fleet-upgrade-v1' as const;

export const CANONICAL_FLEET_MUTATIONS_BACKEND_ENV = 'CANONICAL_FLEET_MUTATIONS' as const;
export const CANONICAL_FLEET_MUTATIONS_ENV_KEY = 'EXPO_PUBLIC_CANONICAL_FLEET_MUTATIONS' as const;

export const REPAIR_SERVER_CASH_POLICY = 'REPAIR_SERVER_CASH_POLICY_MATCHED' as const;
export const CANONICAL_REPAIR_AD_DISCOUNT_POLICY = 'CANONICAL_REPAIR_IGNORES_AD_DISCOUNT_TOKEN' as const;
export const TRAILER_REPAIR_UPGRADE_POLICY = 'TRAILER_REPAIR_UPGRADE_NOT_IN_PRODUCTION' as const;

export const CANONICAL_FLEET_REPAIR_ACTION = 'FULL_RESTORE_TO_100' as const;

export type CanonicalFleetMutationsGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalFleetMutationsGate(options?: {
  envValue?: string | null;
}): CanonicalFleetMutationsGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.EXPO_PUBLIC_CANONICAL_FLEET_MUTATIONS ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalFleetMutationsAllowed(options?: {
  envValue?: string | null;
}): boolean {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_FLEET_MUTATIONS ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST';
}

export function isValidCanonicalFleetIntentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(value);
}

export function isCanonicalTruckUpgradeType(value: unknown): value is TruckUpgradeType {
  return typeof value === 'string' && (TRUCK_UPGRADE_TYPES as readonly string[]).includes(value);
}

const REPAIR_FORBIDDEN = [
  'repairCost',
  'targetCondition',
  'conditionAfter',
  'conditionBefore',
  'conditionDelta',
  'condition',
  'cashDelta',
  'payment',
];

const UPGRADE_FORBIDDEN = [
  'upgradePrice',
  'price',
  'nextLevel',
  'modifier',
  'upgradeModifier',
  'cashDelta',
  'maintenanceCost',
  'capacity',
  'payment',
];

export function hasOnlyCanonicalFleetRepairKeys(data: Record<string, unknown>): boolean {
  if (REPAIR_FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['assetId', 'repairIntentId', 'canonicalSchemaVersion', 'repairAction'].includes(key),
  );
}

export function hasOnlyCanonicalFleetUpgradeKeys(data: Record<string, unknown>): boolean {
  if (UPGRADE_FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['assetId', 'upgradeType', 'upgradeIntentId', 'canonicalSchemaVersion'].includes(key),
  );
}

export function createCanonicalFleetRepairOperationId(assetId: string, intentId: string): string {
  return `fleet:${assetId}:repair:${intentId}`;
}

export function createCanonicalFleetUpgradeOperationId(
  assetId: string,
  upgradeType: TruckUpgradeType,
  intentId: string,
): string {
  return `fleet:${assetId}:upgrade:${upgradeType}:${intentId}`;
}

export type CanonicalFleetRepairEligibility =
  | 'CANONICAL_FLEET_REPAIR_READY'
  | 'REPAIR_NOT_NEEDED'
  | 'LEGACY_FLEET_UNVERIFIED'
  | 'SCHEMA_UNSUPPORTED'
  | 'ASSET_RESERVED_BY_ACTIVE_DELIVERY'
  | 'TRAILER_UNSUPPORTED'
  | 'AUTHORITY_UNSUPPORTED';

export type CanonicalFleetUpgradeEligibility =
  | 'CANONICAL_FLEET_UPGRADE_READY'
  | 'UPGRADE_MAX_LEVEL'
  | 'LEGACY_FLEET_UNVERIFIED'
  | 'SCHEMA_UNSUPPORTED'
  | 'ASSET_RESERVED_BY_ACTIVE_DELIVERY'
  | 'TRAILER_UNSUPPORTED'
  | 'AUTHORITY_UNSUPPORTED'
  | 'UNSUPPORTED_UPGRADE_TYPE';

function trustedAsset(asset: CanonicalFleetAssetDocument | null | undefined): boolean {
  if (!asset) return false;
  const selection = classifyCanonicalFleetSelection(asset.assetId);
  if (selection === 'LEGACY') return false;
  const trust = resolveAssetTrustClass(asset);
  return trust === 'SERVER_CANONICAL' || trust === 'INTERNAL_TEST_FIXTURE';
}

export function classifyCanonicalFleetRepair(
  asset: CanonicalFleetAssetDocument | null | undefined,
  callerUid: string,
): CanonicalFleetRepairEligibility {
  if (!asset) return 'LEGACY_FLEET_UNVERIFIED';
  if (asset.canonicalFleetAssetSchemaVersion !== CANONICAL_FLEET_ASSET_SCHEMA_VERSION) {
    return 'SCHEMA_UNSUPPORTED';
  }
  if (asset.ownerUid !== callerUid) return 'LEGACY_FLEET_UNVERIFIED';
  if (asset.assetType === 'TRAILER') return 'TRAILER_UNSUPPORTED';
  if (!trustedAsset(asset)) return 'AUTHORITY_UNSUPPORTED';
  if (asset.activeCanonicalRoadDeliveryId) return 'ASSET_RESERVED_BY_ACTIVE_DELIVERY';
  if (asset.economicCondition >= 100) return 'REPAIR_NOT_NEEDED';
  return 'CANONICAL_FLEET_REPAIR_READY';
}

export function classifyCanonicalFleetUpgrade(
  asset: CanonicalFleetAssetDocument | null | undefined,
  callerUid: string,
  upgradeType: unknown,
): CanonicalFleetUpgradeEligibility {
  if (!isCanonicalTruckUpgradeType(upgradeType)) return 'UNSUPPORTED_UPGRADE_TYPE';
  if (!asset) return 'LEGACY_FLEET_UNVERIFIED';
  if (asset.canonicalFleetAssetSchemaVersion !== CANONICAL_FLEET_ASSET_SCHEMA_VERSION) {
    return 'SCHEMA_UNSUPPORTED';
  }
  if (asset.ownerUid !== callerUid) return 'LEGACY_FLEET_UNVERIFIED';
  if (asset.assetType === 'TRAILER') return 'TRAILER_UNSUPPORTED';
  if (!trustedAsset(asset)) return 'AUTHORITY_UNSUPPORTED';
  if (asset.activeCanonicalRoadDeliveryId) return 'ASSET_RESERVED_BY_ACTIVE_DELIVERY';
  const truck = truckFromCanonicalFleetAsset(asset);
  if (!canUpgradeTruck(truck, upgradeType)) return 'UPGRADE_MAX_LEVEL';
  return 'CANONICAL_FLEET_UPGRADE_READY';
}

export function deriveCanonicalFleetRepair(asset: CanonicalFleetAssetDocument): {
  repairCost: number;
  targetCondition: 100;
  conditionBefore: number;
  conditionDelta: number;
} {
  const truck = truckFromCanonicalFleetAsset(asset);
  const repairCost = calculateTruckRepairCost(truck);
  const conditionBefore = asset.economicCondition;
  return {
    repairCost,
    targetCondition: 100,
    conditionBefore,
    conditionDelta: 100 - conditionBefore,
  };
}

export function deriveCanonicalFleetUpgrade(
  asset: CanonicalFleetAssetDocument,
  upgradeType: TruckUpgradeType,
): {
  derivedCost: number;
  currentLevel: number;
  nextLevel: number;
  upgradesAfter: TruckUpgrades;
  capacityAfter: number;
} {
  const truck = truckFromCanonicalFleetAsset(asset);
  const currentLevel = truck.upgrades?.[upgradeType] ?? 0;
  const derivedCost = getTruckUpgradeCost(truck, upgradeType);
  const next = applyTruckUpgrade(truck, upgradeType);
  return {
    derivedCost,
    currentLevel,
    nextLevel: next.upgrades?.[upgradeType] ?? currentLevel,
    upgradesAfter: { ...next.upgrades! },
    capacityAfter: next.capacity,
  };
}

export type CanonicalFleetRepairUpgradeReceipt = {
  operationId: string;
  operationType: 'REPAIR' | 'UPGRADE';
  assetId: string;
  ownerUid: string;
  revisionBefore: number;
  revisionAfter: number;
  conditionBefore: number | null;
  conditionAfter: number | null;
  upgradeType: TruckUpgradeType | null;
  upgradeLevelBefore: number | null;
  upgradeLevelAfter: number | null;
  cashTransactionId: string;
  cashBefore: number;
  cashDelta: number;
  cashAfter: number;
  derivedCost: number;
  policyVersion: string;
  createdAtMs: number;
  authoritySource: CanonicalFleetAssetDocument['authoritySource'];
};

export {
  CANONICAL_FLEET_ASSETS_COLLECTION,
  CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION,
  MAX_UPGRADE_LEVEL,
  parseCanonicalFleetAsset,
};
