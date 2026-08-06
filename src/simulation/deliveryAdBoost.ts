/**
 * Aktif teslimat ödüllü reklam hızlandırma — eligibility, idempotency, simulation.
 */

import {
  DELIVERY_AD_BOOST_COOLDOWN_MS,
  DELIVERY_AD_BOOST_ENABLED,
  DELIVERY_AD_BOOST_MAX_PROCESSED_REWARD_IDS,
  DELIVERY_AD_BOOST_MAX_TOTAL_RATIO,
  DELIVERY_AD_BOOST_MAX_USES,
  DELIVERY_AD_BOOST_MIN_REMAINING_MS,
  DELIVERY_AD_BOOST_REDUCTION_RATIO,
} from '../config/deliveryAdBoost';
import { GAME_LOOP_TICK_MS, getMsPerGameHour, realMsToGameHours } from '../config/balance';
import type { Delivery, DeliveryAdBoostState, Truck } from '../types/game';
import {
  isDeliveryFuelProgressComplete,
  isDeliveryProgressComplete,
  updateDeliveryProgressWithFuel,
} from './delivery';

declare const __DEV__: boolean | undefined;

export type DeliveryAdBoostEligibilityReason =
  | 'eligible'
  | 'delivery-not-active'
  | 'limit-reached'
  | 'remaining-time-too-short'
  | 'incident-pending'
  | 'truck-out-of-fuel'
  | 'ad-not-ready'
  | 'consent-not-ready'
  | 'cooldown'
  | 'already-processing'
  | 'disabled'
  | 'invalid-state';

export interface DeliveryAdBoostEligibilityResult {
  eligible: boolean;
  reason: DeliveryAdBoostEligibilityReason;
  remainingMs: number;
  estimatedReductionMs: number;
  usesRemaining: number;
  message?: string;
}

export interface DeliveryAdBoostAdState {
  adLoaded?: boolean;
  consentReady?: boolean;
  globalProcessing?: boolean;
  lastBoostAdAt?: number;
}

export interface ApplyDeliveryRewardedBoostParams {
  delivery: Delivery;
  truck: Truck;
  rewardId: string;
  earnedAt: number;
  gameSpeed?: number;
  currentGameTime?: number;
  processedAt?: number;
}

export interface ApplyDeliveryRewardedBoostResult {
  ok: boolean;
  reason?: string;
  delivery?: Delivery;
  truck?: Truck;
  appliedReductionMs?: number;
  shouldComplete?: boolean;
}

