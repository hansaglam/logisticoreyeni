/**
 * OS/local gameplay notification domain — shared iOS/Android.
 * Does not import expo-notifications.
 */

import { isDeliveryLateRisk } from '../utils/deadlineUx';
import type { DeliveryFailureReason } from '../types/game';

export const MARKET_OS_NOTIFICATIONS_ENABLED = false;

export const OS_NOTIFICATION_DEDUPE_MAX = 250;

export type OsNotificationChannelId =
  | 'critical-operations'
  | 'deliveries'
  | 'fleet-updates'
  | 'progress-rewards';

export type OsGameplayNotificationType =
  | 'delivery_out_of_fuel'
  | 'delivery_incident'
  | 'delivery_deadline_risk'
  | 'delivery_late'
  | 'delivery_completed'
  | 'delivery_failed'
  | 'fleet_rental'
  | 'transfer_completed'
  | 'warehouse_transfer_completed'
  | 'company_level_up'
  | 'weekly_mission_completed';

export type DeliveryDeadlineOsState = 'safe' | 'at_risk' | 'late';

export type OsGameplayNotificationPayload = {
  type: OsGameplayNotificationType;
  deliveryId?: string;
  vehicleId?: string;
  incidentId?: string;
  transferId?: string;
  truckId?: string;
  level?: number;
  missionId?: string;
  tab?: 'map' | 'contracts' | 'fleet' | 'dashboard' | 'more';
  moreSubRoute?: 'missions' | 'warehouse';
};

export type OsGameplayNotificationSpec = {
  dedupeKey: string;
  channelId: OsNotificationChannelId;
  title: string;
  body: string;
  data: OsGameplayNotificationPayload;
};

export function appendOsDedupeKey(keys: string[], key: string): string[] {
  if (keys.includes(key)) {
    return keys;
  }
  const next = [...keys, key];
  if (next.length <= OS_NOTIFICATION_DEDUPE_MAX) {
    return next;
  }
  return next.slice(next.length - OS_NOTIFICATION_DEDUPE_MAX);
}

export function hasOsDedupeKey(keys: string[] | undefined, key: string): boolean {
  return Boolean(keys && keys.includes(key));
}

export function normalizeOsDedupeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || unique.includes(item)) {
      continue;
    }
    unique.push(item);
  }
  return unique.slice(-OS_NOTIFICATION_DEDUPE_MAX);
}

