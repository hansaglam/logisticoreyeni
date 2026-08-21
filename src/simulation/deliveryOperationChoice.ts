/**
 * Teslimat operasyon kararı — canonical model ve tek resolve yolu.
 * Android / iOS ortak business logic.
 */

import type {
  Delivery,
  DeliveryIncidentChoice,
  DeliveryIncidentEffects,
  DeliveryIncidentResolutionRecord,
} from '../types/game';

import { getDeliveryRemainingGameHours } from './deliveryTiming';

/** Oyun saati → kalan süre saniyesi (oyun zamanı). */
export const GAME_HOURS_TO_REMAINING_SECONDS = 3600;

export type DeliveryOperationChoice = {
  id: string;
  title: string;
  description?: string;
  cashDelta: number;
  remainingTimeDeltaSeconds: number;
  reputationDelta?: number;
  riskDelta?: number;
  outcomeCode: string;
};

export type OperationResolutionState = 'idle' | 'resolving' | 'resolved';

export interface ResolveDeliveryOperationChoiceEffects {
  cashDelta: number;
  fuelCostDelta: number;
  fuelLitersDelta: number;
  truckConditionDelta: number;
  driverXpDelta: number;
  playerXpDelta: number;
  reputationDelta: number;
  remainingTimeDeltaSeconds: number;
  outcomeCode: string;
}

export interface ResolveDeliveryOperationChoiceResult {
  ok: boolean;
  reason?: string;
  delivery?: Delivery;
  effects?: ResolveDeliveryOperationChoiceEffects;
  resolutionRecord?: DeliveryIncidentResolutionRecord;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function deliveryTimeDeltaHoursToRemainingSeconds(hours: number): number {
  if (!Number.isFinite(hours) || hours === 0) {
    return 0;
  }
  return Math.round(hours * GAME_HOURS_TO_REMAINING_SECONDS);
}

export function remainingSecondsToDeliveryTimeDeltaHours(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds === 0) {
    return 0;
  }
  return seconds / GAME_HOURS_TO_REMAINING_SECONDS;
}

/** Nakit hareketi: cashDelta − fuelCostDelta (pozitif yakıt maliyeti = gider). */
export function getOperationChoiceNetCashDelta(effects: DeliveryIncidentEffects): number {
  return (effects.cashDelta ?? 0) - (effects.fuelCostDelta ?? 0);
}

export function incidentChoiceToOperationChoice(
  choice: DeliveryIncidentChoice,
  outcomeCode: string,
): DeliveryOperationChoice {
  return {
    id: choice.id,
    title: choice.label,
    description: choice.description,
    cashDelta: getOperationChoiceNetCashDelta(choice.effects),
    remainingTimeDeltaSeconds: deliveryTimeDeltaHoursToRemainingSeconds(
      choice.effects.deliveryTimeDeltaHours ?? 0,
    ),
    reputationDelta: choice.effects.reputationDelta,
    riskDelta: choice.effects.riskDelta,
    outcomeCode,
  };
}

export function buildOperationResolutionId(
  deliveryId: string,
  eventId: string,
  choiceId: string,
): string {
  return `${deliveryId}:${eventId}:${choiceId}`;
}

export function canAffordOperationChoice(
  playerMoney: number,
  effects: DeliveryIncidentEffects,
): boolean {
  const netCash = getOperationChoiceNetCashDelta(effects);
  if (netCash >= 0) {
    return true;
  }
  const cost = Math.abs(netCash);
  if (!Number.isFinite(playerMoney) || !Number.isFinite(cost) || cost <= 0) {
    return false;
  }
  return playerMoney >= cost;
}

export function getOperationChoiceDisabledReason(params: {
  playerMoney: number;
  effects: DeliveryIncidentEffects;
  incidentResolved?: boolean;
  deliveryActive?: boolean;
  isResolving?: boolean;
}): string | null {
  if (params.isResolving) {
    return 'Karar uygulanıyor…';
  }
  if (params.incidentResolved) {
    return 'Bu olay zaten çözüldü.';
  }
  if (params.deliveryActive === false) {
    return 'Teslimat artık aktif değil.';
  }
  if (!canAffordOperationChoice(params.playerMoney, params.effects)) {
    return 'Bu işlem için yeterli nakit yok.';
  }
  return null;
}

