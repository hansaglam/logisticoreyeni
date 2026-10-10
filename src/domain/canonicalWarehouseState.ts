/**
 * Canonical warehouse economic state (Map V2 Step 29T).
 *
 * INTERNAL_TEST: server-derived open/upgrade/opex. Public openWarehouse/upgradeWarehouse
 * remain local. Inventory/cargo not in scope. Company level is a frozen INTERNAL
 * policy (save player.level is not trusted). Pure. No React. No Firebase.
 */

import { operatingCostBalance, tradingBalance } from '../config/balance';
import {
  canOpenMoreWarehouses,
  getWarehouseUpgradeCapacityGain,
  getWarehouseUpgradeRequiredLevel,
  isWarehouseCityUnlocked,
} from '../config/levelConfig';
import { CITIES_BY_ID } from '../data/cities';
import {
  estimateWarehouseOpenCost,
  estimateWarehouseUpgradeCost,
  resolveWarehouseDailyOperatingCost,
} from '../utils/warehouseCalculations';

export const CANONICAL_WAREHOUSE_STATE_AUTHORITY_STATUS =
  'CANONICAL_WAREHOUSE_STATE_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const WAREHOUSE_READINESS_STATUS = 'WAREHOUSE_INTERNAL_CANONICAL_ONLY' as const;
export const WAREHOUSE_COMPANY_LEVEL_CLASS = 'WAREHOUSE_COMPANY_LEVEL_UNVERIFIED' as const;
export const WAREHOUSE_INVENTORY_CLASS = 'WAREHOUSE_INVENTORY_SEPARATE_NOT_REQUIRED_FOR_OPEX' as const;
export const WAREHOUSE_CLOSE_STATUS = 'NOT_PRESENT' as const;
export const NO_AUTOMATIC_LEGACY_WAREHOUSE_MIGRATION =
  'NO_AUTOMATIC_LEGACY_WAREHOUSE_MIGRATION' as const;
export const LEGACY_WAREHOUSE_AUTHORITY = 'LEGACY_CLIENT_UNVERIFIED' as const;

export const CANONICAL_WAREHOUSE_ENV = 'CANONICAL_WAREHOUSE_AUTHORITY' as const;
export const CANONICAL_WAREHOUSES_COLLECTION = 'canonicalWarehouses' as const;
export const CANONICAL_WAREHOUSE_RECEIPTS_COLLECTION = 'canonicalWarehouseReceipts' as const;
export const CANONICAL_WAREHOUSE_SCHEMA_VERSION = 1 as const;
export const CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION = 'canonical-warehouse-open-v1' as const;
export const CANONICAL_WAREHOUSE_UPGRADE_POLICY_VERSION = 'canonical-warehouse-upgrade-v1' as const;
export const CANONICAL_WAREHOUSE_AUTHORITY_VERSION = 1 as const;

/**
 * Frozen INTERNAL company level: unlocks all registry cities (diyarbakir=9),
 * max warehouse count (level 10 → 6), and large upgrade (level 8).
 * Not player.level. Public authority remains company-level unverified.
 */
export const CANONICAL_WAREHOUSE_INTERNAL_COMPANY_LEVEL = 10 as const;

export const CANONICAL_WAREHOUSE_OPEN_TYPES = ['standard', 'cold'] as const;
export type CanonicalWarehouseOpenType = (typeof CANONICAL_WAREHOUSE_OPEN_TYPES)[number];

export type CanonicalWarehouseAuthorityClass =
  | 'SERVER_CANONICAL'
  | 'INTERNAL_TEST_FIXTURE'
  | 'LEGACY_CLIENT_UNVERIFIED'
  | 'UNSUPPORTED';

export type CanonicalWarehouseGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalWarehouseGate(options?: {
  envValue?: string | null;
}): CanonicalWarehouseGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_WAREHOUSE_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalWarehouseAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalWarehouseGate(options) === 'INTERNAL_TEST';
}

export function classifyCanonicalWarehouseReadiness(): typeof WAREHOUSE_READINESS_STATUS {
  return WAREHOUSE_READINESS_STATUS;
}

export function isValidCanonicalWarehouseIntentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(value);
}

export function isCanonicalWarehouseOpenType(value: unknown): value is CanonicalWarehouseOpenType {
  return value === 'standard' || value === 'cold';
}

export function isCanonicalWarehouseCityId(cityId: string): boolean {
  return Boolean(CITIES_BY_ID[cityId]);
}

export function listCanonicalWarehouseCityIds(): string[] {
  return Object.keys(CITIES_BY_ID);
}

