/**
 * LogistiCore - Merkezi şirket seviye konfigürasyonu
 *
 * Kamyon, şoför, depo ve sözleşme kilitleri tek kaynaktan yönetilir.
 * levelBalance (balance.ts) bu dosyadan türetilir.
 */

import type { DriverTier, FutureUnlockStatus } from '../types/game';
import { contractLevelBalance } from './contractLevelBalance';

export interface ContractUnlockTier {
  level: number;
  maxTonnage: number;
  label: string;
}

export interface ContractTonnageRange {
  level: number;
  minTonnage: number;
  maxTonnage: number;
}

export interface WarehouseCountTier {
  level: number;
  maxWarehouses: number;
}

export interface FutureUnlock {
  level: number;
  title: string;
  status: FutureUnlockStatus;
}

export interface LevelUnlockPreview {
  level: number;
  title: string;
  status: 'available' | FutureUnlockStatus;
}

export const levelConfig = {
  maxLevel: 30,

  xpCurve: {
    baseXp: 100,
    exponent: 1.45,
  },

  contractUnlocks: [
    { level: 1, maxTonnage: 25, label: 'Küçük sözleşmeler' },
    { level: 2, maxTonnage: 40, label: 'Orta tonajlı sözleşmeler' },
    { level: 3, maxTonnage: 60, label: 'Genişletilmiş sözleşmeler' },
    { level: 4, maxTonnage: 85, label: 'Büyük tonajlı sözleşmeler' },
    { level: 5, maxTonnage: 100, label: 'Büyük sözleşmeler' },
    { level: 8, maxTonnage: 120, label: 'Ağır yük sözleşmeleri' },
    { level: 10, maxTonnage: 150, label: 'Kurumsal sözleşmeler' },
  ] satisfies ContractUnlockTier[],

  /** Sözleşme üretiminde kullanılan tonaj aralıkları */
  contractGeneration: {
    tonnageRanges: [
      { level: 1, minTonnage: 10, maxTonnage: 25 },
      { level: 2, minTonnage: 20, maxTonnage: 40 },
      { level: 3, minTonnage: 25, maxTonnage: 60 },
      { level: 4, minTonnage: 40, maxTonnage: 85 },
      { level: 5, minTonnage: 60, maxTonnage: 100 },
      { level: 8, minTonnage: 90, maxTonnage: 120 },
      { level: 10, minTonnage: 100, maxTonnage: 150 },
    ] satisfies ContractTonnageRange[],
    /** @deprecated contractLevelBalance kullanın */
    tierDistribution: {
      currentLevel: 0.7,
      nextLevel: 0.2,
      futureTeaser: 0.08,
    },
    /** Filo kapasitesine göre iş dağılımı */
    capacityDistribution: {
      doable: 0.7,
      stretch: 0.2,
      aspirational: 0.1,
    },
    /** @deprecated tierDistribution kullanın */
    teaserChance: 0.08,
  },

  /**
   * Kamyon kilitleri — anahtarlar mağaza katalog id'leriyle eşleşir.
   */
  truckUnlocks: {
    'truck-starter-1': 1,
    'truck-ford-cargo': 1,
    'truck-volvo-fh': 3,
    'truck-mercedes-actros': 4,
    'truck-refrigerated': 7,
    'truck-heavy-haul': 8,
  },

  driverUnlocks: {
    rookie: 1,
    standard: 3,
    experienced: 6,
    expert: 10,
    international: 15,
  } satisfies Record<DriverTier, number>,

  warehouseUnlocks: {
    maxWarehousesByLevel: [
      { level: 1, maxWarehouses: 1 },
      { level: 2, maxWarehouses: 2 },
      { level: 4, maxWarehouses: 3 },
      { level: 6, maxWarehouses: 4 },
      { level: 10, maxWarehouses: 6 },
    ] satisfies WarehouseCountTier[],
    mediumWarehouseLevel: 5,
    largeWarehouseLevel: 8,
    /** Level 1'den itibaren depo açılabilen şehirler */
    starterCityIds: ['izmir', 'istanbul', 'ankara', 'bursa', 'antalya'],
    /** Bu seviyeden sonra genişletilmiş şehir listesi açılır */
    extendedCityUnlockLevel: 4,
    /**
     * TODO: Level 4+ şehirler — konya, adana, samsun, gaziantep
     * CITIES verisine eklendiğinde extendedCityIds olarak tanımlanacak.
     */
    extendedCityIds: [] as string[],
    mediumUpgradeCapacity: 40,
    largeUpgradeCapacity: 60,
    maxUpgradeTier: 3,
  },

  futureUnlocks: [
    { level: 12, title: 'Yurt dışı pazarı', status: 'coming_soon' },
    { level: 16, title: 'Tren taşımacılığı', status: 'coming_soon' },
    { level: 21, title: 'Gemi lojistiği', status: 'coming_soon' },
    { level: 26, title: 'Hava kargo', status: 'coming_soon' },
  ] satisfies FutureUnlock[],

  /** Sabit XP ödülleri — oyun aksiyonlarından */
  xpRewards: {
    truckPurchase: 30,
    driverHire: 10,
    warehouseOpen: 40,
    warehouseUpgrade: 25,
  },

  /** Teslimat XP formülü sabitleri */
  deliveryXp: {
    base: 25,
    distanceDivisor: 20,
    profitDivisor: 1000,
    riskBonus: { low: 0, medium: 10, high: 25 },
    min: 20,
    max: 150,
  },

  /** Ticaret satış XP formülü sabitleri */
  tradeXp: {
    base: 10,
    profitDivisor: 1500,
    min: 10,
    max: 100,
    lossSale: 2,
  },
} as const;

