/**
 * LogistiCore - Şirket seviye ve XP sistemi
 */

import {
  calculateXpToNextLevel,
  getMaxContractTonnageForLevel,
  getMinLevelForWarehouseCount as getMinWarehouseLevelFromConfig,
  getRequiredLevelForTonnage as getRequiredLevelForTonnageFromConfig,
  getTruckRequiredLevel,
  levelConfig,
} from '../config/levelConfig';
import type { Contract, Delivery, Player, PlayerProgressFields } from '../types/game';

/** Kayıt yükleme — level/xp alanları eksik olabilir */
export type PlayerProgressInput = Omit<Player, keyof PlayerProgressFields> & PlayerProgressFields;

export type DeliveryRiskTier = 'low' | 'medium' | 'high';

export interface LevelBenefits {
  level: number;
  maxContractTonnage: number;
  nextLevelHint: string;
}

export interface LevelProgress {
  level: number;
  xp: number;
  xpToNextLevel: number;
  totalXp: number;
  progressRatio: number;
  isMaxLevel: boolean;
}

export {
  calculateXpToNextLevel,
  canOpenMoreWarehouses,
  getContractLevelUnlockHint,
  getContractTonnageRangeForLevel,
  getDriverTierRequiredLevel,
  getMaxContractTonnageForLevel,
  getMaxWarehousesForLevel,
  getNextContractUnlockTier,
  getNextLevelForMoreWarehouses,
  getNextUnlockForLevel,
  getTruckRequiredLevel,
  getUnlockedFutureFeatures,
  getWarehouseUpgradeCapacityGain,
  getWarehouseUpgradeRequiredLevel,
  isWarehouseCityUnlocked,
} from '../config/levelConfig';

/** Oyuncu level/xp alanlarını normalize eder — eski save uyumluluğu */
export function normalizePlayerProgress(player: PlayerProgressInput): Player {
  const level = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const xp = Math.max(0, player?.xp ?? 0);
  const totalXp = Math.max(0, player?.totalXp ?? xp);
  const xpToNextLevel = player?.xpToNextLevel ?? calculateXpToNextLevel(level);

  return {
    ...player,
    level,
    xp,
    totalXp,
    xpToNextLevel,
    companyLevel: level,
    diamonds: Math.max(0, player?.diamonds ?? 0),
    failedDeliveries: Math.max(0, player?.failedDeliveries ?? 0),
    lateDeliveries: Math.max(0, player?.lateDeliveries ?? 0),
  };
}

export function getLevelProgress(player: Player): LevelProgress {
  const normalized = normalizePlayerProgress(player);
  const isMaxLevel = normalized.level >= levelConfig.maxLevel;
  const xpToNext = isMaxLevel ? calculateXpToNextLevel(normalized.level) : normalized.xpToNextLevel;
  const progressRatio = isMaxLevel ? 1 : xpToNext > 0 ? normalized.xp / xpToNext : 0;

  return {
    level: normalized.level,
    xp: normalized.xp,
    xpToNextLevel: xpToNext,
    totalXp: normalized.totalXp,
    progressRatio: Math.max(0, Math.min(1, progressRatio)),
    isMaxLevel,
  };
}

/** @deprecated getMaxContractTonnageForLevel kullanın */
export function getMaxTonnageForLevel(level: number): number {
  return getMaxContractTonnageForLevel(level);
}

export function getRequiredLevelForTonnage(tonnage: number): number {
  return getRequiredLevelForTonnageFromConfig(tonnage);
}

/** @deprecated getTruckRequiredLevel kullanın */
export function getTruckUnlockLevel(truckId: string): number {
  return getTruckRequiredLevel(truckId);
}

export function getMinLevelForWarehouseCount(currentWarehouseCount: number): number {
  return getMinWarehouseLevelFromConfig(currentWarehouseCount);
}

export function getLevelBenefits(level: number): LevelBenefits {
  const safeLevel = Math.max(1, Math.min(level, levelConfig.maxLevel));
  const maxContractTonnage = getMaxContractTonnageForLevel(safeLevel);

  const nextTier = levelConfig.contractUnlocks.find((tier) => tier.level > safeLevel);
  const nextLevelHint = nextTier?.label ?? 'Global lojistik hedefleri';

  return {
    level: safeLevel,
    maxContractTonnage,
    nextLevelHint,
  };
}

export function getDeliveryRiskTier(delivery: Delivery | Pick<Delivery, 'breakdownChance' | 'accidentChance'>): DeliveryRiskTier {
  const combinedRisk = (delivery.breakdownChance ?? 0) + (delivery.accidentChance ?? 0);
  if (combinedRisk < 0.1) return 'low';
  if (combinedRisk < 0.25) return 'medium';
  return 'high';
}

export function calculateDeliveryXp(
  distanceKm?: number,
  netProfit?: number,
  riskTier?: DeliveryRiskTier,
): number {
  const cfg = levelConfig.deliveryXp;
  const safeDistance = Math.max(0, distanceKm ?? 0);
  const safeProfit = netProfit ?? 0;
  const tier = riskTier ?? 'low';

  const distanceXp = safeDistance / cfg.distanceDivisor;
  const profitXp = Math.max(0, safeProfit) / cfg.profitDivisor;
  const riskBonus = cfg.riskBonus[tier];

  const rawXp = Math.round(cfg.base + distanceXp + profitXp + riskBonus);
  return Math.min(cfg.max, Math.max(cfg.min, rawXp));
}

export function calculateTradeSaleXp(profit?: number): number {
  const cfg = levelConfig.tradeXp;
  const safeProfit = profit ?? 0;

  if (safeProfit <= 0) {
    return cfg.lossSale;
  }

  const rawXp = Math.round(cfg.base + safeProfit / cfg.profitDivisor);
  return Math.min(cfg.max, Math.max(cfg.min, rawXp));
}

export interface ApplyXpResult {
  player: Player;
  leveledUp: boolean;
  newLevels: number[];
  xpGained: number;
}

/** XP ekler; level atlama ve fazla XP taşımasını destekler */
export function applyXpToPlayer(player: Player, amount: number): ApplyXpResult {
  const normalized = normalizePlayerProgress(player);
  if (amount < 0) {
    return { player: normalized, leveledUp: false, newLevels: [], xpGained: 0 };
  }

  let xp = normalized.xp + amount;
  let level = normalized.level;
  let xpToNextLevel = normalized.xpToNextLevel;
  const totalXp = normalized.totalXp + Math.max(0, amount);
  const newLevels: number[] = [];

  while (xp >= xpToNextLevel && level < levelConfig.maxLevel) {
    xp -= xpToNextLevel;
    level += 1;
    newLevels.push(level);
    xpToNextLevel = calculateXpToNextLevel(level);
  }

  if (level >= levelConfig.maxLevel) {
    xp = 0;
    xpToNextLevel = calculateXpToNextLevel(level);
  }

  return {
    player: {
      ...normalized,
      xp,
      level,
      xpToNextLevel,
      totalXp,
      companyLevel: level,
    },
    leveledUp: newLevels.length > 0,
    newLevels,
    xpGained: amount,
  };
}

export function getContractRequiredLevel(contract: Contract): number {
  return contract.requiredLevel ?? 1;
}

export function isContractLevelLocked(contract: Contract, playerLevel: number): boolean {
  return getContractRequiredLevel(contract) > Math.max(1, playerLevel);
}
