/**
 * Canonical ROAD fleet economic authority (Map V2 Step 29J).
 *
 * INTERNAL_TEST server-owned fixture assets only. Live save fleet is
 * LEGACY_CLIENT_FLEET_UNVERIFIED. Pure. No React. No Firebase. No cash mutation.
 */

import type { Trailer, Truck, TruckUpgrades } from '../types/game';
import { STARTER_TRUCK, findTruckMarketItem } from '../data/trucks';
import { getDefaultFuelFillRatio, getDefaultFuelTankCapacityL } from '../utils/truckFuel';
import {
  CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID,
  CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
  CANONICAL_ROAD_TRUCK_FIXTURES,
  buildCanonicalRoadTrailerFixture,
  freezeCanonicalRoadExecutionEconomicsFromTruckState,
  isCanonicalRoadTruckFixtureId,
  type CanonicalRoadExecutionContractBasis,
  type FreezeCanonicalRoadExecutionEconomicsResult,
} from './canonicalRoadExecutionEconomics';

export {
  CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID,
  CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
};

export const CANONICAL_ROAD_FLEET_ECONOMIC_AUTHORITY_STATUS =
  'CANONICAL_ROAD_FLEET_ECONOMIC_AUTHORITY_PASS_INTERNAL_FIXTURES' as const;

export const CANONICAL_FLEET_ASSET_SCHEMA_VERSION = 1 as const;
export const CANONICAL_FLEET_ECONOMIC_POLICY_VERSION =
  'canonical-fleet-economics-internal-v1' as const;

export const CANONICAL_FLEET_ASSETS_COLLECTION = 'canonicalFleetAssets' as const;
export const CANONICAL_ROAD_FLEET_ENV_KEY = 'EXPO_PUBLIC_CANONICAL_ROAD_FLEET' as const;
export const CANONICAL_ROAD_INTERNAL_TEST_BACKEND_ENV = 'CANONICAL_ROAD_INTERNAL_TEST' as const;

export const PRODUCTION_FLEET_AUTHORITY =
  'PRODUCTION_FLEET_AUTHORITY_BLOCKED_LEGACY_SAVE_STATE' as const;
export const INTERNAL_FLEET_AUTHORITY = 'INTERNAL_FIXTURE_AUTHORITY_READY' as const;
export const LEGACY_CLIENT_FLEET_UNVERIFIED = 'LEGACY_CLIENT_FLEET_UNVERIFIED' as const;

export type CanonicalRoadFleetGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalRoadFleetGate(options?: {
  envValue?: string | null;
}): CanonicalRoadFleetGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.EXPO_PUBLIC_CANONICAL_ROAD_FLEET ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalRoadInternalFleetBootstrapAllowed(options?: {
  envValue?: string | null;
}): boolean {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_ROAD_INTERNAL_TEST ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST';
}

export type CanonicalFleetAssetType = 'TRUCK' | 'TRAILER';