export type LevelConfig = typeof levelConfig;

/** Sonraki seviye için gereken XP */
export function calculateXpToNextLevel(level: number): number {
  const safeLevel = Math.max(1, level);
  const { baseXp, exponent } = levelConfig.xpCurve;
  return Math.round(baseXp * Math.pow(safeLevel, exponent));
}

/** Belirli seviyede alınabilecek maksimum sözleşme tonajı */
export function getMaxContractTonnageForLevel(level: number): number {
  const safeLevel = Math.max(1, level);
  let maxTonnage = levelConfig.contractUnlocks[0]?.maxTonnage ?? 25;

  for (const tier of levelConfig.contractUnlocks) {
    if (safeLevel >= tier.level) {
      maxTonnage = tier.maxTonnage;
    }
  }

  return maxTonnage;
}

/** Belirli seviyede açılabilecek maksimum depo sayısı */
export function getMaxWarehousesForLevel(level: number): number {
  const safeLevel = Math.max(1, level);
  let maxWarehouses = levelConfig.warehouseUnlocks.maxWarehousesByLevel[0]?.maxWarehouses ?? 1;

  for (const tier of levelConfig.warehouseUnlocks.maxWarehousesByLevel) {
    if (safeLevel >= tier.level) {
      maxWarehouses = tier.maxWarehouses;
    }
  }

  return maxWarehouses;
}

/** Oyuncu daha fazla depo açabilir mi? */
export function canOpenMoreWarehouses(playerLevel: number, currentWarehouseCount: number): boolean {
  const safeLevel = Math.max(1, playerLevel ?? 1);
  const safeCount = Math.max(0, currentWarehouseCount ?? 0);
  return safeCount < getMaxWarehousesForLevel(safeLevel);
}

/** Depo limiti dolduğunda bir sonraki slot için gereken level */
export function getNextLevelForMoreWarehouses(currentWarehouseCount: number): number {
  return getMinLevelForWarehouseCount(Math.max(0, currentWarehouseCount ?? 0));
}

/** Şehirde depo açma kilidi — başlangıç şehirleri Level 1, genişletilmiş liste Level 4+ */
export function isWarehouseCityUnlocked(cityId: string, playerLevel: number): boolean {
  const safeLevel = Math.max(1, playerLevel ?? 1);
  const { starterCityIds, extendedCityUnlockLevel, extendedCityIds } = levelConfig.warehouseUnlocks;

  if ((starterCityIds as readonly string[]).includes(cityId)) {
    return true;
  }

  if ((extendedCityIds as readonly string[]).includes(cityId)) {
    return safeLevel >= extendedCityUnlockLevel;
  }

  // Bilinmeyen şehirler — starter listesinde değilse genişletilmiş seviye gerekir
  return safeLevel >= extendedCityUnlockLevel;
}

/** Depo yükseltme kademesine göre gereken level (null = maksimum kademe) */
export function getWarehouseUpgradeRequiredLevel(currentUpgradeTier: number): number | null {
  const tier = Math.max(1, currentUpgradeTier ?? 1);
  const { mediumWarehouseLevel, largeWarehouseLevel, maxUpgradeTier } = levelConfig.warehouseUnlocks;

  if (tier >= maxUpgradeTier) {
    return null;
  }
  if (tier === 1) {
    return mediumWarehouseLevel;
  }
  if (tier === 2) {
    return largeWarehouseLevel;
  }
  return null;
}

