/**
 * Core vehicle / staff cash authority (Map V2 Step 29R).
 *
 * INTERNAL_TEST lease start, catalog hire/fire, canonical sale.
 * Recovery stays fail-closed. Recurring lease is not billed here.
 * Pure. No React. No Firebase. No public UI wiring.
 */

import { fleetManagementBalance } from '../config/balance';
import { DRIVER_POOL, findDriverPoolItem } from '../data/drivers';
import { findTruckMarketItem } from '../data/trucks';
import { calculateCanonicalTruckResaleValue } from './truckResaleValuation';
import { createCanonicalProductionAssetId } from './canonicalProductionFleet';
import type { CanonicalFleetAssetDocument } from './canonicalRoadFleet';
import type { TruckUpgrades } from '../types/game';
import {
  resolveLeaseDailyCost,
  resolveLeaseOfferCost,
  type TruckLeaseOfferPeriod,
} from '../utils/truckLeasePresentation';

export const CORE_VEHICLE_STAFF_CASH_AUTHORITY_STATUS =
  'CORE_VEHICLE_STAFF_CASH_AUTHORITY_PASS_FOUNDATION' as const;

export const LEASE_FAMILY_STATUS =
  'LEASE_START_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;
export const LEASE_RECURRING_COST_OWNERSHIP =
  'LEASE_RECURRING_COST_BELONGS_TO_DAILY_OPEX' as const;
export const LEASE_RETURN_STATUS = 'LEASE_RETURN_BLOCKED_CLIENT_CLOCK' as const;

export const DRIVER_HIRE_FAMILY_STATUS =
  'DRIVER_HIRE_AUTHORITY_INTERNAL_POLICY_ONLY' as const;
export const DRIVER_FIRE_FAMILY_STATUS =
  'DRIVER_FIRE_INTERNAL_TEST_CANONICAL_ROSTER' as const;
export const DRIVER_SALARY_OPEX_STATUS =
  'DRIVER_SALARY_BELONGS_TO_DAILY_OPEX' as const;

export const VEHICLE_SALE_FAMILY_STATUS =
  'VEHICLE_SALE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;
export const VEHICLE_RECOVERY_FAMILY_STATUS =
  'VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE' as const;

export const CANONICAL_CORE_VEHICLE_STAFF_CASH_ENV =
  'CANONICAL_CORE_VEHICLE_STAFF_CASH' as const;
export const CANONICAL_LEASE_SCHEMA_VERSION = 1 as const;
export const CANONICAL_DRIVER_OFFER_POLICY_VERSION = 'canonical-driver-offer-v1' as const;
export const CANONICAL_LEASE_POLICY_VERSION = 'canonical-vehicle-lease-v1' as const;
export const CANONICAL_VEHICLE_STAFF_AUTHORITY_VERSION = 1 as const;

export const CANONICAL_VEHICLE_LEASES_COLLECTION = 'canonicalVehicleLeases' as const;
export const CANONICAL_LEASE_RECEIPTS_COLLECTION = 'canonicalLeaseReceipts' as const;
export const CANONICAL_DRIVERS_COLLECTION = 'canonicalDrivers' as const;
export const CANONICAL_DRIVER_RECEIPTS_COLLECTION = 'canonicalDriverReceipts' as const;
export const CANONICAL_DRIVER_ROSTER_META_COLLECTION = 'canonicalDriverRosterMeta' as const;
export const CANONICAL_DRIVER_ROSTER_META_DOC = 'current' as const;
export const CANONICAL_VEHICLE_SALE_RECEIPTS_COLLECTION = 'canonicalVehicleSaleReceipts' as const;

export type CanonicalCoreVehicleStaffCashGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalCoreVehicleStaffCashGate(options?: {
  envValue?: string | null;
}): CanonicalCoreVehicleStaffCashGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_CORE_VEHICLE_STAFF_CASH ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalCoreVehicleStaffCashAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalCoreVehicleStaffCashGate(options) === 'INTERNAL_TEST';
}

export function isValidCanonicalVehicleStaffIntentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(value);
}

export function isValidCanonicalLeasePeriod(value: unknown): value is TruckLeaseOfferPeriod {
  return value === 'weekly' || value === 'monthly';
}

