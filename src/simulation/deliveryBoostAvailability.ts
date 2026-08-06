/**
 * Teslimat hızlandırma kullanılabilirliği — canonical öncelik sırası ve kullanıcı metinleri.
 */

import {
  DELIVERY_AD_BOOST_ENABLED,
  DELIVERY_AD_BOOST_MAX_TOTAL_RATIO,
  DELIVERY_AD_BOOST_MAX_USES,
  DELIVERY_BOOST_MIN_REMAINING_SECONDS,
} from '../config/deliveryAdBoost';
import type { Delivery, Truck } from '../types/game';
import { normalizeJobProgress } from '../utils/deliveryMetrics';
import { isDeliveryProgressComplete } from './delivery';
import {
  calculateDeliveryBoostReductionMs,
  type DeliveryAdBoostAdState,
  getDeliveryOriginalDurationMs,
  hasPendingDeliveryIncident,
  isActiveDeliveryForBoost,
  normalizeDeliveryAdBoostState,
} from './deliveryAdBoost';
import {
  buildDeliveryTimingSnapshot,
  getDeliveryRemainingMsFromSnapshot,
} from './deliveryTiming';

export type DeliveryBoostDisabledReason =
  | 'delivery-not-active'
  | 'timing-not-ready'
  | 'boost-limit-reached'
  | 'blocking-incident'
  | 'privacy-required'
  | 'offline'
  | 'ad-not-ready'
  | 'remaining-time-too-short';

export type DeliveryBoostAvailability =
  | {
      status: 'available';
      remainingSeconds: number;
      estimatedReductionMs: number;
      usesRemaining: number;
      etaLabel: string;
    }
  | {
      status: 'disabled';
      reason: DeliveryBoostDisabledReason;
      remainingSeconds: number | null;
      estimatedReductionMs: number;
      usesRemaining: number;
      etaLabel: string;
    };

export interface GetDeliveryBoostAvailabilityParams {
  delivery: Delivery;
  truck?: Truck | null;
  currentGameTime?: number;
  gameSpeed?: number;
  adState?: DeliveryAdBoostAdState;
  isOnline?: boolean;
  monetizationBlockedReason?: string | null;
}

function disabled(
  reason: DeliveryBoostDisabledReason,
  snapshot: ReturnType<typeof buildDeliveryTimingSnapshot>,
  estimatedReductionMs: number,
  usesRemaining: number,
): DeliveryBoostAvailability {
  return {
    status: 'disabled',
    reason,
    remainingSeconds: snapshot.remainingSeconds,
    estimatedReductionMs,
    usesRemaining,
    etaLabel: snapshot.etaLabel,
  };
}

export function getMinRemainingMinutesForBoost(): number {
  return Math.ceil(DELIVERY_BOOST_MIN_REMAINING_SECONDS / 60);
}

export function deliveryBoostDisabledReasonToUserMessage(
  reason: DeliveryBoostDisabledReason,
): { title: string; body: string; helper?: string } {
  const minMinutes = getMinRemainingMinutesForBoost();
  switch (reason) {
    case 'delivery-not-active':
      return {
        title: 'Teslimatı Hızlandır',
        body: 'Bu teslimat için hızlandırma kullanılamıyor.',
      };
    case 'timing-not-ready':
      return {
        title: 'Teslimatı Hızlandır',
        body: 'Teslimat bilgisi hazırlanıyor.',
      };
    case 'boost-limit-reached':
      return {
        title: 'Teslimatı Hızlandır',
        body: 'Bu teslimat için tüm hızlandırma hakları kullanıldı.',
      };
    case 'blocking-incident':
      return {
        title: 'Teslimatı Hızlandır',
        body: 'Bu teslimat mevcut durum nedeniyle hızlandırılamıyor.',
      };
    case 'privacy-required':
      return {
        title: 'Teslimatı Hızlandır',
        body: 'Gizlilik Tercihini Tamamla',
        helper:
          'Reklam ödüllerini kullanmak için gizlilik ve reklam tercihlerini gözden geçir.',
      };
    case 'offline':
      return {
        title: 'Teslimatı Hızlandır',
        body: 'Reklam yüklemek için internet bağlantısı gerekli.',
      };
    case 'ad-not-ready':
      return {
        title: 'Teslimatı Hızlandır',
        body: 'Reklam şu anda hazır değil. Biraz sonra tekrar deneyin.',
      };
    case 'remaining-time-too-short':
      return {
        title: 'Teslimatı Hızlandır',
        body: 'Teslimat tamamlanmak üzere olduğu için hızlandırma artık kullanılamaz.',
        helper: `Hızlandırma yalnızca kalan süre ${minMinutes} dakikadan fazlaysa kullanılabilir.`,
      };
    default:
      return {
        title: 'Teslimatı Hızlandır',
        body: 'Hızlandırma şu an kullanılamıyor.',
      };
  }
}

