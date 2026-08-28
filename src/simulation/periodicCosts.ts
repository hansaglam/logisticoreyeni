/**
 * Periyodik 24s sabit giderler — gerçek timestamp, idempotent periodKey.
 * Oyuncu kişisel gününe bağlı değildir.
 */

import { operatingCostBalance } from '../config/balance';
import { DAY_MS, getEconomyNow } from './economyClock';
import { calculateDailyOperatingCostBreakdown } from './dailyOperatingCosts';
import type { Player } from '../types/game';

export const PERIOD_24H_MS = DAY_MS;

/** Offline catch-up: fixed operating costs are never charged (store product rule). */
export const OFFLINE_CATCHUP_MAX_COST_PERIODS = 0;

/** Online advanceTime: at most one 24h economy period per invocation. */
export const ONLINE_TICK_MAX_COST_PERIODS = 1;

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
    Math.floor(
      params.maxOfflineCostPeriods ??
        operatingCostBalance.maxOfflineChargeDays ??
        0,
    ),
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

  const elapsedPeriods = Math.floor((now - last) / PERIOD_24H_MS);
  if (elapsedPeriods <= 0) {
    return { periodsElapsed: 0, periodStarts: [], capped: false };
  }

  // Offline catch-up: enumerate elapsed debt for metadata, never charge.
  if (maxPeriods <= 0) {
    return {
      periodsElapsed: elapsedPeriods,
      periodStarts: [],
      capped: true,
    };
  }

  const periodsToProcess = Math.min(elapsedPeriods, maxPeriods);
  const capped = elapsedPeriods > maxPeriods;
  const periodStarts: number[] = [];
  for (let index = 0; index < periodsToProcess; index += 1) {
    periodStarts.push(last + index * PERIOD_24H_MS);
  }

  return {
    periodsElapsed: elapsedPeriods,
    periodStarts,
    capped,
  };
}

function resolveNewlyProcessedUntil(params: {
  economyNowMs: number;
  previousProcessedAt: number;
  periodsElapsed: number;
  periodSlotsProcessed: number;
  maxPeriods: number;
}): number {
  const {
    economyNowMs,
    previousProcessedAt,
    periodsElapsed,
    periodSlotsProcessed,
    maxPeriods,
  } = params;

  if (economyNowMs <= previousProcessedAt || periodsElapsed <= 0) {
    return previousProcessedAt;
  }

  // Offline: forgive historical debt and jump to now once any full period elapsed.
  if (maxPeriods <= 0) {
    return economyNowMs;
  }

  if (periodSlotsProcessed <= 0) {
    return previousProcessedAt;
  }

  return previousProcessedAt + periodSlotsProcessed * PERIOD_24H_MS;
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
  const maxPeriods = Math.max(
    0,
    Math.floor(
      params.maxOfflineCostPeriods ??
        operatingCostBalance.maxOfflineChargeDays ??
        0,
    ),
  );
  const previousProcessedAt =
    params.lastProcessedEconomyAt != null &&
    Number.isFinite(params.lastProcessedEconomyAt)
      ? params.lastProcessedEconomyAt
      : economyNowMs;

  const { periodsElapsed, periodStarts, capped } = calculatePeriodicCostPeriods({
    economyNowMs,
    lastProcessedEconomyAt: params.lastProcessedEconomyAt,
    maxOfflineCostPeriods: params.maxOfflineCostPeriods,
  });

  const newlyProcessedUntil = resolveNewlyProcessedUntil({
    economyNowMs,
    previousProcessedAt,
    periodsElapsed,
    periodSlotsProcessed: periodStarts.length,
    maxPeriods,
  });

  if (periodStarts.length === 0) {
    if (
      operatingCostBalance.economyAuditLogsEnabled &&
      periodsElapsed > 0 &&
      maxPeriods <= 0
    ) {
      logTimeProgressionAudit({
        kind: 'periodic_cost_skip',
        previousCursor: previousProcessedAt,
        now: economyNowMs,
        elapsedPeriods: periodsElapsed,
        periodsToProcess: 0,
        newCursor: newlyProcessedUntil,
        maxPeriods,
      });
    }

    return {
      periodsElapsed,
      periodsCharged: 0,
      capped,
      deductions: [],
      totalAmount: 0,
      newlyProcessedUntil,
      periodKeysApplied: [],
    };
  }

  const applied = new Set(params.alreadyAppliedPeriodKeys ?? []);
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

  if (operatingCostBalance.economyAuditLogsEnabled) {
    logTimeProgressionAudit({
      kind: 'periodic_cost_apply',
      previousCursor: previousProcessedAt,
      now: economyNowMs,
      elapsedPeriods: periodsElapsed,
      periodsToProcess: periodStarts.length,
      periodsCharged: periodKeysApplied.length,
      newCursor: newlyProcessedUntil,
      maxPeriods,
    });
  }

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

export function logTimeProgressionAudit(payload: object): void {
  if (!operatingCostBalance.economyAuditLogsEnabled && !__DEV__) {
    return;
  }
  if (!operatingCostBalance.economyAuditLogsEnabled) {
    return;
  }
  console.log('[time-progression-audit]', payload);
}

/** Backward-compatible export for older diagnostics. */
export const logOfflineEconomyAudit = logTimeProgressionAudit;
