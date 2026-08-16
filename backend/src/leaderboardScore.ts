/**
 * Backend-authoritative liderlik skoru (v2).
 *
 * Client raw score kabul edilmez. Skor yalnız trusted serverState'ten üretilir.
 * Varsayılan itibar (50) nötrdür; 0 teslimatlı hesaplar sıralamaya giremez.
 */

import type { ServerStateDocument } from './serverStateTypes';

export const LEADERBOARD_SCORE_VERSION = 2;
export const LEADERBOARD_MIN_COMPLETED_DELIVERIES = 3;

export const LEADERBOARD_SCORE_BALANCE = {
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
  maxLevel: 100,
  maxReputation: 100,
  maxCompletedContracts: 50_000,
  maxFleetValue: 50_000_000,
  maxWarehouseValue: 20_000_000,
} as const;

export interface LeaderboardScoreBreakdown {
  deliveryScore: number;
  progressionScore: number;
  reputationScore: number;
  assetScore: number;
  financeScore: number;
  weeklyActivityScore: number;
  penaltyScore: number;
  totalScore: number;
  rankedEligible: boolean;
  level: number;
  reputation: number;
  completedContracts: number;
  weeklyCompletedDeliveries: number;
  companyName: string;
  /** @deprecated v1 alias */
  levelScore: number;
  fleetScore: number;
  warehouseNetworkScore: number;
  financialScore: number;
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

export function isLeaderboardRankedEligible(completedDeliveries: number): boolean {
  return (
    Number.isFinite(completedDeliveries) &&
    completedDeliveries >= LEADERBOARD_MIN_COMPLETED_DELIVERIES
  );
}

function calculateOwnedFleetValue(trucks: unknown[]): number {
  let total = 0;
  for (const raw of trucks) {
    const truck = record(raw);
    if (truck.leaseExpired === true) continue;
    const ownershipType = typeof truck.ownershipType === 'string' ? truck.ownershipType : 'owned';
    if (ownershipType !== 'owned') continue;
    if (truck.status === 'marketplace_locked') continue;
    if (typeof truck.marketplaceListingId === 'string' && truck.marketplaceListingId.length > 0) {
      continue;
    }
    const purchasePrice = Math.max(0, finite(truck.purchasePrice));
    const condition = clamp(finite(truck.condition, 100), 0, 100);
    total += purchasePrice * (condition / 100);
  }
  return clamp(total, 0, LEADERBOARD_SCORE_BALANCE.maxFleetValue);
}

function calculateOwnedWarehouseValue(warehouses: unknown[]): number {
  let total = 0;
  for (const raw of warehouses) {
    const warehouse = record(raw);
    const capacity = Math.max(0, finite(warehouse.capacityTons));
    const tier = Math.max(1, finite(warehouse.upgradeTier, 1));
    const tierBonus = 1 + (tier - 1) * LEADERBOARD_SCORE_BALANCE.warehouseTierBonusRate;
    total += capacity * LEADERBOARD_SCORE_BALANCE.warehouseCapacityValue * tierBonus;
  }
  return clamp(total, 0, LEADERBOARD_SCORE_BALANCE.maxWarehouseValue);
}

function scaleAssetValue(value: number): number {
  const safe = Math.max(0, value);
  return (
    LEADERBOARD_SCORE_BALANCE.assetSqrt * Math.sqrt(safe) +
    LEADERBOARD_SCORE_BALANCE.assetLog * Math.log1p(safe / LEADERBOARD_SCORE_BALANCE.assetLogDivisor)
  );
}

function scaleCash(cash: number): number {
  const normalized = Math.max(0, cash);
  const capped = Math.min(normalized, LEADERBOARD_SCORE_BALANCE.cashSoftCap);
  let score = LEADERBOARD_SCORE_BALANCE.cashSqrt * Math.sqrt(capped);
  if (normalized > LEADERBOARD_SCORE_BALANCE.cashSoftCap) {
    const overflow = normalized - LEADERBOARD_SCORE_BALANCE.cashSoftCap;
    score +=
      LEADERBOARD_SCORE_BALANCE.cashOverflowLog *
      Math.log1p(overflow / LEADERBOARD_SCORE_BALANCE.cashSoftCap);
  }
  return score;
}

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
  extras?: { weeklyCompletedDeliveries?: number },
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
    weeklyCompletedDeliveries: extras?.weeklyCompletedDeliveries ?? 0,
    trucks: state.ownedTrucks.map((truck) => ({
      id: truck.truckId,
      catalogId: truck.templateId,
      purchasePrice: truck.purchasePrice,
      condition: truck.condition,
      ownershipType: truck.ownershipType,
      status: truck.status,
      leaseExpired: false,
      marketplaceListingId: truck.marketplaceListingId ?? null,
    })),
    warehouses: state.warehouses,
  };
  const gameState = {
    currentTime: 0,
    financeLedger: [],
  };
  return { ok: true, player, gameState };
}

