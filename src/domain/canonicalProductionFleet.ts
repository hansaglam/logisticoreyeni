/**
 * Production fleet authority migration foundation (Map V2 Step 29L).
 *
 * Trusted mint helpers only. No save import. No generic register.
 * No cash mutation. Pure. No React. No Firebase.
 */

import { STARTER_TRUCK, TRUCK_MARKET, findTruckMarketItem } from '../data/trucks';
import { TRAILER_MARKET } from '../data/trailers';
import { calculateTruckRepairCost } from '../simulation/delivery';
import { getTruckUpgradeCost, type TruckUpgradeType } from '../simulation/truckUpgrades';
import { getDefaultFuelFillRatio, getDefaultFuelTankCapacityL } from '../utils/truckFuel';
import type { Truck, TruckUpgrades } from '../types/game';
import {
  CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
  CANONICAL_FLEET_ECONOMIC_POLICY_VERSION,
  LEGACY_CLIENT_FLEET_UNVERIFIED,
  type CanonicalFleetAssetDocument,
  type CanonicalFleetAssetType,
} from './canonicalRoadFleet';

export const PRODUCTION_FLEET_AUTHORITY_MIGRATION_STATUS =
  'PRODUCTION_FLEET_AUTHORITY_MIGRATION_PASS_NEW_ASSETS_ONLY' as const;

export const PRODUCTION_FLEET_LEGACY_POLICY = 'NO_AUTOMATIC_LEGACY_MIGRATION' as const;

export const MARKETPLACE_FLEET_LINEAGE =
  'MARKETPLACE_CANONICAL_FLEET_IDENTITY_READY_ECONOMICS_BLOCKED' as const;

export const CATALOG_FLEET_LINEAGE =
  'CATALOG_CANONICAL_READY_WITH_SMALL_SERVER_PORT_FOUNDATION_ONLY' as const;

export const STARTER_FLEET_LINEAGE = 'STARTER_DETERMINISTIC_NEW_ACCOUNT_ONLY' as const;

export type CanonicalFleetTrustClass =
  | 'SERVER_CANONICAL'
  | 'SERVER_CANONICAL_PENDING_MIGRATION'
  | 'LEGACY_CLIENT_UNVERIFIED'
  | 'INTERNAL_TEST_FIXTURE'
  | 'UNSUPPORTED';

export type CanonicalFleetAuthoritySource =
  | 'INTERNAL_TEST_FIXTURE'
  | 'CATALOG_PURCHASE_FOUNDATION'
  | 'STARTER_ISSUE_FOUNDATION'
  | 'MARKETPLACE_IDENTITY_ONLY';

export type ProductionFleetAuthorityStatus =
  | 'SERVER_CANONICAL_READY'
  | 'INTERNAL_FIXTURE_ONLY'
  | 'LEGACY_UNVERIFIED'
  | 'MISSING_PURCHASE_LINEAGE'
  | 'CONDITION_AUTHORITY_MISSING'
  | 'UPGRADE_AUTHORITY_MISSING'
  | 'WEAR_AUTHORITY_MISSING'
  | 'SCHEMA_UNSUPPORTED'
  | 'MARKETPLACE_ECONOMICS_CLIENT_ORIGINATED';

const ZERO_UPGRADES: TruckUpgrades = {
  engine: 0,
  fuelEfficiency: 0,
  cargo: 0,
  durability: 0,
};

export function isCanonicalProductionAssetId(value: unknown): value is string {
  return typeof value === 'string' && /^cfa_[A-Za-z0-9._-]+$/.test(value) && value.length <= 128;
}

export function createCanonicalProductionAssetId(
  kind: 'starter' | 'catalog' | 'trailer' | 'lease',
  key: string,
): string {
  const safe = key.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  return `cfa_${kind}_${safe}`;
}

