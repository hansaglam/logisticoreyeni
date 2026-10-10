/**
 * Internal backend helper for canonical cash mutations (Step 29E).
 *
 * Allowed internally: INTERNAL_TEST_CREDIT, INTERNAL_TEST_DEBIT,
 * ROAD_DELIVERY_SETTLEMENT, CANONICAL_FLEET_REPAIR, CANONICAL_FLEET_UPGRADE,
 * CANONICAL_ROAD_INCIDENT, CANONICAL_CATALOG_PURCHASE, CANONICAL_FUEL_PURCHASE,
 * CANONICAL_VEHICLE_LEASE_START, CANONICAL_DRIVER_HIRE, CANONICAL_DRIVER_FIRE,
 * CANONICAL_VEHICLE_SALE, CANONICAL_DAILY_OPEX, CANONICAL_WAREHOUSE_OPEN,
 * CANONICAL_WAREHOUSE_UPGRADE, CANONICAL_CARGO_BUY, CANONICAL_CARGO_SELL.
 * Not an HTTPS cash-delta callable.
 * Never accept a client-chosen delta through onCall.
 *
 * Writes:
 * - users/{uid}/serverState/current.cash
 * - users/{uid}/canonicalCashTransactions/{transactionId}
 *
 * Does not write users/{uid}.money, saves/*, or canonicalDeliveryCompletions.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

import {
  ACCOUNT_CASH_AUTHORITY_MIGRATION_VERSION_UNMIGRATED,
  CANONICAL_CASH_CURRENCY,
  CANONICAL_CASH_TRANSACTION_AUTHORITY_VERSION,
  type CanonicalCashOperationType,
} from '../../src/domain/canonicalCashOperation';
import {
  CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR,
  canonicalMinimumCashAfterDebit,
} from '../../src/domain/canonicalMandatoryExpensePolicy';

export const CANONICAL_CASH_TRANSACTIONS_COLLECTION = 'canonicalCashTransactions';
export const SERVER_STATE_CASH_FLOOR = 0;

export type CanonicalCashMutationInput = {
  uid: string;
  transactionId: string;
  operationType: CanonicalCashOperationType;
  sourceId: string;
  /** Server-derived integer delta. Positive = credit, negative = debit. */
  amountDelta: number;
  metadata?: Readonly<Record<string, string | number | boolean>>;
  nowMs?: number;
  /** Unit-test only. Never wire to a callable. */
  simulateFailureAfterValidate?: boolean;
};

export type CanonicalCashReceipt = {
  transactionId: string;
  operationType: CanonicalCashOperationType;
  cashBefore: number;
  cashDelta: number;
  cashAfter: number;
  currency: typeof CANONICAL_CASH_CURRENCY;
  applied: boolean;
  alreadyApplied: boolean;
  createdAt: number;
};

export type CanonicalCashMutationSuccess = {
  ok: true;
  receipt: CanonicalCashReceipt;
};

export type CanonicalCashMutationFailure = {
  ok: false;
  reason:
    | 'UNAUTHENTICATED'
    | 'INVALID_TRANSACTION_ID'
    | 'INVALID_AMOUNT'
    | 'INVALID_OPERATION'
    | 'SERVER_STATE_MISSING'
    | 'INSUFFICIENT_CASH'
    | typeof CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR
    | 'CANONICAL_CASH_TRANSACTION_CONFLICT'
    | 'SIMULATED_FAILURE';
};

export type CanonicalCashMutationResult =
  | CanonicalCashMutationSuccess
  | CanonicalCashMutationFailure;

export type CanonicalCashTransactionDocument = {
  transactionId: string;
  operationType: CanonicalCashOperationType;
  sourceId: string;
  amountDelta: number;
  currency: typeof CANONICAL_CASH_CURRENCY;
  createdAt: number;
  cashAuthorityVersion: typeof CANONICAL_CASH_TRANSACTION_AUTHORITY_VERSION;
  accountCashAuthorityMigrationVersion: typeof ACCOUNT_CASH_AUTHORITY_MIGRATION_VERSION_UNMIGRATED;
  ownerUid: string;
  cashBefore: number;
  cashAfter: number;
  metadata: Record<string, string | number | boolean>;
};