function formatMoneyAmount(amount: number): string {
  return `$${Math.abs(Math.round(amount))}`;
}

function formatRemainingTimeDeltaLabel(seconds: number): string {
  if (!seconds) {
    return '';
  }
  const absSeconds = Math.abs(seconds);
  const totalMinutes = Math.round(absSeconds / 60);
  if (totalMinutes >= 60) {
    const hours = totalMinutes / 60;
    const value = hours % 1 === 0 ? `${hours}` : hours.toFixed(1).replace(/\.0$/, '');
    return seconds > 0 ? `${value} saat gecikme` : `${value} saat kazan`;
  }
  return seconds > 0 ? `${totalMinutes} dk gecikme` : `${totalMinutes} dk kazan`;
}

export function formatOperationChoiceEffectSummary(
  effects: DeliveryIncidentEffects,
): string {
  const parts: string[] = [];
  const netCash = getOperationChoiceNetCashDelta(effects);
  const remainingTimeDeltaSeconds = deliveryTimeDeltaHoursToRemainingSeconds(
    effects.deliveryTimeDeltaHours ?? 0,
  );
  const hasMonetaryCost = netCash < 0;
  const hasMonetaryGain = netCash > 0;

  if ((effects.cashDelta ?? 0) !== 0) {
    if ((effects.cashDelta ?? 0) < 0) {
      parts.push(`${formatMoneyAmount(effects.cashDelta ?? 0)} maliyet`);
    } else {
      parts.push(`${formatMoneyAmount(effects.cashDelta ?? 0)} gelir`);
    }
  }

  if ((effects.fuelCostDelta ?? 0) !== 0) {
    if ((effects.fuelCostDelta ?? 0) > 0) {
      parts.push(`${formatMoneyAmount(effects.fuelCostDelta ?? 0)} ek yakıt`);
    } else {
      parts.push(`${formatMoneyAmount(effects.fuelCostDelta ?? 0)} tasarruf`);
    }
  }

  if ((effects.fuelLitersDelta ?? 0) !== 0) {
    const liters = Math.round(Math.abs(effects.fuelLitersDelta ?? 0));
    parts.push(
      (effects.fuelLitersDelta ?? 0) > 0 ? `+${liters} L yakıt` : `-${liters} L yakıt`,
    );
  }

  if (remainingTimeDeltaSeconds !== 0) {
    parts.push(formatRemainingTimeDeltaLabel(remainingTimeDeltaSeconds));
  }

  if ((effects.progressDelta ?? 0) !== 0) {
    const pct = Math.round(Math.abs(effects.progressDelta ?? 0) * 100);
    parts.push(
      (effects.progressDelta ?? 0) > 0 ? `%${pct} ilerleme` : `%${pct} gerileme`,
    );
  }

  if ((effects.truckConditionDelta ?? 0) !== 0) {
    parts.push(
      (effects.truckConditionDelta ?? 0) > 0
        ? `Kondisyon +${effects.truckConditionDelta}`
        : `Kondisyon ${effects.truckConditionDelta}`,
    );
  }

  if ((effects.driverXpDelta ?? 0) > 0) {
    parts.push(`Şoför XP +${effects.driverXpDelta}`);
  }

  if ((effects.playerXpDelta ?? 0) > 0) {
    parts.push(`XP +${effects.playerXpDelta}`);
  }

  if ((effects.reputationDelta ?? 0) !== 0) {
    parts.push(
      (effects.reputationDelta ?? 0) > 0
        ? `İtibar +${effects.reputationDelta}`
        : `İtibar ${effects.reputationDelta}`,
    );
  }

  if (parts.length === 0) {
    return 'Ücretsiz';
  }

  if (!hasMonetaryCost && !hasMonetaryGain && remainingTimeDeltaSeconds === 0) {
    return `Ücretsiz · ${parts.join(' · ')}`;
  }

  return parts.join(' · ');
}