const FORBIDDEN_CLIENT_FIELDS = [
  'price',
  'purchasePrice',
  'leaseCost',
  'prepaidLeaseCost',
  'weeklyLeaseCost',
  'hireFee',
  'hiringFee',
  'salary',
  'salaryPerDay',
  'dailySalary',
  'severanceCost',
  'salePrice',
  'saleValue',
  'resaleValue',
  'condition',
  'mileage',
  'mileageKm',
  'totalMileageKm',
  'upgrades',
  'cashDelta',
  'amount',
  'money',
  'recoveryCost',
  'cashCost',
  'fuelLiters',
] as const;

function hasOnlyKeys(
  data: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  if (FORBIDDEN_CLIENT_FIELDS.some((key) => key in data)) return false;
  return Object.keys(data).every((key) => allowed.includes(key));
}

export function hasOnlyCanonicalLeaseStartKeys(data: Record<string, unknown>): boolean {
  return hasOnlyKeys(data, [
    'catalogModelId',
    'leaseIntentId',
    'leasePeriod',
    'canonicalSchemaVersion',
  ]);
}

export function hasOnlyCanonicalDriverHireKeys(data: Record<string, unknown>): boolean {
  return hasOnlyKeys(data, ['poolId', 'hireIntentId', 'canonicalSchemaVersion']);
}

export function hasOnlyCanonicalDriverFireKeys(data: Record<string, unknown>): boolean {
  return hasOnlyKeys(data, ['driverId', 'fireIntentId', 'canonicalSchemaVersion']);
}

export function hasOnlyCanonicalVehicleSaleKeys(data: Record<string, unknown>): boolean {
  return hasOnlyKeys(data, ['assetId', 'saleIntentId', 'canonicalSchemaVersion']);
}

export function hasOnlyCanonicalVehicleRecoveryKeys(data: Record<string, unknown>): boolean {
  return hasOnlyKeys(data, [
    'assetId',
    'recoveryIntentId',
    'actionId',
    'canonicalSchemaVersion',
  ]);
}

export function createCanonicalLeaseAssetId(leaseIntentId: string): string {
  return createCanonicalProductionAssetId('lease', leaseIntentId);
}

export function createCanonicalLeaseId(leaseIntentId: string): string {
  return `lease_${leaseIntentId}`;
}

export function createCanonicalLeaseStartTransactionId(
  assetId: string,
  leaseIntentId: string,
): string {
  return `fleet:${assetId}:lease:${leaseIntentId}`;
}

export function createCanonicalDriverHireTransactionId(
  driverId: string,
  hireIntentId: string,
): string {
  return `driver:${driverId}:hire:${hireIntentId}`;
}

export function createCanonicalDriverFireTransactionId(
  driverId: string,
  fireIntentId: string,
): string {
  return `driver:${driverId}:fire:${fireIntentId}`;
}

export function createCanonicalVehicleSaleTransactionId(
  assetId: string,
  saleIntentId: string,
): string {
  return `fleet:${assetId}:sale:${saleIntentId}`;
}

export function createCanonicalDeliveryMileageOperationId(deliveryId: string): string {
  return `delivery:${deliveryId}:mileage`;
}

export function deriveCanonicalLeaseStartCost(
  catalogModelId: string,
  leasePeriod: TruckLeaseOfferPeriod,
):
  | {
      ok: true;
      catalogId: string;
      prepaidCost: number;
      weeklyLeaseCost: number;
      recurringDailyCost: number;
    }
  | { ok: false; reason: string } {
  const truck = findTruckMarketItem(catalogModelId);
  if (!truck) return { ok: false, reason: 'UNKNOWN_CATALOG_MODEL' };
  const weekly = Number(truck.weeklyLeaseCost);
  if (!Number.isSafeInteger(weekly) || weekly <= 0) {
    return { ok: false, reason: 'LEASE_OFFER_UNAVAILABLE' };
  }
  const prepaidCost = resolveLeaseOfferCost(weekly, leasePeriod);
  if (!Number.isSafeInteger(prepaidCost) || prepaidCost <= 0) {
    return { ok: false, reason: 'INVALID_LEASE_COST' };
  }
  return {
    ok: true,
    catalogId: truck.id,
    prepaidCost,
    weeklyLeaseCost: weekly,
    recurringDailyCost: resolveLeaseDailyCost(prepaidCost, leasePeriod),
  };
}

