/**
 * Aktif teslimatların gerçek zamana göre offline ilerlemesi.
 * Sabit işletme gideri içermez — yalnız delivery progress / completion.
 */

import { getMsPerGameHour, realMsToGameHours } from '../config/balance';
import type { Delivery, Truck } from '../types/game';
import {
  accumulateDeliveryTickDiagnostics,
  isPendingIncidentBlocking,
} from '../domain/deliveryDelayDiagnostics';
import {
  isDeliveryFuelProgressComplete,
  isDeliveryProgressComplete,
  updateDeliveryProgress,
  updateDeliveryProgressWithFuel,
} from './delivery';
import { MS_PER_MINUTE } from './economyClock';

/** Aktif teslimat varken offline catch-up eşiği (kısa background dahil) */
export const ACTIVE_DELIVERY_OFFLINE_MIN_MS = 15_000;
/** Aktif teslimat yokken genel offline eşiği */
export const DEFAULT_OFFLINE_MIN_MS = 5 * MS_PER_MINUTE;

export function isActiveRouteDelivery(delivery: Delivery): boolean {
  return delivery.status === 'on_route' || delivery.status === 'preparing';
}

export function countActiveRouteDeliveriesInList(deliveries: Delivery[] | undefined): number {
  return (deliveries ?? []).filter(isActiveRouteDelivery).length;
}

