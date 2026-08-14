/**
 * Kamyon bakım / geliştirme altyapısı — Phase 3.
 */

import type { Truck, TruckUpgrades } from '../types/game';
import { clamp } from '../utils/math';

export const MAX_UPGRADE_LEVEL = 3;

export type TruckUpgradeType = keyof TruckUpgrades;

export const TRUCK_UPGRADE_LABELS: Record<TruckUpgradeType, string> = {
  engine: 'Motor',
  fuelEfficiency: 'Yakıt Verimliliği',
  cargo: 'Kargo',
  durability: 'Dayanıklılık',
};

export const TRUCK_UPGRADE_DISPLAY_NAMES: Record<TruckUpgradeType, string> = {
  engine: 'Motor',
  fuelEfficiency: 'Yakıt Verimliliği',
  cargo: 'Kargo Kapasitesi',
  durability: 'Dayanıklılık',
};

export const TRUCK_UPGRADE_BENEFITS: Record<TruckUpgradeType, string> = {
  engine: 'Teslimat süresini azaltır',
  fuelEfficiency: 'Yakıt tüketimini azaltır',
  cargo: 'Taşıma kapasitesini artırır',
  durability: 'Kondisyon kaybını azaltır',
};

export const TRUCK_UPGRADE_ACTION_LABELS: Record<TruckUpgradeType, string> = {
  engine: 'Motoru Yükselt',
  fuelEfficiency: 'Yakıt Verimliliğini Yükselt',
  cargo: 'Kargo Kapasitesini Yükselt',
  durability: 'Dayanıklılığı Yükselt',
};

export const TRUCK_UPGRADE_TYPES: TruckUpgradeType[] = [
  'engine',
  'fuelEfficiency',
  'cargo',
  'durability',
];

export function getEngineSpeedMultiplier(truck: Truck): number {
  const reduction = getEngineDurationReduction(normalizeTruckUpgrades(truck));
  if (reduction <= 0) {
    return 1;
  }
  return 1 / (1 - reduction);
}

export function formatTruckUpgradeCurrentEffect(
  truck: Truck,
  upgradeType: TruckUpgradeType,
): string {
  const normalized = normalizeTruckUpgrades(truck);
  const level = normalized.upgrades?.[upgradeType] ?? 0;
  if (level <= 0) {
    return 'Henüz etki yok';
  }

  switch (upgradeType) {
    case 'engine':
      return `Süre -%${Math.round(getEngineDurationReduction(normalized) * 100)}`;
    case 'fuelEfficiency':
      return `Yakıt -%${Math.round(getFuelEfficiencyReduction(normalized) * 100)}`;
    case 'cargo':
      return `+${getCargoCapacityBonus(normalized).toFixed(1)} t kapasite`;
    case 'durability':
      return `Kondisyon kaybı -%${Math.round(getDurabilityConditionLossReduction(normalized) * 100)}`;
    default:
      return '—';
  }
}

export function formatTruckUpgradeNextEffect(
  truck: Truck,
  upgradeType: TruckUpgradeType,
): string {
  const normalized = normalizeTruckUpgrades(truck);
  const currentLevel = normalized.upgrades?.[upgradeType] ?? 0;
  if (currentLevel >= MAX_UPGRADE_LEVEL) {
    return '—';
  }
  const preview = normalizeTruckUpgrades({
    ...normalized,
    upgrades: {
      ...normalized.upgrades!,
      [upgradeType]: currentLevel + 1,
    },
  });
  switch (upgradeType) {
    case 'engine':
      return `Süre -%${Math.round(getEngineDurationReduction(preview) * 100)}`;
    case 'fuelEfficiency':
      return `Yakıt -%${Math.round(getFuelEfficiencyReduction(preview) * 100)}`;
    case 'cargo':
      return `+${getCargoCapacityBonus(preview).toFixed(1)} t kapasite`;
    case 'durability':
      return `Kondisyon kaybı -%${Math.round(
        getDurabilityConditionLossReduction(preview) * 100,
      )}`;
    default:
      return '—';
  }
}

export function formatTruckUpgradeSuccessToast(upgradeType: TruckUpgradeType): string {
  switch (upgradeType) {
    case 'engine':
      return 'Motor yükseltildi';
    case 'fuelEfficiency':
      return 'Yakıt verimliliği yükseltildi';
    case 'cargo':
      return 'Kargo kapasitesi yükseltildi';
    case 'durability':
      return 'Dayanıklılık yükseltildi';
    default:
      return 'Yükseltme tamamlandı';
  }
}

export const DEFAULT_TRUCK_UPGRADES: TruckUpgrades = {
  engine: 0,
  fuelEfficiency: 0,
  cargo: 0,
  durability: 0,
};

