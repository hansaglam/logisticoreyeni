/**
 * Fail-soft queue for recordCanonicalDeliveryCompletion.
 *
 * V1: guests never enqueue. Linked-account historic guest deliveries are NOT
 * retroactively submitted after account link.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CANONICAL_DELIVERY_QUEUE_MAX_RETRY,
  CANONICAL_DELIVERY_QUEUE_MAX_SIZE,
  mergeCanonicalDeliveryReceipt,
  normalizeCanonicalDeliveryReceipt,
  shouldRetryCanonicalDeliveryReason,
  type CanonicalDeliveryPendingReceipt,
  isValidCanonicalDeliveryId,
} from './canonicalDeliveryCompletionQueueLogic';
import { getAccountStatus } from '../services/authService';
import { recordCanonicalDeliveryCompletion } from '../services/weeklyMissionService';

export const CANONICAL_DELIVERY_QUEUE_KEY =
  '@logisticore/canonical_delivery_completion_pending_v1';

export type { CanonicalDeliveryPendingReceipt };
export {
  mergeCanonicalDeliveryReceipt,
  shouldRetryCanonicalDeliveryReason,
  isValidCanonicalDeliveryId,
};

let flushInFlight: Promise<void> | null = null;
let memoryQueue: CanonicalDeliveryPendingReceipt[] | null = null;

export function isLinkedAccountForCanonicalDelivery(status = getAccountStatus()): boolean {
  return Boolean(status.isReady && status.uid && !status.isAnonymous && status.provider !== 'guest');
}

async function readQueue(): Promise<CanonicalDeliveryPendingReceipt[]> {
  if (memoryQueue) {
    return memoryQueue.slice();
  }
  try {
    const raw = await AsyncStorage.getItem(CANONICAL_DELIVERY_QUEUE_KEY);
    if (!raw) {
      memoryQueue = [];
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
          .map(normalizeCanonicalDeliveryReceipt)
          .filter((item): item is CanonicalDeliveryPendingReceipt => item != null)
      : [];
    memoryQueue = list;
    return list.slice();
  } catch {
    memoryQueue = [];
    return [];
  }
}

async function writeQueue(next: CanonicalDeliveryPendingReceipt[]): Promise<void> {
  const trimmed = next
    .filter((item) => item.retryCount < CANONICAL_DELIVERY_QUEUE_MAX_RETRY)
    .slice(-CANONICAL_DELIVERY_QUEUE_MAX_SIZE);
  memoryQueue = trimmed;
  try {
    if (trimmed.length === 0) {
      await AsyncStorage.removeItem(CANONICAL_DELIVERY_QUEUE_KEY);
      return;
    }
    await AsyncStorage.setItem(CANONICAL_DELIVERY_QUEUE_KEY, JSON.stringify(trimmed));
  } catch {
    // Persistence failure must not affect gameplay.
  }
}

/**
 * After local successful delivery completion.
 * Guests: no-op. Linked: enqueue + fail-soft flush.
 */
export function notifyCanonicalDeliveryCompleted(deliveryId: string): void {
  if (!isValidCanonicalDeliveryId(deliveryId)) {
    return;
  }
  if (!isLinkedAccountForCanonicalDelivery()) {
    return;
  }
  void (async () => {
    try {
      const queue = await readQueue();
      const next = mergeCanonicalDeliveryReceipt(queue, deliveryId);
      if (next.length === queue.length) {
        await flushCanonicalDeliveryCompletionQueue();
        return;
      }
      await writeQueue(next);
      await flushCanonicalDeliveryCompletionQueue();
    } catch {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.info('[canonical-delivery] enqueue failed (fail-soft)');
      }
    }
  })();
}

export async function flushCanonicalDeliveryCompletionQueue(): Promise<void> {
  if (flushInFlight) {
    return flushInFlight;
  }
  flushInFlight = (async () => {
    if (!isLinkedAccountForCanonicalDelivery()) {
      return;
    }
    const queue = await readQueue();
    if (queue.length === 0) {
      return;
    }
    const remaining: CanonicalDeliveryPendingReceipt[] = [];
    for (const receipt of queue) {
      const result = await recordCanonicalDeliveryCompletion({
        deliveryId: receipt.deliveryId,
      });
      if (result.ok) {
        continue;
      }
      if (
        result.reason === 'anonymous-not-supported' ||
        result.reason === 'invalid-request'
      ) {
        continue;
      }
      if (shouldRetryCanonicalDeliveryReason(result.reason)) {
        remaining.push({
          ...receipt,
          retryCount: receipt.retryCount + 1,
        });
        continue;
      }
      if (receipt.retryCount + 1 < CANONICAL_DELIVERY_QUEUE_MAX_RETRY) {
        remaining.push({
          ...receipt,
          retryCount: receipt.retryCount + 1,
        });
      }
    }
    await writeQueue(remaining);
  })().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

/** Test helper — reset in-memory cache. */
export function resetCanonicalDeliveryQueueMemoryForTests(): void {
  memoryQueue = null;
  flushInFlight = null;
}
