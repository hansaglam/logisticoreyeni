/**
 * Pure helpers for canonical multimodal completion queue (no RN / AsyncStorage).
 * Distinct from ROAD canonicalDeliveryCompletionQueue.
 */

export const CANONICAL_MULTIMODAL_COMPLETION_QUEUE_MAX_SIZE = 24;
export const CANONICAL_MULTIMODAL_COMPLETION_QUEUE_MAX_RETRY = 20;
export const CANONICAL_MULTIMODAL_CANCELLATION_QUEUE_MAX_SIZE = 24;

export type CanonicalMultimodalPendingReceipt = {
  shipmentId: string;
  createdAt: number;
  retryCount: number;
};

export function normalizeCanonicalMultimodalReceipt(
  raw: unknown,
): CanonicalMultimodalPendingReceipt | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.shipmentId !== 'string' || record.shipmentId.length < 1 || record.shipmentId.length > 128) {
    return null;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(record.shipmentId) || record.shipmentId.includes(':')) {
    return null;
  }
  const createdAt = Number(record.createdAt);
  const retryCount = Number(record.retryCount);
  return {
    shipmentId: record.shipmentId,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    retryCount: Number.isFinite(retryCount) && retryCount >= 0 ? Math.floor(retryCount) : 0,
  };
}

export function mergeCanonicalMultimodalReceipt(
  existing: CanonicalMultimodalPendingReceipt[],
  shipmentId: string,
  nowMs = Date.now(),
): CanonicalMultimodalPendingReceipt[] {
  const next = normalizeCanonicalMultimodalReceipt({ shipmentId, createdAt: nowMs, retryCount: 0 });
  if (!next) return existing;
  if (existing.some((item) => item.shipmentId === shipmentId)) {
    return existing;
  }
  return [...existing, next].slice(-CANONICAL_MULTIMODAL_COMPLETION_QUEUE_MAX_SIZE);
}

export function shouldRetryCanonicalMultimodalReason(reason: string): boolean {
  return (
    reason === 'service-unavailable' ||
    reason === 'rate-limited' ||
    reason === 'timeout' ||
    reason === 'firebase-disabled' ||
    reason === 'auth-required'
  );
}
