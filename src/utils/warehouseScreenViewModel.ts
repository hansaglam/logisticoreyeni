/**
 * Depolar ekranı view model — gerçek store verisinden türetilir, sahte metrik yok.
 */

import {
  canOpenMoreWarehouses,
  getCityUnlockLevel,
  getMaxWarehousesForLevel,
  getNextLevelForMoreWarehouses,
  isWarehouseCityUnlocked,
} from '../config/levelConfig';
import { getCityName, getProductName } from './entityLookup';
import { calculateTradeProfit, getCityProductMarketPrice, normalizeWarehouse } from '../simulation/trading';
import { requiresColdStorage } from '../simulation/warehouseActions';
import {
  cityHasWarehouseType,
  getInventoryQuality,
  getWarehouseTypeLabel,
  productNeedsColdStorage,
  resolveWarehouseType,
} from '../simulation/warehouseStorage';
import { getWarehouseMetrics } from '../simulation/warehouseMetrics';
import {
  getActiveWarehouseStockTransfers,
  getWarehouseStockTransferReasonMessage,
} from '../simulation/warehouseStockTransfer';
import {
  estimateNewWarehouseDailyOperatingCost,
  estimateWarehouseOpenCost,
  getWarehouseUpgradePreview,
} from './warehouseCalculations';
import type {
  City,
  Driver,
  FinanceLedgerEntry,
  Product,
  ProductId,
  Trailer,
  Truck,
  Warehouse,
  WarehouseStockTransfer,
  WarehouseType,
} from '../types/game';

const SHORTAGE_RATIO = 0.7;
const SURPLUS_RATIO = 1.2;
const MAX_CITY_OPPORTUNITIES = 4;

export type WarehouseOccupancyStatus = 'empty' | 'active' | 'nearly-full' | 'full';

export interface WarehouseStockRowVm {
  productId: ProductId;
  productName: string;
  quantityTons: number;
  averageBuyPrice: number;
  currentPrice: number;
  unrealizedProfit: number;
  needsCold: boolean;
  quality: number;
}

export interface OwnedWarehouseCardVm {
  warehouse: Warehouse;
  cityName: string;
  type: WarehouseType;
  typeLabel: string;
  level: number;
  status: WarehouseOccupancyStatus;
  statusLabel: string;
  usedTons: number;
  capacityTons: number;
  occupancyPercent: number;
  dailyCost: number;
  inventoryValue: number;
  unrealizedProfit: number;
  productTypeCount: number;
  stocks: WarehouseStockRowVm[];
  upgradePreview: ReturnType<typeof getWarehouseUpgradePreview>;
  canAffordUpgrade: boolean;
  upgradeDisabled: boolean;
  upgradeHelperText: string | null;
}

export interface WarehouseTransferCardVm {
  transfer: WarehouseStockTransfer;
  productName: string;
  sourceCityName: string;
  destinationCityName: string;
  truckName: string;
  trailerLabel: string;
  driverName: string;
  needsCold: boolean;
  remainingKm: number;
  progressPercent: number;
  projectedNetProfit: number | null;
}

export interface WarehouseOpportunityVm {
  cityId: string;
  cityName: string;
  economicLabel: string;
  signalCount: number;
  costModifier: number;
  standardOpenCost: number;
  standardDailyCost: number;
  coldOpenCost: number;
  coldDailyCost: number;
  hasStandard: boolean;
  hasCold: boolean;
  cityUnlocked: boolean;
  requiredLevel: number;
  mode: 'new-city' | 'add-cold';
}

export interface WarehouseScreenOverview {
  inventoryValue: number;
  usedCapacityTons: number;
  totalCapacityTons: number;
  occupancyPercent: number;
  dailyOperatingCost: number;
  activeTransferCount: number;
  activeTransferTons: number;
}