export function classifyLocalFleetAssetAuthority(_asset?: {
  id?: string | null;
  fleetAuthorityClass?: string | null;
}): 'LEGACY_CLIENT_UNVERIFIED' {
  void _asset?.fleetAuthorityClass;
  return 'LEGACY_CLIENT_UNVERIFIED';
}

export function classifyProductionFleetAuthority(
  asset: CanonicalFleetAssetDocument | null | undefined,
): ProductionFleetAuthorityStatus {
  if (!asset) return 'LEGACY_UNVERIFIED';
  if (asset.canonicalFleetAssetSchemaVersion !== CANONICAL_FLEET_ASSET_SCHEMA_VERSION) {
    return 'SCHEMA_UNSUPPORTED';
  }
  const trust = resolveAssetTrustClass(asset);
  if (trust === 'INTERNAL_TEST_FIXTURE') return 'INTERNAL_FIXTURE_ONLY';
  if (trust === 'LEGACY_CLIENT_UNVERIFIED') return 'LEGACY_UNVERIFIED';
  if (trust === 'SERVER_CANONICAL') return 'SERVER_CANONICAL_READY';
  if (trust === 'SERVER_CANONICAL_PENDING_MIGRATION') return 'MISSING_PURCHASE_LINEAGE';
  return 'LEGACY_UNVERIFIED';
}

export function resolveAssetTrustClass(asset: CanonicalFleetAssetDocument): CanonicalFleetTrustClass {
  if (asset.authorityClass) return asset.authorityClass;
  if (asset.authoritySource === 'INTERNAL_TEST_FIXTURE') return 'INTERNAL_TEST_FIXTURE';
  if (
    asset.authoritySource === 'CATALOG_PURCHASE_FOUNDATION' ||
    asset.authoritySource === 'STARTER_ISSUE_FOUNDATION'
  ) {
    return 'SERVER_CANONICAL';
  }
  return 'LEGACY_CLIENT_UNVERIFIED';
}

export function classifyMarketplaceFleetLineage(): typeof MARKETPLACE_FLEET_LINEAGE {
  return MARKETPLACE_FLEET_LINEAGE;
}

export function classifyCatalogFleetLineage(): typeof CATALOG_FLEET_LINEAGE {
  return CATALOG_FLEET_LINEAGE;
}

export function classifyStarterFleetLineage(): typeof STARTER_FLEET_LINEAGE {
  return STARTER_FLEET_LINEAGE;
}

export function hasOnlyCanonicalProductionMintKeys(data: Record<string, unknown>): boolean {
  const forbidden = [
    'condition',
    'upgrades',
    'maintenanceCost',
    'authorityClass',
    'economicRevision',
    'cashDelta',
    'payment',
  ];
  if (forbidden.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['canonicalSchemaVersion', 'catalogModelId', 'purchaseId', 'assetType'].includes(key),
  );
}

function catalogTruckTemplate(catalogModelId: string): Truck | null {
  if (catalogModelId === STARTER_TRUCK.catalogId || catalogModelId === STARTER_TRUCK.id) {
    return { ...STARTER_TRUCK, upgrades: { ...ZERO_UPGRADES } };
  }
  const item = findTruckMarketItem(catalogModelId) ?? TRUCK_MARKET.find((row) => row.id === catalogModelId);
  if (!item) return null;
  return {
    ...item,
    id: item.id,
    catalogId: item.id,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status: 'idle',
    ownershipType: 'owned',
    upgrades: { ...ZERO_UPGRADES },
  };
}