const OPEN_FORBIDDEN = [
  'price',
  'openCost',
  'upgradeCost',
  'currentLevel',
  'nextLevel',
  'level',
  'capacity',
  'capacityTons',
  'operatingCost',
  'dailyOperatingCost',
  'warehouseExpense',
  'cashDelta',
  'money',
  'payment',
  'authorityClass',
  'amount',
] as const;

export function hasOnlyCanonicalWarehouseOpenKeys(data: Record<string, unknown>): boolean {
  if (OPEN_FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['cityId', 'warehouseType', 'openIntentId', 'canonicalSchemaVersion'].includes(key),
  );
}

export function hasOnlyCanonicalWarehouseUpgradeKeys(data: Record<string, unknown>): boolean {
  if (OPEN_FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['warehouseId', 'upgradeIntentId', 'canonicalSchemaVersion'].includes(key),
  );
}

export function createCanonicalWarehouseId(
  cityId: string,
  warehouseType: CanonicalWarehouseOpenType,
): string {
  return `wh_${cityId}_${warehouseType}`;
}

export function createCanonicalWarehouseOpenTransactionId(
  cityId: string,
  warehouseType: CanonicalWarehouseOpenType,
): string {
  return `warehouse:${cityId}:${warehouseType}:open`;
}

export function createCanonicalWarehouseUpgradeTransactionId(
  warehouseId: string,
  nextLevel: number,
): string {
  return `warehouse:${warehouseId}:upgrade:${nextLevel}`;
}

export type CanonicalWarehouseDocument = {
  schemaVersion: typeof CANONICAL_WAREHOUSE_SCHEMA_VERSION;
  warehouseId: string;
  ownerUid: string;
  cityId: string;
  warehouseType: CanonicalWarehouseOpenType;
  level: number;
  capacityTons: number;
  economicRevision: number;
  warehousePolicyVersion: typeof CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION;
  authorityClass: 'INTERNAL_TEST_FIXTURE';
  createdAtMs: number;
  updatedAtMs: number;
};

export type CanonicalWarehouseOpexSite = {
  warehouseId: string;
  cityId: string;
  warehouseType: CanonicalWarehouseOpenType;
  level: number;
  economicRevision: number;
  operatingExpense: number;
};

export type CanonicalWarehouseReceipt = {
  operationId: string;
  operationType: 'OPEN' | 'UPGRADE';
  warehouseId: string;
  cityId: string;
  warehouseType: CanonicalWarehouseOpenType;
  revisionBefore: number;
  revisionAfter: number;
  levelBefore: number;
  levelAfter: number;
  capacityBefore: number;
  capacityAfter: number;
  cashBefore: number;
  cashDelta: number;
  cashAfter: number;
  cashTransactionId: string;
  policyVersion: string;
  createdAtMs: number;
  authoritySource: 'INTERNAL_TEST';
  ownerUid: string;
  authorityVersion: typeof CANONICAL_WAREHOUSE_AUTHORITY_VERSION;
};

export function deriveCanonicalWarehouseOpenQuote(input: {
  cityId: string;
  warehouseType: unknown;
}):
  | {
      ok: true;
      cityId: string;
      warehouseType: CanonicalWarehouseOpenType;
      warehouseId: string;
      price: number;
      level: number;
      capacityTons: number;
      operatingExpense: number;
    }
  | { ok: false; reason: string } {
  if (typeof input.cityId !== 'string' || !isCanonicalWarehouseCityId(input.cityId)) {
    return { ok: false, reason: 'UNKNOWN_CITY' };
  }
  if (!isCanonicalWarehouseOpenType(input.warehouseType)) {
    return { ok: false, reason: 'UNSUPPORTED_WAREHOUSE_TYPE' };
  }
  if (!isWarehouseCityUnlocked(input.cityId, CANONICAL_WAREHOUSE_INTERNAL_COMPANY_LEVEL)) {
    return { ok: false, reason: 'CITY_LOCKED_INTERNAL_POLICY' };
  }
  const city = CITIES_BY_ID[input.cityId]!;
  const price = estimateWarehouseOpenCost(city, input.warehouseType);
  if (!Number.isSafeInteger(price) || price <= 0) {
    return { ok: false, reason: 'INVALID_OPEN_PRICE' };
  }
  const capacityTons = tradingBalance.defaultWarehouseCapacityTons;
  const operatingExpense = resolveWarehouseDailyOperatingCost(
    {
      id: '__preview__',
      cityId: input.cityId,
      capacityTons,
      capacityTon: capacityTons,
      upgradeTier: 1,
      warehouseType: input.warehouseType,
    },
    city,
  );
  if (!Number.isSafeInteger(operatingExpense) || operatingExpense <= 0) {
    return { ok: false, reason: 'INVALID_OPERATING_COST' };
  }
  return {
    ok: true,
    cityId: input.cityId,
    warehouseType: input.warehouseType,
    warehouseId: createCanonicalWarehouseId(input.cityId, input.warehouseType),
    price,
    level: 1,
    capacityTons,
    operatingExpense,
  };
}

