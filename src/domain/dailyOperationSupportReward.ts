import { operatingCostBalance } from '../config/balance';
import { calculateDailyOperatingCostBreakdown } from '../simulation/dailyOperatingCosts';
import type { Player } from '../types/game';

export const DAILY_OPERATION_SUPPORT_REWARD_MULTIPLIER = 1.25;
export const MIN_DAILY_OPERATION_SUPPORT_REWARD = 500;
export const DAILY_OPERATION_SUPPORT_REWARD_ROUND_STEP = 50;

export type DailyOperationSupportPlayerInput = Pick<
  Player,
  'drivers' | 'warehouses' | 'trucks'
>;

export function roundUpToNearest(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return step;
  }
  if (!Number.isFinite(step) || step <= 0) {
    return Math.ceil(value);
  }
  return Math.ceil(value / step) * step;
}

/** Günlük zorunlu operasyon gideri — kira peşin tahsil edildiği için günlük cash kesintisine dahil değil. */
export function calculateDailyMandatoryOperatingCost(
  player: DailyOperationSupportPlayerInput,
): number {
  return calculateDailyOperatingCostBreakdown(player).total;
}

/**
 * Canonical günlük operasyon desteği ödülü.
 * UI, reklam grant ve finance history aynı helper'ı kullanmalı.
 */
export function calculateDailyOperationSupportReward(
  player: DailyOperationSupportPlayerInput,
): number {
  const mandatoryDailyCost = calculateDailyMandatoryOperatingCost(player);
  const rawReward = mandatoryDailyCost * DAILY_OPERATION_SUPPORT_REWARD_MULTIPLIER;
  const roundedReward = roundUpToNearest(rawReward, DAILY_OPERATION_SUPPORT_REWARD_ROUND_STEP);
  return Math.max(MIN_DAILY_OPERATION_SUPPORT_REWARD, roundedReward);
}

/** Regression / smoke testler için başlangıç oyuncusu günlük zorunlu gider tahmini. */
export function estimateStarterPlayerMandatoryDailyCost(): number {
  return calculateDailyMandatoryOperatingCost({
    drivers: [
      {
        id: 'starter-driver',
        dailySalary: operatingCostBalance.fallbackDriverDailySalary,
        salaryPerDay: operatingCostBalance.fallbackDriverDailySalary,
      } as Player['drivers'][number],
    ],
    warehouses: [
      {
        id: 'starter-warehouse',
        cityId: 'izmir',
        capacityTons: 100,
        dailyOperatingCost: operatingCostBalance.fallbackWarehouseDailyCost,
      } as Player['warehouses'][number],
    ],
    trucks: [
      {
        id: 'starter-truck',
        ownershipType: 'owned',
      } as Player['trucks'][number],
    ],
  });
}
