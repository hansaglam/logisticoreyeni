/**
 * Canonical daily opex / staff state authority (Map V2 Step 29S).
 *
 * INTERNAL_TEST fixed 24h server wall-clock. Enumerates canonical drivers/leases/fleet/warehouses.
 * Warehouse opex is INTERNAL canonical only. Production local opex unchanged.
 * Pure. No React. No Firebase. No public UI wiring.
 */

import { operatingCostBalance } from '../config/balance';
import type { CanonicalDriverDocument, CanonicalVehicleLeaseDocument } from './canonicalCoreVehicleStaffCash';
import type { CanonicalFleetAssetDocument } from './canonicalRoadFleet';
import type {
  CanonicalWarehouseDocument,
  CanonicalWarehouseOpexSite,
} from './canonicalWarehouseState';
import {
  CANONICAL_MANDATORY_EXPENSE_POLICY_VERSION,
  MANDATORY_RECURRING_EXPENSE_POLICY,
} from './canonicalMandatoryExpensePolicy';
import {
  deriveCanonicalWarehouseSiteOpex,
  sumCanonicalWarehouseOpex,
} from './canonicalWarehouseState';

export const CANONICAL_DAILY_OPEX_STAFF_STATE_AUTHORITY_STATUS =
  'CANONICAL_DAILY_OPEX_STAFF_STATE_AUTHORITY_PASS_INTERNAL_CLOCK_ONLY' as const;

export const DAILY_OPEX_READINESS_STATUS =
  'DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED' as const;

export const DAILY_OPEX_CLOCK_MODEL = 'INTERNAL_TEST_FIXED_SPEED_OPEX_CLOCK' as const;
export const CANONICAL_DAILY_OPEX_POLICY_VERSION = 'canonical-daily-opex-internal-fixed-v1' as const;
export const CANONICAL_DAILY_OPEX_SCHEMA_VERSION = 1 as const;
export const CANONICAL_DAILY_OPEX_AUTHORITY_VERSION = 1 as const;

export const CANONICAL_DAILY_OPEX_ENV = 'CANONICAL_DAILY_OPEX' as const;
export const CANONICAL_OPEX_STATE_COLLECTION = 'canonicalOpexState' as const;
export const CANONICAL_OPEX_STATE_DOC = 'current' as const;
export const CANONICAL_DAILY_OPEX_RECEIPTS_COLLECTION = 'canonicalDailyOpexReceipts' as const;

/** Matches production PERIOD_24H_MS / DAY_MS. */
export const CANONICAL_OPEX_PERIOD_DURATION_MS = 24 * 60 * 60 * 1000;
/** Matches production ONLINE_TICK_MAX_COST_PERIODS. */
export const CANONICAL_OPEX_MAX_PERIODS_PER_CALL = 1;
/** Matches production OFFLINE_CATCHUP_MAX_COST_PERIODS — public offline still 0. */
export const CANONICAL_OPEX_OFFLINE_CATCHUP_PERIODS = 0;

export const WAREHOUSE_OPEX_AUTHORITY = 'WAREHOUSE_INTERNAL_CANONICAL' as const;
export const OVERDRAFT_OPEX_AUTHORITY = 'CANONICAL_MANDATORY_EXPENSE_PARITY' as const;
export const LEGACY_DRIVER_OPEX = 'LEGACY_DRIVER_UNVERIFIED' as const;
export const LEGACY_LEASE_OPEX = 'LEGACY_LEASE_UNVERIFIED' as const;
export const OTHER_STAFF_OPEX = 'NOT_PRESENT' as const;

export type CanonicalDailyOpexGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalDailyOpexGate(options?: {
  envValue?: string | null;
}): CanonicalDailyOpexGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_DAILY_OPEX ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalDailyOpexAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalDailyOpexGate(options) === 'INTERNAL_TEST';
}

export function classifyCanonicalDailyOpexReadiness(): typeof DAILY_OPEX_READINESS_STATUS {
  return DAILY_OPEX_READINESS_STATUS;
}

const FORBIDDEN = [
  'daysElapsed',
  'elapsedDays',
  'periodCount',
  'periodIndex',
  'salary',
  'salaryTotal',
  'driverCount',
  'leaseTotal',
  'warehouseTotal',
  'warehouseCost',
  'expenseTotal',
  'totalExpense',
  'cashDelta',
  'amount',
  'money',
  'allowOverdraft',
  'minCashBalance',
  'minimumCash',
  'partial',
  'paymentAmount',
  'actualDebit',
  'cashAfter',
  'unpaidExpense',
] as const;

export function hasOnlyCanonicalDailyOpexKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['canonicalSchemaVersion', 'expectedPeriodIndex'].includes(key),
  );
}

export function createCanonicalOpexPeriodId(periodIndex: number): string {
  return `p24_${periodIndex}`;
}

export function createCanonicalDailyOpexTransactionId(periodIndex: number): string {
  return `opex:${createCanonicalOpexPeriodId(periodIndex)}:daily`;
}

