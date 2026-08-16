/**
 * Şirket puanı (Company Score) v2 — haftalık leaderboard ile aynı formül.
 *
 * Varsayılan itibar (50) nötrdür. 0 teslimatlı hesaplar sıralamaya girmez.
 * Nakit 1:1 katkı vermez. Kiralık/ilanlı araçlar varlık puanına sayılmaz.
 *
 * Backend: backend/src/leaderboardScore.ts — sayıları senkron tut.
 */

import { warehouseBalance } from '../config/balance';
import { CITIES_BY_ID } from '../data/cities';
import {
  isLeaderboardRankedEligible,
  LEADERBOARD_MIN_COMPLETED_DELIVERIES,
} from '../domain/leaderboardRankEligibility';
import { getProductByIdSafe } from '../utils/entityLookup';
import type {
  City,
  CompanyScoreBreakdown,
  FinanceLedgerEntry,
  Product,
  StoreGameState,
  Truck,
  Warehouse,
} from '../types/game';
import { getCityProductMarketPrice, normalizeWarehouse } from './trading';

export type { CompanyScoreBreakdown } from '../types/game';

export const COMPANY_SCORE_VERSION = 2;
export { LEADERBOARD_MIN_COMPLETED_DELIVERIES, isLeaderboardRankedEligible };

const SCORE = {
  deliveryLinear: 380,
  deliveryLogScale: 2_200,
  successfulBonus: 90,
  failedPenalty: 320,
  latePenalty: 110,
  maxDeliveryScore: 45_000,
  levelLinear: 720,
  levelSqrt: 380,
  maxProgressionScore: 22_000,
  reputationBaseline: 50,
  reputationRange: 50,
  reputationAmplitude: 7_200,
  reputationPenaltyCapRatio: 0.28,
  maxReputationAbs: 7_200,
  assetSqrt: 26,
  assetLog: 140,
  assetLogDivisor: 8_000,
  maxAssetScore: 24_000,
  warehouseCapacityValue: 80,
  warehouseTierBonusRate: 0.15,
  cashSqrt: 7,
  cashSoftCap: 80_000,
  cashOverflowLog: 400,
  maxFinanceScore: 8_000,
  weeklyLinear: 520,
  weeklyLog: 900,
  maxWeeklyScore: 12_000,
  maxTotalScore: 120_000,
  maxFleetValue: 50_000_000,
  maxWarehouseValue: 20_000_000,
} as const;

export type CompanyScoreGameState = Pick<
  StoreGameState,
  'player' | 'cities' | 'products' | 'financeLedger' | 'currentTime'
> & {
  weeklyCompletedDeliveries?: number;
};