export interface WarehouseScreenViewModel {
  overview: WarehouseScreenOverview;
  warehouses: OwnedWarehouseCardVm[];
  activeTransfers: WarehouseTransferCardVm[];
  opportunities: WarehouseOpportunityVm[];
  limits: {
    currentCount: number;
    maxCount: number;
    canOpenMore: boolean;
    nextLevelForMore: number;
  };
}

function occupancyStatus(percent: number, hasStock: boolean): {
  status: WarehouseOccupancyStatus;
  label: string;
} {
  if (!hasStock || percent <= 0) return { status: 'empty', label: 'Boş' };
  if (percent >= 100) return { status: 'full', label: 'Tam Dolu' };
  if (percent >= 80) return { status: 'nearly-full', label: 'Dolmak Üzere' };
  return { status: 'active', label: 'Aktif' };
}

function countSignals(city: City): number {
  let count = 0;
  for (const state of Object.values(city.products)) {
    const target = state.targetStock > 0 ? state.targetStock : Math.max(state.stock, 1);
    const ratio = state.stock / target;
    if (ratio < SHORTAGE_RATIO || ratio > SURPLUS_RATIO) count += 1;
  }
  return count;
}

function economicLabel(city: City): string {
  const signals = countSignals(city);
  if (signals >= 5) return 'Yüksek ticaret potansiyeli';
  if (city.warehouseCostModifier >= 1.2) return 'Pahalı depo bölgesi';
  if (city.warehouseCostModifier <= 0.95) return 'Uygun maliyetli bölge';
  return 'Normal piyasa';
}

function trailerLabel(trailer: Trailer | undefined): string {
  if (!trailer) return 'Dorse yok';
  switch (trailer.type) {
    case 'refrigerated':
      return 'Soğutuculu Dorse';
    case 'heavy':
      return 'Ağır Dorse';
    case 'container':
      return 'Konteyner Dorse';
    default:
      return 'Standart Dorse';
  }
}