/** Bir sonraki yükseltmede eklenecek kapasite (ton) */
export function getWarehouseUpgradeCapacityGain(currentUpgradeTier: number): number {
  const tier = Math.max(1, currentUpgradeTier ?? 1);
  const { mediumUpgradeCapacity, largeUpgradeCapacity } = levelConfig.warehouseUnlocks;
  if (tier === 1) {
    return mediumUpgradeCapacity;
  }
  if (tier === 2) {
    return largeUpgradeCapacity;
  }
  return 0;
}

/** Kamyon satın alma / kullanım için gereken minimum şirket seviyesi */
export function getTruckRequiredLevel(truckId: string): number {
  const unlocks = levelConfig.truckUnlocks as Record<string, number>;
  return unlocks[truckId] ?? 1;
}

/** Şoför kalite kademesi için gereken minimum şirket seviyesi */
export function getDriverTierRequiredLevel(tier: DriverTier | string): number {
  const unlocks = levelConfig.driverUnlocks as Record<string, number>;
  return unlocks[tier] ?? 1;
}

/** Oyuncunun seviyesine göre önizlemesi açılmış gelecek özellikler */
export function getUnlockedFutureFeatures(level: number): FutureUnlock[] {
  const safeLevel = Math.max(1, level);
  return levelConfig.futureUnlocks.filter((feature) => safeLevel >= feature.level);
}

/** Bir sonraki açılacak içeriği döndürür (en yakın seviye) */
export function getNextUnlockForLevel(level: number): LevelUnlockPreview | null {
  const safeLevel = Math.max(1, level);
  const candidates: LevelUnlockPreview[] = [];

  for (const tier of levelConfig.contractUnlocks) {
    if (tier.level > safeLevel) {
      candidates.push({ level: tier.level, title: tier.label, status: 'available' });
    }
  }

  for (const [, reqLevel] of Object.entries(levelConfig.truckUnlocks)) {
    if (reqLevel > safeLevel) {
      candidates.push({ level: reqLevel, title: 'Yeni kamyon', status: 'available' });
    }
  }

  for (const [tier, reqLevel] of Object.entries(levelConfig.driverUnlocks)) {
    if (reqLevel > safeLevel) {
      candidates.push({ level: reqLevel, title: `Şoför kademesi: ${tier}`, status: 'available' });
    }
  }

  for (const tier of levelConfig.warehouseUnlocks.maxWarehousesByLevel) {
    if (tier.level > safeLevel) {
      candidates.push({
        level: tier.level,
        title: `${tier.maxWarehouses} depo hakkı`,
        status: 'available',
      });
    }
  }

  const { mediumWarehouseLevel, largeWarehouseLevel } = levelConfig.warehouseUnlocks;
  if (mediumWarehouseLevel > safeLevel) {
    candidates.push({
      level: mediumWarehouseLevel,
      title: 'Orta depo yükseltme',
      status: 'available',
    });
  }
  if (largeWarehouseLevel > safeLevel) {
    candidates.push({
      level: largeWarehouseLevel,
      title: 'Büyük depo yükseltme',
      status: 'available',
    });
  }

  for (const feature of levelConfig.futureUnlocks) {
    if (feature.level > safeLevel) {
      candidates.push({
        level: feature.level,
        title: feature.title,
        status: feature.status,
      });
    }
  }

  candidates.sort((a, b) => a.level - b.level || a.title.localeCompare(b.title, 'tr'));
  return candidates[0] ?? null;
}

/** Tonaja göre gereken minimum şirket seviyesi */
export function getRequiredLevelForTonnage(tonnage: number): number {
  const tiers = [...levelConfig.contractUnlocks].sort((a, b) => a.maxTonnage - b.maxTonnage);

  for (const tier of tiers) {
    if (tonnage <= tier.maxTonnage) {
      return tier.level;
    }
  }

  return tiers[tiers.length - 1]?.level ?? 1;
}

