/**
 * Depo maliyet hesapları — warehouseBalance tek kaynak.
 */

import { operatingCostBalance, tradingBalance, warehouseBalance } from '../config/balance';
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
