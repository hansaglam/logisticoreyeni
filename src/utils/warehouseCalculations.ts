/**
 * Depo maliyet hesapları — warehouseBalance tek kaynak.
 */

import { operatingCostBalance, tradingBalance, warehouseBalance } from '../config/balance';
import {
  getWarehouseUpgradeCapacityGain,
  getWarehouseUpgradeRequiredLevel,
} from '../config/levelConfig';
import { CITIES_BY_ID } from '../data/cities';
import { resolveWarehouseType } from '../simulation/warehouseStorage';
import type { City, Warehouse, WarehouseType } from '../types/game';

export interface WarehouseDailyCostBreakdown {
  rent: number;
  electricityCost: number;
  staffCost: number;
  total: number;
}

export type WarehouseCostInput = Warehouse & {
  /** @deprecated capacityTons kullanın */
  capacity?: number;
  /** @deprecated upgradeTier kullanın */
  level?: number;
  rent?: number;
  electricityCost?: number;
  staffCost?: number;
};

export function getDefaultWarehouseCapacityTons(): number {
  return tradingBalance.defaultWarehouseCapacityTons;
}

export function getWarehouseCapacityTons(warehouse: WarehouseCostInput): number {
  const raw =
    warehouse.capacityTons ??
    warehouse.capacityTon ??
    warehouse.capacity ??
    tradingBalance.defaultWarehouseCapacityTons;

  if (!Number.isFinite(raw) || raw <= 0) {
    return tradingBalance.defaultWarehouseCapacityTons;
  }

  return raw;
}

export function getWarehouseUpgradeTier(warehouse: WarehouseCostInput): number {
  const tier = warehouse.upgradeTier ?? warehouse.level ?? 1;
  return Number.isFinite(tier) && tier > 0 ? tier : 1;
}

export function getCityWarehouseCostModifier(
  cityId: string,
  city?: Pick<City, 'warehouseCostModifier'>,
): number {
  const modifier = city?.warehouseCostModifier ?? CITIES_BY_ID[cityId]?.warehouseCostModifier ?? 1;
  return Number.isFinite(modifier) && modifier > 0 ? modifier : 1;
}

export function getWarehouseOpenCostMultiplier(warehouseType: WarehouseType): number {
  return warehouseType === 'cold' ? warehouseBalance.coldOpenCostMultiplier : 1;
}

export function getColdElectricityMultiplier(warehouseType: WarehouseType): number {
  return warehouseType === 'cold' ? warehouseBalance.coldElectricityMultiplier : 1;
}

export function calculateWarehouseDailyOperatingCostBreakdown(
  warehouse: WarehouseCostInput,
  city?: Pick<City, 'warehouseCostModifier'>,
): WarehouseDailyCostBreakdown {
  const capacity = getWarehouseCapacityTons(warehouse);
  const tier = getWarehouseUpgradeTier(warehouse);
  const modifier = getCityWarehouseCostModifier(warehouse.cityId, city);
  const warehouseType = resolveWarehouseType(warehouse.warehouseType);
  const coldMultiplier = getColdElectricityMultiplier(warehouseType);

  const rent = capacity * warehouseBalance.rentPerTon * modifier;
  const electricityCost =
    capacity * warehouseBalance.electricityPerTon * coldMultiplier * modifier;
  const staffCost = warehouseBalance.staffCostPerLevel * tier;

  const resolvedRent = warehouse.rent ?? rent;
  const resolvedElectricity = warehouse.electricityCost ?? electricityCost;
  const resolvedStaff = warehouse.staffCost ?? staffCost;
  const total = Math.round(resolvedRent + resolvedElectricity + resolvedStaff);

  return {
    rent: resolvedRent,
    electricityCost: resolvedElectricity,
    staffCost: resolvedStaff,
    total: total > 0 ? total : operatingCostBalance.fallbackWarehouseDailyCost,
  };
}

/** Kapasite/tier değişiminden sonra güncel günlük işletme maliyetini hesaplar */
export function resolveWarehouseDailyOperatingCost(
  warehouse: WarehouseCostInput,
  city?: Pick<City, 'warehouseCostModifier'>,
): number {
  const breakdown = calculateWarehouseDailyOperatingCostBreakdown(
    {
      ...warehouse,
      rent: undefined,
      electricityCost: undefined,
      staffCost: undefined,
    },
    city,
  );
  return breakdown.total;
}

export function calculateWarehouseDailyOperatingCost(
  warehouse: WarehouseCostInput,
  city?: Pick<City, 'warehouseCostModifier'>,
): number {
  const stored = warehouse.dailyOperatingCost;
  if (stored != null && Number.isFinite(stored) && stored > 0) {
    return stored;
  }

  return calculateWarehouseDailyOperatingCostBreakdown(warehouse, city).total;
}

