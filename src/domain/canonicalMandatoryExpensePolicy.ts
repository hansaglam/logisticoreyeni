/**
 * Canonical cash debit policies (Map V2 Step 29V).
 *
 * Mandatory recurring expense mirrors production `applyCashTransaction`
 * kind `mandatory-expense` and `financeBalance.minCashBalance`.
 * Voluntary purchases stay at floor 0. The client never selects the policy.
 * Pure. No React. No Firebase.
 */

import { financeBalance } from '../config/balance';
import { applyCashTransaction } from '../utils/cashPolicy';
import type { CanonicalCashOperationType } from './canonicalCashOperation';

export const CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY_STATUS =
  'CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY_PASS_INTERNAL_ONLY' as const;

export const CANONICAL_MANDATORY_EXPENSE_POLICY_VERSION =
  'canonical-mandatory-expense-v1' as const;

export const VOLUNTARY_PURCHASE_POLICY = 'VOLUNTARY_PURCHASE' as const;
export const MANDATORY_RECURRING_EXPENSE_POLICY = 'MANDATORY_RECURRING_EXPENSE' as const;
export const SIGNED_DELTA_FLOOR_ZERO_POLICY = 'SIGNED_DELTA_FLOOR_ZERO' as const;

export const CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR =
  'CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR' as const;

export type CanonicalCashDebitPolicy =
  | typeof VOLUNTARY_PURCHASE_POLICY
  | typeof MANDATORY_RECURRING_EXPENSE_POLICY
  | typeof SIGNED_DELTA_FLOOR_ZERO_POLICY;

const VOLUNTARY: ReadonlySet<CanonicalCashOperationType> = new Set([
  'INTERNAL_TEST_DEBIT',
  'CANONICAL_FLEET_REPAIR',
  'CANONICAL_FLEET_UPGRADE',
  'CANONICAL_CATALOG_PURCHASE',
  'CANONICAL_FUEL_PURCHASE',
  'CANONICAL_VEHICLE_LEASE_START',
  'CANONICAL_DRIVER_HIRE',
  'CANONICAL_DRIVER_FIRE',
  'CANONICAL_WAREHOUSE_OPEN',
  'CANONICAL_WAREHOUSE_UPGRADE',
  'CANONICAL_CARGO_BUY',
]);

const MANDATORY: ReadonlySet<CanonicalCashOperationType> = new Set(['CANONICAL_DAILY_OPEX']);

const SIGNED_FLOOR_ZERO: ReadonlySet<CanonicalCashOperationType> = new Set([
  'INTERNAL_TEST_CREDIT',
  'ROAD_DELIVERY_SETTLEMENT',
  'CANONICAL_ROAD_INCIDENT',
  'CANONICAL_VEHICLE_SALE',
  'CANONICAL_CARGO_SELL',
  'CANONICAL_MISSION_REWARD',
  'CANONICAL_MILESTONE_REWARD',
]);

export function resolveCanonicalCashDebitPolicy(
  operationType: CanonicalCashOperationType,
): { ok: true; policy: CanonicalCashDebitPolicy } | { ok: false; reason: 'UNKNOWN_CASH_POLICY' } {
  if (MANDATORY.has(operationType)) {
    return { ok: true, policy: MANDATORY_RECURRING_EXPENSE_POLICY };
  }
  if (VOLUNTARY.has(operationType)) {
    return { ok: true, policy: VOLUNTARY_PURCHASE_POLICY };
  }
  if (SIGNED_FLOOR_ZERO.has(operationType)) {
    return { ok: true, policy: SIGNED_DELTA_FLOOR_ZERO_POLICY };
  }
  return { ok: false, reason: 'UNKNOWN_CASH_POLICY' };
}

export function canonicalMinimumCashAfterDebit(
  operationType: CanonicalCashOperationType,
): number | null {
  const policy = resolveCanonicalCashDebitPolicy(operationType);
  if (!policy.ok) return null;
  if (policy.policy === MANDATORY_RECURRING_EXPENSE_POLICY) {
    return financeBalance.minCashBalance;
  }
  return 0;
}

export type MandatoryExpenseApplication =
  | {
      ok: true;
      requestedExpense: number;
      actualDebit: number;
      unpaidExpense: number;
      cashBefore: number;
      cashAfter: number;
      minCashBalance: number;
      floorReached: boolean;
      policyVersion: typeof CANONICAL_MANDATORY_EXPENSE_POLICY_VERSION;
      policyClass: typeof MANDATORY_RECURRING_EXPENSE_POLICY;
    }
  | {
      ok: false;
      reason: typeof CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR | 'INVALID_EXPENSE';
    };

/**
 * Production `mandatory-expense`: debit min(requested, cash - minCashBalance),
 * inclusive floor. Unpaid remainder is not a debt balance. Cursor still advances.
 */
export function deriveMandatoryExpenseApplication(
  cashBeforeRaw: number,
  requestedExpense: number,
): MandatoryExpenseApplication {
  if (!Number.isSafeInteger(cashBeforeRaw)) {
    return { ok: false, reason: 'INVALID_EXPENSE' };
  }
  if (cashBeforeRaw < financeBalance.minCashBalance) {
    return { ok: false, reason: CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR };
  }
  if (!Number.isSafeInteger(requestedExpense) || requestedExpense <= 0) {
    return { ok: false, reason: 'INVALID_EXPENSE' };
  }
  const applied = applyCashTransaction({
    currentCash: cashBeforeRaw,
    amount: requestedExpense,
    kind: 'mandatory-expense',
    referenceId: 'canonical-mandatory-expense',
  });
  if (!applied.ok || !Number.isSafeInteger(applied.amount) || !Number.isSafeInteger(applied.cashAfter)) {
    return { ok: false, reason: 'INVALID_EXPENSE' };
  }
  return {
    ok: true,
    requestedExpense: applied.requestedAmount,
    actualDebit: applied.amount,
    unpaidExpense: applied.requestedAmount - applied.amount,
    cashBefore: applied.cashBefore,
    cashAfter: applied.cashAfter,
    minCashBalance: financeBalance.minCashBalance,
    floorReached: applied.reason === 'cash-floor-reached',
    policyVersion: CANONICAL_MANDATORY_EXPENSE_POLICY_VERSION,
    policyClass: MANDATORY_RECURRING_EXPENSE_POLICY,
  };
}