const ALLOWED_HELPER_OPERATIONS: ReadonlySet<CanonicalCashOperationType> = new Set([
  'INTERNAL_TEST_CREDIT',
  'INTERNAL_TEST_DEBIT',
  'ROAD_DELIVERY_SETTLEMENT',
  'CANONICAL_FLEET_REPAIR',
  'CANONICAL_FLEET_UPGRADE',
  'CANONICAL_ROAD_INCIDENT',
  'CANONICAL_CATALOG_PURCHASE',
  'CANONICAL_FUEL_PURCHASE',
  'CANONICAL_VEHICLE_LEASE_START',
  'CANONICAL_DRIVER_HIRE',
  'CANONICAL_DRIVER_FIRE',
  'CANONICAL_VEHICLE_SALE',
  'CANONICAL_DAILY_OPEX',
  'CANONICAL_WAREHOUSE_OPEN',
  'CANONICAL_WAREHOUSE_UPGRADE',
  'CANONICAL_CARGO_BUY',
  'CANONICAL_CARGO_SELL',
  'CANONICAL_MISSION_REWARD',
  'CANONICAL_MILESTONE_REWARD',
]);

export function canonicalCashTransactionRef(uid: string, transactionId: string): string {
  return `users/${uid}/${CANONICAL_CASH_TRANSACTIONS_COLLECTION}/${transactionId}`;
}

export function serverStateCurrentRef(uid: string): string {
  return `users/${uid}/serverState/current`;
}

export function isValidCanonicalCashTransactionId(transactionId: string): boolean {
  return (
    typeof transactionId === 'string' &&
    transactionId.length >= 1 &&
    transactionId.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(transactionId)
  );
}