export function estimateWarehouseOpenCost(
  city: Pick<City, 'warehouseCostModifier'>,
  warehouseType: WarehouseType = 'standard',
): number {
  const modifier = getCityWarehouseCostModifier('', city);
  const typeMultiplier = getWarehouseOpenCostMultiplier(warehouseType);
  return Math.round(warehouseBalance.baseOpenCost * modifier * typeMultiplier);
}

export function estimateNewWarehouseDailyOperatingCost(
  cityId: string,
  warehouseType: WarehouseType = 'standard',
  city?: Pick<City, 'warehouseCostModifier'>,
): number {
  const capacity = getDefaultWarehouseCapacityTons();
  const previewWarehouse: Warehouse = {
    id: '__preview__',
    cityId,
    capacityTons: capacity,
    capacityTon: capacity,
    upgradeTier: 1,
    warehouseType,
  };

  return calculateWarehouseDailyOperatingCostBreakdown(previewWarehouse, city).total;
}

export function estimateWarehouseUpgradeCost(
  city?: Pick<City, 'warehouseCostModifier'>,
  cityId?: string,
): number {
  const modifier = city ? getCityWarehouseCostModifier(cityId ?? '', city) : 1;
  return Math.round(
    warehouseBalance.baseOpenCost * warehouseBalance.upgradeCostRatio * modifier,
  );
}

export interface WarehouseUpgradePreview {
  currentLevel: number;
  nextLevel: number | null;
  currentCapacity: number;
  nextCapacity: number | null;
  currentDailyCost: number;
  nextDailyCost: number | null;
  /** @deprecated use upgradeCost */
  upgradePrice: number | null;
  upgradeCost: number | null;
  requiredPlayerLevel: number | null;
  canAfford: boolean;
  isMaxLevel: boolean;
  isValid: boolean;
  missingMoney: number;
  failureReason?:
    | 'max-level'
    | 'insufficient-funds'
    | 'level-required'
    | 'invalid-upgrade-config';
}

/** UI + store ortak yükseltme önizlemesi */
export function getWarehouseUpgradePreview(
  warehouse: WarehouseCostInput,
  city?: Pick<City, 'warehouseCostModifier'>,
  playerMoney = Number.POSITIVE_INFINITY,
): WarehouseUpgradePreview {
  const currentLevel = getWarehouseUpgradeTier(warehouse);
  const currentCapacity = getWarehouseCapacityTons(warehouse);
  const currentDailyCost = resolveWarehouseDailyOperatingCost(warehouse, city);
  const requiredPlayerLevel = getWarehouseUpgradeRequiredLevel(currentLevel);
  const capacityGain = getWarehouseUpgradeCapacityGain(currentLevel);

  if (requiredPlayerLevel == null || capacityGain <= 0) {
    return {
      currentLevel,
      nextLevel: null,
      currentCapacity,
      nextCapacity: null,
      currentDailyCost,
      nextDailyCost: null,
      upgradePrice: null,
      upgradeCost: null,
      requiredPlayerLevel: null,
      canAfford: false,
      isMaxLevel: true,
      isValid: false,
      missingMoney: 0,
      failureReason: 'max-level',
    };
  }

  const nextLevel = currentLevel + 1;
  const nextCapacity = currentCapacity + capacityGain;
  const nextDailyCost = resolveWarehouseDailyOperatingCost(
    {
      ...warehouse,
      capacityTons: nextCapacity,
      capacityTon: nextCapacity,
      upgradeTier: nextLevel,
      dailyOperatingCost: undefined,
      rent: undefined,
      electricityCost: undefined,
      staffCost: undefined,
    },
    city,
  );
  const upgradeCost = estimateWarehouseUpgradeCost(city, warehouse.cityId);
  if (!Number.isFinite(upgradeCost) || upgradeCost < 0) {
    return {
      currentLevel,
      nextLevel: null,
      currentCapacity,
      nextCapacity: null,
      currentDailyCost,
      nextDailyCost: null,
      upgradePrice: null,
      upgradeCost: null,
      requiredPlayerLevel,
      canAfford: false,
      isMaxLevel: false,
      isValid: false,
      missingMoney: 0,
      failureReason: 'invalid-upgrade-config',
    };
  }

  const safeMoney = Number.isFinite(playerMoney) ? playerMoney : 0;
  const ignoreMoney = !Number.isFinite(playerMoney) || playerMoney === Number.POSITIVE_INFINITY;
  const canAfford = ignoreMoney ? true : safeMoney >= upgradeCost;
  const missingMoney = ignoreMoney ? 0 : Math.max(0, upgradeCost - safeMoney);

  return {
    currentLevel,
    nextLevel,
    currentCapacity,
    nextCapacity,
    currentDailyCost,
    nextDailyCost,
    upgradePrice: upgradeCost,
    upgradeCost,
    requiredPlayerLevel,
    canAfford,
    isMaxLevel: false,
    isValid: capacityGain > 0 && nextCapacity > currentCapacity && upgradeCost >= 0,
    missingMoney,
    failureReason: !canAfford ? 'insufficient-funds' : undefined,
  };
}