export function resolveWeeklySeasonActivity(
  state: Pick<
    ServerStateDocument,
    'completedDeliveries' | 'leaderboardSeasonKey' | 'weeklySeasonBaselineCompleted'
  >,
  seasonKey: string,
): {
  weeklyCompletedDeliveries: number;
  leaderboardSeasonKey: string;
  weeklySeasonBaselineCompleted: number;
} {
  const completed = Math.max(0, Math.floor(finite(state.completedDeliveries)));
  if (state.leaderboardSeasonKey !== seasonKey) {
    return {
      weeklyCompletedDeliveries: 0,
      leaderboardSeasonKey: seasonKey,
      weeklySeasonBaselineCompleted: completed,
    };
  }
  const baseline =
    typeof state.weeklySeasonBaselineCompleted === 'number' &&
    Number.isFinite(state.weeklySeasonBaselineCompleted)
      ? Math.max(0, Math.floor(state.weeklySeasonBaselineCompleted))
      : completed;
  return {
    weeklyCompletedDeliveries: Math.max(0, completed - baseline),
    leaderboardSeasonKey: seasonKey,
    weeklySeasonBaselineCompleted: baseline,
  };
}

/**
 * Canonical player state → liderlik skoru v2.
 */
export function calculateLeaderboardScore(
  canonicalPlayerState: Record<string, unknown>,
  _gameState: Record<string, unknown> = {},
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
  const weeklyCompletedDeliveries = Math.max(
    0,
    Math.floor(finite(canonicalPlayerState.weeklyCompletedDeliveries)),
  );
  const cash = Math.max(0, finite(canonicalPlayerState.money));

  const fleetValue = calculateOwnedFleetValue(array(canonicalPlayerState.trucks));
  const warehouseValue = calculateOwnedWarehouseValue(array(canonicalPlayerState.warehouses));

  const successfulDeliveries = Math.max(0, completedContracts - failedDeliveries);
  const rawDelivery =
    completedContracts * LEADERBOARD_SCORE_BALANCE.deliveryLinear +
    LEADERBOARD_SCORE_BALANCE.deliveryLogScale * Math.log1p(completedContracts) +
    successfulDeliveries * LEADERBOARD_SCORE_BALANCE.successfulBonus -
    failedDeliveries * LEADERBOARD_SCORE_BALANCE.failedPenalty -
    lateDeliveries * LEADERBOARD_SCORE_BALANCE.latePenalty;
  const deliveryScore = clamp(safeRound(rawDelivery), 0, LEADERBOARD_SCORE_BALANCE.maxDeliveryScore);
  const penaltyScore = safeRound(
    -(
      failedDeliveries * LEADERBOARD_SCORE_BALANCE.failedPenalty +
      lateDeliveries * LEADERBOARD_SCORE_BALANCE.latePenalty
    ),
  );

  const levelOffset = Math.max(0, level - 1);
  const progressionScore = clamp(
    safeRound(
      levelOffset * LEADERBOARD_SCORE_BALANCE.levelLinear +
        LEADERBOARD_SCORE_BALANCE.levelSqrt * Math.sqrt(levelOffset),
    ),
    0,
    LEADERBOARD_SCORE_BALANCE.maxProgressionScore,
  );

  const fleetScore = safeRound(scaleAssetValue(fleetValue));
  const warehouseNetworkScore = safeRound(scaleAssetValue(warehouseValue));
  const assetScore = clamp(
    fleetScore + warehouseNetworkScore,
    0,
    LEADERBOARD_SCORE_BALANCE.maxAssetScore,
  );

  const quality = clamp(
    (reputation - LEADERBOARD_SCORE_BALANCE.reputationBaseline) /
      LEADERBOARD_SCORE_BALANCE.reputationRange,
    -1,
    1,
  );
  let reputationScore = safeRound(quality * LEADERBOARD_SCORE_BALANCE.reputationAmplitude);
  if (reputationScore < 0) {
    const penaltyCap = -safeRound(
      LEADERBOARD_SCORE_BALANCE.reputationPenaltyCapRatio *
        (deliveryScore + progressionScore + assetScore),
    );
    reputationScore = Math.max(reputationScore, penaltyCap);
  }
  reputationScore = clamp(
    reputationScore,
    -LEADERBOARD_SCORE_BALANCE.maxReputationAbs,
    LEADERBOARD_SCORE_BALANCE.maxReputationAbs,
  );

  const financeScore = clamp(
    safeRound(scaleCash(cash)),
    0,
    LEADERBOARD_SCORE_BALANCE.maxFinanceScore,
  );

  const weeklyActivityScore = clamp(
    safeRound(
      weeklyCompletedDeliveries * LEADERBOARD_SCORE_BALANCE.weeklyLinear +
        LEADERBOARD_SCORE_BALANCE.weeklyLog * Math.log1p(weeklyCompletedDeliveries),
    ),
    0,
    LEADERBOARD_SCORE_BALANCE.maxWeeklyScore,
  );

  const rankedEligible = isLeaderboardRankedEligible(completedContracts);
  const totalScore = clamp(
    safeRound(
      deliveryScore +
        progressionScore +
        reputationScore +
        assetScore +
        financeScore +
        weeklyActivityScore,
    ),
    0,
    LEADERBOARD_SCORE_BALANCE.maxTotalScore,
  );

  const companyNameRaw =
    typeof canonicalPlayerState.companyName === 'string'
      ? canonicalPlayerState.companyName.trim()
      : '';

  return {
    deliveryScore,
    progressionScore,
    reputationScore,
    assetScore,
    financeScore,
    weeklyActivityScore,
    penaltyScore,
    totalScore,
    rankedEligible,
    level,
    reputation,
    completedContracts,
    weeklyCompletedDeliveries,
    companyName: companyNameRaw.length > 0 ? companyNameRaw.slice(0, 48) : 'LogistiCore Lojistik',
    levelScore: progressionScore,
    fleetScore,
    warehouseNetworkScore,
    financialScore: financeScore,
  };
}
