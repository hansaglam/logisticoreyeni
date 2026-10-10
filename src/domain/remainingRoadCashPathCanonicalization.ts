/**
 * Remaining ROAD cash-path canonicalization (Map V2 Step 29P).
 *
 * Classifies leftover signed-in cash mutations and defines INTERNAL_TEST
 * catalog purchase identity. Does not enable HUD overlay or public buy buttons.
 * Pure. No React. No Firebase.
 */

import { TRAILER_MARKET } from '../data/trailers';
import { findTruckMarketItem } from '../data/trucks';
import { createCanonicalProductionAssetId } from './canonicalProductionFleet';

export const REMAINING_ROAD_CASH_PATH_CANONICALIZATION_STATUS =
  'REMAINING_ROAD_CASH_PATH_CANONICALIZATION_PASS_FOUNDATION' as const;

export const SIGNED_IN_CASH_AUTHORITY_READINESS =
  'SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS' as const;

export const FUEL_CASH_AUTHORITY_STATUS =
  'FUEL_CASH_AUTHORITY_INTERNAL_TEST_PROGRESSIVE_PUBLIC_BLOCKED' as const;
export const CATALOG_TRUCK_PURCHASE_STATUS =
  'CATALOG_TRUCK_PURCHASE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;
export const CATALOG_TRAILER_PURCHASE_STATUS =
  'CATALOG_TRAILER_PURCHASE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;
export const VEHICLE_SALE_CASH_STATUS =
  'VEHICLE_SALE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;
export const VEHICLE_RECOVERY_CASH_STATUS =
  'VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE' as const;
export const DRIVER_HIRE_CASH_STATUS = 'DRIVER_HIRE_AUTHORITY_INTERNAL_POLICY_ONLY' as const;
export const DRIVER_FIRE_CASH_STATUS = 'DRIVER_FIRE_INTERNAL_TEST_CANONICAL_ROSTER' as const;
export const LEASE_CASH_STATUS = 'LEASE_START_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;
export const WAREHOUSE_OPEN_CASH_STATUS = 'WAREHOUSE_INTERNAL_CANONICAL_ONLY' as const;
export const WAREHOUSE_UPGRADE_CASH_STATUS = 'WAREHOUSE_INTERNAL_CANONICAL_ONLY' as const;
export const CARGO_BUY_CASH_STATUS =
  'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;
export const CARGO_SELL_CASH_STATUS =
  'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;
export const DAILY_OPEX_CASH_STATUS =
  'DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED' as const;
export const AD_REWARD_CASH_STATUS = 'AD_REWARD_AUTHORITY_BLOCKED_VERIFICATION' as const;
export const MISSION_REWARD_CASH_STATUS = 'MISSION_INTERNAL_CANONICAL_STATE_ONLY' as const;
export const MILESTONE_REWARD_CASH_STATUS = 'MILESTONE_INTERNAL_CANONICAL_STATE_ONLY' as const;
export const WEEKLY_LOCAL_OBJECTIVE_CASH_STATUS =
  'CLIENT_WEEKLY_OBJECTIVE_BLOCKED_DUPLICATE_OF_SERVER_CLAIMS' as const;
export const MARKETPLACE_CASH_STATUS = 'MARKETPLACE_SERVER_CANONICAL_HUD_UNMIGRATED' as const;
export const INCIDENT_CASH_STATUS =
  'INCIDENT_CASH_INTERNAL_TEST_ONLY_PRODUCTION_CLIENT' as const;
export const SERVER_CLAIM_CASH_STATUS = 'SERVER_WEEKLY_SEASON_CHALLENGE_CLAIMS_CANONICAL' as const;

export const CANONICAL_CATALOG_PURCHASE_ENV = 'CANONICAL_CATALOG_PURCHASE' as const;
export const CANONICAL_PURCHASE_RECEIPTS_COLLECTION = 'canonicalPurchaseReceipts' as const;
export const CANONICAL_PURCHASE_AUTHORITY_VERSION = 1 as const;
export const CANONICAL_CATALOG_PURCHASE_POLICY_VERSION = 'canonical-catalog-purchase-v1' as const;

