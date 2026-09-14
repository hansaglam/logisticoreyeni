/**
 * Server-authoritative completed-delivery increments.
 *
 * Client may submit only a bounded deliveryId (existing local delivery identity).
 * The server never accepts an absolute total and never decrements.
 */

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { runFirestoreTransactionWithRetry } from './firestoreTransactionUtils';
import { serverStateRef } from './serverState';

const MAX_COMPLETED_DELIVERIES = 50_000;
const MAX_DELIVERY_ID_LENGTH = 128;

export type CanonicalDeliveryCompletionReason =
  | 'auth-required'
  | 'anonymous-not-supported'
  | 'invalid-request'
  | 'server-state-not-initialized'
  | 'service-unavailable';

export type CanonicalDeliveryCompletionResult =
  | {
      ok: true;
      deliveryId: string;
      alreadyRecorded: boolean;
      completedDeliveries: number;
    }
  | {
      ok: false;
      reason: CanonicalDeliveryCompletionReason;
      deliveryId: string;
    };

export function isValidCanonicalDeliveryId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_DELIVERY_ID_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

export function canonicalDeliveryCompletionRef(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
) {
  return firestore.doc(`users/${uid}/canonicalDeliveryCompletions/${deliveryId}`);
}

function readCompletedDeliveries(data: Record<string, unknown> | undefined): number {
  const raw = data?.completedDeliveries;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.floor(raw));
}

export async function recordCanonicalDeliveryCompletionTransaction(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
  nowMs = Date.now(),
): Promise<CanonicalDeliveryCompletionResult> {
  if (!uid || typeof uid !== 'string') {
    return { ok: false, reason: 'auth-required', deliveryId: '' };
  }
  if (!isValidCanonicalDeliveryId(deliveryId)) {
    return { ok: false, reason: 'invalid-request', deliveryId: typeof deliveryId === 'string' ? deliveryId : '' };
  }

  try {
    const { result } = await runFirestoreTransactionWithRetry(firestore, async (transaction) => {
      const completionRef = canonicalDeliveryCompletionRef(firestore, uid, deliveryId);
      const serverRef = serverStateRef(firestore, uid);
      const [completionSnap, serverSnap] = await Promise.all([
        transaction.get(completionRef),
        transaction.get(serverRef),
      ]);

      if (!serverSnap.exists) {
        return {
          ok: false as const,
          reason: 'server-state-not-initialized' as const,
          deliveryId,
        };
      }

      const current = readCompletedDeliveries(serverSnap.data() as Record<string, unknown>);
      if (completionSnap.exists) {
        return {
          ok: true as const,
          deliveryId,
          alreadyRecorded: true,
          completedDeliveries: current,
        };
      }

      const next = Math.min(MAX_COMPLETED_DELIVERIES, current + 1);
      const claimedAt = Timestamp.fromMillis(nowMs);
      transaction.create(completionRef, {
        ownerUid: uid,
        deliveryId,
        recordedAt: claimedAt,
        schemaVersion: 1,
      });
      transaction.update(serverRef, {
        completedDeliveries: next,
        sourceVersion: FieldValue.increment(1),
        updatedAt: claimedAt,
      });
      return {
        ok: true as const,
        deliveryId,
        alreadyRecorded: false,
        completedDeliveries: next,
      };
    });
    return result;
  } catch {
    return { ok: false, reason: 'service-unavailable', deliveryId };
  }
}