function isDevEnvironment(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

function clampCount(value: unknown, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.min(max, Math.floor(n));
}

export function createDefaultDeliveryAdBoostState(): DeliveryAdBoostState {
  return {
    usedCount: 0,
    totalReducedMs: 0,
    processedRewardIds: [],
  };
}

export function normalizeDeliveryAdBoostState(raw: unknown): DeliveryAdBoostState {
  if (!raw || typeof raw !== 'object') {
    return createDefaultDeliveryAdBoostState();
  }
  const record = raw as Partial<DeliveryAdBoostState>;
  const processedRewardIds = Array.isArray(record.processedRewardIds)
    ? record.processedRewardIds
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(-DELIVERY_AD_BOOST_MAX_PROCESSED_REWARD_IDS)
    : [];
  return {
    usedCount: clampCount(record.usedCount, DELIVERY_AD_BOOST_MAX_USES),
    totalReducedMs: clampCount(record.totalReducedMs, Number.MAX_SAFE_INTEGER),
    lastRewardedAt:
      typeof record.lastRewardedAt === 'number' && Number.isFinite(record.lastRewardedAt)
        ? record.lastRewardedAt
        : undefined,
    processedRewardIds,
  };
}

export function normalizeDeliveryAdBoostFields(delivery: Delivery): Delivery {
  if (!delivery.deliveryAdBoost) {
    return delivery;
  }
  return {
    ...delivery,
    deliveryAdBoost: normalizeDeliveryAdBoostState(delivery.deliveryAdBoost),
  };
}

export function isActiveDeliveryForBoost(delivery: Delivery): boolean {
  return (
    delivery.status === 'preparing' ||
    delivery.status === 'on_route' ||
    delivery.status === 'paused'
  );
}

export function hasPendingDeliveryIncident(delivery: Delivery): boolean {
  return (
    delivery.incident?.status === 'pending' &&
    delivery.incidentResolved !== true
  );
}

export function getDeliveryOriginalDurationMs(
  delivery: Delivery,
  gameSpeed = 1,
): number {
  const travelHours = Math.max(Number(delivery.travelHours) || 0, 0.1);
  return travelHours * getMsPerGameHour(gameSpeed);
}

export function getDeliveryRemainingMs(
  delivery: Delivery,
  gameSpeed = 1,
): number {
  const progress = Math.max(0, Math.min(1, Number(delivery.progress) || 0));
  const remainingGameHours = Math.max(0, (1 - progress) * Math.max(delivery.travelHours, 0.1));
  return remainingGameHours * getMsPerGameHour(gameSpeed);
}

export function calculateDeliveryBoostReductionMs(params: {
  delivery: Delivery;
  gameSpeed?: number;
}): number {
  const gameSpeed = params.gameSpeed ?? 1;
  const boost = normalizeDeliveryAdBoostState(params.delivery.deliveryAdBoost);
  const remainingMs = getDeliveryRemainingMs(params.delivery, gameSpeed);
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return 0;
  }

  const requested = remainingMs * DELIVERY_AD_BOOST_REDUCTION_RATIO;
  const originalDurationMs = getDeliveryOriginalDurationMs(params.delivery, gameSpeed);
  const maxTotalReductionMs = originalDurationMs * DELIVERY_AD_BOOST_MAX_TOTAL_RATIO;
  const remainingCapMs = Math.max(0, maxTotalReductionMs - boost.totalReducedMs);
  const minTickMs = GAME_LOOP_TICK_MS;
  const capped = Math.min(requested, remainingCapMs, remainingMs);
  return Math.max(minTickMs, Math.floor(capped));
}

export function getDeliveryAdBoostEligibility(params: {
  delivery: Delivery;
  truck?: Truck | null;
  nowMs?: number;
  gameSpeed?: number;
  adState?: DeliveryAdBoostAdState;
}): DeliveryAdBoostEligibilityResult {
  const nowMs = params.nowMs ?? Date.now();
  const gameSpeed = params.gameSpeed ?? 1;
  const adState = params.adState ?? {};
  const boost = normalizeDeliveryAdBoostState(params.delivery.deliveryAdBoost);
  const remainingMs = getDeliveryRemainingMs(params.delivery, gameSpeed);
  const usesRemaining = Math.max(0, DELIVERY_AD_BOOST_MAX_USES - boost.usedCount);
  const estimatedReductionMs = calculateDeliveryBoostReductionMs({
    delivery: params.delivery,
    gameSpeed,
  });

  const ineligible = (
    reason: DeliveryAdBoostEligibilityReason,
    message: string,
  ): DeliveryAdBoostEligibilityResult => ({
    eligible: false,
    reason,
    remainingMs,
    estimatedReductionMs,
    usesRemaining,
    message,
  });

  if (!DELIVERY_AD_BOOST_ENABLED) {
    return ineligible('disabled', 'Teslimat hızlandırma kapalı.');
  }

  if (!isActiveDeliveryForBoost(params.delivery)) {
    return ineligible('delivery-not-active', 'Aktif teslimat yok.');
  }

  if (params.delivery.progress >= 1 || isDeliveryProgressComplete(params.delivery.progress)) {
    return ineligible('delivery-not-active', 'Teslimat tamamlanmak üzere.');
  }

  if (hasPendingDeliveryIncident(params.delivery)) {
    return ineligible('incident-pending', 'Önce bekleyen operasyon kararını tamamla.');
  }

  if (
    params.delivery.status === 'paused' &&
    params.delivery.pausedReason === 'out-of-fuel'
  ) {
    return ineligible('truck-out-of-fuel', 'Yakıt bittiği için hızlandırma kullanılamaz.');
  }

  if (params.truck?.status === 'out_of_fuel' && params.delivery.pausedReason === 'out-of-fuel') {
    return ineligible('truck-out-of-fuel', 'Yakıt bittiği için hızlandırma kullanılamaz.');
  }

  if (boost.usedCount >= DELIVERY_AD_BOOST_MAX_USES) {
    return ineligible('limit-reached', 'Bu teslimat için hızlandırma sınırına ulaştın.');
  }

  if (remainingMs < DELIVERY_AD_BOOST_MIN_REMAINING_MS) {
    return ineligible('remaining-time-too-short', 'Kalan süre hızlandırma için çok kısa.');
  }

  const originalDurationMs = getDeliveryOriginalDurationMs(params.delivery, gameSpeed);
  if (
    boost.totalReducedMs >=
    originalDurationMs * DELIVERY_AD_BOOST_MAX_TOTAL_RATIO - GAME_LOOP_TICK_MS
  ) {
    return ineligible('limit-reached', 'Bu teslimat için hızlandırma sınırına ulaştın.');
  }

  if (estimatedReductionMs <= 0) {
    return ineligible('invalid-state', 'Hızlandırma hesaplanamadı.');
  }

  if (adState.globalProcessing) {
    return ineligible('already-processing', 'Reklam işleniyor…');
  }

  if (
    adState.lastBoostAdAt != null &&
    nowMs - adState.lastBoostAdAt < DELIVERY_AD_BOOST_COOLDOWN_MS
  ) {
    return ineligible('cooldown', 'Kısa süre sonra tekrar deneyebilirsin.');
  }

  if (adState.consentReady === false) {
    return ineligible('consent-not-ready', 'Gizlilik tercihi gerekli.');
  }

  if (adState.adLoaded === false) {
    return ineligible('ad-not-ready', 'Reklam hazırlanıyor…');
  }

  return {
    eligible: true,
    reason: 'eligible',
    remainingMs,
    estimatedReductionMs,
    usesRemaining,
  };
}

