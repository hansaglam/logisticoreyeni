/**
 * Periyodik 24s sabit giderler — gerçek timestamp, idempotent periodKey.
 * Oyuncu kişisel gününe bağlı değildir.
 */

import { operatingCostBalance } from '../config/balance';
import { getEconomyNow, MS_PER_24H } from './economyClock';
import { calculateDailyOperatingCostBreakdown } from './dailyOperatingCosts';
import type { Player } from '../types/game';

export const PERIOD_24H_MS = MS_PER_24H;

export interface PeriodicCostDeduction {
  type: 'driver_salary' | 'warehouse_operating' | 'operations' | 'other';
  amount: number;
  periodKey: string;
  referenceId: string;
}

export interface PeriodicCostApplicationResult {
  periodsElapsed: number;
  periodsCharged: number;
  capped: boolean;
  deductions: PeriodicCostDeduction[];
  totalAmount: number;
  newlyProcessedUntil: number;
  periodKeysApplied: string[];
}

export function periodKeyForStart(periodStartMs: number): string {
  return `p24_${Math.floor(periodStartMs / PERIOD_24H_MS)}`;
}

export function calculatePeriodicCostPeriods(params: {
  economyNowMs: number;
  lastProcessedEconomyAt: number | null | undefined;
  maxOfflineCostPeriods?: number;
  alreadyAppliedPeriodKeys?: Iterable<string>;
}): {
  periodsElapsed: number;
  periodStarts: number[];
  capped: boolean;
} {
  const maxPeriods = Math.max(
    0,
    params.maxOfflineCostPeriods ?? operatingCostBalance.maxOfflineChargeDays ?? 0,
  );
  const now = Math.max(0, params.economyNowMs);
  const last =
    params.lastProcessedEconomyAt != null &&
    Number.isFinite(params.lastProcessedEconomyAt) &&
    params.lastProcessedEconomyAt > 0
      ? params.lastProcessedEconomyAt
      : now;

  if (now <= last) {
    return { periodsElapsed: 0, periodStarts: [], capped: false };
  }

  // Offline sabit gider kapalı (maxPeriods=0). Not: Array#slice(-0) tüm diziye eşittir.
  if (maxPeriods <= 0) {
    return { periodsElapsed: 0, periodStarts: [], capped: false };
  }

  const firstPeriodStart = Math.floor(last / PERIOD_24H_MS) * PERIOD_24H_MS;
  // last tam period sınırındaysa bir sonraki period'dan başla
  let cursor =
    last > firstPeriodStart ? firstPeriodStart + PERIOD_24H_MS : firstPeriodStart;
  if (cursor <= last) {
    cursor = Math.floor(last / PERIOD_24H_MS) * PERIOD_24H_MS + PERIOD_24H_MS;
  }

  const allStarts: number[] = [];
  while (cursor + PERIOD_24H_MS <= now) {
    allStarts.push(cursor);
    cursor += PERIOD_24H_MS;
  }

  const capped = allStarts.length > maxPeriods;
  const periodStarts = capped ? allStarts.slice(-maxPeriods) : allStarts;

  return {
    periodsElapsed: allStarts.length,
    periodStarts,
    capped,
  };
}

/**
 * Idempotent periyodik maliyet — aynı periodKey iki kez uygulanmaz.
 */
export function buildPeriodicCostDeductions(params: {
  player: Pick<Player, 'drivers' | 'warehouses' | 'trucks'>;
  economyNowMs?: number;
  lastProcessedEconomyAt: number | null | undefined;
  alreadyAppliedPeriodKeys?: Iterable<string>;
  maxOfflineCostPeriods?: number;
}): PeriodicCostApplicationResult {
  const economyNowMs = params.economyNowMs ?? getEconomyNow();
  const applied = new Set(params.alreadyAppliedPeriodKeys ?? []);
  const { periodsElapsed, periodStarts, capped } = calculatePeriodicCostPeriods({
    economyNowMs,
    lastProcessedEconomyAt: params.lastProcessedEconomyAt,
    maxOfflineCostPeriods: params.maxOfflineCostPeriods,
  });

  const breakdown = calculateDailyOperatingCostBreakdown(params.player);
  const deductions: PeriodicCostDeduction[] = [];

  for (const periodStart of periodStarts) {
    const periodKey = periodKeyForStart(periodStart);
    if (applied.has(periodKey)) {
      continue;
    }
    applied.add(periodKey);

    if (breakdown.driverSalaries > 0) {
      deductions.push({
        type: 'driver_salary',
        amount: breakdown.driverSalaries,
        periodKey,
        referenceId: `${periodKey}:driver`,
      });
    }
    if (breakdown.warehouseOperating > 0) {
      deductions.push({
        type: 'warehouse_operating',
        amount: breakdown.warehouseOperating,
        periodKey,
        referenceId: `${periodKey}:warehouse`,
      });
    }
    if (breakdown.operations > 0) {
      deductions.push({
        type: 'operations',
        amount: breakdown.operations,
        periodKey,
        referenceId: `${periodKey}:ops`,
      });
    }
  }

  const totalAmount = deductions.reduce((sum, d) => sum + d.amount, 0);
  const periodKeysApplied = [...new Set(deductions.map((d) => d.periodKey))];
  const newlyProcessedUntil =
    periodKeysApplied.length > 0
      ? Math.max(
          ...periodKeysApplied.map((key) => {
            const n = Number(key.replace('p24_', ''));
            return (n + 1) * PERIOD_24H_MS;
          }),
        )
      : params.lastProcessedEconomyAt ?? economyNowMs;

  return {
    periodsElapsed,
    periodsCharged: periodKeysApplied.length,
    capped,
    deductions,
    totalAmount,
    newlyProcessedUntil,
    periodKeysApplied,
  };
}

export function logOfflineEconomyAudit(payload: Record<string, unknown>): void {
  if (!operatingCostBalance.economyAuditLogsEnabled && !__DEV__) {
    return;
  }
  if (!operatingCostBalance.economyAuditLogsEnabled) {
    return;
  }
  console.log('[offline-economy-audit]', payload);
}
