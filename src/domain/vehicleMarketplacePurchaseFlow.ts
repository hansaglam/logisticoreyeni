/**
 * Marketplace purchase orchestration helpers.
 * Keeps confirm from awaiting optional cloud/fleet refreshes that can hang.
 */

import type {
  VehicleMarketplaceActionResult,
  VehicleMarketplaceFailureReason,
} from '../types/vehicleMarketplace';

export const MARKETPLACE_PURCHASE_TIMEOUT_MS = 12_000;

export type MarketplacePurchaseEnvelope = {
  transactionId: string;
  idempotencyKey: string;
};

export function createMarketplacePurchaseEnvelope(params: {
  listingId: string;
  buyerUid: string;
  requestId: string;
}): MarketplacePurchaseEnvelope {
  const listingId = sanitizeIdPart(params.listingId);
  const buyerUid = sanitizeIdPart(params.buyerUid);
  const requestId = sanitizeIdPart(params.requestId);
  const token = `purchase:${listingId}:${buyerUid}:${requestId}`.slice(0, 128);
  return {
    transactionId: token,
    idempotencyKey: token,
  };
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 48);
}

export function isMarketplacePurchaseSuccess(
  result: Pick<VehicleMarketplaceActionResult, 'ok' | 'reason'>,
): boolean {
  return result.ok === true || result.reason === 'already-completed';
}

export function shouldReusePurchaseEnvelope(
  reason?: VehicleMarketplaceFailureReason | string,
): boolean {
  return (
    reason === 'timeout' ||
    reason === 'network-error' ||
    reason === 'service-unavailable' ||
    reason === 'marketplace-unavailable'
  );
}

export type MarketplacePurchaseAttempt = MarketplacePurchaseEnvelope & {
  listingId: string;
};

export function resolveMarketplacePurchaseAttempt(params: {
  existing: MarketplacePurchaseAttempt | null;
  listingId: string;
  buyerUid: string;
  requestId: string;
}): MarketplacePurchaseAttempt {
  if (params.existing && params.existing.listingId === params.listingId) {
    return params.existing;
  }
  return {
    listingId: params.listingId,
    ...createMarketplacePurchaseEnvelope({
      listingId: params.listingId,
      buyerUid: params.buyerUid,
      requestId: params.requestId,
    }),
  };
}

export type MarketplacePurchaseClientOutcome =
  | { kind: 'success'; reconcileAsync: true; requiresLocalApply: true }
  | { kind: 'retryable-failure'; reuseEnvelope: true; reason: string }
  | { kind: 'terminal-failure'; reuseEnvelope: false; reason: string };

export function resolveMarketplacePurchaseClientOutcome(
  result: Pick<VehicleMarketplaceActionResult, 'ok' | 'reason'>,
  refresh?: { refreshFailed?: boolean; localApplyFailed?: boolean },
): MarketplacePurchaseClientOutcome {
  if (isMarketplacePurchaseSuccess(result)) {
    if (refresh?.localApplyFailed) {
      return {
        kind: 'retryable-failure',
        reuseEnvelope: true,
        reason: 'save-conflict',
      };
    }
    return { kind: 'success', reconcileAsync: true, requiresLocalApply: true };
  }
  const reason = result.reason ?? 'timeout';
  if (shouldReusePurchaseEnvelope(reason)) {
    return { kind: 'retryable-failure', reuseEnvelope: true, reason };
  }
  return { kind: 'terminal-failure', reuseEnvelope: false, reason };
}

export function getMarketplacePurchaseAlertCopy(
  reason?: VehicleMarketplaceFailureReason | string,
): { title: string; message: string } {
  switch (reason) {
    case 'insufficient-funds':
      return { title: 'Satın alma tamamlanamadı', message: 'Yeterli nakdin yok.' };
    case 'listing-sold':
    case 'listing-not-active':
      return {
        title: 'Satın alma tamamlanamadı',
        message: 'Bu araç başka bir oyuncu tarafından satın alındı.',
      };
    case 'listing-not-found':
      return { title: 'Satın alma tamamlanamadı', message: 'İlan artık mevcut değil.' };
    case 'fleet-limit':
      return { title: 'Satın alma tamamlanamadı', message: 'Filonda boş yer yok.' };
    case 'not-owner':
      return {
        title: 'Satın alma tamamlanamadı',
        message: 'Araç satıcının filosunda bulunamadı.',
      };
    case 'permission-denied':
      return {
        title: 'Satın alma tamamlanamadı',
        message: 'Satın alma işlemi doğrulanamadı.',
      };
    case 'timeout':
    case 'network-error':
      return {
        title: 'Satın alma tamamlanamadı',
        message: 'Sunucudan yanıt alınamadı. İşlem durumunu kontrol edip tekrar dene.',
      };
    case 'save-conflict':
      return {
        title: 'Satın alma tamamlanamadı',
        message: 'Kayıt senkronizasyonu tamamlanmadı. Birkaç saniye sonra tekrar dene.',
      };
    default:
      return {
        title: 'Satın alma tamamlanamadı',
        message: 'Satın alma tamamlanamadı. Tekrar dene.',
      };
  }
}

export async function withMarketplacePurchaseTimeout<T>(
  promise: Promise<T>,
  timeoutMs = MARKETPLACE_PURCHASE_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = Object.assign(new Error('NETWORK_TIMEOUT'), {
            marketplaceReason: 'timeout' as const,
            code: 'functions/deadline-exceeded',
          });
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function logMarketplacePurchase(
  stage: string,
  payload?: Record<string, unknown>,
): void {
  const error = payload?.error;
  const errorRecord =
    error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  console.info(`[MARKETPLACE_PURCHASE] ${stage}`, {
    ...payload,
    error: errorRecord
      ? {
          code: typeof errorRecord.code === 'string' ? errorRecord.code : null,
          message:
            typeof errorRecord.message === 'string' ? errorRecord.message : null,
          stack:
            typeof errorRecord.stack === 'string'
              ? String(errorRecord.stack).split('\n').slice(0, 4).join('\n')
              : null,
        }
      : undefined,
  });
}