export function canOpenCanonicalWarehouseSlot(currentCanonicalCount: number): boolean {
  return canOpenMoreWarehouses(
    CANONICAL_WAREHOUSE_INTERNAL_COMPANY_LEVEL,
    currentCanonicalCount,
  );
}

export function deriveCanonicalWarehouseUpgradeQuote(warehouse: CanonicalWarehouseDocument):
  | {
      ok: true;
      nextLevel: number;
      nextCapacity: number;
      price: number;
      nextOperatingExpense: number;
      requiredInternalCompanyLevel: number;
    }
  | { ok: false; reason: string } {
  const city = CITIES_BY_ID[warehouse.cityId];
  if (!city) return { ok: false, reason: 'UNKNOWN_CITY' };
  const required = getWarehouseUpgradeRequiredLevel(warehouse.level);
  const capacityGain = getWarehouseUpgradeCapacityGain(warehouse.level);
  if (required == null || capacityGain <= 0) {
    return { ok: false, reason: 'MAX_LEVEL' };
  }
  if (CANONICAL_WAREHOUSE_INTERNAL_COMPANY_LEVEL < required) {
    return { ok: false, reason: 'CITY_LOCKED_INTERNAL_POLICY' };
  }
  const price = estimateWarehouseUpgradeCost(city, warehouse.cityId);
  if (!Number.isSafeInteger(price) || price <= 0) {
    return { ok: false, reason: 'INVALID_UPGRADE_PRICE' };
  }
  const nextLevel = warehouse.level + 1;
  const nextCapacity = warehouse.capacityTons + capacityGain;
  const nextOperatingExpense = resolveWarehouseDailyOperatingCost(
    {
      id: warehouse.warehouseId,
      cityId: warehouse.cityId,
      capacityTons: nextCapacity,
      capacityTon: nextCapacity,
      upgradeTier: nextLevel,
      warehouseType: warehouse.warehouseType,
    },
    city,
  );
  if (!Number.isSafeInteger(nextOperatingExpense) || nextOperatingExpense <= 0) {
    return { ok: false, reason: 'INVALID_OPERATING_COST' };
  }
  return {
    ok: true,
    nextLevel,
    nextCapacity,
    price,
    nextOperatingExpense,
    requiredInternalCompanyLevel: required,
  };
}

export function deriveCanonicalWarehouseSiteOpex(
  warehouse: CanonicalWarehouseDocument,
): CanonicalWarehouseOpexSite {
  const city = CITIES_BY_ID[warehouse.cityId];
  const operatingExpense = city
    ? resolveWarehouseDailyOperatingCost(
        {
          id: warehouse.warehouseId,
          cityId: warehouse.cityId,
          capacityTons: warehouse.capacityTons,
          capacityTon: warehouse.capacityTons,
          upgradeTier: warehouse.level,
          warehouseType: warehouse.warehouseType,
        },
        city,
      )
    : operatingCostBalance.fallbackWarehouseDailyCost;
  return {
    warehouseId: warehouse.warehouseId,
    cityId: warehouse.cityId,
    warehouseType: warehouse.warehouseType,
    level: warehouse.level,
    economicRevision: warehouse.economicRevision,
    operatingExpense,
  };
}

export function sumCanonicalWarehouseOpex(sites: readonly CanonicalWarehouseOpexSite[]): number {
  return sites.reduce((sum, site) => sum + site.operatingExpense, 0);
}

export function buildCanonicalWarehouseDocument(input: {
  uid: string;
  quote: Extract<ReturnType<typeof deriveCanonicalWarehouseOpenQuote>, { ok: true }>;
  nowMs: number;
}): CanonicalWarehouseDocument {
  return {
    schemaVersion: CANONICAL_WAREHOUSE_SCHEMA_VERSION,
    warehouseId: input.quote.warehouseId,
    ownerUid: input.uid,
    cityId: input.quote.cityId,
    warehouseType: input.quote.warehouseType,
    level: input.quote.level,
    capacityTons: input.quote.capacityTons,
    economicRevision: 1,
    warehousePolicyVersion: CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION,
    authorityClass: 'INTERNAL_TEST_FIXTURE',
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
}