export function buildCanonicalFleetAssetFromCatalogPurchase(input: {
  uid: string;
  catalogModelId: string;
  purchaseId: string;
  nowMs: number;
  assetType?: CanonicalFleetAssetType;
}): { ok: true; asset: CanonicalFleetAssetDocument } | { ok: false; reason: string } {
  if (!input.uid || !input.purchaseId || !input.catalogModelId) {
    return { ok: false, reason: 'MISSING_PURCHASE_LINEAGE' };
  }
  if (input.assetType === 'TRAILER') {
    const trailer = TRAILER_MARKET.find((row) => row.id === input.catalogModelId);
    if (!trailer) return { ok: false, reason: 'CANONICAL_TRAILER_INCOMPATIBLE' };
    const assetId = createCanonicalProductionAssetId('trailer', input.purchaseId);
    return {
      ok: true,
      asset: {
        assetId,
        assetType: 'TRAILER',
        canonicalFleetAssetSchemaVersion: CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
        catalogModelId: trailer.id,
        ownerUid: input.uid,
        fixtureKey: '',
        economicCondition: 100,
        economicUpgradeIds: { ...ZERO_UPGRADES },
        economicPolicyVersion: CANONICAL_FLEET_ECONOMIC_POLICY_VERSION,
        maintenanceCostPerKm: 0,
        fuelConsumptionPerKm: 0,
        capacity: trailer.capacityBonusTons,
        speed: 0,
        vehicleClass: null,
        trailerType: trailer.type,
        capacityBonusTons: trailer.capacityBonusTons,
        economicRevision: 1,
        mileageKm: 0,
        mileageRevision: 1,
        ownershipType: 'owned',
        lifecycleStatus: 'ACTIVE',
        authoritySource: 'CATALOG_PURCHASE_FOUNDATION',
        authorityClass: 'SERVER_CANONICAL',
        createdAtMs: input.nowMs,
        updatedAtMs: input.nowMs,
      },
    };
  }
  const template = catalogTruckTemplate(input.catalogModelId);
  if (!template) return { ok: false, reason: 'CANONICAL_TRUCK_ECONOMICS_INVALID' };
  const assetId = createCanonicalProductionAssetId('catalog', input.purchaseId);
  return {
    ok: true,
    asset: {
      assetId,
      assetType: 'TRUCK',
      canonicalFleetAssetSchemaVersion: CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
      catalogModelId: template.catalogId ?? template.id,
      ownerUid: input.uid,
      fixtureKey: '',
      economicCondition: template.condition,
      economicUpgradeIds: { ...ZERO_UPGRADES },
      economicPolicyVersion: CANONICAL_FLEET_ECONOMIC_POLICY_VERSION,
      maintenanceCostPerKm: template.maintenanceCost,
      fuelConsumptionPerKm: template.fuelConsumptionPerKm,
      capacity: template.capacity,
      speed: template.speed,
      vehicleClass: template.vehicleClass ?? null,
      trailerType: null,
      capacityBonusTons: 0,
      economicRevision: 1,
      fuelStateSchemaVersion: 1,
      currentFuelL: Math.round(
        getDefaultFuelTankCapacityL(template) * getDefaultFuelFillRatio(assetId),
      ),
      fuelCapacityL: getDefaultFuelTankCapacityL(template),
      fuelRevision: 1,
      fuelPolicyVersion: 'canonical-fuel-state-v1',
      mileageKm: 0,
      mileageRevision: 1,
      ownershipType: 'owned',
      lifecycleStatus: 'ACTIVE',
      authoritySource: 'CATALOG_PURCHASE_FOUNDATION',
      authorityClass: 'SERVER_CANONICAL',
      createdAtMs: input.nowMs,
      updatedAtMs: input.nowMs,
    },
  };
}

export function buildCanonicalFleetAssetFromLease(input: {
  uid: string;
  catalogModelId: string;
  leaseIntentId: string;
  leaseId: string;
  nowMs: number;
}): { ok: true; asset: CanonicalFleetAssetDocument } | { ok: false; reason: string } {
  const built = buildCanonicalFleetAssetFromCatalogPurchase({
    uid: input.uid,
    catalogModelId: input.catalogModelId,
    purchaseId: input.leaseIntentId,
    nowMs: input.nowMs,
    assetType: 'TRUCK',
  });
  if (!built.ok) return built;
  const assetId = createCanonicalProductionAssetId('lease', input.leaseIntentId);
  return {
    ok: true,
    asset: {
      ...built.asset,
      assetId,
      ownershipType: 'leased',
      lifecycleStatus: 'LEASE_ACTIVE',
      canonicalLeaseId: input.leaseId,
    },
  };
}