export type CanonicalFleetAssetDocument = {
  assetId: string;
  assetType: CanonicalFleetAssetType;
  canonicalFleetAssetSchemaVersion: typeof CANONICAL_FLEET_ASSET_SCHEMA_VERSION;
  catalogModelId: string;
  ownerUid: string;
  fixtureKey: string;
  economicCondition: number;
  economicUpgradeIds: TruckUpgrades;
  economicPolicyVersion: typeof CANONICAL_FLEET_ECONOMIC_POLICY_VERSION;
  maintenanceCostPerKm: number;
  fuelConsumptionPerKm: number;
  capacity: number;
  speed: number;
  vehicleClass: string | null;
  trailerType: Trailer['type'] | null;
  capacityBonusTons: number;
  economicRevision: number;
  fuelStateSchemaVersion?: 1;
  currentFuelL?: number;
  fuelCapacityL?: number;
  fuelRevision?: number;
  fuelPolicyVersion?: string;
  mileageKm?: number;
  mileageRevision?: number;
  ownershipType?: 'owned' | 'leased';
  lifecycleStatus?: 'ACTIVE' | 'SOLD' | 'LEASE_ACTIVE';
  canonicalLeaseId?: string | null;
  authoritySource: 'INTERNAL_TEST_FIXTURE' | 'CATALOG_PURCHASE_FOUNDATION' | 'STARTER_ISSUE_FOUNDATION';
  authorityClass?: 'SERVER_CANONICAL' | 'INTERNAL_TEST_FIXTURE' | 'SERVER_CANONICAL_PENDING_MIGRATION';
  activeCanonicalRoadDeliveryId?: string | null;
  reservedAtMs?: number | null;
  reservationRevision?: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

const ZERO_UPGRADES: TruckUpgrades = {
  engine: 0,
  fuelEfficiency: 0,
  cargo: 0,
  durability: 0,
};

export function hashCanonicalFleetEconomicsPackage(
  assets: readonly CanonicalFleetAssetDocument[],
): string {
  const payload = assets
    .map(
      (row) =>
        `${row.assetId}:${row.assetType}:${row.economicCondition}:${row.maintenanceCostPerKm}:${row.fuelConsumptionPerKm}:${row.economicUpgradeIds.engine}.${row.economicUpgradeIds.fuelEfficiency}.${row.economicUpgradeIds.cargo}.${row.economicUpgradeIds.durability}:${row.trailerType ?? ''}:${row.capacityBonusTons}`,
    )
    .sort()
    .join('|');
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function truckAssetFromFixture(uid: string, truck: Truck, nowMs: number): CanonicalFleetAssetDocument {
  const fuelCapacityL = getDefaultFuelTankCapacityL(truck);
  const currentFuelL = Math.round(fuelCapacityL * getDefaultFuelFillRatio(truck.id));
  return {
    assetId: truck.id,
    assetType: 'TRUCK',
    canonicalFleetAssetSchemaVersion: CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
    catalogModelId: truck.catalogId ?? truck.id,
    ownerUid: uid,
    fixtureKey: truck.id,
    economicCondition: truck.condition,
    economicUpgradeIds: {
      engine: truck.upgrades?.engine ?? 0,
      fuelEfficiency: truck.upgrades?.fuelEfficiency ?? 0,
      cargo: truck.upgrades?.cargo ?? 0,
      durability: truck.upgrades?.durability ?? 0,
    },
    economicPolicyVersion: CANONICAL_FLEET_ECONOMIC_POLICY_VERSION,
    maintenanceCostPerKm: truck.maintenanceCost,
    fuelConsumptionPerKm: truck.fuelConsumptionPerKm,
    capacity: truck.capacity,
    speed: truck.speed,
    vehicleClass: truck.vehicleClass ?? null,
    trailerType: null,
    capacityBonusTons: 0,
    economicRevision: 1,
    fuelStateSchemaVersion: 1,
    currentFuelL,
    fuelCapacityL,
    fuelRevision: 1,
    fuelPolicyVersion: 'canonical-fuel-state-v1',
    mileageKm: 0,
    mileageRevision: 1,
    ownershipType: 'owned',
    lifecycleStatus: 'ACTIVE',
    authoritySource: 'INTERNAL_TEST_FIXTURE',
    authorityClass: 'INTERNAL_TEST_FIXTURE',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function trailerAssetFromFixture(uid: string, nowMs: number): CanonicalFleetAssetDocument {
  const trailer = buildCanonicalRoadTrailerFixture('fixture-healthy');
  return {
    assetId: CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
    assetType: 'TRAILER',
    canonicalFleetAssetSchemaVersion: CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
    catalogModelId: CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
    ownerUid: uid,
    fixtureKey: CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
    economicCondition: trailer.condition,
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
    authoritySource: 'INTERNAL_TEST_FIXTURE',
    authorityClass: 'INTERNAL_TEST_FIXTURE',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function buildInternalCanonicalFleetFixtureAssets(
  uid: string,
  nowMs: number,
): CanonicalFleetAssetDocument[] {
  return [
    truckAssetFromFixture(uid, CANONICAL_ROAD_TRUCK_FIXTURES['fixture-healthy']!, nowMs),
    truckAssetFromFixture(uid, CANONICAL_ROAD_TRUCK_FIXTURES['fixture-degraded']!, nowMs),
    truckAssetFromFixture(uid, CANONICAL_ROAD_TRUCK_FIXTURES['fixture-upgraded']!, nowMs),
    trailerAssetFromFixture(uid, nowMs),
  ];
}

export const CANONICAL_FLEET_ECONOMICS_PACKAGE_HASH = hashCanonicalFleetEconomicsPackage(
  buildInternalCanonicalFleetFixtureAssets('hash', 0),
);

export function isValidCanonicalFleetAssetId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

export function classifyCanonicalFleetSelection(
  assetId: string,
): 'FIXTURE' | 'PRODUCTION_CANONICAL' | 'LEGACY' {
  if (
    assetId in CANONICAL_ROAD_TRUCK_FIXTURES ||
    assetId === CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID
  ) {
    return 'FIXTURE';
  }
  if (String(assetId).startsWith('cfa_')) {
    return 'PRODUCTION_CANONICAL';
  }
  return 'LEGACY';
}

export function parseCanonicalFleetAsset(
  data: Record<string, unknown> | undefined,
  expectedType: CanonicalFleetAssetType,
): { ok: true; asset: CanonicalFleetAssetDocument } | { ok: false; reason: string } {
  if (!data) {
    return {
      ok: false,
      reason: expectedType === 'TRUCK' ? 'CANONICAL_TRUCK_NOT_FOUND' : 'CANONICAL_TRAILER_NOT_FOUND',
    };
  }
  if (data.canonicalFleetAssetSchemaVersion !== CANONICAL_FLEET_ASSET_SCHEMA_VERSION) {
    return {
      ok: false,
      reason:
        expectedType === 'TRUCK'
          ? 'CANONICAL_TRUCK_SCHEMA_UNSUPPORTED'
          : 'CANONICAL_TRAILER_NOT_FOUND',
    };
  }
  if (data.assetType !== expectedType) {
    return {
      ok: false,
      reason: expectedType === 'TRUCK' ? 'CANONICAL_TRUCK_ECONOMICS_INVALID' : 'CANONICAL_TRAILER_INCOMPATIBLE',
    };
  }
  const asset = data as CanonicalFleetAssetDocument;
  if (expectedType === 'TRUCK') {
    if (
      !Number.isFinite(asset.economicCondition) ||
      asset.economicCondition < 0 ||
      asset.economicCondition > 100 ||
      !Number.isFinite(asset.maintenanceCostPerKm) ||
      asset.maintenanceCostPerKm < 0
    ) {
      return { ok: false, reason: 'CANONICAL_TRUCK_ECONOMICS_INVALID' };
    }
  }
  return { ok: true, asset };
}

export function truckFromCanonicalFleetAsset(asset: CanonicalFleetAssetDocument): Truck {
  const catalog =
    findTruckMarketItem(asset.catalogModelId) ??
    (asset.catalogModelId === STARTER_TRUCK.catalogId || asset.catalogModelId === STARTER_TRUCK.id
      ? STARTER_TRUCK
      : null);
  const template =
    CANONICAL_ROAD_TRUCK_FIXTURES[asset.fixtureKey] ??
    catalog ??
    CANONICAL_ROAD_TRUCK_FIXTURES[CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID]!;
  return {
    ...template,
    id: asset.assetId,
    catalogId: asset.catalogModelId,
    condition: asset.economicCondition,
    maintenanceCost: asset.maintenanceCostPerKm,
    fuelConsumptionPerKm: asset.fuelConsumptionPerKm,
    capacity: asset.capacity,
    speed: asset.speed,
    vehicleClass: (asset.vehicleClass as Truck['vehicleClass']) ?? template.vehicleClass,
    upgrades: { ...asset.economicUpgradeIds },
    currentFuelL: asset.currentFuelL,
    fuelTankCapacityL: asset.fuelCapacityL,
    totalMileageKm: asset.mileageKm,
    ownershipType: asset.ownershipType ?? 'owned',
  };
}

export function trailerFromCanonicalFleetAsset(
  asset: CanonicalFleetAssetDocument,
  truckId: string,
): Trailer {
  const base = buildCanonicalRoadTrailerFixture(truckId);
  return {
    ...base,
    id: asset.assetId,
    type: asset.trailerType ?? 'standard',
    capacityBonusTons: asset.capacityBonusTons,
    condition: asset.economicCondition,
  };
}

export function freezeExecutionEconomicsFromCanonicalFleet(input: {
  contract: CanonicalRoadExecutionContractBasis;
  truckAsset: CanonicalFleetAssetDocument;
  trailerAsset: CanonicalFleetAssetDocument | null;
  selectedDriverId?: string | null;
  driverAware?: Pick<
    Parameters<typeof freezeCanonicalRoadExecutionEconomicsFromTruckState>[0],
    | 'driver'
    | 'activeEvents'
    | 'driverEconomics'
    | 'fuelPricePerLiter'
    | 'contractType'
    | 'penaltyMultiplier'
    | 'recommendedTruckCondition'
  > | null;
  createdAtMs: number;
}): FreezeCanonicalRoadExecutionEconomicsResult {
  if (input.truckAsset.ownerUid !== input.trailerAsset?.ownerUid && input.trailerAsset) {
    return { ok: false, reason: 'CANONICAL_TRAILER_NOT_OWNED' };
  }
  const truck = truckFromCanonicalFleetAsset(input.truckAsset);
  const trailer = input.trailerAsset
    ? trailerFromCanonicalFleetAsset(input.trailerAsset, truck.id)
    : null;
  return freezeCanonicalRoadExecutionEconomicsFromTruckState({
    contract: input.contract,
    truck,
    trailer,
    truckSource: 'CANONICAL_FLEET_ASSET',
    trailerSource: trailer ? 'CANONICAL_FLEET_ASSET' : 'NONE',
    truckEconomicRevision: input.truckAsset.economicRevision,
    trailerEconomicRevision: input.trailerAsset?.economicRevision ?? null,
    selectedDriverId: input.selectedDriverId,
    ...(input.driverAware ?? {}),
    createdAtMs: input.createdAtMs,
  });
}

export function fleetAssetsConflict(
  existing: CanonicalFleetAssetDocument,
  next: CanonicalFleetAssetDocument,
): boolean {
  return (
    existing.fixtureKey !== next.fixtureKey ||
    existing.economicCondition !== next.economicCondition ||
    existing.maintenanceCostPerKm !== next.maintenanceCostPerKm ||
    existing.economicUpgradeIds.engine !== next.economicUpgradeIds.engine ||
    existing.economicUpgradeIds.fuelEfficiency !== next.economicUpgradeIds.fuelEfficiency ||
    existing.economicUpgradeIds.cargo !== next.economicUpgradeIds.cargo ||
    existing.economicUpgradeIds.durability !== next.economicUpgradeIds.durability ||
    existing.trailerType !== next.trailerType ||
    existing.capacityBonusTons !== next.capacityBonusTons
  );
}

export function hasOnlyCanonicalFleetBootstrapKeys(data: Record<string, unknown>): boolean {
  if (
    ['condition', 'upgrades', 'maintenanceCost', 'trailerCost', 'payment', 'cashDelta'].some(
      (key) => key in data,
    )
  ) {
    return false;
  }
  return Object.keys(data).every((key) => key === 'canonicalSchemaVersion');
}