export function buildWarehouseScreenViewModel(params: {
  warehouses: Warehouse[];
  cities: City[];
  products: Product[];
  trucks: Truck[];
  trailers: Trailer[];
  drivers: Driver[];
  activeWarehouseStockTransfers: WarehouseStockTransfer[] | undefined;
  financeLedger?: FinanceLedgerEntry[];
  currentTime?: number;
  playerLevel: number;
  playerMoney: number;
}): WarehouseScreenViewModel {
  const {
    warehouses,
    cities,
    products,
    trucks,
    trailers,
    drivers,
    activeWarehouseStockTransfers,
    financeLedger,
    currentTime = 0,
    playerLevel,
    playerMoney,
  } = params;

  const cityById = new Map(cities.map((city) => [city.id, city]));
  const truckById = new Map(trucks.map((truck) => [truck.id, truck]));
  const trailerById = new Map(trailers.map((trailer) => [trailer.id, trailer]));
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));

  let inventoryValue = 0;
  let usedCapacityTons = 0;
  let totalCapacityTons = 0;
  let dailyOperatingCost = 0;

  const warehouseCards: OwnedWarehouseCardVm[] = warehouses.map((raw) => {
    const warehouse = normalizeWarehouse(raw, currentTime);
    const city = cityById.get(warehouse.cityId);
    const metrics = getWarehouseMetrics(warehouse, city, {
      financeLedger,
      currentTime,
    });
    inventoryValue += metrics.inventoryValue;
    usedCapacityTons += metrics.usedCapacityTons;
    totalCapacityTons += metrics.totalCapacityTons;
    dailyOperatingCost += metrics.dailyOperatingCost;

    const type = resolveWarehouseType(warehouse.warehouseType);
    const occupancy = occupancyStatus(
      metrics.occupancyPercent,
      metrics.productTypeCount > 0,
    );
    const upgradePreview = getWarehouseUpgradePreview(warehouse, city, playerMoney);
    const canAffordUpgrade = upgradePreview.canAfford;
    const requiredLevel = upgradePreview.requiredPlayerLevel;
    const isMaxed = upgradePreview.isMaxLevel || upgradePreview.nextLevel == null;
    const levelLocked = requiredLevel != null && playerLevel < requiredLevel;
    const upgradeDisabled = isMaxed || levelLocked || !canAffordUpgrade;

    const stocks: WarehouseStockRowVm[] = (warehouse.inventory ?? [])
      .filter((item) => item.quantity > 0)
      .map((item) => {
        const currentPrice = city ? getCityProductMarketPrice(city, item.productId) : 0;
        const profit = calculateTradeProfit(
          currentPrice,
          item.averageBuyPrice,
          item.quantity,
          getInventoryQuality(item),
        );
        const product = products.find((p) => p.id === item.productId);
        return {
          productId: item.productId,
          productName: getProductName(item.productId),
          quantityTons: item.quantity,
          averageBuyPrice: item.averageBuyPrice,
          currentPrice,
          unrealizedProfit: profit,
          needsCold: product ? productNeedsColdStorage(product) || requiresColdStorage(product) : false,
          quality: getInventoryQuality(item),
        };
      });

    return {
      warehouse,
      cityName: city?.name ?? getCityName(warehouse.cityId),
      type,
      typeLabel: getWarehouseTypeLabel(type),
      level: warehouse.upgradeTier ?? 1,
      status: occupancy.status,
      statusLabel: occupancy.label,
      usedTons: metrics.usedCapacityTons,
      capacityTons: metrics.totalCapacityTons,
      occupancyPercent: metrics.occupancyPercent,
      dailyCost: metrics.dailyOperatingCost,
      inventoryValue: metrics.inventoryValue,
      unrealizedProfit: metrics.unrealizedProfit,
      productTypeCount: metrics.productTypeCount,
      stocks,
      upgradePreview,
      canAffordUpgrade,
      upgradeDisabled,
      upgradeHelperText: isMaxed
        ? 'Maksimum seviyeye ulaşıldı'
        : levelLocked
          ? `Yükseltme için Level ${requiredLevel} gerekli`
          : !canAffordUpgrade
            ? 'Yükseltme için nakit yetersiz'
            : null,
    };
  });

  const activeTransfersRaw = getActiveWarehouseStockTransfers(activeWarehouseStockTransfers);
  const activeTransfers: WarehouseTransferCardVm[] = activeTransfersRaw.map((transfer) => {
    const remainingKm = Math.max(
      0,
      Math.round(transfer.routeDistanceKm * (1 - Math.min(1, Math.max(0, transfer.progress)))),
    );
    const destCity = cityById.get(transfer.destinationCityId);
    const market = destCity
      ? getCityProductMarketPrice(destCity, transfer.productId)
      : null;
    let projectedNetProfit: number | null = null;
    if (market != null && Number.isFinite(market) && market > 0) {
      const gross = calculateTradeProfit(
        market,
        transfer.averagePurchasePriceAtStart,
        transfer.quantityTons,
        transfer.qualityAtStart ?? 100,
      );
      projectedNetProfit = gross - transfer.totalCost;
    }

    const product = products.find((p) => p.id === transfer.productId);
    const trailer = transfer.trailerId
      ? trailerById.get(transfer.trailerId)
      : trailers.find((item) => item.attachedTruckId === transfer.truckId);

    return {
      transfer,
      productName: getProductName(transfer.productId),
      sourceCityName: getCityName(transfer.sourceCityId),
      destinationCityName: getCityName(transfer.destinationCityId),
      truckName: truckById.get(transfer.truckId)?.name ?? 'Kamyon',
      trailerLabel: trailerLabel(trailer),
      driverName: driverById.get(transfer.driverId)?.name ?? 'Şoför',
      needsCold: product ? productNeedsColdStorage(product) || requiresColdStorage(product) : false,
      remainingKm,
      progressPercent: Math.round(Math.min(1, Math.max(0, transfer.progress)) * 100),
      projectedNetProfit,
    };
  });

  const warehouseCityIds = new Set(warehouses.map((w) => w.cityId));
  const opportunities: WarehouseOpportunityVm[] = [];

  const newCityCandidates = cities
    .filter((city) => !warehouseCityIds.has(city.id))
    .sort((a, b) => countSignals(b) - countSignals(a))
    .slice(0, MAX_CITY_OPPORTUNITIES);

  for (const city of newCityCandidates) {
    opportunities.push({
      cityId: city.id,
      cityName: city.name,
      economicLabel: economicLabel(city),
      signalCount: countSignals(city),
      costModifier: city.warehouseCostModifier ?? 1,
      standardOpenCost: estimateWarehouseOpenCost(city, 'standard'),
      standardDailyCost: estimateNewWarehouseDailyOperatingCost(city.id, 'standard', city),
      coldOpenCost: estimateWarehouseOpenCost(city, 'cold'),
      coldDailyCost: estimateNewWarehouseDailyOperatingCost(city.id, 'cold', city),
      hasStandard: false,
      hasCold: false,
      cityUnlocked: isWarehouseCityUnlocked(city.id, playerLevel),
      requiredLevel: getCityUnlockLevel(city.id),
      mode: 'new-city',
    });
  }

  for (const city of cities) {
    if (!warehouseCityIds.has(city.id)) continue;
    if (cityHasWarehouseType(warehouses, city.id, 'cold')) continue;
    opportunities.push({
      cityId: city.id,
      cityName: city.name,
      economicLabel: 'Soğuk depo eklenebilir',
      signalCount: countSignals(city),
      costModifier: city.warehouseCostModifier ?? 1,
      standardOpenCost: estimateWarehouseOpenCost(city, 'standard'),
      standardDailyCost: estimateNewWarehouseDailyOperatingCost(city.id, 'standard', city),
      coldOpenCost: estimateWarehouseOpenCost(city, 'cold'),
      coldDailyCost: estimateNewWarehouseDailyOperatingCost(city.id, 'cold', city),
      hasStandard: cityHasWarehouseType(warehouses, city.id, 'standard'),
      hasCold: false,
      cityUnlocked: isWarehouseCityUnlocked(city.id, playerLevel),
      requiredLevel: getCityUnlockLevel(city.id),
      mode: 'add-cold',
    });
  }

  const activeTransferTons = activeTransfersRaw.reduce(
    (sum, transfer) => sum + Math.max(0, transfer.quantityTons),
    0,
  );

  return {
    overview: {
      inventoryValue,
      usedCapacityTons,
      totalCapacityTons,
      occupancyPercent:
        totalCapacityTons > 0
          ? Math.min(100, (usedCapacityTons / totalCapacityTons) * 100)
          : 0,
      dailyOperatingCost,
      activeTransferCount: activeTransfers.length,
      activeTransferTons,
    },
    warehouses: warehouseCards,
    activeTransfers,
    opportunities,
    limits: {
      currentCount: warehouses.length,
      maxCount: getMaxWarehousesForLevel(playerLevel),
      canOpenMore: canOpenMoreWarehouses(playerLevel, warehouses.length),
      nextLevelForMore: getNextLevelForMoreWarehouses(warehouses.length),
    },
  };
}

export function mapWarehouseActionReasonToMessage(
  reason: string | undefined,
  fallback?: string,
): string {
  if (!reason) return fallback ?? 'İşlem tamamlanamadı.';
  try {
    return getWarehouseStockTransferReasonMessage(reason as never);
  } catch {
    return fallback ?? reason;
  }
}

export function getStockProfitTone(profit: number): 'profit' | 'loss' | 'neutral' {
  if (profit > 1) return 'profit';
  if (profit < -1) return 'loss';
  return 'neutral';
}
