/**
 * Pure helpers for canonical delivery completion queue (no RN / AsyncStorage).
 */

export const CANONICAL_DELIVERY_QUEUE_MAX_SIZE = 50;
export const CANONICAL_DELIVERY_QUEUE_MAX_RETRY = 20;

export type CanonicalDeliveryPendingReceipt = {
  deliveryId: string;
  createdAt: number;
  retryCount: number;
};

export function isValidCanonicalDeliveryId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

export function normalizeCanonicalDeliveryReceipt(
  raw: unknown,
): CanonicalDeliveryPendingReceipt | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isValidCanonicalDeliveryId(record.deliveryId)) return null;
  const createdAt = Number(record.createdAt);
  const retryCount = Number(record.retryCount);
  return {
    deliveryId: record.deliveryId,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    retryCount: Number.isFinite(retryCount) && retryCount >= 0 ? Math.floor(retryCount) : 0,
  };
}

/** Merge a new receipt without duplicates. */
export function mergeCanonicalDeliveryReceipt(
  existing: CanonicalDeliveryPendingReceipt[],
  deliveryId: string,
  nowMs = Date.now(),
): CanonicalDeliveryPendingReceipt[] {
  if (!isValidCanonicalDeliveryId(deliveryId)) {
    return existing;
  }
  if (existing.some((item) => item.deliveryId === deliveryId)) {
    return existing;
  }
  return [
    ...existing,
    { deliveryId, createdAt: nowMs, retryCount: 0 },
  ].slice(-CANONICAL_DELIVERY_QUEUE_MAX_SIZE);
}

export function shouldRetryCanonicalDeliveryReason(reason: string): boolean {
  return (
    reason === 'service-unavailable' ||
    reason === 'rate-limited' ||
    reason === 'timeout' ||
    reason === 'firebase-disabled' ||
    reason === 'auth-required'
  );
}
