/**
 * Step 29AF — server-owned company progression / ROAD reputation (INTERNAL_TEST).
 * No cash mutation. No public save mutation. No generic XP/reputation endpoint.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

import {
  CANONICAL_PROGRESSION_RECEIPT_CONFLICT,
  canonicalCompanyProgressionPath,
  canonicalProgressionReceiptMatches,
  canonicalProgressionReceiptPath,
  classifyCanonicalCompanyProgression,
  createInitialCanonicalCompanyProgression,
  isCanonicalCompanyProgressionAllowed,
  planCanonicalProgressionMutation,
  type CanonicalCompanyProgressionAuthorityClass,
  type CanonicalCompanyProgressionState,
  type CanonicalProgressionApplication,
  type CanonicalProgressionMutationInput,
  type CanonicalProgressionReceipt,
} from '../../src/domain/canonicalCompanyProgression';

function isAuthenticatedUid(uid: string): boolean {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

export type InitializeCanonicalCompanyProgressionResult =
  | { ok: true; alreadyInitialized: boolean; state: CanonicalCompanyProgressionState }
  | { ok: false; reason: string; authorityClass?: CanonicalCompanyProgressionAuthorityClass };

/**
 * New canonical accounts only. An existing cloud save or a migrated/used serverState means
 * the account already has client-owned progression, which is never imported here.
 */
export async function initializeCanonicalCompanyProgressionForNewAccount(
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<InitializeCanonicalCompanyProgressionResult> {
  if (!isCanonicalCompanyProgressionAllowed({ envValue: options?.envValue })) {
    return { ok: false, reason: 'CANONICAL_COMPANY_PROGRESSION_AUTHORITY_OFF' };
  }
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }
  return firestore.runTransaction(async (transaction) => {
    const progressionRef = firestore.doc(canonicalCompanyProgressionPath(uid));
    const progressionSnap = await transaction.get(progressionRef);
    const saveSnap = await transaction.get(firestore.doc(`users/${uid}/saves/current`));
    const serverStateSnap = await transaction.get(firestore.doc(`users/${uid}/serverState/current`));
    if (progressionSnap.exists) {
      const classified = classifyCanonicalCompanyProgression(
        progressionSnap.data() as Record<string, unknown>,
        uid,
      );
      if (classified.authorityClass === 'SERVER_CANONICAL_PROGRESSION') {
        return { ok: true as const, alreadyInitialized: true, state: classified.state };
      }
      return {
        ok: false as const,
        reason: 'CANONICAL_PROGRESSION_EXISTING_NOT_SERVER_CANONICAL',
        authorityClass: classified.authorityClass,
      };
    }
    if (saveSnap.exists) {
      return {
        ok: false as const,
        reason: 'CANONICAL_PROGRESSION_LEGACY_SAVE_PRESENT',
        authorityClass: 'LEGACY_CLIENT_UNVERIFIED' as const,
      };
    }
    if (serverStateSnap.exists) {
      const serverState = serverStateSnap.data() ?? {};
      const used =
        serverState.migrationSource !== 'default' ||
        Number(serverState.completedDeliveries ?? 0) > 0 ||
        Number(serverState.failedDeliveries ?? 0) > 0 ||
        Number(serverState.lateDeliveries ?? 0) > 0;
      if (used) {
        return {
          ok: false as const,
          reason: 'CANONICAL_PROGRESSION_LEGACY_SERVER_STATE_PRESENT',
          authorityClass: 'LEGACY_CLIENT_UNVERIFIED' as const,
        };
      }
    }
    const state = createInitialCanonicalCompanyProgression(uid, nowMs);
    transaction.create(progressionRef, { ...state });
    return { ok: true as const, alreadyInitialized: false, state };
  });
}

export type CanonicalProgressionTransactionContext =
  | { enabled: false }
  | {
      enabled: true;
      state: CanonicalCompanyProgressionState | null;
      authorityClass: CanonicalCompanyProgressionAuthorityClass;
      receipts: Map<string, Record<string, unknown> | null>;
    };

/** All progression reads happen here, before any write in the caller's transaction. */
export async function readCanonicalProgressionContext(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  operationIds: string[],
  envValue: string | null | undefined,
): Promise<CanonicalProgressionTransactionContext> {
  if (!isCanonicalCompanyProgressionAllowed({ envValue })) {
    return { enabled: false };
  }
  const snap = await transaction.get(firestore.doc(canonicalCompanyProgressionPath(uid)));
  const classified = classifyCanonicalCompanyProgression(
    snap.exists ? (snap.data() as Record<string, unknown>) : undefined,
    uid,
  );
  const receipts = new Map<string, Record<string, unknown> | null>();
  for (const operationId of operationIds) {
    const receiptSnap = await transaction.get(
      firestore.doc(canonicalProgressionReceiptPath(uid, operationId)),
    );
    receipts.set(
      operationId,
      receiptSnap.exists ? (receiptSnap.data() as Record<string, unknown>) : null,
    );
  }
  return {
    enabled: true,
    state: classified.authorityClass === 'SERVER_CANONICAL_PROGRESSION' ? classified.state : null,
    authorityClass: classified.authorityClass,
    receipts,
  };
}

export type CanonicalProgressionWritePlan =
  | { ok: true; application: CanonicalProgressionApplication; receipt: CanonicalProgressionReceipt | null; next: CanonicalCompanyProgressionState | null }
  | { ok: false; reason: typeof CANONICAL_PROGRESSION_RECEIPT_CONFLICT };

export function planCanonicalProgressionWrite(
  context: CanonicalProgressionTransactionContext,
  input: CanonicalProgressionMutationInput,
): CanonicalProgressionWritePlan {
  if (!context.enabled) {
    return { ok: true, application: 'NOT_EVALUATED_GATE_OFF', receipt: null, next: null };
  }
  const existing = context.receipts.get(input.operationId) ?? null;
  if (existing) {
    if (!canonicalProgressionReceiptMatches(existing, input)) {
      return { ok: false, reason: CANONICAL_PROGRESSION_RECEIPT_CONFLICT };
    }
    return { ok: true, application: 'ALREADY_APPLIED', receipt: null, next: null };
  }
  if (!context.state) {
    return {
      ok: true,
      application:
        context.authorityClass === 'UNINITIALIZED'
          ? 'NOT_APPLIED_UNINITIALIZED'
          : 'NOT_APPLIED_NOT_SERVER_CANONICAL',
      receipt: null,
      next: null,
    };
  }
  const planned = planCanonicalProgressionMutation(context.state, input);
  return { ok: true, application: 'APPLIED', receipt: planned.receipt, next: planned.next };
}

export function commitCanonicalProgressionWrite(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  plan: CanonicalProgressionWritePlan,
): void {
  if (!plan.ok || plan.application !== 'APPLIED' || !plan.receipt || !plan.next) return;
  transaction.create(
    firestore.doc(canonicalProgressionReceiptPath(uid, plan.receipt.operationId)),
    { ...plan.receipt },
  );
  transaction.set(firestore.doc(canonicalCompanyProgressionPath(uid)), { ...plan.next });
}