export function normalizeTruckUpgrades(truck: Truck): Truck {
  const raw = truck.upgrades ?? DEFAULT_TRUCK_UPGRADES;
  const upgrades: TruckUpgrades = {
    engine: clamp(raw.engine ?? 0, 0, MAX_UPGRADE_LEVEL),
    fuelEfficiency: clamp(raw.fuelEfficiency ?? 0, 0, MAX_UPGRADE_LEVEL),
    cargo: clamp(raw.cargo ?? 0, 0, MAX_UPGRADE_LEVEL),
    durability: clamp(raw.durability ?? 0, 0, MAX_UPGRADE_LEVEL),
  };
  const upgradeLevel = clamp(
    truck.upgradeLevel ?? Object.values(upgrades).reduce((s, v) => s + v, 0),
    0,
    MAX_UPGRADE_LEVEL * 4,
  );
  return {
    ...truck,
    condition: clamp(truck.condition ?? 100, 0, 100),
    upgradeLevel,
    upgrades,
  };
}

export function getTruckUpgradeCost(truck: Truck, upgradeType: TruckUpgradeType): number {
  const normalized = normalizeTruckUpgrades(truck);
  const currentLevel = normalized.upgrades?.[upgradeType] ?? 0;
  if (currentLevel >= MAX_UPGRADE_LEVEL) {
    return 0;
  }
  const basePrice = truck.purchasePrice ?? 50000;
  const tierMultiplier = 1 + currentLevel * 0.75;
  const typeMultiplier: Record<TruckUpgradeType, number> = {
    engine: 0.08,
    fuelEfficiency: 0.07,
    cargo: 0.09,
    durability: 0.06,
  };
  return Math.round(basePrice * typeMultiplier[upgradeType] * tierMultiplier);
}

export function canUpgradeTruck(truck: Truck, upgradeType: TruckUpgradeType): boolean {
  const normalized = normalizeTruckUpgrades(truck);
  return (normalized.upgrades?.[upgradeType] ?? 0) < MAX_UPGRADE_LEVEL;
}

export function applyTruckUpgrade(truck: Truck, upgradeType: TruckUpgradeType): Truck {
  const normalized = normalizeTruckUpgrades(truck);
  const current = normalized.upgrades?.[upgradeType] ?? 0;
  if (current >= MAX_UPGRADE_LEVEL) {
    return normalized;
  }

  const upgrades = {
    ...normalized.upgrades!,
    [upgradeType]: current + 1,
  };

  let capacity = normalized.capacity;
  if (upgradeType === 'cargo') {
    capacity = Math.round(capacity * 1.04 * 10) / 10;
  }

  return {
    ...normalized,
    upgrades,
    upgradeLevel: Object.values(upgrades).reduce((s, v) => s + v, 0),
    capacity,
  };
}

/** Motor — teslimat süresi azaltma */
export function getEngineDurationReduction(truck: Truck): number {
  const level = normalizeTruckUpgrades(truck).upgrades?.engine ?? 0;
  return level * 0.015;
}

/** Yakıt verimliliği — yakıt maliyeti azaltma */
export function getFuelEfficiencyReduction(truck: Truck): number {
  const level = normalizeTruckUpgrades(truck).upgrades?.fuelEfficiency ?? 0;
  return level * 0.02;
}

/** Kargo — efektif kapasite bonusu (ton) */
export function getCargoCapacityBonus(truck: Truck): number {
  const level = normalizeTruckUpgrades(truck).upgrades?.cargo ?? 0;
  return level * 0.5;
}

/** Dayanıklılık — kondisyon kaybı azaltma */
export function getDurabilityConditionLossReduction(truck: Truck): number {
  const level = normalizeTruckUpgrades(truck).upgrades?.durability ?? 0;
  return level * 0.08;
}

export function getEffectiveTruckCapacity(truck: Truck): number {
  const normalized = normalizeTruckUpgrades(truck);
  return normalized.capacity + getCargoCapacityBonus(normalized);
}

export function isTruckSuitableForRiskyContract(
  truck: Truck,
  recommendedCondition?: number,
): { suitable: boolean; warning: boolean } {
  const condition = truck.condition ?? 100;
  const recommended = recommendedCondition ?? 70;
  if (condition < 30) {
    return { suitable: false, warning: true };
  }
  if (condition < recommended) {
    return { suitable: true, warning: true };
  }
  return { suitable: true, warning: false };
}

export function getTruckUpgradeSummary(truck: Truck): string[] {
  const normalized = normalizeTruckUpgrades(truck);
  const badges: string[] = [];
  for (const [key, label] of Object.entries(TRUCK_UPGRADE_LABELS) as [TruckUpgradeType, string][]) {
    const level = normalized.upgrades?.[key] ?? 0;
    if (level > 0) {
      badges.push(`${label} +${level}`);
    }
  }
  return badges;
}