export function issueCanonicalStarterFleetAsset(input: {
  uid: string;
  nowMs: number;
}): { ok: true; asset: CanonicalFleetAssetDocument } | { ok: false; reason: string } {
  if (!input.uid) return { ok: false, reason: 'UNAUTHENTICATED' };
  const built = buildCanonicalFleetAssetFromCatalogPurchase({
    uid: input.uid,
    catalogModelId: STARTER_TRUCK.catalogId ?? STARTER_TRUCK.id,
    purchaseId: 'starter_v1',
    nowMs: input.nowMs,
  });
  if (!built.ok) return built;
  return {
    ok: true,
    asset: {
      ...built.asset,
      assetId: createCanonicalProductionAssetId('starter', 'v1'),
      authoritySource: 'STARTER_ISSUE_FOUNDATION',
      authorityClass: 'SERVER_CANONICAL',
    },
  };
}

export function buildCanonicalFleetAssetFromMarketplacePurchase(): {
  ok: false;
  reason: typeof MARKETPLACE_FLEET_LINEAGE;
} {
  return { ok: false, reason: MARKETPLACE_FLEET_LINEAGE };
}

export function rejectLegacySaveFleetImport(): {
  ok: false;
  reason: typeof LEGACY_CLIENT_FLEET_UNVERIFIED;
} {
  return { ok: false, reason: LEGACY_CLIENT_FLEET_UNVERIFIED };
}


export function deriveCanonicalRepairIntent(truck: Truck): {
  targetCondition: number;
  derivedCost: number;
} {
  return {
    targetCondition: 100,
    derivedCost: calculateTruckRepairCost(truck),
  };
}

export function deriveCanonicalUpgradeIntent(truck: Truck, upgradeType: TruckUpgradeType): {
  derivedCost: number;
  currentLevel: number;
} {
  return {
    derivedCost: getTruckUpgradeCost(truck, upgradeType),
    currentLevel: truck.upgrades?.[upgradeType] ?? 0,
  };
}

export function applyTrustedCanonicalFleetRevision(
  asset: CanonicalFleetAssetDocument,
  nextCondition: number,
  nowMs: number,
): CanonicalFleetAssetDocument {
  return {
    ...asset,
    economicCondition: nextCondition,
    economicRevision: asset.economicRevision + 1,
    updatedAtMs: nowMs,
  };
}

export type CanonicalFleetMutationReceipt = {
  assetId: string;
  operationId: string;
  operationType: 'PURCHASE' | 'STARTER_ISSUE' | 'DELIVERY_WEAR' | 'REPAIR' | 'UPGRADE';
  revisionBefore: number;
  revisionAfter: number;
  createdAtMs: number;
};

export function createCanonicalFleetMutationOperationId(
  assetId: string,
  operationType: CanonicalFleetMutationReceipt['operationType'],
  intentId: string,
): string {
  return `fleet:${assetId}:${operationType.toLowerCase()}:${intentId}`;
}

export function createCanonicalFleetMutationReceipt(
  assetBefore: CanonicalFleetAssetDocument,
  assetAfter: CanonicalFleetAssetDocument,
  operationType: CanonicalFleetMutationReceipt['operationType'],
  intentId: string,
  nowMs: number,
): CanonicalFleetMutationReceipt {
  return {
    assetId: assetAfter.assetId,
    operationId: createCanonicalFleetMutationOperationId(assetAfter.assetId, operationType, intentId),
    operationType,
    revisionBefore: assetBefore.economicRevision,
    revisionAfter: assetAfter.economicRevision,
    createdAtMs: nowMs,
  };
}

export { deriveCanonicalDeliveryWear } from './canonicalFleetConditionWear';
export { LEGACY_CLIENT_FLEET_UNVERIFIED };