/** Mevcut depo sayısından bir sonraki depo için gereken minimum seviye */
export function getMinLevelForWarehouseCount(currentWarehouseCount: number): number {
  if (currentWarehouseCount <= 0) {
    return 1;
  }

  const targetWarehouses = currentWarehouseCount + 1;
  const tiers = [...levelConfig.warehouseUnlocks.maxWarehousesByLevel].sort(
    (a, b) => a.level - b.level,
  );

  for (const tier of tiers) {
    if (tier.maxWarehouses >= targetWarehouses) {
      return tier.level;
    }
  }

  return levelConfig.maxLevel;
}

/** Oyuncu seviyesine uygun sözleşme tonaj aralığı */
export function getContractTonnageRangeForLevel(level: number): ContractTonnageRange {
  const safeLevel = Math.max(1, level);
  let range: ContractTonnageRange = levelConfig.contractGeneration.tonnageRanges[0] ?? {
    level: 1,
    minTonnage: 10,
    maxTonnage: 25,
  };

  for (const tier of levelConfig.contractGeneration.tonnageRanges) {
    if (safeLevel >= tier.level) {
      range = tier;
    }
  }

  return range;
}

/** Bir sonraki sözleşme tonaj kademesi */
export function getNextContractUnlockTier(playerLevel: number): ContractUnlockTier | null {
  const safeLevel = Math.max(1, playerLevel);
  return levelConfig.contractUnlocks.find((tier) => tier.level > safeLevel) ?? null;
}

export type ContractGenerationLevelTier = 'current' | 'next' | 'twoAbove' | 'special';

interface ContractTierWeights {
  current: number;
  next: number;
  twoAbove: number;
  special: number;
}

function getContractTierWeightsForPlayer(playerLevel: number): ContractTierWeights {
  const safeLevel = Math.max(1, playerLevel);
  const balance = contractLevelBalance;

  if (safeLevel === 1) {
    return { current: 0.8, next: 0.18, twoAbove: 0.02, special: 0 };
  }
  if (safeLevel === 2) {
    return { current: 0.75, next: 0.2, twoAbove: 0.05, special: 0 };
  }
  if (safeLevel === 3) {
    return { current: 0.72, next: 0.2, twoAbove: 0.08, special: 0 };
  }
  if (safeLevel >= 8) {
    return { current: 0.6, next: 0.22, twoAbove: 0.12, special: 0.06 };
  }

  return {
    current: balance.sameOrLowerLevelWeight,
    next: balance.oneLevelAboveWeight,
    twoAbove: balance.twoLevelAboveWeight,
    special: balance.specialHighLevelWeight,
  };
}

/** Oyuncu seviyesine göre sözleşme üretim kademesi seçer */
export function pickContractGenerationLevelTier(
  playerLevel: number,
): ContractGenerationLevelTier {
  const weights = getContractTierWeightsForPlayer(playerLevel);
  const roll = Math.random();

  if (roll < weights.current) {
    return 'current';
  }
  if (roll < weights.current + weights.next) {
    return 'next';
  }
  if (roll < weights.current + weights.next + weights.twoAbove) {
    return 'twoAbove';
  }
  return weights.special > 0 ? 'special' : 'twoAbove';
}

/** Oyuncu seviyesine göre üretilebilecek max requiredLevel */
export function getMaxAllowedContractRequiredLevel(playerLevel: number): number {
  const safeLevel = Math.max(1, playerLevel);
  const extraGap =
    contractLevelBalance.lowLevelMaxExtraLevel[safeLevel] ??
    contractLevelBalance.maxVisibleLevelGapDefault;
  return safeLevel + extraGap;
}

export type ContractCapacityProfile = 'doable' | 'stretch' | 'aspirational';

/** Filo kapasitesine göre iş profili seçer */
export function pickContractCapacityProfile(): ContractCapacityProfile {
  const { capacityDistribution } = levelConfig.contractGeneration;
  const roll = Math.random();
  if (roll < capacityDistribution.doable) {
    return 'doable';
  }
  if (roll < capacityDistribution.doable + capacityDistribution.stretch) {
    return 'stretch';
  }
  return 'aspirational';
}

/** Oyuncu seviyesinin üstündeki N. sözleşme kilidi kademesi (1 = bir üst, 2 = iki üst) */
export function getContractUnlockTierAbovePlayer(
  playerLevel: number,
  tiersAbove: number,
): ContractUnlockTier | null {
  const safeLevel = Math.max(1, playerLevel);
  const above = levelConfig.contractUnlocks.filter((tier) => tier.level > safeLevel);
  return above[tiersAbove - 1] ?? null;
}