export function isAuthenticatedUid(uid: string): boolean {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

function compactMetadata(
  metadata: CanonicalCashMutationInput['metadata'],
): Record<string, string | number | boolean> {
  if (!metadata) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (out && Object.keys(out).length >= 16) break;
    if (typeof key !== 'string' || key.length > 64) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

function rejectDebitAgainstPolicy(
  operationType: CanonicalCashOperationType,
  cashBefore: number,
  cashAfter: number,
  amountDelta: number,
): CanonicalCashMutationFailure | null {
  if (amountDelta >= 0) return null;
  const floor = canonicalMinimumCashAfterDebit(operationType);
  if (floor == null) return { ok: false, reason: 'INVALID_OPERATION' };
  if (
    operationType === 'CANONICAL_DAILY_OPEX' &&
    (!Number.isSafeInteger(cashBefore) || cashBefore < floor)
  ) {
    return { ok: false, reason: CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR };
  }
  if (cashAfter < floor) return { ok: false, reason: 'INSUFFICIENT_CASH' };
  return null;
}

function sameCanonicalPayload(
  existing: CanonicalCashTransactionDocument,
  input: CanonicalCashMutationInput,
): boolean {
  return (
    existing.operationType === input.operationType &&
    existing.sourceId === input.sourceId &&
    existing.amountDelta === input.amountDelta &&
    existing.currency === CANONICAL_CASH_CURRENCY
  );
}

export async function applyCanonicalCashMutationInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  input: CanonicalCashMutationInput,
): Promise<CanonicalCashMutationResult> {
  if (!isAuthenticatedUid(input.uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }
  if (!isValidCanonicalCashTransactionId(input.transactionId)) {
    return { ok: false, reason: 'INVALID_TRANSACTION_ID' };
  }
  if (!ALLOWED_HELPER_OPERATIONS.has(input.operationType)) {
    return { ok: false, reason: 'INVALID_OPERATION' };
  }
  if (
    typeof input.amountDelta !== 'number' ||
    !Number.isFinite(input.amountDelta) ||
    !Number.isSafeInteger(input.amountDelta) ||
    input.amountDelta === 0
  ) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  if (input.operationType === 'INTERNAL_TEST_CREDIT' && input.amountDelta <= 0) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  if (input.operationType === 'INTERNAL_TEST_DEBIT' && input.amountDelta >= 0) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  if (
    (input.operationType === 'CANONICAL_FLEET_REPAIR' ||
      input.operationType === 'CANONICAL_FLEET_UPGRADE' ||
      input.operationType === 'CANONICAL_CATALOG_PURCHASE' ||
      input.operationType === 'CANONICAL_FUEL_PURCHASE' ||
      input.operationType === 'CANONICAL_VEHICLE_LEASE_START' ||
      input.operationType === 'CANONICAL_DRIVER_HIRE' ||
      input.operationType === 'CANONICAL_DRIVER_FIRE' ||
      input.operationType === 'CANONICAL_DAILY_OPEX' ||
      input.operationType === 'CANONICAL_WAREHOUSE_OPEN' ||
      input.operationType === 'CANONICAL_WAREHOUSE_UPGRADE' ||
      input.operationType === 'CANONICAL_CARGO_BUY') &&
    input.amountDelta >= 0
  ) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  if (
    (input.operationType === 'CANONICAL_VEHICLE_SALE' ||
      input.operationType === 'CANONICAL_CARGO_SELL' ||
      input.operationType === 'CANONICAL_MISSION_REWARD' ||
      input.operationType === 'CANONICAL_MILESTONE_REWARD') &&
    input.amountDelta <= 0
  ) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }

  const stateRef = firestore.doc(serverStateCurrentRef(input.uid));
  const txnRef = firestore.doc(canonicalCashTransactionRef(input.uid, input.transactionId));
  const [stateSnap, txnSnap] = await Promise.all([transaction.get(stateRef), transaction.get(txnRef)]);

  if (txnSnap.exists) {
    const existing = txnSnap.data() as CanonicalCashTransactionDocument | undefined;
    if (!existing) {
      return { ok: false, reason: 'CANONICAL_CASH_TRANSACTION_CONFLICT' };
    }
    if (sameCanonicalPayload(existing, input)) {
      return {
        ok: true,
        receipt: {
          transactionId: existing.transactionId,
          operationType: existing.operationType,
          cashBefore: existing.cashBefore,
          cashDelta: existing.amountDelta,
          cashAfter: existing.cashAfter,
          currency: CANONICAL_CASH_CURRENCY,
          applied: false,
          alreadyApplied: true,
          createdAt: existing.createdAt,
        },
      };
    }
    return { ok: false, reason: 'CANONICAL_CASH_TRANSACTION_CONFLICT' };
  }

  if (!stateSnap.exists) {
    return { ok: false, reason: 'SERVER_STATE_MISSING' };
  }
  const state = stateSnap.data() as { cash?: unknown; sourceVersion?: unknown } | undefined;
  const cashBefore = Number(state?.cash);
  if (!Number.isFinite(cashBefore)) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }

  const cashAfter = cashBefore + input.amountDelta;
  if (!Number.isFinite(cashAfter) || Math.abs(cashAfter) > Number.MAX_SAFE_INTEGER) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  const floorRejection = rejectDebitAgainstPolicy(
    input.operationType,
    cashBefore,
    cashAfter,
    input.amountDelta,
  );
  if (floorRejection) return floorRejection;

  if (input.simulateFailureAfterValidate) {
    return { ok: false, reason: 'SIMULATED_FAILURE' };
  }

  const createdAt = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const metadata = compactMetadata(input.metadata);
  const doc: CanonicalCashTransactionDocument = {
    transactionId: input.transactionId,
    operationType: input.operationType,
    sourceId: input.sourceId,
    amountDelta: input.amountDelta,
    currency: CANONICAL_CASH_CURRENCY,
    createdAt,
    cashAuthorityVersion: CANONICAL_CASH_TRANSACTION_AUTHORITY_VERSION,
    accountCashAuthorityMigrationVersion: ACCOUNT_CASH_AUTHORITY_MIGRATION_VERSION_UNMIGRATED,
    ownerUid: input.uid,
    cashBefore,
    cashAfter,
    metadata,
  };

  transaction.create(txnRef, doc);
  transaction.update(stateRef, {
    cash: cashAfter,
    sourceVersion: Number(state?.sourceVersion ?? 0) + 1,
  });

  return {
    ok: true,
    receipt: {
      transactionId: input.transactionId,
      operationType: input.operationType,
      cashBefore,
      cashDelta: input.amountDelta,
      cashAfter,
      currency: CANONICAL_CASH_CURRENCY,
      applied: true,
      alreadyApplied: false,
      createdAt,
    },
  };
}