export function createDeliveryBoostRewardId(deliveryId: string, earnedAt: number): string {
  const prefix = deliveryId.slice(0, 8);
  return `delivery-boost:${prefix}:${earnedAt}`;
}

export function applyDeliveryBoostSim(params: {
  delivery: Delivery;
  truck: Truck;
  simDurationMs: number;
  gameSpeed?: number;
  processedAt?: number;
}): { delivery: Delivery; truck: Truck; appliedSimMs: number } {
  const gameSpeed = params.gameSpeed ?? 1;
  const simDurationMs = Math.max(0, Math.floor(Number(params.simDurationMs) || 0));
  if (simDurationMs <= 0) {
    return { delivery: params.delivery, truck: params.truck, appliedSimMs: 0 };
  }

  const boostGameHours = realMsToGameHours(simDurationMs, gameSpeed);
  const minGameHours = realMsToGameHours(GAME_LOOP_TICK_MS, gameSpeed);
  const hoursToApply = Math.max(minGameHours, boostGameHours);

  const beforeRemaining = getDeliveryRemainingMs(params.delivery, gameSpeed);
  const { delivery, truck } = updateDeliveryProgressWithFuel(
    params.delivery,
    params.truck,
    hoursToApply,
    params.processedAt,
  );
  const afterRemaining = getDeliveryRemainingMs(delivery, gameSpeed);
  const appliedSimMs = Math.max(0, beforeRemaining - afterRemaining);

  return {
    delivery,
    truck,
    appliedSimMs: appliedSimMs > 0 ? appliedSimMs : GAME_LOOP_TICK_MS,
  };
}