export function resolveDeliveryProgressAnchorMs(
  delivery: Delivery,
  fallbackMs?: number | null,
): number | null {
  const candidates = [delivery.lastProgressedRealAtMs, delivery.startedRealAtMs, fallbackMs];
  for (const value of candidates) {
    if (value != null && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Gerçek zamandan bu teslimat için eklenmesi gereken oyun saati.
 * Offline catch-up ve reconcile için tek kaynak.
 */
export function computeDeliveryCatchUpGameHours(params: {
  delivery: Delivery;
  nowMs: number;
  gameSpeed: number;
  baselineMs?: number | null;
}): number {
  const { delivery, nowMs, gameSpeed, baselineMs } = params;
  if (!isActiveRouteDelivery(delivery)) {
    return 0;
  }

  const anchor = resolveDeliveryProgressAnchorMs(delivery, baselineMs);
  if (anchor == null || nowMs <= anchor) {
    return 0;
  }

  return realMsToGameHours(nowMs - anchor, gameSpeed);
}

/**
 * Tüm aktif teslimatlar için gereken maksimum catch-up oyun saati.
 */
export function computeRequiredDeliveryCatchUpGameHours(params: {
  deliveries: Delivery[] | undefined;
  nowMs: number;
  gameSpeed: number;
  baselineMs?: number | null;
}): number {
  let maxHours = 0;
  for (const delivery of params.deliveries ?? []) {
    maxHours = Math.max(
      maxHours,
      computeDeliveryCatchUpGameHours({
        delivery,
        nowMs: params.nowMs,
        gameSpeed: params.gameSpeed,
        baselineMs: params.baselineMs,
      }),
    );
  }
  return maxHours;
}

/**
 * Offline elapsed eşiği — aktif teslimat varsa kısa background da uygulanır.
 */
export function resolveOfflineProgressMinMs(hasActiveDeliveries: boolean): number {
  return hasActiveDeliveries ? ACTIVE_DELIVERY_OFFLINE_MIN_MS : DEFAULT_OFFLINE_MIN_MS;
}

/**
 * Wall-clock ile progress'i hizala; eksik kalanı tamamla.
 * advanceTime sonrası güvenlik ağı — çift settlement store tarafında engellenir.
 */
export function reconcileDeliveriesWithRealTime(params: {
  deliveries: Delivery[];
  trucks?: Truck[];
  nowMs: number;
  gameSpeed: number;
  baselineMs?: number | null;
  currentTime?: number;
}): {
  deliveries: Delivery[];
  trucks: Truck[];
  completedIds: string[];
  progressedCount: number;
} {
  const completedIds: string[] = [];
  let progressedCount = 0;
  let trucks = params.trucks ?? [];

  const deliveries = params.deliveries.map((delivery) => {
    if (!isActiveRouteDelivery(delivery)) {
      return delivery;
    }
    if (delivery.settledAt != null || delivery.settlementId) {
      return delivery;
    }

    const catchUpHours = computeDeliveryCatchUpGameHours({
      delivery,
      nowMs: params.nowMs,
      gameSpeed: params.gameSpeed,
      baselineMs: params.baselineMs,
    });

    if (catchUpHours <= 0) {
      return {
        ...delivery,
        lastProgressedRealAtMs: params.nowMs,
      };
    }

    const before = delivery.progress ?? 0;
    let updated: Delivery;

    if (isPendingIncidentBlocking(delivery)) {
      updated = accumulateDeliveryTickDiagnostics(delivery, catchUpHours, {
        wasOutOfFuel: false,
        isOutOfFuel: false,
        incidentBlocking: true,
        otherPaused: false,
      });
    } else if (delivery.pausedReason === 'out-of-fuel' || delivery.status === 'paused') {
      updated = accumulateDeliveryTickDiagnostics(delivery, catchUpHours, {
        wasOutOfFuel: delivery.pausedReason === 'out-of-fuel',
        isOutOfFuel: delivery.pausedReason === 'out-of-fuel',
        incidentBlocking: false,
        otherPaused: delivery.pausedReason !== 'out-of-fuel',
      });
    } else {
      const truck = trucks.find((candidate) => candidate.id === delivery.truckId);
      if (truck) {
        const wasOutOfFuel = delivery.pausedReason === 'out-of-fuel';
        const fueled = updateDeliveryProgressWithFuel(
          delivery,
          truck,
          catchUpHours,
          params.currentTime,
        );
        trucks = trucks.map((candidate) =>
          candidate.id === truck.id ? fueled.truck : candidate,
        );
        updated = accumulateDeliveryTickDiagnostics(fueled.delivery, catchUpHours, {
          wasOutOfFuel,
          isOutOfFuel: fueled.delivery.pausedReason === 'out-of-fuel',
          incidentBlocking: false,
          otherPaused: false,
        });
      } else {
        updated = updateDeliveryProgress(delivery, catchUpHours);
      }
    }

    updated = {
      ...updated,
      lastProgressedRealAtMs: params.nowMs,
      startedRealAtMs: delivery.startedRealAtMs ?? params.baselineMs ?? params.nowMs,
      expectedDurationGameHours:
        delivery.expectedDurationGameHours ?? delivery.travelHours,
    };

    if ((updated.progress ?? 0) > before) {
      progressedCount += 1;
    }

    if (
      updated.incident?.status === 'pending' &&
      updated.incidentResolved !== true
    ) {
      return updated;
    }

    if (
      updated.pausedReason === 'out-of-fuel' ||
      updated.status === 'paused'
    ) {
      return updated;
    }

    if (
      isDeliveryProgressComplete(updated.progress) &&
      isDeliveryFuelProgressComplete(updated)
    ) {
      completedIds.push(updated.id);
    }

    return updated;
  });

  return { deliveries, trucks, completedIds, progressedCount };
}

/** Kalan progress için gereken gerçek ms (bilgi / test) */
export function estimateRemainingRealMsForDelivery(
  delivery: Delivery,
  gameSpeed: number,
): number {
  if (!isActiveRouteDelivery(delivery)) {
    return 0;
  }
  const travelHours = Math.max(
    delivery.expectedDurationGameHours ?? delivery.travelHours ?? 0.1,
    0.1,
  );
  const remainingProgress = Math.max(0, 1 - (delivery.progress ?? 0));
  const remainingGameHours = remainingProgress * travelHours;
  return remainingGameHours * getMsPerGameHour(gameSpeed);
}

export function buildDeliverySettlementId(deliveryId: string): string {
  return `settlement_${deliveryId}`;
}