export function applyDeliveryRemainingTimeDelta(
  delivery: Delivery,
  remainingTimeDeltaSeconds: number,
  currentGameTime?: number,
): Delivery {
  if (!remainingTimeDeltaSeconds) {
    return delivery;
  }

  const deltaHours = remainingSecondsToDeliveryTimeDeltaHours(remainingTimeDeltaSeconds);
  const remainingProgress = Math.max(0, 1 - Math.min(1, Math.max(0, delivery.progress)));
  const currentTravelHours = Math.max(delivery.travelHours, 0.1);
  const progressRemainingHours = remainingProgress * currentTravelHours;
  const etaRemainingHours =
    currentGameTime != null &&
    Number.isFinite(currentGameTime) &&
    typeof delivery.estimatedArrivalTime === 'number' &&
    Number.isFinite(delivery.estimatedArrivalTime)
      ? delivery.estimatedArrivalTime - currentGameTime
      : progressRemainingHours;
  const currentRemainingHours =
    etaRemainingHours > 1e-6 ? etaRemainingHours : progressRemainingHours;
  const nextRemainingHours = Math.max(0.05, currentRemainingHours + deltaHours);
  const nextTravelHours =
    remainingProgress > 0.001
      ? nextRemainingHours / remainingProgress
      : Math.max(0.1, currentTravelHours + deltaHours);
  let nextEta =
    (currentGameTime != null && Number.isFinite(currentGameTime)
      ? currentGameTime
      : delivery.estimatedArrivalTime - currentRemainingHours) + nextRemainingHours;
  if (currentGameTime != null && Number.isFinite(currentGameTime)) {
    nextEta = Math.max(currentGameTime, nextEta);
  }

  const previousChoiceDelay =
    typeof delivery.delayDiagnostics?.incidentChoiceDelayHours === 'number'
      ? delivery.delayDiagnostics.incidentChoiceDelayHours
      : 0;

  return {
    ...delivery,
    travelHours: nextTravelHours,
    estimatedArrivalTime: nextEta,
    delayDiagnostics: {
      outOfFuelHours: delivery.delayDiagnostics?.outOfFuelHours ?? 0,
      incidentPendingHours: delivery.delayDiagnostics?.incidentPendingHours ?? 0,
      otherPausedHours: delivery.delayDiagnostics?.otherPausedHours ?? 0,
      fuelOutCount: delivery.delayDiagnostics?.fuelOutCount ?? 0,
      incidentChoiceDelayHours: previousChoiceDelay + Math.max(0, deltaHours),
    },
  };
}

export function buildOperationOutcomeMessage(params: {
  choiceLabel: string;
  netCashDelta: number;
  remainingTimeDeltaSeconds: number;
}): { title: string; message: string } {
  const { choiceLabel, netCashDelta, remainingTimeDeltaSeconds } = params;
  const parts: string[] = [];

  if (netCashDelta < 0) {
    parts.push(`${formatMoneyAmount(netCashDelta)} ödendi`);
  } else if (netCashDelta > 0) {
    parts.push(`${formatMoneyAmount(netCashDelta)} kazanıldı`);
  }

  if (remainingTimeDeltaSeconds < 0) {
    const minutes = Math.round(Math.abs(remainingTimeDeltaSeconds) / 60);
    parts.push(
      minutes >= 60
        ? `Teslimat süresi ${Math.round(minutes / 60)} saat kısaldı`
        : `Teslimat süresi ${minutes} dakika kısaldı`,
    );
  } else if (remainingTimeDeltaSeconds > 0) {
    const minutes = Math.round(remainingTimeDeltaSeconds / 60);
    parts.push(
      minutes >= 60
        ? `Teslimata ${Math.round(minutes / 60)} saat gecikme eklendi`
        : `Teslimata ${minutes} dakika gecikme eklendi`,
    );
  }

  if (parts.length === 0) {
    return {
      title: 'Operasyon kararı uygulandı',
      message: choiceLabel,
    };
  }

  return {
    title: choiceLabel,
    message: `${parts.join('. ')}.`,
  };
}