export function applyDeliveryRewardedBoost(
  params: ApplyDeliveryRewardedBoostParams,
): ApplyDeliveryRewardedBoostResult {
  const delivery = normalizeDeliveryAdBoostFields(params.delivery);
  const boost = normalizeDeliveryAdBoostState(delivery.deliveryAdBoost);
  const gameSpeed = params.gameSpeed ?? 1;
  const earnedAt = params.earnedAt;

  if (!params.rewardId?.trim()) {
    return { ok: false, reason: 'Geçersiz ödül kimliği.' };
  }

  if (boost.processedRewardIds.includes(params.rewardId)) {
    return { ok: false, reason: 'Bu ödül zaten uygulandı.' };
  }

  const eligibility = getDeliveryAdBoostEligibility({
    delivery,
    truck: params.truck,
    nowMs: earnedAt,
    gameSpeed,
  });

  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.message ?? 'Hızlandırma uygun değil.' };
  }

  const requestedReductionMs = eligibility.estimatedReductionMs;
  const simResult = applyDeliveryBoostSim({
    delivery,
    truck: params.truck,
    simDurationMs: requestedReductionMs,
    gameSpeed,
    processedAt: params.processedAt ?? params.currentGameTime,
  });

  const appliedReductionMs = Math.max(
    0,
    getDeliveryRemainingMs(delivery, gameSpeed) -
      getDeliveryRemainingMs(simResult.delivery, gameSpeed),
  );

  const nextProcessedIds = [...boost.processedRewardIds, params.rewardId].slice(
    -DELIVERY_AD_BOOST_MAX_PROCESSED_REWARD_IDS,
  );

  const nextBoost: DeliveryAdBoostState = {
    usedCount: Math.min(DELIVERY_AD_BOOST_MAX_USES, boost.usedCount + 1),
    totalReducedMs: boost.totalReducedMs + appliedReductionMs,
    lastRewardedAt: earnedAt,
    processedRewardIds: nextProcessedIds,
  };

  const nextDelivery: Delivery = {
    ...simResult.delivery,
    deliveryAdBoost: nextBoost,
    status:
      simResult.delivery.pausedReason === 'out-of-fuel'
        ? 'paused'
        : simResult.delivery.status === 'paused'
          ? 'on_route'
          : simResult.delivery.status,
  };

  const shouldComplete =
    isDeliveryProgressComplete(nextDelivery.progress) &&
    isDeliveryFuelProgressComplete(nextDelivery);

  logDeliveryAdBoost({
    stage: 'boost-applied',
    deliveryIdPrefix: delivery.id.slice(0, 8),
    rewardIdPrefix: params.rewardId.slice(0, 12),
    remainingBeforeMs: eligibility.remainingMs,
    requestedReductionMs,
    appliedReductionMs,
    remainingAfterMs: getDeliveryRemainingMs(nextDelivery, gameSpeed),
    usedCount: nextBoost.usedCount,
    reason: eligibility.reason,
  });

  return {
    ok: true,
    delivery: nextDelivery,
    truck: simResult.truck,
    appliedReductionMs,
    shouldComplete,
  };
}

export function formatBoostMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

export function formatBoostDurationLabel(ms: number): string {
  const totalMinutes = formatBoostMinutes(ms);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} sa ${minutes} dk` : `${hours} sa`;
  }
  return `${minutes} dk`;
}

export function eligibilityReasonToUserMessage(
  result: DeliveryAdBoostEligibilityResult,
): string {
  if (result.message) {
    return result.message;
  }
  switch (result.reason) {
    case 'ad-not-ready':
      return 'Reklam hazırlanıyor…';
    case 'consent-not-ready':
      return 'Gizlilik tercihi gerekli.';
    case 'limit-reached':
      return 'Bu teslimat için hızlandırma sınırına ulaştın.';
    case 'incident-pending':
      return 'Önce bekleyen operasyon kararını tamamla.';
    case 'cooldown':
      return 'Kısa süre sonra tekrar deneyebilirsin.';
    case 'remaining-time-too-short':
      return 'Kalan süre hızlandırma için çok kısa.';
    default:
      return 'Hızlandırma şu an kullanılamıyor.';
  }
}

export function logDeliveryAdBoost(payload: {
  stage:
    | 'eligibility'
    | 'show-requested'
    | 'ad-opened'
    | 'reward-earned'
    | 'boost-applied'
    | 'dismissed'
    | 'failed';
  deliveryIdPrefix: string;
  rewardIdPrefix?: string;
  remainingBeforeMs?: number;
  requestedReductionMs?: number;
  appliedReductionMs?: number;
  remainingAfterMs?: number;
  usedCount?: number;
  reason?: string;
}): void {
  if (!isDevEnvironment()) {
    return;
  }
  console.log('[delivery-ad-boost]', payload);
}
