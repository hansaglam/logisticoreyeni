/**
 * Offline progression — gerçek zaman farkını oyun simülasyonuna uygular.
 * Arka planda loop çalıştırmaz; oyuncu döndüğünde catch-up yapar.
 */

import { realMsToGameHours } from '../config/balance';
import {
  isDeliveryProgressComplete,
  updateDeliveryProgress,
} from './delivery';
import type {
  Delivery,
  Driver,
  FinanceLedgerEntry,
  StoreGameState,
  Truck,
} from '../types/game';

export { realMsToGameHours };

export const OFFLINE_PROGRESS_VERSION = 1;
export const MAX_OFFLINE_PROGRESS_HOURS = 12;
export const MIN_OFFLINE_PROGRESS_MINUTES = 5;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export interface OfflineElapsedResult {
  elapsedMs: number;
  appliedMs: number;
  capped: boolean;
  shouldApply: boolean;
  reason?: 'missing_last_seen' | 'non_positive' | 'below_minimum' | 'ready';
}

export interface OfflineProgressSummary {
  elapsedMs: number;
  appliedMs: number;
  capped: boolean;
  completedDeliveries: number;
  lateDeliveries: number;
  earnings: number;
  expenses: number;
  otherNetChange: number;
  netChange: number;
  driverLevelUps: string[];
  worldEventsUpdated: boolean;
  marketUpdated: boolean;
  dailyCostsApplied: boolean;
  hasMeaningfulChanges: boolean;
  ledgerEntryCount: number;
}

export interface OfflineProgressSnapshot {
  money: number;
  completedContracts: number;
  lateDeliveries: number;
  activeDeliveryCount: number;
  activeDeliveryIds: string[];
  financeLedgerIds: string[];
  drivers: Driver[];
  currentTime: number;
  worldEventCount: number;
  lastWorldEventGeneratedDay: number;
  citiesSignature: string;
}

export interface OfflineLedgerDeltaSummary {
  earnings: number;
  expenses: number;
  deliveryIncomeCount: number;
  ledgerEntryCount: number;
}

const OFFLINE_SUMMARY_INCOME_CATEGORIES = new Set([
  'contract_income',
  'delivery_income',
  'trade_sale',
  'bonus',
  'other_income',
]);

const OFFLINE_SUMMARY_EXPENSE_CATEGORIES = new Set([
  'fuel',
  'maintenance',
  'penalty',
  'daily_operating_cost',
  'driver_salary',
  'warehouse_operating',
  'truck_lease',
  'operations',
  'other_expense',
]);

export function resolveOfflineBaselineMs(
  sources: {
    stateLastSimulated?: number | null;
    metaLastSimulated?: number | null;
    stateLastSeen?: number | null;
    nowMs: number;
  },
): number | null {
  const candidates = [
    sources.stateLastSimulated,
    sources.metaLastSimulated,
    sources.stateLastSeen,
  ].filter(
    (value): value is number =>
      value != null && Number.isFinite(value) && value > 0 && value <= sources.nowMs,
  );

  if (candidates.length === 0) {
    return null;
  }

  return Math.max(...candidates);
}

export interface ApplyOfflineDeliveriesResult {
  deliveries: Delivery[];
  completedIds: string[];
  progressedCount: number;
}

export function calculateOfflineElapsed(
  lastSeenMs: number | undefined | null,
  nowMs: number,
): OfflineElapsedResult {
  if (lastSeenMs == null || !Number.isFinite(lastSeenMs) || lastSeenMs <= 0) {
    return {
      elapsedMs: 0,
      appliedMs: 0,
      capped: false,
      shouldApply: false,
      reason: 'missing_last_seen',
    };
  }

  const rawElapsed = nowMs - lastSeenMs;
  if (rawElapsed <= 0) {
    return {
      elapsedMs: rawElapsed,
      appliedMs: 0,
      capped: false,
      shouldApply: false,
      reason: 'non_positive',
    };
  }

  const minMs = MIN_OFFLINE_PROGRESS_MINUTES * MS_PER_MINUTE;
  if (rawElapsed < minMs) {
    return {
      elapsedMs: rawElapsed,
      appliedMs: 0,
      capped: false,
      shouldApply: false,
      reason: 'below_minimum',
    };
  }

  const maxMs = MAX_OFFLINE_PROGRESS_HOURS * MS_PER_HOUR;
  const capped = rawElapsed > maxMs;
  const appliedMs = capped ? maxMs : rawElapsed;

  return {
    elapsedMs: rawElapsed,
    appliedMs,
    capped,
    shouldApply: true,
    reason: 'ready',
  };
}