export type CanonicalDriverOffer = {
  offerId: string;
  poolId: string;
  name: string;
  skill: number;
  attention: number;
  salaryPerDay: number;
  hiringFee: number;
  policyVersion: typeof CANONICAL_DRIVER_OFFER_POLICY_VERSION;
};

export function freezeCanonicalDriverOfferFromPool(
  poolId: string,
): { ok: true; offer: CanonicalDriverOffer } | { ok: false; reason: string } {
  const item = findDriverPoolItem(poolId);
  if (!item) return { ok: false, reason: 'UNKNOWN_DRIVER_OFFER' };
  if (item.comingSoon) return { ok: false, reason: 'DRIVER_OFFER_UNAVAILABLE' };
  const hiringFee = item.hiringFee;
  const salaryPerDay = item.salaryPerDay;
  if (!Number.isSafeInteger(hiringFee) || hiringFee <= 0) {
    return { ok: false, reason: 'INVALID_HIRE_FEE' };
  }
  if (!Number.isSafeInteger(salaryPerDay) || salaryPerDay <= 0) {
    return { ok: false, reason: 'INVALID_DRIVER_SALARY' };
  }
  return {
    ok: true,
    offer: {
      offerId: item.id,
      poolId: item.id,
      name: item.name,
      skill: item.experience,
      attention: item.attention,
      salaryPerDay,
      hiringFee,
      policyVersion: CANONICAL_DRIVER_OFFER_POLICY_VERSION,
    },
  };
}

export function listCanonicalDriverOfferIds(): readonly string[] {
  return DRIVER_POOL.filter((row) => !row.comingSoon).map((row) => row.id);
}

export function deriveCanonicalDriverSeveranceCost(salaryPerDay: number): number {
  return Math.round(salaryPerDay * fleetManagementBalance.driverSeveranceDays);
}

function calculateUpgradeInvestmentValue(
  purchasePrice: number,
  upgrades: TruckUpgrades | undefined,
): number {
  const levels = upgrades ?? { engine: 0, fuelEfficiency: 0, cargo: 0, durability: 0 };
  const multipliers = {
    engine: 0.08,
    fuelEfficiency: 0.07,
    cargo: 0.09,
    durability: 0.06,
  } as const;
  let total = 0;
  for (const key of Object.keys(multipliers) as (keyof typeof multipliers)[]) {
    const level = Math.min(3, Math.max(0, Number(levels[key]) || 0));
    for (let tier = 0; tier < level; tier += 1) {
      total += purchasePrice * multipliers[key] * (1 + tier * 0.75);
    }
  }
  return Math.round(total);
}

export function deriveCanonicalVehicleSaleValue(asset: CanonicalFleetAssetDocument):
  | { ok: true; saleValue: number; mileageKm: number; catalogId: string }
  | { ok: false; reason: string } {
  if (asset.assetType !== 'TRUCK') {
    return { ok: false, reason: 'CANONICAL_TRAILER_NOT_SELLABLE' };
  }
  if (asset.lifecycleStatus === 'SOLD') {
    return { ok: false, reason: 'CANONICAL_ASSET_ALREADY_SOLD' };
  }
  if ((asset.ownershipType ?? 'owned') === 'leased' || asset.lifecycleStatus === 'LEASE_ACTIVE') {
    return { ok: false, reason: 'LEASED_ASSET_NOT_SELLABLE' };
  }
  if (asset.activeCanonicalRoadDeliveryId) {
    return { ok: false, reason: 'CANONICAL_ASSET_RESERVED' };
  }
  const trust =
    asset.authorityClass === 'SERVER_CANONICAL' ||
    asset.authoritySource === 'CATALOG_PURCHASE_FOUNDATION' ||
    asset.authoritySource === 'STARTER_ISSUE_FOUNDATION' ||
    asset.authoritySource === 'INTERNAL_TEST_FIXTURE';
  if (!trust) {
    return { ok: false, reason: 'LEGACY_FLEET_UNVERIFIED' };
  }
  const catalog = findTruckMarketItem(asset.catalogModelId);
  const basePrice = catalog?.purchasePrice ?? 0;
  if (!Number.isSafeInteger(basePrice) || basePrice <= 0) {
    return { ok: false, reason: 'INVALID_CATALOG_PRICE' };
  }
  const mileageKm = Math.max(0, Math.round(Number(asset.mileageKm) || 0));
  const saleValue = calculateCanonicalTruckResaleValue(
    {
      basePrice,
      condition: asset.economicCondition,
      mileageKm,
      upgradeValue: calculateUpgradeInvestmentValue(basePrice, asset.economicUpgradeIds),
      isLeased: false,
    },
    fleetManagementBalance,
  );
  if (!Number.isSafeInteger(saleValue) || saleValue <= 0) {
    return { ok: false, reason: 'INVALID_SALE_VALUE' };
  }
  return { ok: true, saleValue, mileageKm, catalogId: asset.catalogModelId };
}

