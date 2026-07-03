/**
 * LogistiCore - Şirket seviye ve XP sistemi
 */

import { levelBalance } from '../config/balance';
import type { Contract, Delivery, Player } from '../types/game';

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

/** Sonraki seviye için gereken XP */
export function calculateXpToNextLevel(level: number): number {
  const safeLevel = Math.max(1, level);
  return Math.round(100 * Math.pow(safeLevel, 1.45));
}

/** Oyuncu level/xp alanlarını normalize eder — eski save uyumluluğu */
export function normalizePlayerProgress(player: Player): Player {
  const level = Math.max(1, player.level ?? player.companyLevel ?? 1);
  const xp = Math.max(0, player.xp ?? 0);
  const totalXp = Math.max(0, player.totalXp ?? xp);
  const xpToNextLevel = player.xpToNextLevel ?? calculateXpToNextLevel(level);

  return {
    ...player,
    level,
    xp,
    totalXp,
    xpToNextLevel,
    companyLevel: level,
  };
}

export function getLevelProgress(player: Player): LevelProgress {
  const normalized = normalizePlayerProgress(player);
  const isMaxLevel = normalized.level >= levelBalance.maxLevel;
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

export function getMaxTonnageForLevel(level: number): number {
  const safeLevel = Math.max(1, level);
  let maxTonnage: number = levelBalance.contractTonnageByLevel[0]?.maxTonnage ?? 25;

  for (const tier of levelBalance.contractTonnageByLevel) {
    if (safeLevel >= tier.level) {
      maxTonnage = tier.maxTonnage;
    }
  }

  return maxTonnage;
}

export function getRequiredLevelForTonnage(tonnage: number): number {
  const tiers = [...levelBalance.contractTonnageByLevel].sort((a, b) => a.maxTonnage - b.maxTonnage);

  for (const tier of tiers) {
    if (tonnage <= tier.maxTonnage) {
      return tier.level;
    }
  }

  return tiers[tiers.length - 1]?.level ?? 1;
}

export function getTruckUnlockLevel(truckId: string): number {
  const unlocks = levelBalance.truckUnlockLevels as Record<string, number>;
  return unlocks[truckId] ?? 1;
}

export function getMinLevelForWarehouseCount(currentWarehouseCount: number): number {
  if (currentWarehouseCount <= 0) {
    return 1;
  }
  if (currentWarehouseCount === 1) {
    return levelBalance.warehouseUnlockLevels.openSecondWarehouse;
  }
  if (currentWarehouseCount === 2) {
    return levelBalance.warehouseUnlockLevels.openThirdWarehouse;
  }
  return levelBalance.warehouseUnlockLevels.largeWarehouse;
}

export function getLevelBenefits(level: number): LevelBenefits {
  const safeLevel = Math.max(1, Math.min(level, levelBalance.maxLevel));
  const maxContractTonnage = getMaxTonnageForLevel(safeLevel);

  let nextLevelHint = 'Daha büyük sözleşmeler';
  if (safeLevel < 2) {
    nextLevelHint = 'Orta tonajlı sözleşmeler';
  } else if (safeLevel < 4) {
    nextLevelHint = 'Büyük sözleşmeler ve yeni kamyonlar';
  } else if (safeLevel < 6) {
    nextLevelHint = 'Ağır yükler ve ek depolar';
  }

  return {
    level: safeLevel,
    maxContractTonnage,
    nextLevelHint,
  };
}

export function getDeliveryRiskTier(delivery: Delivery): DeliveryRiskTier {
  const combinedRisk = (delivery.breakdownChance ?? 0) + (delivery.accidentChance ?? 0);
  if (combinedRisk < 0.1) return 'low';
  if (combinedRisk < 0.25) return 'medium';
  return 'high';
}

export function calculateDeliveryXp(
  distanceKm: number,
  netProfit: number,
  riskTier: DeliveryRiskTier,
): number {
  const baseXp = 25;
  const distanceXp = distanceKm / 20;
  const profitXp = Math.max(0, netProfit) / 1000;
  const riskBonus = riskTier === 'high' ? 25 : riskTier === 'medium' ? 10 : 0;

  return Math.max(1, Math.round(baseXp + distanceXp + profitXp + riskBonus));
}

export function calculateTradeSaleXp(profit: number): number {
  if (profit <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(10 + profit / 1500));
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

  while (xp >= xpToNextLevel && level < levelBalance.maxLevel) {
    xp -= xpToNextLevel;
    level += 1;
    newLevels.push(level);
    xpToNextLevel = calculateXpToNextLevel(level);
  }

  if (level >= levelBalance.maxLevel) {
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
