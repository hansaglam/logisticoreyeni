/**
 * Teslimat zamanlama — ETA etiketi ve boost eligibility için tek kaynak.
 */

import { getMsPerGameHour } from '../config/balance';
import type { Delivery } from '../types/game';
import { normalizeJobProgress } from '../utils/deliveryMetrics';
import { isDeliveryProgressComplete } from './delivery';

export interface DeliveryTimingSnapshot {
  /** Gerçek saniye; hazır değilse null. */
  remainingSeconds: number | null;
  totalDurationSeconds: number;
  progress: number;
  etaLabel: string;
}

export function formatDeliveryEtaLabel(remainingGameHours: number): string {
  if (!Number.isFinite(remainingGameHours) || remainingGameHours < 0) {
    return 'ETA bekleniyor';
  }
  const totalMinutes = Math.max(0, Math.round(remainingGameHours * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (wholeHours <= 0) {
    return `ETA ${minutes} dk`;
  }
  return `ETA ${wholeHours} sa ${minutes} dk`;
}

/** Kalan süre (oyun saati) — estimatedArrival öncelikli. */
export function getDeliveryRemainingGameHours(
  delivery: Delivery,
  currentGameTime?: number,
): number | null {
  const progress = normalizeJobProgress(delivery.progress);
  if (
    currentGameTime != null &&
    Number.isFinite(currentGameTime) &&
    typeof delivery.estimatedArrivalTime === 'number' &&
    Number.isFinite(delivery.estimatedArrivalTime)
  ) {
    return Math.max(0, delivery.estimatedArrivalTime - currentGameTime);
  }

  const travelHours = Number(delivery.travelHours);
  if (!Number.isFinite(travelHours) || travelHours <= 0) {
    return null;
  }
  return Math.max(0, (1 - progress) * travelHours);
}

export function getDeliveryRemainingMsFromSnapshot(
  delivery: Delivery,
  gameSpeed: number,
  currentGameTime?: number,
): number | null {
  const remainingGameHours = getDeliveryRemainingGameHours(delivery, currentGameTime);
  if (remainingGameHours == null || !Number.isFinite(remainingGameHours)) {
    return null;
  }
  return remainingGameHours * getMsPerGameHour(gameSpeed);
}

export function buildDeliveryTimingSnapshot(params: {
  delivery: Delivery;
  currentGameTime?: number;
  gameSpeed?: number;
}): DeliveryTimingSnapshot {
  const progress = normalizeJobProgress(params.delivery.progress);
  const gameSpeed = params.gameSpeed ?? 1;
  const travelHours = Math.max(Number(params.delivery.travelHours) || 0, 0.1);
  const totalDurationSeconds = (travelHours * getMsPerGameHour(gameSpeed)) / 1000;
  const remainingGameHours = getDeliveryRemainingGameHours(params.delivery, params.currentGameTime);

  if (remainingGameHours == null || !Number.isFinite(remainingGameHours)) {
    return {
      remainingSeconds: null,
      totalDurationSeconds,
      progress,
      etaLabel: 'Teslimat bilgisi hazırlanıyor.',
    };
  }

  const remainingSeconds = remainingGameHours * 3600;
  return {
    remainingSeconds,
    totalDurationSeconds: travelHours * 3600,
    progress,
    etaLabel: formatDeliveryEtaLabel(remainingGameHours),
  };
}

export function isDeliveryTimingComplete(
  delivery: Delivery,
  currentGameTime?: number,
): boolean {
  const progress = normalizeJobProgress(delivery.progress);
  if (isDeliveryProgressComplete(progress)) {
    return true;
  }
  const remainingGameHours = getDeliveryRemainingGameHours(delivery, currentGameTime);
  return remainingGameHours != null && remainingGameHours <= 0;
}