/** Seviye kademesine göre tonaj aralığı ve gereken minimum seviye */
export function resolveContractGenerationRange(
  playerLevel: number,
  levelTier: ContractGenerationLevelTier,
): { minTonnage: number; maxTonnage: number; requiredLevel: number } {
  const safeLevel = Math.max(1, playerLevel);

  if (levelTier === 'current') {
    const range = getContractTonnageRangeForLevel(safeLevel);
    return {
      minTonnage: range.minTonnage,
      maxTonnage: range.maxTonnage,
      requiredLevel: safeLevel,
    };
  }

  if (levelTier === 'next') {
    const nextTier = getNextContractUnlockTier(safeLevel);
    if (nextTier) {
      const range = getContractTonnageRangeForLevel(nextTier.level);
      return {
        minTonnage: range.minTonnage,
        maxTonnage: range.maxTonnage,
        requiredLevel: nextTier.level,
      };
    }
  }

  if (levelTier === 'twoAbove') {
    const futureTier = getContractUnlockTierAbovePlayer(safeLevel, 2);
    if (futureTier) {
      const range = getContractTonnageRangeForLevel(futureTier.level);
      return {
        minTonnage: range.minTonnage,
        maxTonnage: range.maxTonnage,
        requiredLevel: futureTier.level,
      };
    }
  }

  if (levelTier === 'special') {
    const specialTier = getContractUnlockTierAbovePlayer(safeLevel, 3);
    if (specialTier) {
      const range = getContractTonnageRangeForLevel(specialTier.level);
      return {
        minTonnage: range.minTonnage,
        maxTonnage: range.maxTonnage,
        requiredLevel: specialTier.level,
      };
    }
  }

  const fallback = getContractTonnageRangeForLevel(safeLevel);
  return {
    minTonnage: fallback.minTonnage,
    maxTonnage: fallback.maxTonnage,
    requiredLevel: safeLevel,
  };
}

/** Filo kapasitesine göre tonaj aralığını daraltır veya genişletir */
export function applyCapacityProfileToTonnageRange(
  minTonnage: number,
  maxTonnage: number,
  profile: ContractCapacityProfile,
  ownedMaxTruckCapacity: number,
  idleMaxTruckCapacity?: number,
): { minTonnage: number; maxTonnage: number } | null {
  const ownedMax = Math.max(0, ownedMaxTruckCapacity);
  const idleMax = Math.max(0, idleMaxTruckCapacity ?? ownedMax);
  const feasibleMax = idleMax > 0 ? idleMax : ownedMax;
  const safeMin = Math.max(5, minTonnage);
  const safeMax = Math.max(safeMin, maxTonnage);

  if (ownedMax <= 0) {
    return { minTonnage: safeMin, maxTonnage: safeMax };
  }

  switch (profile) {
    case 'doable': {
      const cappedMax = Math.min(safeMax, feasibleMax, ownedMax);
      if (cappedMax < 5) {
        return null;
      }
      return {
        minTonnage: Math.min(safeMin, cappedMax),
        maxTonnage: cappedMax,
      };
    }
    case 'stretch': {
      const stretchMin = Math.max(safeMin, ownedMax * 0.7);
      const stretchMax = Math.min(safeMax, Math.max(ownedMax * 1.05, ownedMax + 2));
      if (stretchMax < stretchMin) {
        return null;
      }
      return {
        minTonnage: Math.min(stretchMin, stretchMax),
        maxTonnage: stretchMax,
      };
    }
    case 'aspirational': {
      const aspirationalMin = Math.max(safeMin, ownedMax + 1);
      const aspirationalMax = safeMax;
      if (aspirationalMax < aspirationalMin) {
        return null;
      }
      return {
        minTonnage: aspirationalMin,
        maxTonnage: aspirationalMax,
      };
    }
    default:
      return { minTonnage: safeMin, maxTonnage: safeMax };
  }
}

/** Level kilidi için oyuncuya gösterilecek kısa ipucu */
export function getContractLevelUnlockHint(playerLevel: number, requiredLevel: number): string {
  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const safeRequiredLevel = Math.max(1, requiredLevel ?? 1);
  const levelsNeeded = safeRequiredLevel - safePlayerLevel;

  if (levelsNeeded <= 0) {
    return '';
  }
  if (levelsNeeded === 1) {
    return 'Bir sonraki seviyede açılır';
  }
  return `Level ${safeRequiredLevel}'e ulaşınca açılır (${levelsNeeded} seviye kaldı)`;
}