export function hasPendingDeliveryOperationDecision(delivery: Delivery): boolean {
  return (
    delivery.incident?.status === 'pending' &&
    delivery.incidentResolved !== true &&
    !delivery.incident?.resolvedChoiceId
  );
}

export function resolveDeliveryOperationChoice(params: {
  delivery: Delivery;
  choiceId: string;
  currentGameTime: number;
  playerMoney?: number;
}): ResolveDeliveryOperationChoiceResult {
  const { delivery, choiceId, currentGameTime, playerMoney } = params;

  if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
    return { ok: false, reason: 'Teslimat artık aktif değil.' };
  }

  const incident = delivery.incident;
  if (!incident || incident.status !== 'pending') {
    return { ok: false, reason: 'Bekleyen operasyon olayı yok.' };
  }

  if (delivery.incidentResolved || incident.resolvedChoiceId) {
    return { ok: false, reason: 'Bu olay zaten çözüldü.' };
  }

  const choice = incident.choices.find((item) => item.id === choiceId);
  if (!choice) {
    return { ok: false, reason: 'Geçersiz seçim.' };
  }

  if (playerMoney != null && !canAffordOperationChoice(playerMoney, choice.effects)) {
    return { ok: false, reason: 'Bu işlem için yeterli nakit yok.' };
  }

  const effects = choice.effects;
  const remainingTimeDeltaSeconds = deliveryTimeDeltaHoursToRemainingSeconds(
    effects.deliveryTimeDeltaHours ?? 0,
  );
  const outcomeCode = `${incident.type}:${choice.id}`;
  const resolutionRecord: DeliveryIncidentResolutionRecord = {
    eventId: incident.id,
    choiceId: choice.id,
    resolvedAt: currentGameTime,
    cashDelta: getOperationChoiceNetCashDelta(effects),
    remainingTimeDeltaSeconds,
    deliveryId: delivery.id,
    outcomeCode,
    type: incident.type,
    severity: incident.severity,
    polarity: incident.polarity,
    title: incident.title,
    triggeredAtProgress: incident.triggerProgress,
    triggeredAtGameTime: incident.createdAtGameTime,
    deliveryTimeDeltaHours: effects.deliveryTimeDeltaHours ?? 0,
    resolvedAtProgress: delivery.progress,
  };

  let nextDelivery: Delivery = {
    ...delivery,
    incidentResolved: true,
    lastIncidentResolvedAt: currentGameTime,
    lastIncidentResolvedProgress: delivery.progress,
    incidentResolutionHistory: [
      ...(delivery.incidentResolutionHistory ?? []),
      resolutionRecord,
    ],
    incident: {
      ...incident,
      status: 'resolved',
      resolvedChoiceId: choice.id,
      resolvedAtGameTime: currentGameTime,
    },
  };

  nextDelivery = applyDeliveryRemainingTimeDelta(
    nextDelivery,
    remainingTimeDeltaSeconds,
    currentGameTime,
  );

  if (effects.progressDelta) {
    nextDelivery = {
      ...nextDelivery,
      progress: clamp(nextDelivery.progress + effects.progressDelta, 0, 1),
    };
  }

  const remainingAfter = getDeliveryRemainingGameHours(nextDelivery, currentGameTime);
  if (remainingAfter != null && remainingAfter < 0) {
    nextDelivery = {
      ...nextDelivery,
      estimatedArrivalTime: currentGameTime,
    };
  }

  return {
    ok: true,
    delivery: nextDelivery,
    resolutionRecord,
    effects: {
      cashDelta: effects.cashDelta ?? 0,
      fuelCostDelta: effects.fuelCostDelta ?? 0,
      fuelLitersDelta: effects.fuelLitersDelta ?? 0,
      truckConditionDelta: effects.truckConditionDelta ?? 0,
      driverXpDelta: effects.driverXpDelta ?? 0,
      playerXpDelta: effects.playerXpDelta ?? 0,
      reputationDelta: effects.reputationDelta ?? 0,
      remainingTimeDeltaSeconds,
      outcomeCode,
    },
  };
}