export function osNotificationIdentifier(dedupeKey: string): string {
  return dedupeKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function classifyDeliveryDeadlineOsState(input: {
  currentTime: number;
  estimatedArrivalTime: number;
  deadlineTime: number;
}): DeliveryDeadlineOsState {
  if (input.currentTime > input.deadlineTime) {
    return 'late';
  }
  if (isDeliveryLateRisk(input.estimatedArrivalTime, input.deadlineTime)) {
    return 'at_risk';
  }
  return 'safe';
}

export function buildOutOfFuelOsKey(deliveryId: string, fuelOutEventCount: number): string {
  return `delivery:${deliveryId}:out_of_fuel:${Math.max(1, fuelOutEventCount)}`;
}

export function buildIncidentOsKey(deliveryId: string, incidentId: string): string {
  return `delivery:${deliveryId}:incident:${incidentId}`;
}

export function buildDeadlineRiskOsKey(deliveryId: string): string {
  return `delivery:${deliveryId}:deadline_risk`;
}

export function buildLateOsKey(deliveryId: string): string {
  return `delivery:${deliveryId}:late`;
}

export function buildCompletedOsKey(deliveryId: string): string {
  return `delivery:${deliveryId}:completed`;
}

export function buildFailedOsKey(deliveryId: string): string {
  return `delivery:${deliveryId}:failed`;
}

export function buildLevelOsKey(level: number): string {
  return `level:${level}`;
}

export function buildWeeklyMissionOsKey(missionId: string): string {
  return `weekly_mission:${missionId}`;
}

export function buildTransferOsKey(transferId: string): string {
  return `transfer:${transferId}:completed`;
}

export function buildWarehouseTransferOsKey(transferId: string): string {
  return `warehouse_transfer:${transferId}:completed`;
}

export function nextFuelOutEventCount(
  previousPausedOutOfFuel: boolean,
  nowPausedOutOfFuel: boolean,
  currentCount: number | undefined,
): { count: number; transitioned: boolean } {
  const count = Math.max(0, Math.floor(currentCount ?? 0));
  if (!previousPausedOutOfFuel && nowPausedOutOfFuel) {
    return { count: count + 1, transitioned: true };
  }
  return { count, transitioned: false };
}

export function formatOsNotificationMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '+';
  const abs = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${abs}`;
}

export function buildOutOfFuelOsNotification(input: {
  deliveryId: string;
  vehicleId: string;
  truckName: string;
  fuelOutEventCount: number;
}): OsGameplayNotificationSpec {
  return {
    dedupeKey: buildOutOfFuelOsKey(input.deliveryId, input.fuelOutEventCount),
    channelId: 'critical-operations',
    title: 'Aracın yakıtsız kaldı',
    body: `${input.truckName} ilerlemiyor. Son teslim süresi işlemeye devam ediyor.`,
    data: {
      type: 'delivery_out_of_fuel',
      deliveryId: input.deliveryId,
      vehicleId: input.vehicleId,
      tab: 'map',
    },
  };
}

export function buildIncidentOsNotification(input: {
  deliveryId: string;
  incidentId: string;
}): OsGameplayNotificationSpec {
  return {
    dedupeKey: buildIncidentOsKey(input.deliveryId, input.incidentId),
    channelId: 'critical-operations',
    title: 'Operasyon kararı gerekiyor',
    body: 'Teslimat, karar verene kadar ilerlemiyor. Son teslim süresi işlemeye devam ediyor.',
    data: {
      type: 'delivery_incident',
      deliveryId: input.deliveryId,
      incidentId: input.incidentId,
      tab: 'contracts',
    },
  };
}

export function buildDeadlineRiskOsNotification(input: {
  deliveryId: string;
  originName: string;
  destinationName: string;
}): OsGameplayNotificationSpec {
  return {
    dedupeKey: buildDeadlineRiskOsKey(input.deliveryId),
    channelId: 'deliveries',
    title: 'Teslimat gecikme riski',
    body: `${input.originName} → ${input.destinationName} teslimatında zaman payı kritik seviyeye düştü.`,
    data: {
      type: 'delivery_deadline_risk',
      deliveryId: input.deliveryId,
      tab: 'map',
    },
  };
}

export function buildLateOsNotification(input: { deliveryId: string }): OsGameplayNotificationSpec {
  return {
    dedupeKey: buildLateOsKey(input.deliveryId),
    channelId: 'deliveries',
    title: 'Teslimat gecikiyor',
    body: 'Son teslim süresi aşıldı. İtibar cezası riski var.',
    data: {
      type: 'delivery_late',
      deliveryId: input.deliveryId,
      tab: 'map',
    },
  };
}

export function buildCompletedOsNotification(input: {
  deliveryId: string;
  revenue: number;
  punctuality: 'early' | 'on-time' | 'late-minor' | 'late-major' | 'failed' | 'cancelled';
}): OsGameplayNotificationSpec | null {
  if (input.punctuality === 'cancelled' || input.punctuality === 'failed') {
    return null;
  }
  const money = formatOsNotificationMoney(input.revenue);
  const body =
    input.punctuality === 'early'
      ? `Teslimat erken tamamlandı. ${money}`
      : input.punctuality === 'on-time'
        ? `Teslimat zamanında tamamlandı. ${money}`
        : `Teslimat gecikmeli tamamlandı. ${money}`;
  return {
    dedupeKey: buildCompletedOsKey(input.deliveryId),
    channelId: 'deliveries',
    title: 'Teslimat tamamlandı',
    body,
    data: {
      type: 'delivery_completed',
      deliveryId: input.deliveryId,
      tab: 'contracts',
    },
  };
}

export function buildFailedOsNotification(input: {
  deliveryId: string;
  reason: DeliveryFailureReason;
}): OsGameplayNotificationSpec | null {
  if (input.reason === 'cancelled') {
    return null;
  }
  const body =
    input.reason === 'too_late'
      ? 'Son teslim süresi kritik seviyede aşıldı.'
      : input.reason === 'breakdown'
        ? 'Araç arızası nedeniyle teslimat tamamlanamadı.'
        : input.reason === 'accident'
          ? 'Kaza nedeniyle teslimat tamamlanamadı.'
          : null;
  if (!body) {
    return null;
  }
  return {
    dedupeKey: buildFailedOsKey(input.deliveryId),
    channelId: 'deliveries',
    title: 'Teslimat başarısız',
    body,
    data: {
      type: 'delivery_failed',
      deliveryId: input.deliveryId,
      tab: 'contracts',
    },
  };
}

export function buildTransferCompletedOsNotification(input: {
  transferId: string;
  truckName: string;
  cityName: string;
}): OsGameplayNotificationSpec {
  return {
    dedupeKey: buildTransferOsKey(input.transferId),
    channelId: 'fleet-updates',
    title: 'Transfer tamamlandı',
    body: `${input.truckName} ${input.cityName} deposuna ulaştı.`,
    data: {
      type: 'transfer_completed',
      transferId: input.transferId,
      tab: 'fleet',
    },
  };
}

export function buildWarehouseTransferCompletedOsNotification(input: {
  transferId: string;
  cityName: string;
}): OsGameplayNotificationSpec {
  return {
    dedupeKey: buildWarehouseTransferOsKey(input.transferId),
    channelId: 'fleet-updates',
    title: 'Transfer tamamlandı',
    body: `Stok ${input.cityName} deposuna ulaştı.`,
    data: {
      type: 'warehouse_transfer_completed',
      transferId: input.transferId,
      tab: 'more',
      moreSubRoute: 'warehouse',
    },
  };
}

export function buildLevelUpOsNotification(input: {
  companyName: string;
  level: number;
}): OsGameplayNotificationSpec {
  return {
    dedupeKey: buildLevelOsKey(input.level),
    channelId: 'progress-rewards',
    title: 'Şirket seviye atladı 🎉',
    body: `${input.companyName} artık Seviye ${input.level}.`,
    data: {
      type: 'company_level_up',
      level: input.level,
      tab: 'dashboard',
    },
  };
}

export function buildWeeklyMissionOsNotification(input: {
  missionId: string;
}): OsGameplayNotificationSpec {
  return {
    dedupeKey: buildWeeklyMissionOsKey(input.missionId),
    channelId: 'progress-rewards',
    title: 'Haftalık görev tamamlandı',
    body: 'Ödülün seni bekliyor.',
    data: {
      type: 'weekly_mission_completed',
      missionId: input.missionId,
      tab: 'more',
      moreSubRoute: 'missions',
    },
  };
}

export function listNewlyReadyWeeklyObjectiveIds(
  previous: Record<string, { progress: number; isClaimed?: boolean; completedAt?: number }>,
  next: Record<string, { progress: number; isClaimed?: boolean; completedAt?: number }>,
  targets: Record<string, number>,
): string[] {
  const ready: string[] = [];
  for (const [id, entry] of Object.entries(next)) {
    if (entry.isClaimed) continue;
    const target = targets[id];
    if (!(target > 0) || entry.progress < target) continue;
    const before = previous[id];
    const wasReady = Boolean(before && !before.isClaimed && before.progress >= target);
    if (!wasReady) {
      ready.push(id);
    }
  }
  return ready;
}

export function deadlineOsTransitions(
  previous: DeliveryDeadlineOsState,
  next: DeliveryDeadlineOsState,
): { notifyRisk: boolean; notifyLate: boolean; persistRiskKey: boolean } {
  return {
    notifyRisk: previous === 'safe' && next === 'at_risk',
    notifyLate: previous !== 'late' && next === 'late',
    persistRiskKey: previous === 'safe' && next === 'late',
  };
}

export function collectHydrationOsDedupeKeys(input: {
  currentTime: number;
  companyLevel: number;
  activeDeliveries: Array<{
    id: string;
    status: string;
    pausedReason?: string;
    fuelOutEventCount?: number;
    estimatedArrivalTime: number;
    deadlineTime: number;
    incident?: { id: string; status: string } | null;
    incidentResolved?: boolean;
  }>;
  settlementHistory?: Array<{
    deliveryId: string;
    punctualityResult: string;
  }>;
  completedTransferIds?: string[];
  completedWarehouseTransferIds?: string[];
  readyWeeklyMissionIds?: string[];
}): string[] {
  const keys: string[] = [];
  for (let level = 1; level <= Math.max(1, input.companyLevel); level += 1) {
    keys.push(buildLevelOsKey(level));
  }
  for (const delivery of input.activeDeliveries) {
    const outOfFuel =
      delivery.status === 'paused' && delivery.pausedReason === 'out-of-fuel';
    if (outOfFuel) {
      keys.push(buildOutOfFuelOsKey(delivery.id, Math.max(1, delivery.fuelOutEventCount ?? 1)));
    }
    if (
      delivery.incident &&
      delivery.incident.status === 'pending' &&
      !delivery.incidentResolved
    ) {
      keys.push(buildIncidentOsKey(delivery.id, delivery.incident.id));
    }
    const deadline = classifyDeliveryDeadlineOsState({
      currentTime: input.currentTime,
      estimatedArrivalTime: delivery.estimatedArrivalTime,
      deadlineTime: delivery.deadlineTime,
    });
    if (deadline === 'at_risk' || deadline === 'late') {
      keys.push(buildDeadlineRiskOsKey(delivery.id));
    }
    if (deadline === 'late') {
      keys.push(buildLateOsKey(delivery.id));
    }
  }
  for (const record of input.settlementHistory ?? []) {
    if (record.punctualityResult === 'failed' || record.punctualityResult === 'cancelled') {
      keys.push(buildFailedOsKey(record.deliveryId));
      continue;
    }
    keys.push(buildCompletedOsKey(record.deliveryId));
  }
  for (const transferId of input.completedTransferIds ?? []) {
    keys.push(buildTransferOsKey(transferId));
  }
  for (const transferId of input.completedWarehouseTransferIds ?? []) {
    keys.push(buildWarehouseTransferOsKey(transferId));
  }
  for (const missionId of input.readyWeeklyMissionIds ?? []) {
    keys.push(buildWeeklyMissionOsKey(missionId));
  }
  return keys;
}
