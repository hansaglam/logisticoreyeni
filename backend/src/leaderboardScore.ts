/**
 * Backend-authoritative liderlik skoru.
 *
 * Client raw score kabul edilmez. Skor yalnız trusted cloud-save player state'ten üretilir.
 * Nakit tek başına sınırsız skor üretmez (soft-cap).
 */

export const LEADERBOARD_SCORE_BALANCE = {
  levelBonusPerLevel: 5_000,
  reputationBonusPerPoint: 1_000,
  completedContractBonus: 1_500,
  truckValueWeight: 0.85,
  warehouseValueWeight: 0.75,
  warehouseTierBonusRate: 0.15,
  warehouseCapacityValueMultiplier: 120,
  networkHubBonus: 2_500,
  weeklyTradeProfitWeight: 0.5,
  weeklyHours: 168,
  failedDeliveryPenalty: 5_000,
  lateDeliveryPenalty: 2_000,
  /** Soft-cap: bu eşiğe kadar nakit 1:1 katkı; fazlası logaritmik. */
  cashSoftCap: 2_000_000,
  cashOverflowScale: 80_000,
  maxLevel: 100,
  maxReputation: 100,
  maxCompletedContracts: 50_000,
  maxFleetValue: 50_000_000,
  maxWarehouseValue: 20_000_000,
  maxWeeklyTradeProfit: 5_000_000,
  maxTotalScore: 100_000_000,
} as const;