export function deriveCanonicalMileageIncrementKm(input: {
  completionOutcome?: string | null;
  failureAuthorityClass?: string | null;
  distanceKm?: number | null;
}): { ok: true; incrementKm: number } | { ok: false; reason: string } {
  if (input.failureAuthorityClass === 'SERVER_DERIVED_FAILURE') {
    return { ok: true, incrementKm: 0 };
  }
  if (input.completionOutcome && input.completionOutcome !== 'SUCCESS') {
    return { ok: true, incrementKm: 0 };
  }
  const distance = Number(input.distanceKm);
  if (!Number.isFinite(distance) || distance < 0) {
    return { ok: false, reason: 'MILEAGE_DISTANCE_UNAVAILABLE' };
  }
  return { ok: true, incrementKm: Math.round(distance) };
}

export type CanonicalVehicleLeaseDocument = {
  leaseId: string;
  canonicalFleetAssetId: string;
  catalogModelId: string;
  leasePolicyVersion: typeof CANONICAL_LEASE_POLICY_VERSION;
  canonicalLeaseSchemaVersion: typeof CANONICAL_LEASE_SCHEMA_VERSION;
  leasePeriod: TruckLeaseOfferPeriod;
  prepaidCost: number;
  recurringCost: number;
  weeklyLeaseCost: number;
  status: 'ACTIVE';
  ownerUid: string;
  createdAt: number;
  updatedAt: number;
};

export type CanonicalLeaseReceipt = {
  leaseIntentId: string;
  leaseId: string;
  assetId: string;
  catalogId: string;
  leasePeriod: TruckLeaseOfferPeriod;
  cashBefore: number;
  prepaidCost: number;
  cashAfter: number;
  transactionId: string;
  createdAt: number;
  authorityVersion: typeof CANONICAL_VEHICLE_STAFF_AUTHORITY_VERSION;
  policyVersion: typeof CANONICAL_LEASE_POLICY_VERSION;
  ownerUid: string;
};

export type CanonicalDriverDocument = {
  driverId: string;
  poolId: string;
  ownerUid: string;
  name: string;
  skill: number;
  attentionBaseline: number;
  salaryPerDay: number;
  hiringFee: number;
  status: 'hired' | 'fired';
  assignedCanonicalDeliveryId: string | null;
  schema: 1;
  authoritySource: 'DRIVER_POOL_CATALOG';
  policyVersion: typeof CANONICAL_DRIVER_OFFER_POLICY_VERSION;
  revision: number;
  createdAt: number;
  updatedAt: number;
  firedAtMs?: number;
};

export type CanonicalDriverReceipt = {
  intentId: string;
  driverId: string;
  operation: 'HIRE' | 'FIRE';
  cashBefore: number;
  amount: number;
  cashAfter: number;
  transactionId: string;
  createdAt: number;
  authorityVersion: typeof CANONICAL_VEHICLE_STAFF_AUTHORITY_VERSION;
  policyVersion: typeof CANONICAL_DRIVER_OFFER_POLICY_VERSION;
  ownerUid: string;
};

export type CanonicalVehicleSaleReceipt = {
  saleIntentId: string;
  assetId: string;
  catalogId: string;
  cashBefore: number;
  saleValue: number;
  cashAfter: number;
  mileageKm: number;
  condition: number;
  transactionId: string;
  createdAt: number;
  authorityVersion: typeof CANONICAL_VEHICLE_STAFF_AUTHORITY_VERSION;
  ownerUid: string;
};