export function safeScore(value: unknown): number {
  if (typeof value !== 'number') {
    return 0;
  }
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function formatCompanyScore(value: number): string {
  const rounded = safeScore(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('en-US')}`;
}

export function isCompanyScoreRankedEligible(completedDeliveries: number): boolean {
  return isLeaderboardRankedEligible(completedDeliveries);
}

export function calculateTruckValue(trucks: Truck[] | undefined): number {
  const total = (trucks ?? []).reduce((sum, truck) => {
    if (truck.leaseExpired) return sum;
    if ((truck.ownershipType ?? 'owned') !== 'owned') return sum;
    if (truck.status === 'marketplace_locked') return sum;
    const purchasePrice = truck.purchasePrice ?? 0;
    const condition = Math.max(0, Math.min(100, truck.condition ?? 100));
    return sum + purchasePrice * (condition / 100);
  }, 0);
  return Math.min(SCORE.maxFleetValue, Number.isFinite(total) ? total : 0);
}

export function calculateWarehouseValue(warehouses: Warehouse[] | undefined): number {
  const total = (warehouses ?? []).reduce((sum, warehouse) => {
    const capacity = warehouse.capacityTons ?? 0;
    const tier = Math.max(1, warehouse.upgradeTier ?? 1);
    const tierBonus = 1 + (tier - 1) * SCORE.warehouseTierBonusRate;
    return sum + capacity * SCORE.warehouseCapacityValue * tierBonus;
  }, 0);
  return Math.min(SCORE.maxWarehouseValue, Number.isFinite(total) ? total : 0);
}

export function calculateInventoryValue(
  warehouses: Warehouse[] | undefined,
  cities: City[] | undefined,
  _products: Product[] | undefined,
): number {
  const cityById = new Map((cities ?? []).map((city) => [city.id, city]));

  let total = 0;
  for (const warehouse of warehouses ?? []) {
    const city = cityById.get(warehouse.cityId) ?? CITIES_BY_ID[warehouse.cityId];
    const inventory = normalizeWarehouse(warehouse).inventory ?? [];

    for (const item of inventory) {
      const quantity = item.quantity ?? 0;
      if (quantity <= 0) continue;

      const product = getProductByIdSafe(item.productId);
      if (!product) continue;

      const unitPrice = city ? getCityProductMarketPrice(city, item.productId) : 0;
      const safePrice = Number.isFinite(unitPrice) ? unitPrice : 0;
      total += quantity * safePrice;
    }
  }

  return Number.isFinite(total) ? total : 0;
}

export function calculateWeeklyTradeProfit(
  financeLedger: FinanceLedgerEntry[] | undefined,
  currentTime: number,
): number {
  const windowStart = currentTime - 168;
  let purchases = 0;
  let sales = 0;

  for (const entry of financeLedger ?? []) {
    if (entry.time < windowStart) continue;
    if (
      (entry.category === 'trade_purchase' || entry.category === 'market_purchase') &&
      entry.type === 'expense'
    ) {
      purchases += entry.amount ?? 0;
    }
    if (
      (entry.category === 'trade_sale' || entry.category === 'market_sale') &&
      entry.type === 'income'
    ) {
      sales += entry.amount ?? 0;
    }
  }

  return sales - purchases;
}

function scaleAssetValue(value: number): number {
  const safe = Math.max(0, value);
  return SCORE.assetSqrt * Math.sqrt(safe) + SCORE.assetLog * Math.log1p(safe / SCORE.assetLogDivisor);
}

function scaleCash(cash: number): number {
  const normalized = Math.max(0, cash);
  const capped = Math.min(normalized, SCORE.cashSoftCap);
  let score = SCORE.cashSqrt * Math.sqrt(capped);
  if (normalized > SCORE.cashSoftCap) {
    score += SCORE.cashOverflowLog * Math.log1p((normalized - SCORE.cashSoftCap) / SCORE.cashSoftCap);
  }
  return score;
}

export function getCompanyScoreBreakdown(state: CompanyScoreGameState): CompanyScoreBreakdown {
  const player = state.player;
  const trucks = player?.trucks ?? [];
  const warehouses = player?.warehouses ?? [];
  const cash = Math.max(0, player?.money ?? 0);
  const completedContracts = Math.max(0, player?.completedContracts ?? 0);
  const reputation = Math.max(0, Math.min(100, player?.reputation ?? 0));
  const level = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const failedDeliveries = Math.max(0, player?.failedDeliveries ?? 0);
  const lateDeliveries = Math.max(0, player?.lateDeliveries ?? 0);
  const weeklyCompletedDeliveries = Math.max(0, state.weeklyCompletedDeliveries ?? 0);

  const truckValue = calculateTruckValue(trucks);
  const warehouseValue = calculateWarehouseValue(warehouses);
  const inventoryValue = calculateInventoryValue(warehouses, state.cities, state.products);
  const weeklyTradeProfit = calculateWeeklyTradeProfit(
    state.financeLedger,
    state.currentTime ?? 0,
  );

  const successfulDeliveries = Math.max(0, completedContracts - failedDeliveries);
  const deliveryScore = clamp(
    safeScore(
      completedContracts * SCORE.deliveryLinear +
        SCORE.deliveryLogScale * Math.log1p(completedContracts) +
        successfulDeliveries * SCORE.successfulBonus -
        failedDeliveries * SCORE.failedPenalty -
        lateDeliveries * SCORE.latePenalty,
    ),
    0,
    SCORE.maxDeliveryScore,
  );
  const penaltyCostScore = safeScore(
    failedDeliveries * SCORE.failedPenalty + lateDeliveries * SCORE.latePenalty,
  );
  const penaltyScore = safeScore(-penaltyCostScore);

  const levelOffset = Math.max(0, level - 1);
  const progressionScore = clamp(
    safeScore(levelOffset * SCORE.levelLinear + SCORE.levelSqrt * Math.sqrt(levelOffset)),
    0,
    SCORE.maxProgressionScore,
  );

  const truckValueScore = safeScore(scaleAssetValue(truckValue));
  const warehouseValueScore = safeScore(scaleAssetValue(warehouseValue));
  const assetScore = clamp(truckValueScore + warehouseValueScore, 0, SCORE.maxAssetScore);

  const quality = clamp(
    (reputation - SCORE.reputationBaseline) / SCORE.reputationRange,
    -1,
    1,
  );
  let reputationScore = safeScore(quality * SCORE.reputationAmplitude);
  if (reputationScore < 0) {
    const penaltyCap = -safeScore(
      SCORE.reputationPenaltyCapRatio * (deliveryScore + progressionScore + assetScore),
    );
    reputationScore = Math.max(reputationScore, penaltyCap);
  }
  reputationScore = clamp(reputationScore, -SCORE.maxReputationAbs, SCORE.maxReputationAbs);

  const financeScore = clamp(safeScore(scaleCash(cash)), 0, SCORE.maxFinanceScore);
  const weeklyActivityScore = clamp(
    safeScore(
      weeklyCompletedDeliveries * SCORE.weeklyLinear +
        SCORE.weeklyLog * Math.log1p(weeklyCompletedDeliveries),
    ),
    0,
    SCORE.maxWeeklyScore,
  );

  const totalScore = clamp(
    safeScore(
      deliveryScore +
        progressionScore +
        reputationScore +
        assetScore +
        financeScore +
        weeklyActivityScore,
    ),
    0,
    SCORE.maxTotalScore,
  );

  return {
    deliveryScore,
    progressionScore,
    reputationScore,
    assetScore,
    financeScore,
    weeklyActivityScore,
    cashScore: financeScore,
    truckValueScore,
    warehouseValueScore,
    inventoryValueScore: 0,
    completedContractsScore: deliveryScore,
    levelScore: progressionScore,
    weeklyTradeProfitScore: weeklyActivityScore,
    penaltyScore,
    penaltyCostScore,
    totalScore,
    rankedEligible: isCompanyScoreRankedEligible(completedContracts),
    truckValue: safeScore(truckValue),
    warehouseValue: safeScore(warehouseValue),
    inventoryValue: safeScore(inventoryValue),
    weeklyTradeProfit: safeScore(weeklyTradeProfit),
    failedDeliveries,
    lateDeliveries,
  };
}

export function calculateCompanyScore(state: CompanyScoreGameState): number {
  return getCompanyScoreBreakdown(state).totalScore;
}

/** Finans ekranı depo değeri (skor değil). */
export function calculateWarehouseBookValue(warehouses: Warehouse[] | undefined): number {
  return (warehouses ?? []).reduce((sum, warehouse) => {
    const capacity = warehouse.capacityTons ?? 0;
    return sum + capacity * warehouseBalance.capacityValueMultiplier;
  }, 0);
}