export function formatOfflineElapsedDuration(elapsedMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(elapsedMs / MS_PER_MINUTE));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}dk`;
  }
  if (minutes <= 0) {
    return `${hours}s`;
  }
  return `${hours}s ${minutes}dk`;
}

export function createOfflineProgressSnapshot(state: Pick<
  StoreGameState,
  'player' | 'activeDeliveries' | 'currentTime' | 'worldEvents' | 'lastWorldEventGeneratedDay' | 'cities' | 'financeLedger'
>): OfflineProgressSnapshot {
  const cityPrices = state.cities.flatMap((city) =>
    Object.values(city.products ?? {}).map((product) => product.currentPrice ?? 0),
  );
  const activeRouteDeliveries = state.activeDeliveries.filter(
    (delivery) => delivery.status === 'on_route' || delivery.status === 'preparing',
  );
  return {
    money: state.player.money ?? 0,
    completedContracts: state.player.completedContracts ?? 0,
    lateDeliveries: state.player.lateDeliveries ?? 0,
    activeDeliveryCount: activeRouteDeliveries.length,
    activeDeliveryIds: activeRouteDeliveries.map((delivery) => delivery.id),
    financeLedgerIds: (state.financeLedger ?? []).map((entry) => entry.id),
    drivers: structuredClone(state.player.drivers ?? []),
    currentTime: state.currentTime ?? 0,
    worldEventCount: state.worldEvents?.length ?? 0,
    lastWorldEventGeneratedDay: state.lastWorldEventGeneratedDay ?? 0,
    citiesSignature: cityPrices.join(','),
  };
}

export function summarizeOfflineLedgerDelta(
  before: OfflineProgressSnapshot,
  afterLedger: FinanceLedgerEntry[] | undefined,
): OfflineLedgerDeltaSummary {
  const beforeIds = new Set(before.financeLedgerIds);
  const newEntries = (afterLedger ?? []).filter((entry) => !beforeIds.has(entry.id));

  let earnings = 0;
  let expenses = 0;
  let deliveryIncomeCount = 0;

  for (const entry of newEntries) {
    const amount = Math.abs(entry.amount ?? 0);
    if (amount <= 0) {
      continue;
    }
    if (entry.type === 'income') {
      earnings += amount;
      if (
        entry.relatedDeliveryId &&
        (entry.category === 'contract_income' || entry.category === 'delivery_income')
      ) {
        deliveryIncomeCount += 1;
      } else if (OFFLINE_SUMMARY_INCOME_CATEGORIES.has(entry.category)) {
        // counted in earnings
      }
    } else if (entry.type === 'expense') {
      if (
        OFFLINE_SUMMARY_EXPENSE_CATEGORIES.has(entry.category) ||
        entry.category === 'fuel' ||
        entry.category === 'maintenance' ||
        entry.category === 'penalty' ||
        entry.category === 'daily_operating_cost'
      ) {
        expenses += amount;
      } else {
        expenses += amount;
      }
    }
  }

  return {
    earnings,
    expenses,
    deliveryIncomeCount,
    ledgerEntryCount: newEntries.length,
  };
}

export function countOfflineCompletedDeliveries(
  before: OfflineProgressSnapshot,
  after: Pick<StoreGameState, 'player' | 'activeDeliveries'>,
  ledgerDelta: OfflineLedgerDeltaSummary,
): number {
  const afterActiveIds = new Set(
    after.activeDeliveries
      .filter(
        (delivery) => delivery.status === 'on_route' || delivery.status === 'preparing',
      )
      .map((delivery) => delivery.id),
  );
  const removedActiveCount = before.activeDeliveryIds.filter((id) => !afterActiveIds.has(id)).length;
  const completedContractsDelta = Math.max(
    0,
    (after.player.completedContracts ?? 0) - before.completedContracts,
  );
  return Math.max(completedContractsDelta, ledgerDelta.deliveryIncomeCount, removedActiveCount);
}

export function validateOfflineSummaryConsistency(summary: OfflineProgressSummary): boolean {
  const expectedNet = summary.earnings - summary.expenses + summary.otherNetChange;
  const netMatches = Math.abs(expectedNet - summary.netChange) <= 1;
  const earningsConsistent = summary.completedDeliveries <= 0 || summary.earnings > 0;
  return netMatches && earningsConsistent;
}

/**
 * Offline catch-up teslimat ilerlemesi — incident / rastgele arıza üretmez.
 */
export function applyOfflineDeliveries(
  deliveries: Delivery[],
  elapsedGameHours: number,
): ApplyOfflineDeliveriesResult {
  if (elapsedGameHours <= 0) {
    return { deliveries, completedIds: [], progressedCount: 0 };
  }

  const completedIds: string[] = [];
  let progressedCount = 0;

  const updated = deliveries.map((delivery) => {
    if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
      return delivery;
    }

    const beforeProgress = delivery.progress ?? 0;
    let updatedDelivery = updateDeliveryProgress(delivery, elapsedGameHours);

    if ((updatedDelivery.progress ?? 0) > beforeProgress) {
      progressedCount += 1;
    }

    if (updatedDelivery.incident?.status === 'pending') {
      updatedDelivery = {
        ...updatedDelivery,
        incident: undefined,
        incidentGenerated: true,
        incidentResolved: true,
      };
    }

    if (isDeliveryProgressComplete(updatedDelivery.progress)) {
      completedIds.push(updatedDelivery.id);
    }

    return updatedDelivery;
  });

  return { deliveries: updated, completedIds, progressedCount };
}

export function detectDriverLevelUps(before: Driver[], after: Driver[]): string[] {
  const beforeById = new Map(before.map((driver) => [driver.id, driver]));
  const levelUps: string[] = [];

  for (const driver of after) {
    const previous = beforeById.get(driver.id);
    const prevLevel = previous?.level ?? 1;
    const nextLevel = driver.level ?? 1;
    if (nextLevel > prevLevel) {
      levelUps.push(`${driver.name} → Lv.${nextLevel}`);
    }
  }

  return levelUps;
}

export function buildOfflineProgressSummary(
  before: OfflineProgressSnapshot,
  after: Pick<
    StoreGameState,
    'player' | 'activeDeliveries' | 'currentTime' | 'worldEvents' | 'lastWorldEventGeneratedDay' | 'cities' | 'financeLedger'
  >,
  elapsed: OfflineElapsedResult,
  extras: {
    earnings?: number;
    expenses?: number;
    completedDeliveries?: number;
    lateDeliveries?: number;
    worldEventsUpdated?: boolean;
    marketUpdated?: boolean;
    dailyCostsApplied?: boolean;
  } = {},
): OfflineProgressSummary {
  const ledgerDelta = summarizeOfflineLedgerDelta(before, after.financeLedger);
  const earnings = Math.max(ledgerDelta.earnings, extras.earnings ?? 0);
  const expenses = Math.max(ledgerDelta.expenses, extras.expenses ?? 0);
  const completedDeliveries = Math.max(
    countOfflineCompletedDeliveries(before, after, ledgerDelta),
    extras.completedDeliveries ?? 0,
    Math.max(0, (after.player.completedContracts ?? 0) - before.completedContracts),
  );
  const lateDeliveries =
    extras.lateDeliveries ??
    Math.max(0, (after.player.lateDeliveries ?? 0) - before.lateDeliveries);
  const netChange = (after.player.money ?? 0) - before.money;
  const otherNetChange = netChange - (earnings - expenses);
  const driverLevelUps = detectDriverLevelUps(before.drivers, after.player.drivers ?? []);
  const worldEventsUpdated =
    extras.worldEventsUpdated ??
    ((after.worldEvents?.length ?? 0) !== before.worldEventCount ||
      (after.lastWorldEventGeneratedDay ?? 0) !== before.lastWorldEventGeneratedDay);
  const afterCityPrices = after.cities.flatMap((city) =>
    Object.values(city.products ?? {}).map((product) => product.currentPrice ?? 0),
  );
  const marketUpdated =
    extras.marketUpdated ?? afterCityPrices.join(',') !== before.citiesSignature;
  const dailyCostsApplied = extras.dailyCostsApplied ?? false;

  const hasMeaningfulChanges =
    completedDeliveries > 0 ||
    lateDeliveries > 0 ||
    Math.abs(netChange) >= 1 ||
    driverLevelUps.length > 0 ||
    worldEventsUpdated ||
    marketUpdated ||
    dailyCostsApplied ||
    (after.currentTime ?? 0) - before.currentTime >= 1;

  return {
    elapsedMs: elapsed.elapsedMs,
    appliedMs: elapsed.appliedMs,
    capped: elapsed.capped,
    completedDeliveries,
    lateDeliveries,
    earnings,
    expenses,
    otherNetChange,
    netChange,
    driverLevelUps,
    worldEventsUpdated,
    marketUpdated,
    dailyCostsApplied,
    hasMeaningfulChanges,
    ledgerEntryCount: ledgerDelta.ledgerEntryCount,
  };
}

export function shouldShowOfflineSummary(summary: OfflineProgressSummary): boolean {
  return summary.hasMeaningfulChanges && summary.appliedMs > 0;
}

export function shouldSkipDuplicateOfflineApply(
  lastSeenMs: number | undefined | null,
  lastAppliedAtMs: number | undefined | null,
  nowMs: number,
): boolean {
  if (lastAppliedAtMs == null || lastSeenMs == null) {
    return false;
  }
  if (lastAppliedAtMs >= nowMs) {
    return true;
  }
  return lastAppliedAtMs >= lastSeenMs && nowMs - lastAppliedAtMs < MIN_OFFLINE_PROGRESS_MINUTES * MS_PER_MINUTE;
}

export function normalizeOfflineProgressFields(
  state: Partial<StoreGameState>,
  nowMs = Date.now(),
): Pick<StoreGameState, 'lastSeenRealTimeMs' | 'lastOfflineProgressAppliedAt' | 'offlineProgressVersion'> {
  return {
    lastSeenRealTimeMs:
      state.lastSeenRealTimeMs != null && Number.isFinite(state.lastSeenRealTimeMs)
        ? state.lastSeenRealTimeMs
        : nowMs,
    lastOfflineProgressAppliedAt:
      state.lastOfflineProgressAppliedAt != null &&
      Number.isFinite(state.lastOfflineProgressAppliedAt)
        ? state.lastOfflineProgressAppliedAt
        : undefined,
    offlineProgressVersion: state.offlineProgressVersion ?? OFFLINE_PROGRESS_VERSION,
  };
}

export function summarizeOfflineWorldEventDayAdvance(
  beforeDay: number,
  afterDay: number,
): boolean {
  return afterDay > beforeDay;
}

export function countActiveRouteDeliveries(trucks: Truck[], deliveries: Delivery[]): number {
  const busyTruckIds = new Set(
    trucks.filter((truck) => truck.status === 'on_route').map((truck) => truck.id),
  );
  return deliveries.filter(
    (delivery) =>
      (delivery.status === 'on_route' || delivery.status === 'preparing') &&
      busyTruckIds.has(delivery.truckId),
  ).length;
}