export type CanonicalCashBatchResult =
  | {
      ok: true;
      receipts: CanonicalCashReceipt[];
      cashBefore: number;
      cashAfter: number;
      alreadyApplied: boolean;
    }
  | CanonicalCashMutationFailure;

/**
 * Apply several canonical cash mutations in one Firestore transaction.
 * All reads happen before writes. Partial apply is rejected.
 */
export async function applyCanonicalCashMutationsInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  mutations: readonly CanonicalCashMutationInput[],
  nowMs: number,
): Promise<CanonicalCashBatchResult> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }
  if (mutations.length === 0) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  for (const input of mutations) {
    if (input.uid !== uid) {
      return { ok: false, reason: 'UNAUTHENTICATED' };
    }
    if (!isValidCanonicalCashTransactionId(input.transactionId)) {
      return { ok: false, reason: 'INVALID_TRANSACTION_ID' };
    }
    if (!ALLOWED_HELPER_OPERATIONS.has(input.operationType)) {
      return { ok: false, reason: 'INVALID_OPERATION' };
    }
    if (
      typeof input.amountDelta !== 'number' ||
      !Number.isFinite(input.amountDelta) ||
      !Number.isSafeInteger(input.amountDelta) ||
      input.amountDelta === 0
    ) {
      return { ok: false, reason: 'INVALID_AMOUNT' };
    }
    if (input.operationType === 'INTERNAL_TEST_CREDIT' && input.amountDelta <= 0) {
      return { ok: false, reason: 'INVALID_AMOUNT' };
    }
    if (input.operationType === 'INTERNAL_TEST_DEBIT' && input.amountDelta >= 0) {
      return { ok: false, reason: 'INVALID_AMOUNT' };
    }
    if (
      (input.operationType === 'CANONICAL_FLEET_REPAIR' ||
        input.operationType === 'CANONICAL_FLEET_UPGRADE' ||
        input.operationType === 'CANONICAL_CATALOG_PURCHASE' ||
        input.operationType === 'CANONICAL_FUEL_PURCHASE' ||
        input.operationType === 'CANONICAL_VEHICLE_LEASE_START' ||
        input.operationType === 'CANONICAL_DRIVER_HIRE' ||
        input.operationType === 'CANONICAL_DRIVER_FIRE' ||
        input.operationType === 'CANONICAL_DAILY_OPEX' ||
        input.operationType === 'CANONICAL_WAREHOUSE_OPEN' ||
        input.operationType === 'CANONICAL_WAREHOUSE_UPGRADE' ||
        input.operationType === 'CANONICAL_CARGO_BUY') &&
      input.amountDelta >= 0
    ) {
      return { ok: false, reason: 'INVALID_AMOUNT' };
    }
    if (
      (input.operationType === 'CANONICAL_VEHICLE_SALE' ||
        input.operationType === 'CANONICAL_CARGO_SELL' ||
        input.operationType === 'CANONICAL_MISSION_REWARD' ||
        input.operationType === 'CANONICAL_MILESTONE_REWARD') &&
      input.amountDelta <= 0
    ) {
      return { ok: false, reason: 'INVALID_AMOUNT' };
    }
  }

  const stateRef = firestore.doc(serverStateCurrentRef(uid));
  const txnRefs = mutations.map((row) =>
    firestore.doc(canonicalCashTransactionRef(uid, row.transactionId)),
  );
  const [stateSnap, ...txnSnaps] = await Promise.all([
    transaction.get(stateRef),
    ...txnRefs.map((ref) => transaction.get(ref)),
  ]);

  const existingCount = txnSnaps.filter((snap) => snap.exists).length;
  if (existingCount > 0 && existingCount < mutations.length) {
    return { ok: false, reason: 'CANONICAL_CASH_TRANSACTION_CONFLICT' };
  }

  if (!stateSnap.exists) {
    return { ok: false, reason: 'SERVER_STATE_MISSING' };
  }
  const state = stateSnap.data() as { cash?: unknown; sourceVersion?: unknown } | undefined;
  const liveCash = Number(state?.cash);
  if (!Number.isFinite(liveCash)) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }

  if (existingCount === mutations.length) {
    const receipts: CanonicalCashReceipt[] = [];
    for (let i = 0; i < mutations.length; i += 1) {
      const existing = txnSnaps[i]!.data() as CanonicalCashTransactionDocument | undefined;
      const input = mutations[i]!;
      if (!existing || !sameCanonicalPayload(existing, input)) {
        return { ok: false, reason: 'CANONICAL_CASH_TRANSACTION_CONFLICT' };
      }
      receipts.push({
        transactionId: existing.transactionId,
        operationType: existing.operationType,
        cashBefore: existing.cashBefore,
        cashDelta: existing.amountDelta,
        cashAfter: existing.cashAfter,
        currency: CANONICAL_CASH_CURRENCY,
        applied: false,
        alreadyApplied: true,
        createdAt: existing.createdAt,
      });
    }
    const lastAfter = receipts[receipts.length - 1]!.cashAfter;
    if (lastAfter !== liveCash) {
      return { ok: false, reason: 'CANONICAL_CASH_TRANSACTION_CONFLICT' };
    }
    return {
      ok: true,
      receipts,
      cashBefore: receipts[0]!.cashBefore,
      cashAfter: lastAfter,
      alreadyApplied: true,
    };
  }

  let running = liveCash;
  const createdAt = Number.isFinite(nowMs) ? nowMs : Date.now();
  const docs: CanonicalCashTransactionDocument[] = [];
  const receipts: CanonicalCashReceipt[] = [];
  for (const input of mutations) {
    const cashBefore = running;
    const cashAfter = cashBefore + input.amountDelta;
    if (!Number.isFinite(cashAfter) || Math.abs(cashAfter) > Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: 'INVALID_AMOUNT' };
    }
    const floorRejection = rejectDebitAgainstPolicy(
      input.operationType,
      cashBefore,
      cashAfter,
      input.amountDelta,
    );
    if (floorRejection) return floorRejection;
    running = cashAfter;
    const doc: CanonicalCashTransactionDocument = {
      transactionId: input.transactionId,
      operationType: input.operationType,
      sourceId: input.sourceId,
      amountDelta: input.amountDelta,
      currency: CANONICAL_CASH_CURRENCY,
      createdAt,
      cashAuthorityVersion: CANONICAL_CASH_TRANSACTION_AUTHORITY_VERSION,
      accountCashAuthorityMigrationVersion: ACCOUNT_CASH_AUTHORITY_MIGRATION_VERSION_UNMIGRATED,
      ownerUid: uid,
      cashBefore,
      cashAfter,
      metadata: compactMetadata(input.metadata),
    };
    docs.push(doc);
    receipts.push({
      transactionId: input.transactionId,
      operationType: input.operationType,
      cashBefore,
      cashDelta: input.amountDelta,
      cashAfter,
      currency: CANONICAL_CASH_CURRENCY,
      applied: true,
      alreadyApplied: false,
      createdAt,
    });
  }

  for (let i = 0; i < docs.length; i += 1) {
    transaction.create(txnRefs[i]!, docs[i]!);
  }
  transaction.update(stateRef, {
    cash: running,
    sourceVersion: Number(state?.sourceVersion ?? 0) + 1,
  });

  return {
    ok: true,
    receipts,
    cashBefore: liveCash,
    cashAfter: running,
    alreadyApplied: false,
  };
}

export async function runCanonicalCashMutation(
  firestore: Firestore,
  input: CanonicalCashMutationInput,
): Promise<CanonicalCashMutationResult> {
  return firestore.runTransaction((transaction) =>
    applyCanonicalCashMutationInTransaction(transaction, firestore, input),
  );
}