export function getDeliveryBoostAvailability(
  params: GetDeliveryBoostAvailabilityParams,
): DeliveryBoostAvailability {
  const gameSpeed = params.gameSpeed ?? 1;
  const adState = params.adState ?? {};
  const boost = normalizeDeliveryAdBoostState(params.delivery.deliveryAdBoost);
  const usesRemaining = Math.max(0, DELIVERY_AD_BOOST_MAX_USES - boost.usedCount);
  const timing = buildDeliveryTimingSnapshot({
    delivery: params.delivery,
    currentGameTime: params.currentGameTime,
    gameSpeed,
  });
  const remainingMs = getDeliveryRemainingMsFromSnapshot(
    params.delivery,
    gameSpeed,
    params.currentGameTime,
  );
  const estimatedReductionMs = calculateDeliveryBoostReductionMs({
    delivery: params.delivery,
    gameSpeed,
    currentGameTime: params.currentGameTime,
  });

  if (!DELIVERY_AD_BOOST_ENABLED) {
    return disabled('delivery-not-active', timing, estimatedReductionMs, usesRemaining);
  }

  if (!isActiveDeliveryForBoost(params.delivery)) {
    return disabled('delivery-not-active', timing, estimatedReductionMs, usesRemaining);
  }

  const progress = normalizeJobProgress(params.delivery.progress);
  if (isDeliveryProgressComplete(progress)) {
    return disabled('delivery-not-active', timing, estimatedReductionMs, usesRemaining);
  }

  if (remainingMs == null || timing.remainingSeconds == null) {
    return disabled('timing-not-ready', timing, estimatedReductionMs, usesRemaining);
  }

  if (boost.usedCount >= DELIVERY_AD_BOOST_MAX_USES) {
    return disabled('boost-limit-reached', timing, estimatedReductionMs, usesRemaining);
  }

  const originalDurationMs = getDeliveryOriginalDurationMs(params.delivery, gameSpeed);
  if (boost.totalReducedMs >= originalDurationMs * DELIVERY_AD_BOOST_MAX_TOTAL_RATIO - 1) {
    return disabled('boost-limit-reached', timing, estimatedReductionMs, usesRemaining);
  }

  if (hasPendingDeliveryIncident(params.delivery)) {
    return disabled('blocking-incident', timing, estimatedReductionMs, usesRemaining);
  }

  if (
    params.delivery.status === 'paused' &&
    params.delivery.pausedReason === 'out-of-fuel'
  ) {
    return disabled('blocking-incident', timing, estimatedReductionMs, usesRemaining);
  }

  if (
    params.truck?.status === 'out_of_fuel' &&
    params.delivery.pausedReason === 'out-of-fuel'
  ) {
    return disabled('blocking-incident', timing, estimatedReductionMs, usesRemaining);
  }

  if (adState.consentReady === false) {
    return disabled('privacy-required', timing, estimatedReductionMs, usesRemaining);
  }

  if (params.isOnline === false) {
    return disabled('offline', timing, estimatedReductionMs, usesRemaining);
  }

  if (adState.globalProcessing) {
    return disabled('ad-not-ready', timing, estimatedReductionMs, usesRemaining);
  }

  if (adState.adLoaded === false) {
    return disabled('ad-not-ready', timing, estimatedReductionMs, usesRemaining);
  }

  if (timing.remainingSeconds <= DELIVERY_BOOST_MIN_REMAINING_SECONDS) {
    return disabled('remaining-time-too-short', timing, estimatedReductionMs, usesRemaining);
  }

  if (estimatedReductionMs <= 0) {
    return disabled('timing-not-ready', timing, estimatedReductionMs, usesRemaining);
  }

  return {
    status: 'available',
    remainingSeconds: timing.remainingSeconds,
    estimatedReductionMs,
    usesRemaining,
    etaLabel: timing.etaLabel,
  };
}