export interface LeaderboardScoreBreakdown {
  levelScore: number;
  reputationScore: number;
  deliveryScore: number;
  fleetScore: number;
  warehouseNetworkScore: number;
  financialScore: number;
  penaltyScore: number;
  totalScore: number;
  level: number;
  reputation: number;
  completedContracts: number;
  companyName: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function safeRound(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function softCapCash(cash: number): number {
  const normalized = Math.max(0, cash);
  if (normalized <= LEADERBOARD_SCORE_BALANCE.cashSoftCap) {
    return normalized;
  }
  const overflow = normalized - LEADERBOARD_SCORE_BALANCE.cashSoftCap;
  return (
    LEADERBOARD_SCORE_BALANCE.cashSoftCap +
    LEADERBOARD_SCORE_BALANCE.cashOverflowScale * Math.log1p(overflow / LEADERBOARD_SCORE_BALANCE.cashSoftCap)
  );
}

function calculateFleetValue(trucks: unknown[]): number {
  let total = 0;
  for (const raw of trucks) {
    const truck = record(raw);
    if (truck.leaseExpired === true) continue;
    const ownershipType = typeof truck.ownershipType === 'string' ? truck.ownershipType : 'owned';
    const ownershipMultiplier = ownershipType === 'leased' ? 0.35 : 1;
    const purchasePrice = Math.max(0, finite(truck.purchasePrice));
    const condition = clamp(finite(truck.condition, 100), 0, 100);
    total += purchasePrice * (condition / 100) * ownershipMultiplier;
  }
  return clamp(total, 0, LEADERBOARD_SCORE_BALANCE.maxFleetValue);
}

function calculateWarehouseNetworkValue(warehouses: unknown[]): number {
  let total = 0;
  const cityIds = new Set<string>();
  for (const raw of warehouses) {
    const warehouse = record(raw);
    const capacity = Math.max(0, finite(warehouse.capacityTons));
    const tier = Math.max(1, finite(warehouse.upgradeTier, 1));
    const tierBonus = 1 + (tier - 1) * LEADERBOARD_SCORE_BALANCE.warehouseTierBonusRate;
    total +=
      capacity *
      LEADERBOARD_SCORE_BALANCE.warehouseCapacityValueMultiplier *
      tierBonus;
    if (typeof warehouse.cityId === 'string' && warehouse.cityId.length > 0) {
      cityIds.add(warehouse.cityId);
    }
  }
  total += cityIds.size * LEADERBOARD_SCORE_BALANCE.networkHubBonus;
  return clamp(total, 0, LEADERBOARD_SCORE_BALANCE.maxWarehouseValue);
}

function calculateWeeklyTradeProfit(
  financeLedger: unknown[],
  currentTime: number,
): number {
  const windowStart = currentTime - LEADERBOARD_SCORE_BALANCE.weeklyHours;
  let purchases = 0;
  let sales = 0;
  for (const raw of financeLedger) {
    const entry = record(raw);
    const time = finite(entry.time);
    if (time < windowStart) continue;
    const amount = Math.max(0, finite(entry.amount));
    const category = typeof entry.category === 'string' ? entry.category : '';
    const type = typeof entry.type === 'string' ? entry.type : '';
    if (
      (category === 'trade_purchase' || category === 'market_purchase') &&
      type === 'expense'
    ) {
      purchases += amount;
    }
    if (
      (category === 'trade_sale' || category === 'market_sale') &&
      type === 'income'
    ) {
      sales += amount;
    }
  }
  return clamp(
    sales - purchases,
    -LEADERBOARD_SCORE_BALANCE.maxWeeklyTradeProfit,
    LEADERBOARD_SCORE_BALANCE.maxWeeklyTradeProfit,
  );
}

import type { ServerStateDocument } from './serverStateTypes';

export type CanonicalPlayerStateBuildResult =
  | { ok: true; player: Record<string, unknown>; gameState: Record<string, unknown> }
  | { ok: false; reason: 'save-not-found' | 'invalid-player-state' | 'server-state-not-initialized' };

/**
 * Trusted cloud-save belgesinden canonical player görünümü çıkarır.
 * @deprecated Marketplace/leaderboard artık serverState kullanır.
 */
export function extractCanonicalPlayerState(
  save: Record<string, unknown> | null | undefined,
): CanonicalPlayerStateBuildResult {
  if (!save) {
    return { ok: false, reason: 'save-not-found' };
  }
  const gameState = record(save.gameState);
  const player = record(gameState.player);
  if (!Array.isArray(player.trucks)) {
    return { ok: false, reason: 'invalid-player-state' };
  }
  const money = finite(player.money, Number.NaN);
  if (!Number.isFinite(money)) {
    return { ok: false, reason: 'invalid-player-state' };
  }
  return { ok: true, player, gameState };
}

/**
 * Server-owned canonical state → leaderboard player görünümü.
 */
export function extractCanonicalPlayerStateFromServerState(
  state: ServerStateDocument | null | undefined,
): CanonicalPlayerStateBuildResult {
  if (!state || !state.initialized) {
    return { ok: false, reason: 'server-state-not-initialized' };
  }
  const player = {
    companyName: state.companyName,
    money: state.cash,
    level: state.companyLevel,
    companyLevel: state.companyLevel,
    reputation: state.reputation,
    completedContracts: state.completedDeliveries,
    failedDeliveries: state.failedDeliveries,
    lateDeliveries: state.lateDeliveries,
    trucks: state.ownedTrucks.map((truck) => ({
      id: truck.truckId,
      catalogId: truck.templateId,
      purchasePrice: truck.purchasePrice,
      condition: truck.condition,
      ownershipType: truck.ownershipType,
      leaseExpired: false,
    })),
    warehouses: state.warehouses,
  };
  const gameState = {
    currentTime: 0,
    financeLedger: [],
  };
  return { ok: true, player, gameState };
}

/**
 * Canonical player state → liderlik skoru.
 * Exploit edilebilir / negatif değerler normalize edilir.
 */
export function calculateLeaderboardScore(
  canonicalPlayerState: Record<string, unknown>,
  gameState: Record<string, unknown> = {},
): LeaderboardScoreBreakdown {
  const level = clamp(
    Math.floor(finite(canonicalPlayerState.level, finite(canonicalPlayerState.companyLevel, 1))),
    1,
    LEADERBOARD_SCORE_BALANCE.maxLevel,
  );
  const reputation = clamp(
    finite(canonicalPlayerState.reputation),
    0,
    LEADERBOARD_SCORE_BALANCE.maxReputation,
  );
  const completedContracts = clamp(
    Math.floor(finite(canonicalPlayerState.completedContracts)),
    0,
    LEADERBOARD_SCORE_BALANCE.maxCompletedContracts,
  );
  const failedDeliveries = Math.max(0, Math.floor(finite(canonicalPlayerState.failedDeliveries)));
  const lateDeliveries = Math.max(0, Math.floor(finite(canonicalPlayerState.lateDeliveries)));
  const cash = Math.max(0, finite(canonicalPlayerState.money));
  const currentTime = Math.max(0, finite(gameState.currentTime));

  const fleetValue = calculateFleetValue(array(canonicalPlayerState.trucks));
  const warehouseNetworkValue = calculateWarehouseNetworkValue(
    array(canonicalPlayerState.warehouses),
  );
  const weeklyTradeProfit = calculateWeeklyTradeProfit(
    array(gameState.financeLedger),
    currentTime,
  );

  const levelScore = safeRound(level * LEADERBOARD_SCORE_BALANCE.levelBonusPerLevel);
  const reputationScore = safeRound(
    reputation * LEADERBOARD_SCORE_BALANCE.reputationBonusPerPoint,
  );
  const deliveryScore = safeRound(
    completedContracts * LEADERBOARD_SCORE_BALANCE.completedContractBonus,
  );
  const fleetScore = safeRound(fleetValue * LEADERBOARD_SCORE_BALANCE.truckValueWeight);
  const warehouseNetworkScore = safeRound(
    warehouseNetworkValue * LEADERBOARD_SCORE_BALANCE.warehouseValueWeight,
  );
  const financialScore = safeRound(
    softCapCash(cash) +
      weeklyTradeProfit * LEADERBOARD_SCORE_BALANCE.weeklyTradeProfitWeight,
  );
  const penaltyCost = safeRound(
    failedDeliveries * LEADERBOARD_SCORE_BALANCE.failedDeliveryPenalty +
      lateDeliveries * LEADERBOARD_SCORE_BALANCE.lateDeliveryPenalty,
  );
  const penaltyScore = -penaltyCost;

  const totalScore = clamp(
    safeRound(
      levelScore +
        reputationScore +
        deliveryScore +
        fleetScore +
        warehouseNetworkScore +
        financialScore +
        penaltyScore,
    ),
    0,
    LEADERBOARD_SCORE_BALANCE.maxTotalScore,
  );

  const companyNameRaw =
    typeof canonicalPlayerState.companyName === 'string'
      ? canonicalPlayerState.companyName.trim()
      : '';

  return {
    levelScore,
    reputationScore,
    deliveryScore,
    fleetScore,
    warehouseNetworkScore,
    financialScore,
    penaltyScore,
    totalScore,
    level,
    reputation,
    completedContracts,
    companyName: companyNameRaw.length > 0 ? companyNameRaw.slice(0, 48) : 'LogistiCore Lojistik',
  };
}