export const ROAD_CASH_PATHS_NOT_FULLY_CANONICAL = 'ROAD_CASH_PATHS_NOT_FULLY_CANONICAL' as const;

export const SIGNED_IN_CASH_DIAGNOSTIC_REASONS = [
  'ROAD_CASH_PATHS_NOT_FULLY_CANONICAL',
  'FUEL_NOT_CANONICAL',
  'CATALOG_PURCHASE_NOT_CANONICAL',
  'WAREHOUSE_NOT_CANONICAL',
  'CARGO_MARKET_NOT_CANONICAL',
  'REWARD_PATH_NOT_CANONICAL',
] as const;

export type CanonicalCatalogPurchaseGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalCatalogPurchaseGate(options?: {
  envValue?: string | null;
}): CanonicalCatalogPurchaseGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_CATALOG_PURCHASE ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalCatalogPurchaseAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalCatalogPurchaseGate(options) === 'INTERNAL_TEST';
}

export function isValidCanonicalPurchaseId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(value);
}

export function isCanonicalCatalogAssetType(value: unknown): value is 'TRUCK' | 'TRAILER' {
  return value === 'TRUCK' || value === 'TRAILER';
}

const PURCHASE_FORBIDDEN = [
  'price',
  'purchasePrice',
  'condition',
  'upgrades',
  'cashDelta',
  'payment',
  'amount',
  'money',
];

export function hasOnlyCanonicalCatalogPurchaseKeys(data: Record<string, unknown>): boolean {
  if (PURCHASE_FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['catalogModelId', 'purchaseId', 'assetType', 'canonicalSchemaVersion'].includes(key),
  );
}

export function deriveCanonicalCatalogPurchasePrice(
  catalogModelId: string,
  assetType: 'TRUCK' | 'TRAILER',
): { ok: true; price: number; catalogId: string } | { ok: false; reason: string } {
  if (assetType === 'TRAILER') {
    const trailer = TRAILER_MARKET.find((row) => row.id === catalogModelId);
    if (!trailer) return { ok: false, reason: 'UNKNOWN_CATALOG_MODEL' };
    const price = trailer.purchasePrice;
    if (!Number.isSafeInteger(price) || price <= 0) {
      return { ok: false, reason: 'INVALID_CATALOG_PRICE' };
    }
    return { ok: true, price, catalogId: trailer.id };
  }
  const truck = findTruckMarketItem(catalogModelId);
  if (!truck) return { ok: false, reason: 'UNKNOWN_CATALOG_MODEL' };
  const price = truck.purchasePrice;
  if (!Number.isSafeInteger(price) || price <= 0) {
    return { ok: false, reason: 'INVALID_CATALOG_PRICE' };
  }
  return { ok: true, price, catalogId: truck.id };
}

export function createCanonicalCatalogAssetId(
  assetType: 'TRUCK' | 'TRAILER',
  purchaseId: string,
): string {
  return createCanonicalProductionAssetId(assetType === 'TRAILER' ? 'trailer' : 'catalog', purchaseId);
}

export function createCanonicalCatalogPurchaseTransactionId(
  assetId: string,
  purchaseId: string,
): string {
  return `fleet:${assetId}:purchase:${purchaseId}`;
}

export type CanonicalPurchaseReceipt = {
  purchaseId: string;
  assetId: string;
  catalogId: string;
  assetType: 'TRUCK' | 'TRAILER';
  cashBefore: number;
  price: number;
  cashAfter: number;
  transactionId: string;
  createdAt: number;
  authorityVersion: typeof CANONICAL_PURCHASE_AUTHORITY_VERSION;
  policyVersion: typeof CANONICAL_CATALOG_PURCHASE_POLICY_VERSION;
  ownerUid: string;
};

export function classifyFuelCashAuthority(): typeof FUEL_CASH_AUTHORITY_STATUS {
  return FUEL_CASH_AUTHORITY_STATUS;
}
