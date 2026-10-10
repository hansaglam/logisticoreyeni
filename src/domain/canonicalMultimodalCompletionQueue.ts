/**
 * Fail-soft queue for reportCanonicalMultimodalShipmentCompleted.
 * Guests never enqueue. Does not mix with ROAD canonicalDeliveryCompletions.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CANONICAL_MULTIMODAL_COMPLETION_QUEUE_MAX_RETRY,
  mergeCanonicalMultimodalReceipt,
  normalizeCanonicalMultimodalReceipt,
  shouldRetryCanonicalMultimodalReason,
  type CanonicalMultimodalPendingReceipt,
} from './canonicalMultimodalCompletionQueueLogic';
import { isLinkedAccountForCanonicalDelivery } from './canonicalDeliveryCompletionQueue';
import {
  cancelCanonicalMultimodalShipment,
  reportCanonicalMultimodalShipmentCompleted,
} from '../services/canonicalMultimodalService';

export const CANONICAL_MULTIMODAL_COMPLETION_QUEUE_KEY =
  '@logisticore/canonical_multimodal_completion_pending_v1';
export const CANONICAL_MULTIMODAL_CANCELLATION_QUEUE_KEY =
  '@logisticore/canonical_multimodal_cancellation_pending_v1';

let flushInFlight: Promise<void> | null = null;
let memoryCompletion: CanonicalMultimodalPendingReceipt[] | null = null;
let memoryCancel: CanonicalMultimodalPendingReceipt[] | null = null;

async function readQueue(key: string, memory: CanonicalMultimodalPendingReceipt[] | null) {
  if (memory) return memory.slice();
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed.map(normalizeCanonicalMultimodalReceipt).filter((row): row is CanonicalMultimodalPendingReceipt => Boolean(row))
      : [];
    return list;
  } catch {
    return [];
  }
}

async function writeQueue(
  key: string,
  setter: (next: CanonicalMultimodalPendingReceipt[] | null) => void,
  next: CanonicalMultimodalPendingReceipt[],
): Promise<void> {
  setter(next);
  await AsyncStorage.setItem(key, JSON.stringify(next));
}

export function notifyCanonicalMultimodalShipmentCompleted(shipmentId: string): void {
  if (!isLinkedAccountForCanonicalDelivery()) return;
  void (async () => {
    const queue = await readQueue(CANONICAL_MULTIMODAL_COMPLETION_QUEUE_KEY, memoryCompletion);
    memoryCompletion = queue;
    const next = mergeCanonicalMultimodalReceipt(queue, shipmentId);
    if (next.length === queue.length) {
      await flushCanonicalMultimodalCompletionQueue();
      return;
    }
    await writeQueue(CANONICAL_MULTIMODAL_COMPLETION_QUEUE_KEY, (row) => {
      memoryCompletion = row;
    }, next);
    await flushCanonicalMultimodalCompletionQueue();
  })();
}

export function enqueueCanonicalMultimodalCancellation(shipmentId: string): void {
  if (!isLinkedAccountForCanonicalDelivery()) return;
  void (async () => {
    const queue = await readQueue(CANONICAL_MULTIMODAL_CANCELLATION_QUEUE_KEY, memoryCancel);
    memoryCancel = queue;
    const next = mergeCanonicalMultimodalReceipt(queue, shipmentId);
    await writeQueue(CANONICAL_MULTIMODAL_CANCELLATION_QUEUE_KEY, (row) => {
      memoryCancel = row;
    }, next);
    await flushCanonicalMultimodalCompletionQueue();
  })();
}

export async function flushCanonicalMultimodalCompletionQueue(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    if (!isLinkedAccountForCanonicalDelivery()) return;
    const completions = await readQueue(CANONICAL_MULTIMODAL_COMPLETION_QUEUE_KEY, memoryCompletion);
    memoryCompletion = completions;
    const remaining: CanonicalMultimodalPendingReceipt[] = [];
    for (const receipt of completions) {
      const result = await reportCanonicalMultimodalShipmentCompleted({ shipmentId: receipt.shipmentId });
      if (result.ok) continue;
      if (result.reason === 'anonymous-not-supported' || result.reason === 'invalid-request') continue;
      if (
        shouldRetryCanonicalMultimodalReason(result.reason ?? '') ||
        receipt.retryCount + 1 < CANONICAL_MULTIMODAL_COMPLETION_QUEUE_MAX_RETRY
      ) {
        remaining.push({ ...receipt, retryCount: receipt.retryCount + 1 });
      }
    }
    await writeQueue(CANONICAL_MULTIMODAL_COMPLETION_QUEUE_KEY, (row) => {
      memoryCompletion = row;
    }, remaining);

    const cancels = await readQueue(CANONICAL_MULTIMODAL_CANCELLATION_QUEUE_KEY, memoryCancel);
    memoryCancel = cancels;
    const remainingCancel: CanonicalMultimodalPendingReceipt[] = [];
    for (const receipt of cancels) {
      const result = await cancelCanonicalMultimodalShipment({ shipmentId: receipt.shipmentId });
      if (result.ok) continue;
      if (result.reason === 'SHIPMENT_NOT_FOUND' || result.reason === 'invalid-request') continue;
      if (shouldRetryCanonicalMultimodalReason(result.reason ?? '')) {
        remainingCancel.push({ ...receipt, retryCount: receipt.retryCount + 1 });
      }
    }
    await writeQueue(CANONICAL_MULTIMODAL_CANCELLATION_QUEUE_KEY, (row) => {
      memoryCancel = row;
    }, remainingCancel);
  })().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

export function resetCanonicalMultimodalQueueMemoryForTests(): void {
  memoryCompletion = null;
  memoryCancel = null;
  flushInFlight = null;
}