export function computeCanonicalOpexDuePeriodIndex(input: {
  epochMs: number;
  lastSettledPeriodIndex: number;
  nowMs: number;
  periodDurationMs?: number;
}): number | null {
  const duration = input.periodDurationMs ?? CANONICAL_OPEX_PERIOD_DURATION_MS;
  if (!Number.isFinite(input.epochMs) || !Number.isFinite(input.nowMs) || duration <= 0) {
    return null;
  }
  if (input.nowMs < input.epochMs) {
    return null;
  }
  const elapsedPeriods = Math.floor((input.nowMs - input.epochMs) / duration);
  const nextIndex = input.lastSettledPeriodIndex + 1;
  if (nextIndex < 0 || nextIndex >= elapsedPeriods) {
    return null;
  }
  return nextIndex;
}

export type CanonicalOpexBreakdown = {
  driverSalary: number;
  leaseExpense: number;
  warehouseExpense: number;
  vehicleRecurringExpense: number;
  operations: number;
  otherExpense: number;
  totalExpense: number;
  hiredDriverCount: number;
  ownedTruckCount: number;
  activeLeaseCount: number;
  warehouseSites: CanonicalWarehouseOpexSite[];
};

export function deriveCanonicalDailyOpexBreakdown(input: {
  drivers: readonly CanonicalDriverDocument[];
  leases: readonly CanonicalVehicleLeaseDocument[];
  fleet: readonly CanonicalFleetAssetDocument[];
  warehouses?: readonly CanonicalWarehouseDocument[];
}): CanonicalOpexBreakdown {
  const hired = input.drivers.filter(
    (driver) => driver.status === 'hired' && Number.isSafeInteger(driver.salaryPerDay),
  );
  const driverSalary = hired.reduce((sum, driver) => sum + driver.salaryPerDay, 0);
  const activeLeases = input.leases.filter((lease) => lease.status === 'ACTIVE');
  const ownedTrucks = input.fleet.filter(
    (asset) =>
      asset.assetType === 'TRUCK' &&
      (asset.ownershipType ?? 'owned') === 'owned' &&
      asset.lifecycleStatus !== 'SOLD' &&
      asset.lifecycleStatus !== 'LEASE_ACTIVE',
  );
  const operations =
    operatingCostBalance.dailyOperationsBase +
    ownedTrucks.length * operatingCostBalance.operationsPerOwnedTruck +
    hired.length * operatingCostBalance.operationsPerDriver;
  const leaseExpense = 0;
  const warehouseSites = (input.warehouses ?? []).map(deriveCanonicalWarehouseSiteOpex);
  const warehouseExpense = sumCanonicalWarehouseOpex(warehouseSites);
  const vehicleRecurringExpense = 0;
  const otherExpense = 0;
  const totalExpense =
    driverSalary + leaseExpense + warehouseExpense + vehicleRecurringExpense + operations + otherExpense;
  return {
    driverSalary,
    leaseExpense,
    warehouseExpense,
    vehicleRecurringExpense,
    operations,
    otherExpense,
    totalExpense,
    hiredDriverCount: hired.length,
    ownedTruckCount: ownedTrucks.length,
    activeLeaseCount: activeLeases.length,
    warehouseSites,
  };
}

export type CanonicalOpexStateDocument = {
  schemaVersion: typeof CANONICAL_DAILY_OPEX_SCHEMA_VERSION;
  policyVersion: typeof CANONICAL_DAILY_OPEX_POLICY_VERSION;
  authorityMode: typeof DAILY_OPEX_CLOCK_MODEL;
  epochMs: number;
  lastSettledPeriodIndex: number;
  lastSettledAtMs: number | null;
  ownerUid: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CanonicalDailyOpexReceipt = {
  schemaVersion: typeof CANONICAL_DAILY_OPEX_SCHEMA_VERSION;
  periodId: string;
  periodIndex: number;
  periodStartMs: number;
  periodEndMs: number;
  authorityMode: typeof DAILY_OPEX_CLOCK_MODEL;
  policyVersion: typeof CANONICAL_DAILY_OPEX_POLICY_VERSION;
  componentBreakdown: CanonicalOpexBreakdown;
  warehouseAuthority: typeof WAREHOUSE_OPEX_AUTHORITY;
  overdraftAuthority: typeof OVERDRAFT_OPEX_AUTHORITY;
  totalExpense: number;
  requestedDebit: number;
  actualDebit: number;
  unpaidExpense: number;
  cashBefore: number;
  cashAfter: number;
  minCashBalance: number;
  cashPolicyVersion: typeof CANONICAL_MANDATORY_EXPENSE_POLICY_VERSION;
  cashPolicyClass: typeof MANDATORY_RECURRING_EXPENSE_POLICY;
  cashTransactionIds: string[];
  settledAtMs: number;
  authorityVersion: typeof CANONICAL_DAILY_OPEX_AUTHORITY_VERSION;
  ownerUid: string;
};

export function buildInitialCanonicalOpexState(uid: string, nowMs: number): CanonicalOpexStateDocument {
  return {
    schemaVersion: CANONICAL_DAILY_OPEX_SCHEMA_VERSION,
    policyVersion: CANONICAL_DAILY_OPEX_POLICY_VERSION,
    authorityMode: DAILY_OPEX_CLOCK_MODEL,
    epochMs: nowMs,
    lastSettledPeriodIndex: -1,
    lastSettledAtMs: null,
    ownerUid: uid,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}
