/**
 * INTERNAL_TEST canonical daily opex (Step 29S + 29V).
 * Server wall-clock 24h periods. Mandatory expense may reach production minCashBalance.
 * Voluntary purchases do not. Zero actual debit still settles the period with no cash txn.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

import {
  CANONICAL_DRIVERS_COLLECTION,
  CANONICAL_VEHICLE_LEASES_COLLECTION,
  type CanonicalDriverDocument,
  type CanonicalVehicleLeaseDocument,
} from '../../src/domain/canonicalCoreVehicleStaffCash';
import {
  CANONICAL_FLEET_ASSETS_COLLECTION,
  type CanonicalFleetAssetDocument,
} from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_WAREHOUSES_COLLECTION,
  type CanonicalWarehouseDocument,
} from '../../src/domain/canonicalWarehouseState';
import {
  CANONICAL_DAILY_OPEX_AUTHORITY_VERSION,
  CANONICAL_DAILY_OPEX_POLICY_VERSION,
  CANONICAL_DAILY_OPEX_RECEIPTS_COLLECTION,
  CANONICAL_DAILY_OPEX_SCHEMA_VERSION,
  CANONICAL_OPEX_MAX_PERIODS_PER_CALL,
  CANONICAL_OPEX_PERIOD_DURATION_MS,
  CANONICAL_OPEX_STATE_COLLECTION,
  CANONICAL_OPEX_STATE_DOC,
  DAILY_OPEX_CLOCK_MODEL,
  OVERDRAFT_OPEX_AUTHORITY,
  WAREHOUSE_OPEX_AUTHORITY,
  buildInitialCanonicalOpexState,
  computeCanonicalOpexDuePeriodIndex,
  createCanonicalDailyOpexTransactionId,
  createCanonicalOpexPeriodId,
  deriveCanonicalDailyOpexBreakdown,
  isCanonicalDailyOpexAllowed,
  type CanonicalDailyOpexReceipt,
  type CanonicalOpexStateDocument,
} from '../../src/domain/canonicalDailyOpexStaffState';
import { deriveMandatoryExpenseApplication } from '../../src/domain/canonicalMandatoryExpensePolicy';
import {
  applyCanonicalCashMutationsInTransaction,
  isAuthenticatedUid,
  serverStateCurrentRef,
} from './canonicalCashTransaction';

export type SettleCanonicalDailyOpexResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      initializedOnly: boolean;
      receipt: CanonicalDailyOpexReceipt | null;
      state: CanonicalOpexStateDocument;
    }
  | { ok: false; reason: string };

function statePath(uid: string): string {
  return `users/${uid}/${CANONICAL_OPEX_STATE_COLLECTION}/${CANONICAL_OPEX_STATE_DOC}`;
}
function receiptPath(uid: string, periodId: string): string {
  return `users/${uid}/${CANONICAL_DAILY_OPEX_RECEIPTS_COLLECTION}/${periodId}`;
}

function isCollectionQuerySnap(
  snap: unknown,
): snap is { docs: Array<{ data: () => Record<string, unknown> | undefined }> } {
  return Boolean(snap && typeof snap === 'object' && Array.isArray((snap as { docs?: unknown }).docs));
}

async function listCollectionDocs(
  transaction: Transaction,
  firestore: Firestore,
  collectionPath: string,
): Promise<Record<string, unknown>[]> {
  const collection = (
    firestore as Firestore & {
      collection?: (path: string) => { path: string };
    }
  ).collection?.(collectionPath);
  if (!collection) return [];
  const snap = await transaction.get(collection as never);
  if (isCollectionQuerySnap(snap)) {
    return snap.docs
      .map((doc) => doc.data())
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }
  return [];
}

export async function settleCanonicalDailyOpexInternalTransaction(
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: { envValue?: string | null; expectedPeriodIndex?: number },
): Promise<SettleCanonicalDailyOpexResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalDailyOpexAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_DAILY_OPEX_OFF' };
  }
  if (!Number.isFinite(nowMs) || nowMs <= 0) {
    return { ok: false, reason: 'INVALID_CLOCK' };
  }
  void options?.expectedPeriodIndex;
  void CANONICAL_OPEX_MAX_PERIODS_PER_CALL;

  return firestore.runTransaction(async (transaction) => {
    const sRef = firestore.doc(statePath(uid));
    const stateSnap = await transaction.get(sRef);
    if (!stateSnap.exists) {
      const initial = buildInitialCanonicalOpexState(uid, nowMs);
      transaction.create(sRef, initial);
      return {
        ok: true as const,
        alreadyApplied: false,
        initializedOnly: true,
        receipt: null,
        state: initial,
      };
    }
    const state = stateSnap.data() as CanonicalOpexStateDocument;
    if (state.ownerUid !== uid) return { ok: false as const, reason: 'UNAUTHENTICATED' };
    if (state.schemaVersion !== CANONICAL_DAILY_OPEX_SCHEMA_VERSION) {
      return { ok: false as const, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (state.policyVersion !== CANONICAL_DAILY_OPEX_POLICY_VERSION) {
      return { ok: false as const, reason: 'UNSUPPORTED_POLICY' };
    }
    const dueIndex = computeCanonicalOpexDuePeriodIndex({
      epochMs: state.epochMs,
      lastSettledPeriodIndex: state.lastSettledPeriodIndex,
      nowMs,
    });
    if (dueIndex == null) {
      if (state.lastSettledPeriodIndex >= 0) {
        const lastId = createCanonicalOpexPeriodId(state.lastSettledPeriodIndex);
        const lastSnap = await transaction.get(firestore.doc(receiptPath(uid, lastId)));
        if (lastSnap.exists) {
          return {
            ok: true as const,
            alreadyApplied: true,
            initializedOnly: false,
            receipt: lastSnap.data() as CanonicalDailyOpexReceipt,
            state,
          };
        }
      }
      return {
        ok: true as const,
        alreadyApplied: true,
        initializedOnly: false,
        receipt: null,
        state,
      };
    }
    const periodId = createCanonicalOpexPeriodId(dueIndex);
    const rRef = firestore.doc(receiptPath(uid, periodId));
    const receiptSnap = await transaction.get(rRef);
    const transactionId = createCanonicalDailyOpexTransactionId(dueIndex);
    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalDailyOpexReceipt;
      const storedTxn = existing.cashTransactionIds?.[0];
      if (existing.ownerUid !== uid || existing.periodIndex !== dueIndex) {
        return { ok: false as const, reason: 'CANONICAL_OPEX_CONFLICT' };
      }
      if (storedTxn != null && storedTxn !== transactionId) {
        return { ok: false as const, reason: 'CANONICAL_OPEX_CONFLICT' };
      }
      if (storedTxn == null && Number(existing.actualDebit ?? 0) !== 0) {
        return { ok: false as const, reason: 'CANONICAL_OPEX_CONFLICT' };
      }
      if (state.lastSettledPeriodIndex < dueIndex) {
        return { ok: false as const, reason: 'CANONICAL_OPEX_CONFLICT' };
      }
      return {
        ok: true as const,
        alreadyApplied: true,
        initializedOnly: false,
        receipt: existing,
        state,
      };
    }

    const [driverRows, leaseRows, fleetRows, warehouseRows] = await Promise.all([
      listCollectionDocs(transaction, firestore, `users/${uid}/${CANONICAL_DRIVERS_COLLECTION}`),
      listCollectionDocs(transaction, firestore, `users/${uid}/${CANONICAL_VEHICLE_LEASES_COLLECTION}`),
      listCollectionDocs(transaction, firestore, `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}`),
      listCollectionDocs(transaction, firestore, `users/${uid}/${CANONICAL_WAREHOUSES_COLLECTION}`),
    ]);
    const drivers = driverRows as unknown as CanonicalDriverDocument[];
    const leases = leaseRows as unknown as CanonicalVehicleLeaseDocument[];
    const fleet = fleetRows as unknown as CanonicalFleetAssetDocument[];
    const warehouses = warehouseRows as unknown as CanonicalWarehouseDocument[];
    const breakdown = deriveCanonicalDailyOpexBreakdown({ drivers, leases, fleet, warehouses });
    if (!Number.isSafeInteger(breakdown.totalExpense) || breakdown.totalExpense <= 0) {
      return { ok: false as const, reason: 'INVALID_OPEX_TOTAL' };
    }

    const cashSnap = await transaction.get(firestore.doc(serverStateCurrentRef(uid)));
    if (!cashSnap.exists) return { ok: false as const, reason: 'SERVER_STATE_MISSING' };
    const liveCash = Number((cashSnap.data() as { cash?: unknown } | undefined)?.cash);
    const policy = deriveMandatoryExpenseApplication(liveCash, breakdown.totalExpense);
    if (!policy.ok) return { ok: false as const, reason: policy.reason };

    let cashBefore = policy.cashBefore;
    let cashAfter = policy.cashAfter;
    const cashTransactionIds: string[] = [];
    if (policy.actualDebit > 0) {
      const cash = await applyCanonicalCashMutationsInTransaction(
        transaction,
        firestore,
        uid,
        [
          {
            uid,
            transactionId,
            operationType: 'CANONICAL_DAILY_OPEX',
            sourceId: periodId,
            amountDelta: -policy.actualDebit,
            nowMs,
            metadata: {
              periodIndex: dueIndex,
              policyVersion: CANONICAL_DAILY_OPEX_POLICY_VERSION,
              requestedExpense: policy.requestedExpense,
              unpaidExpense: policy.unpaidExpense,
            },
          },
        ],
        nowMs,
      );
      if (!cash.ok) return { ok: false as const, reason: cash.reason };
      if (cash.alreadyApplied) return { ok: false as const, reason: 'CANONICAL_OPEX_CONFLICT' };
      cashBefore = cash.cashBefore;
      cashAfter = cash.cashAfter;
      cashTransactionIds.push(transactionId);
    }

    const periodStartMs = state.epochMs + dueIndex * CANONICAL_OPEX_PERIOD_DURATION_MS;
    const receipt: CanonicalDailyOpexReceipt = {
      schemaVersion: CANONICAL_DAILY_OPEX_SCHEMA_VERSION,
      periodId,
      periodIndex: dueIndex,
      periodStartMs,
      periodEndMs: periodStartMs + CANONICAL_OPEX_PERIOD_DURATION_MS,
      authorityMode: DAILY_OPEX_CLOCK_MODEL,
      policyVersion: CANONICAL_DAILY_OPEX_POLICY_VERSION,
      componentBreakdown: breakdown,
      warehouseAuthority: WAREHOUSE_OPEX_AUTHORITY,
      overdraftAuthority: OVERDRAFT_OPEX_AUTHORITY,
      totalExpense: breakdown.totalExpense,
      requestedDebit: policy.requestedExpense,
      actualDebit: policy.actualDebit,
      unpaidExpense: policy.unpaidExpense,
      cashBefore,
      cashAfter,
      minCashBalance: policy.minCashBalance,
      cashPolicyVersion: policy.policyVersion,
      cashPolicyClass: policy.policyClass,
      cashTransactionIds,
      settledAtMs: nowMs,
      authorityVersion: CANONICAL_DAILY_OPEX_AUTHORITY_VERSION,
      ownerUid: uid,
    };
    const nextState: CanonicalOpexStateDocument = {
      ...state,
      lastSettledPeriodIndex: dueIndex,
      lastSettledAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    transaction.create(rRef, receipt);
    transaction.update(sRef, {
      lastSettledPeriodIndex: dueIndex,
      lastSettledAtMs: nowMs,
      updatedAtMs: nowMs,
    });
    return {
      ok: true as const,
      alreadyApplied: false,
      initializedOnly: false,
      receipt,
      state: nextState,
    };
  });
}
