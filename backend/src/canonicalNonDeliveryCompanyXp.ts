/**
 * Step 29AH — applies company XP inside an already-running canonical operation transaction.
 * Reads happen before the caller's first write; the progression receipt/doc are written
 * after the operation's own writes, in the same transaction. No standalone XP endpoint.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

import {
  CANONICAL_COMPANY_PROGRESSION_AUTHORITY_ENV,
  type CanonicalProgressionMutationInput,
} from '../../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_NON_DELIVERY_XP_AUTHORITY_ENV,
  NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT,
  isCanonicalNonDeliveryXpAllowed,
  resolveCanonicalNonDeliveryReplayProgression,
  type CanonicalNonDeliveryXpOutcome,
  type CanonicalNonDeliveryXpSourceType,
} from '../../src/domain/canonicalNonDeliveryCompanyXp';
import {
  commitCanonicalProgressionWrite,
  planCanonicalProgressionWrite,
  readCanonicalProgressionContext,
  type CanonicalProgressionTransactionContext,
} from './canonicalCompanyProgression';

export type NonDeliveryXpOptions = {
  nonDeliveryXpEnvValue?: string | null;
  progressionEnvValue?: string | null;
};

export function resolveNonDeliveryXpGate(options?: NonDeliveryXpOptions): boolean {
  return isCanonicalNonDeliveryXpAllowed(
    options && 'nonDeliveryXpEnvValue' in options
      ? { envValue: options.nonDeliveryXpEnvValue }
      : { envValue: process.env[CANONICAL_NON_DELIVERY_XP_AUTHORITY_ENV] },
  );
}

/** XP needs both the non-delivery XP gate and the progression gate. */
export async function readNonDeliveryXpContext(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  operationId: string | null,
  options?: NonDeliveryXpOptions,
): Promise<CanonicalProgressionTransactionContext> {
  if (!operationId || !resolveNonDeliveryXpGate(options)) return { enabled: false };
  const progressionEnvValue =
    options && 'progressionEnvValue' in options
      ? options.progressionEnvValue
      : process.env[CANONICAL_COMPANY_PROGRESSION_AUTHORITY_ENV];
  return readCanonicalProgressionContext(transaction, firestore, uid, [operationId], progressionEnvValue);
}

/** A progression receipt can only exist together with its operation receipt. */
export function precheckNonDeliveryXpForNewOperation(
  context: CanonicalProgressionTransactionContext,
  operationId: string | null,
): { ok: true } | { ok: false; reason: typeof NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT } {
  if (context.enabled && operationId && context.receipts.get(operationId)) {
    return { ok: false, reason: NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT };
  }
  return { ok: true };
}

export function resolveNonDeliveryXpReplay(
  context: CanonicalProgressionTransactionContext,
  operationId: string | null,
  sourceType: CanonicalNonDeliveryXpSourceType,
) {
  return resolveCanonicalNonDeliveryReplayProgression({
    enabled: context.enabled,
    operationId,
    sourceType,
    existing: context.enabled && operationId ? context.receipts.get(operationId) : null,
  });
}

/** Call after the operation's own writes. Throws (aborting the transaction) on conflict. */
export function applyNonDeliveryXpInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  context: CanonicalProgressionTransactionContext,
  input: CanonicalProgressionMutationInput | null,
): CanonicalNonDeliveryXpOutcome {
  if (!input) return { application: 'PRODUCTION_NO_XP', operationId: null, receipt: null };
  const plan = planCanonicalProgressionWrite(context, input);
  if (!plan.ok || plan.application === 'ALREADY_APPLIED') {
    throw new Error(NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT);
  }
  commitCanonicalProgressionWrite(transaction, firestore, uid, plan);
  return {
    application: plan.application as CanonicalNonDeliveryXpOutcome['application'],
    operationId: input.operationId,
    receipt: plan.receipt,
  };
}
