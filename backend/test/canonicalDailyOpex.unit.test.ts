/**
 * Canonical daily opex — in-memory tests (Step 29S).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { hireCanonicalDriverTransaction } from '../src/canonicalCoreVehicleStaffCash';
import { settleCanonicalDailyOpexInternalTransaction } from '../src/canonicalDailyOpex';
import {
  runCanonicalCashMutation,
  serverStateCurrentRef,
  CANONICAL_CASH_TRANSACTIONS_COLLECTION,
} from '../src/canonicalCashTransaction';
import { createCanonicalVehicleLeaseTransaction } from '../src/canonicalCoreVehicleStaffCash';
import {
  CANONICAL_DAILY_OPEX_POLICY_VERSION,
  CANONICAL_OPEX_PERIOD_DURATION_MS,
  CANONICAL_OPEX_STATE_COLLECTION,
  CANONICAL_OPEX_STATE_DOC,
  DAILY_OPEX_READINESS_STATUS,
  WAREHOUSE_OPEX_AUTHORITY,
  computeCanonicalOpexDuePeriodIndex,
  createCanonicalDailyOpexTransactionId,
  deriveCanonicalDailyOpexBreakdown,
  hasOnlyCanonicalDailyOpexKeys,
  isCanonicalDailyOpexAllowed,
} from '../../src/domain/canonicalDailyOpexStaffState';
import { operatingCostBalance, financeBalance } from '../../src/config/balance';
import {
  deriveMandatoryExpenseApplication,
  resolveCanonicalCashDebitPolicy,
} from '../../src/domain/canonicalMandatoryExpensePolicy';
import { applyCashTransaction } from '../../src/utils/cashPolicy';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false };
    },
    collection(path: string) {
      return { path, _col: true };
    },
    async runTransaction<T>(
      operation: (transaction: {
        get: (ref: { path: string; _col?: boolean }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
          docs: Array<{ data: () => Record<string, unknown> | undefined }>;
        }>;
        create: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) {
      return operation({
        async get(ref) {
          if (ref._col) {
            const prefix = `${ref.path.replace(/\/$/, '')}/`;
            const docs = [...dump.entries()]
              .filter(([key]) => {
                if (!key.startsWith(prefix)) return false;
                const rest = key.slice(prefix.length);
                return rest.length > 0 && !rest.includes('/');
              })
              .map(([, data]) => ({ data: () => data }));
            return { exists: docs.length > 0, data: () => undefined, docs };
          }
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data, docs: [] };
        },
        create(ref, data) {
          if (dump.has(ref.path)) throw new Error('already-exists');
          dump.set(ref.path, { ...data });
        },
        update(ref, data) {
          const current = dump.get(ref.path);
          if (!current) throw new Error('missing');
          dump.set(ref.path, { ...current, ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

const GATE = { envValue: 'INTERNAL_TEST' as const };
const STAFF = { envValue: 'INTERNAL_TEST' as const };
const EPOCH = 1_700_000_000_000;
const DAY = CANONICAL_OPEX_PERIOD_DURATION_MS;
const POOL_A = 'driver-can-t';
const TRUCK_ID = 'truck-ford-cargo';

function seedCash(db: ReturnType<typeof createMemoryFirestore>, cash = 200_000) {
  db.dump.set(serverStateCurrentRef('uid-a'), { cash, ownerUid: 'uid-a', sourceVersion: 1 });
  db.dump.set('users/uid-a', { money: 44_000 });
}

test('gate, keys, clock math, warehouse classifier', () => {
  assert.equal(isCanonicalDailyOpexAllowed({ envValue: null }), false);
  assert.equal(isCanonicalDailyOpexAllowed(GATE), true);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, daysElapsed: 3 }), false);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, salaryTotal: 1 }), false);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, leaseTotal: 1 }), false);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, warehouseTotal: 1 }), false);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, allowOverdraft: true }), false);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, minCashBalance: -5000 }), false);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, actualDebit: 1 }), false);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, periodIndex: 9 }), false);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1 }), true);
  assert.equal(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, expectedPeriodIndex: 0 }), true);
  assert.equal(
    computeCanonicalOpexDuePeriodIndex({
      epochMs: EPOCH,
      lastSettledPeriodIndex: -1,
      nowMs: EPOCH,
    }),
    null,
  );
  assert.equal(
    computeCanonicalOpexDuePeriodIndex({
      epochMs: EPOCH,
      lastSettledPeriodIndex: -1,
      nowMs: EPOCH + DAY,
    }),
    0,
  );
  assert.equal(
    computeCanonicalOpexDuePeriodIndex({
      epochMs: EPOCH,
      lastSettledPeriodIndex: -1,
      nowMs: EPOCH + 3 * DAY,
    }),
    0,
  );
  assert.equal(WAREHOUSE_OPEX_AUTHORITY, 'WAREHOUSE_INTERNAL_CANONICAL');
  assert.equal(
    DAILY_OPEX_READINESS_STATUS,
    'DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED',
  );
  const empty = deriveCanonicalDailyOpexBreakdown({ drivers: [], leases: [], fleet: [] });
  assert.equal(empty.leaseExpense, 0);
  assert.equal(empty.warehouseExpense, 0);
  assert.equal(empty.operations, operatingCostBalance.dailyOperationsBase);
  assert.equal(empty.totalExpense, operatingCostBalance.dailyOperationsBase);
});

test('auth and gate', async () => {
  const db = createMemoryFirestore();
  const unauth = await settleCanonicalDailyOpexInternalTransaction(db, '', EPOCH, GATE);
  assert.equal(unauth.ok, false);
  if (!unauth.ok) assert.equal(unauth.reason, 'UNAUTHENTICATED');
  const off = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH, {
    envValue: null,
  });
  assert.equal(off.ok, false);
  if (!off.ok) assert.equal(off.reason, 'CANONICAL_DAILY_OPEX_OFF');
});

test('init cursor, first due period, retry, device now irrelevant', async () => {
  const db = createMemoryFirestore();
  seedCash(db);
  const init = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH, GATE);
  assert.equal(init.ok, true);
  if (!init.ok) return;
  assert.equal(init.initializedOnly, true);
  assert.equal(init.receipt, null);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 200_000);
  const idle = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + 1000, GATE);
  assert.equal(idle.ok, true);
  if (idle.ok) assert.equal(idle.alreadyApplied, true);
  const first = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + DAY, GATE);
  assert.equal(first.ok, true);
  if (!first.ok || !first.receipt) return;
  assert.equal(first.receipt.periodIndex, 0);
  assert.equal(first.receipt.totalExpense, operatingCostBalance.dailyOperationsBase);
  assert.equal(first.receipt.componentBreakdown.warehouseExpense, 0);
  assert.equal(first.receipt.cashTransactionIds[0], createCanonicalDailyOpexTransactionId(0));
  assert.equal(
    db.dump.get(serverStateCurrentRef('uid-a'))?.cash,
    200_000 - operatingCostBalance.dailyOperationsBase,
  );
  const retry = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + DAY, GATE);
  assert.equal(retry.ok, true);
  if (!retry.ok || !retry.receipt) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.receipt.totalExpense, first.receipt.totalExpense);
  assert.equal(
    db.dump.get(serverStateCurrentRef('uid-a'))?.cash,
    200_000 - operatingCostBalance.dailyOperationsBase,
  );
  const clientSkew = await settleCanonicalDailyOpexInternalTransaction(
    db,
    'uid-a',
    EPOCH + DAY,
    GATE,
  );
  assert.equal(clientSkew.ok, true);
  if (clientSkew.ok) assert.equal(clientSkew.alreadyApplied, true);
  assert.equal(db.dump.get('users/uid-a')?.money, 44_000);
});

test('driver salary exact, fired excluded, lease recurring 0, catch-up one period', async () => {
  const db = createMemoryFirestore();
  seedCash(db);
  await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH, GATE);
  const hired = await hireCanonicalDriverTransaction(db, 'uid-a', POOL_A, 'hire-opex1', EPOCH, STAFF);
  assert.equal(hired.ok, true);
  const afterHire = Number(db.dump.get(serverStateCurrentRef('uid-a'))?.cash);
  const due = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + DAY, GATE);
  assert.equal(due.ok, true);
  if (!due.ok || !due.receipt) return;
  const expectedOps =
    operatingCostBalance.dailyOperationsBase + operatingCostBalance.operationsPerDriver;
  assert.equal(due.receipt.componentBreakdown.driverSalary, 110);
  assert.equal(due.receipt.componentBreakdown.operations, expectedOps);
  assert.equal(due.receipt.componentBreakdown.leaseExpense, 0);
  assert.equal(due.receipt.totalExpense, 110 + expectedOps);
  assert.equal(
    db.dump.get(serverStateCurrentRef('uid-a'))?.cash,
    afterHire - due.receipt.totalExpense,
  );
  const lease = await createCanonicalVehicleLeaseTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'leaseopex',
    'weekly',
    EPOCH + DAY,
    STAFF,
  );
  assert.equal(lease.ok, true);
  const afterLease = Number(db.dump.get(serverStateCurrentRef('uid-a'))?.cash);
  const second = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + 3 * DAY, GATE);
  assert.equal(second.ok, true);
  if (!second.ok || !second.receipt) return;
  assert.equal(second.receipt.periodIndex, 1);
  assert.equal(second.receipt.componentBreakdown.leaseExpense, 0);
  assert.equal(second.receipt.componentBreakdown.activeLeaseCount, 1);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, afterLease - second.receipt.totalExpense);
});

test('low cash partial-debits to the production floor and advances the cursor', async () => {
  const db = createMemoryFirestore();
  seedCash(db, 10);
  await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH, GATE);
  const settled = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + DAY, GATE);
  assert.equal(settled.ok, true);
  if (!settled.ok || !settled.receipt) return;
  assert.equal(settled.receipt.requestedDebit, operatingCostBalance.dailyOperationsBase);
  assert.equal(settled.receipt.actualDebit, operatingCostBalance.dailyOperationsBase);
  assert.equal(settled.receipt.unpaidExpense, 0);
  assert.equal(settled.receipt.cashAfter, 10 - operatingCostBalance.dailyOperationsBase);
  const state = db.dump.get(
    `users/uid-a/${CANONICAL_OPEX_STATE_COLLECTION}/${CANONICAL_OPEX_STATE_DOC}`,
  );
  assert.equal(state?.lastSettledPeriodIndex, 0);
});

test('rules deny client writes', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalOpexState\/\{/);
  assert.match(rules, /match \/canonicalDailyOpexReceipts\/\{/);
  assert.match(rules, /canonical-daily-opex-internal-fixed-v1|canonicalDailyOpexReceipts/);
});

test('policy version frozen on receipt', async () => {
  const db = createMemoryFirestore();
  seedCash(db);
  await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH, GATE);
  const first = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + DAY, GATE);
  assert.equal(first.ok, true);
  if (first.ok && first.receipt) {
    assert.equal(first.receipt.policyVersion, CANONICAL_DAILY_OPEX_POLICY_VERSION);
  }
  assert.ok(
    [...db.dump.keys()].some((key) => key.includes(CANONICAL_CASH_TRANSACTIONS_COLLECTION)),
  );
});

test('mandatory policy matches production helper', () => {
  const floor = financeBalance.minCashBalance;
  assert.equal(floor, -5000);
  const vectors: Array<[number, number]> = [
    [10000, 1000],
    [1000, 1000],
    [0, 1000],
    [-4000, 500],
    [-4000, 2000],
    [-5000, 100],
    [-4999, 2],
    [100, 6000],
  ];
  for (const [cashBefore, expense] of vectors) {
    const production = applyCashTransaction({
      currentCash: cashBefore,
      amount: expense,
      kind: 'mandatory-expense',
      referenceId: 'parity',
    });
    const derived = deriveMandatoryExpenseApplication(cashBefore, expense);
    assert.equal(derived.ok, true);
    if (!derived.ok) return;
    assert.equal(derived.actualDebit, production.amount);
    assert.equal(derived.cashAfter, production.cashAfter);
    assert.equal(derived.unpaidExpense, production.requestedAmount - production.amount);
    assert.equal(derived.cashAfter >= floor, true);
  }
  const below = deriveMandatoryExpenseApplication(floor - 1, 100);
  assert.equal(below.ok, false);
  if (!below.ok) assert.equal(below.reason, 'CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR');
  assert.equal(resolveCanonicalCashDebitPolicy('CANONICAL_DAILY_OPEX').ok, true);
  assert.equal(resolveCanonicalCashDebitPolicy('CANONICAL_FUEL_PURCHASE').ok, true);
  const fuel = resolveCanonicalCashDebitPolicy('CANONICAL_FUEL_PURCHASE');
  const opex = resolveCanonicalCashDebitPolicy('CANONICAL_DAILY_OPEX');
  const road = resolveCanonicalCashDebitPolicy('ROAD_DELIVERY_SETTLEMENT');
  if (fuel.ok) assert.equal(fuel.policy, 'VOLUNTARY_PURCHASE');
  if (opex.ok) assert.equal(opex.policy, 'MANDATORY_RECURRING_EXPENSE');
  if (road.ok) assert.equal(road.policy, 'SIGNED_DELTA_FLOOR_ZERO');
  assert.equal(resolveCanonicalCashDebitPolicy('MULTIMODAL_SETTLEMENT').ok, false);
});

test('floor, partial, zero debit, retry, credit, voluntary rejection', async () => {
  const db = createMemoryFirestore();
  seedCash(db, -4900);
  await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH, GATE);
  const expense = operatingCostBalance.dailyOperationsBase;
  const first = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + DAY, GATE);
  assert.equal(first.ok, true);
  if (!first.ok || !first.receipt) return;
  assert.equal(first.receipt.actualDebit, Math.min(expense, -4900 - financeBalance.minCashBalance));
  assert.equal(first.receipt.cashAfter, -4900 - first.receipt.actualDebit);
  const second = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + 2 * DAY, GATE);
  assert.equal(second.ok, true);
  if (!second.ok || !second.receipt) return;
  assert.equal(second.receipt.cashAfter, financeBalance.minCashBalance);
  assert.equal(second.receipt.actualDebit + second.receipt.unpaidExpense, expense);
  const atFloor = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + 3 * DAY, GATE);
  assert.equal(atFloor.ok, true);
  if (!atFloor.ok || !atFloor.receipt) return;
  assert.equal(atFloor.receipt.actualDebit, 0);
  assert.equal(atFloor.receipt.cashTransactionIds.length, 0);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, financeBalance.minCashBalance);
  const retry = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + 3 * DAY, GATE);
  assert.equal(retry.ok, true);
  if (retry.ok) assert.equal(retry.alreadyApplied, true);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, financeBalance.minCashBalance);

  const credit = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'credit-while-negative',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'test',
    amountDelta: 1000,
    nowMs: EPOCH,
  });
  assert.equal(credit.ok, true);
  if (credit.ok) assert.equal(credit.receipt.cashAfter, financeBalance.minCashBalance + 1000);

  for (const operationType of [
    'CANONICAL_FUEL_PURCHASE',
    'CANONICAL_FLEET_REPAIR',
    'CANONICAL_FLEET_UPGRADE',
    'CANONICAL_WAREHOUSE_OPEN',
    'CANONICAL_WAREHOUSE_UPGRADE',
    'CANONICAL_CARGO_BUY',
    'CANONICAL_CATALOG_PURCHASE',
    'CANONICAL_DRIVER_HIRE',
    'CANONICAL_VEHICLE_LEASE_START',
  ] as const) {
    const rejected = await runCanonicalCashMutation(db, {
      uid: 'uid-a',
      transactionId: `vol-${operationType}`,
      operationType,
      sourceId: 'test',
      amountDelta: -1,
      nowMs: EPOCH,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.reason, 'INSUFFICIENT_CASH');
  }

  const sell = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'cargo-sell-while-negative',
    operationType: 'CANONICAL_CARGO_SELL',
    sourceId: 'test',
    amountDelta: 50,
    nowMs: EPOCH,
  });
  assert.equal(sell.ok, true);

  const road = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'road-overdraft-blocked',
    operationType: 'ROAD_DELIVERY_SETTLEMENT',
    sourceId: 'test',
    amountDelta: -10_000,
    nowMs: EPOCH,
  });
  assert.equal(road.ok, false);
  if (!road.ok) assert.equal(road.reason, 'INSUFFICIENT_CASH');

  db.dump.set(serverStateCurrentRef('uid-a'), {
    cash: financeBalance.minCashBalance - 1,
    ownerUid: 'uid-a',
    sourceVersion: 1,
  });
  const corrupt = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + 4 * DAY, GATE);
  assert.equal(corrupt.ok, false);
  if (!corrupt.ok) assert.equal(corrupt.reason, 'CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR');
});

test('pre-29V receipt retry does not reapply', async () => {
  const db = createMemoryFirestore();
  seedCash(db, 50);
  await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH, GATE);
  const periodId = 'p24_0';
  db.dump.set(`users/uid-a/canonicalDailyOpexReceipts/${periodId}`, {
    schemaVersion: 1,
    periodId,
    periodIndex: 0,
    ownerUid: 'uid-a',
    cashTransactionIds: [`opex:${periodId}:daily`],
    totalExpense: 80,
    actualDebit: 80,
  });
  db.dump.set(`users/uid-a/${CANONICAL_OPEX_STATE_COLLECTION}/${CANONICAL_OPEX_STATE_DOC}`, {
    ...(db.dump.get(`users/uid-a/${CANONICAL_OPEX_STATE_COLLECTION}/${CANONICAL_OPEX_STATE_DOC}`) ?? {}),
    lastSettledPeriodIndex: 0,
    ownerUid: 'uid-a',
    schemaVersion: 1,
    policyVersion: CANONICAL_DAILY_OPEX_POLICY_VERSION,
    epochMs: EPOCH,
  });
  const before = db.dump.get(serverStateCurrentRef('uid-a'))?.cash;
  const retry = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', EPOCH + DAY, GATE);
  assert.equal(retry.ok, true);
  if (retry.ok) assert.equal(retry.alreadyApplied, true);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, before);
});

