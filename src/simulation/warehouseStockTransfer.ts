/**
 * Depolar arası stok transferi V1 — oyuncunun kendi stoğu.
 * Sözleşme değildir; sabit ödeme yok, yakıt/operasyon maliyeti vardır.
 */

import { deliveryBalance, economyBalance, tradingBalance } from '../config/balance';
import { getCityName, getProductByIdSafe } from '../utils/entityLookup';
import {
  advanceFuelConstrainedProgress,
  getFuelRequiredForJob,
  normalizeTruckFuel,
} from '../utils/truckFuel';
import { clamp } from '../utils/math';
import {
  calculateActualSpeedKmh,
  calculateVehicleSpeed,
} from '../utils/vehiclePerformance';
import {
  getTruckEffectiveCapacityTons,
  getAttachedTrailerForTruck,
  hasEnoughCargoCapacity,
} from './capacity';
import { isDriverIdle, resolveTruckCityId } from './delivery';
import {
  calculateTransferDurationHours,
  findActiveTransferForTruck,
  resolveTransferRoute,
  selectDriverForTransfer,
  updateTransferProgress,
} from './truckTransfer';
import {
  getCityProductMarketPrice,
  getWarehouseInventoryItem,
  getWarehouseUsedCapacityTon,
  mergeInventoryOnBuy,
  normalizeWarehouse,
  reduceInventoryOnSell,
  calculateTradeSellRevenue,
  calculateTradeProfit,
} from './trading';
import {
  requiresColdStorage,
  resolveStorageBlockResult,
  tradeFail,
  tradeOk,
} from './warehouseActions';
import { evaluateStorageSuitability, resolveWarehouseType } from './warehouseStorage';
import type {
  City,
  Driver,
  ProductId,
  Route,
  TradeActionResult,
  Trailer,
  Truck,
  TruckTransfer,
  Warehouse,
  WarehouseActionReason,
  WarehouseStockTransfer,
  WarehouseStockTransferStatus,
} from '../types/game';

const MAX_COMPLETED_STOCK_TRANSFERS = 40;

export const WAREHOUSE_STOCK_TRANSFER_REASON_MESSAGES: Record<
  Extract<
    WarehouseActionReason,
    | 'insufficient-stock'
    | 'source-destination-same'
    | 'destination-full'
    | 'cold-storage-required'
    | 'incompatible-trailer'
    | 'no-available-truck'
    | 'no-available-driver'
    | 'insufficient-capacity'
    | 'insufficient-fuel'
    | 'route-not-found'
    | 'transfer-in-progress'
    | 'invalid-quantity'
    | 'warehouse-required'
    | 'insufficient-funds'
    | 'product-not-found'
  >,
  string
> = {
  'insufficient-stock': 'Kaynak depoda yeterli stok yok.',
  'source-destination-same': 'Kaynak ve hedef depo farklı olmalı.',
  'destination-full': 'Hedef depoda yeterli boş alan yok.',
  'cold-storage-required':
    'Bu ürün soğuk zincir gerektiriyor. Hedef şehirde Soğuk Depo seç.',
  'incompatible-trailer': 'Bu ürün için Soğutuculu Dorse gerekli.',
  'no-available-truck': 'Kaynak şehirde uygun boş kamyon yok.',
  'no-available-driver': 'Müsait şoför bulunamadı.',
  'insufficient-capacity': 'Seçilen kamyon ve dorse kapasitesi yetersiz.',
  'insufficient-fuel': 'Kamyonun yakıtı bu transfer için yeterli değil.',
  'route-not-found': 'Bu şehirler arasında kullanılabilir rota bulunamadı.',
  'transfer-in-progress': 'Seçilen araç başka bir transferde.',
  'invalid-quantity': 'Geçerli bir miktar seçmelisin.',
  'warehouse-required': 'Kaynak veya hedef depo bulunamadı.',
  'insufficient-funds': 'Transfer operasyon maliyeti için nakit yetersiz.',
  'product-not-found': 'Ürün bulunamadı.',
};

export function getWarehouseStockTransferReasonMessage(reason: WarehouseActionReason): string {
  return (
    WAREHOUSE_STOCK_TRANSFER_REASON_MESSAGES[
      reason as keyof typeof WAREHOUSE_STOCK_TRANSFER_REASON_MESSAGES
    ] ?? 'Transfer başlatılamadı.'
  );
}

export function getActiveWarehouseStockTransfers(
  transfers: WarehouseStockTransfer[] | undefined,
): WarehouseStockTransfer[] {
  return (transfers ?? []).filter(
    (transfer) =>
      transfer.status === 'active' ||
      transfer.status === 'pending' ||
      transfer.status === 'paused',
  );
}

export function findActiveWarehouseStockTransferForTruck(
  truckId: string,
  transfers: WarehouseStockTransfer[] | undefined,
): WarehouseStockTransfer | undefined {
  return getActiveWarehouseStockTransfers(transfers).find((transfer) => transfer.truckId === truckId);
}

export function getWarehouseReservedIncomingTons(
  warehouseId: string,
  transfers: WarehouseStockTransfer[] | undefined,
): number {
  return getActiveWarehouseStockTransfers(transfers).reduce((sum, transfer) => {
    if (transfer.destinationWarehouseId !== warehouseId) {
      return sum;
    }
    return sum + Math.max(0, transfer.quantityTons);
  }, 0);
}

export function getWarehouseEffectiveAvailableCapacityTons(
  warehouse: Warehouse,
  transfers: WarehouseStockTransfer[] | undefined,
): number {
  const normalized = normalizeWarehouse(warehouse);
  const capacity = normalized.capacityTons ?? 0;
  const used = getWarehouseUsedCapacityTon(normalized);
  const incoming = getWarehouseReservedIncomingTons(warehouse.id, transfers);
  return Math.max(0, capacity - used - incoming);
}

export function trailerSupportsColdCargo(trailer: Trailer | undefined): boolean {
  return trailer?.type === 'refrigerated';
}

export function calculateStockTransferFuelLiters(params: {
  quantityTons: number;
  truck: Truck;
  driver: Driver;
  route: Route;
}): number {
  const liters = getFuelRequiredForJob({
    distanceKm: params.route.distanceKm,
    truck: params.truck,
    cargoWeightTons: Math.max(0, params.quantityTons),
    routeDifficulty: params.route.difficulty,
    driverFuelSaving: params.driver.fuelSaving,
  });
  return Math.max(0, Math.round(liters));
}

export function calculateStockTransferCosts(params: {
  distanceKm: number;
  truck: Truck;
  driver: Driver;
  durationHours: number;
  fuelPrice: number;
  fuelLiters: number;
}): { fuelCost: number; driverCost: number; totalCost: number } {
  // Model A: nakit = yakıt; driverCost yalnız allocated (periodic salary ayrı)
  const fuelCost = params.fuelLiters * params.fuelPrice;
  const salaryPerDay = params.driver.salaryPerDay ?? params.driver.dailySalary ?? 0;
  const allocatedDriverCost =
    params.durationHours * (salaryPerDay / 24) * deliveryBalance.driverCostMultiplier;
  return {
    fuelCost: Number(fuelCost.toFixed(2)),
    driverCost: Number(allocatedDriverCost.toFixed(2)),
    totalCost: Number(fuelCost.toFixed(2)),
  };
}

export interface ValidateWarehouseStockTransferParams {
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  productId: ProductId;
  quantityTons: number;
  truckId?: string;
  driverId?: string;
  warehouses: Warehouse[];
  trucks: Truck[];
  trailers: Trailer[];
  drivers: Driver[];
  routes: Route[];
  activeWarehouseStockTransfers?: WarehouseStockTransfer[];
  activeTransfers?: TruckTransfer[];
  activeDeliveries?: Array<{ truckId: string; status: string }>;
  homeCityId?: string;
  playerMoney?: number;
  fuelPrice?: number;
  skipAffordabilityCheck?: boolean;
  /** UI ön kontrolü gerekli litreyi gösterebilsin; store başlangıç validasyonunda kullanılmaz. */
  skipFuelCheck?: boolean;
}

function isTruckOnActiveDelivery(
  truckId: string,
  deliveries: Array<{ truckId: string; status: string }> | undefined,
): boolean {
  return (deliveries ?? []).some(
    (delivery) =>
      delivery.truckId === truckId &&
      (delivery.status === 'preparing' ||
        delivery.status === 'on_route' ||
        delivery.status === 'paused'),
  );
}

export interface ValidatedWarehouseStockTransfer {
  sourceWarehouse: Warehouse;
  destinationWarehouse: Warehouse;
  productId: ProductId;
  quantityTons: number;
  averagePurchasePrice: number;
  quality: number;
  truck: Truck;
  trailer: Trailer | undefined;
  driver: Driver;
  route: Route;
  durationHours: number;
  fuelLiters: number;
  fuelLitersAtStart: number;
  costs: { fuelCost: number; driverCost: number; totalCost: number };
}

export function validateWarehouseStockTransfer(
  params: ValidateWarehouseStockTransferParams,
): TradeActionResult & { validated?: ValidatedWarehouseStockTransfer } {
  const quantity = params.quantityTons;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return tradeFail('invalid-quantity', getWarehouseStockTransferReasonMessage('invalid-quantity'));
  }
  if (quantity < tradingBalance.minTradeQuantity) {
    return tradeFail(
      'invalid-quantity',
      `Minimum transfer miktarı ${tradingBalance.minTradeQuantity} ton.`,
    );
  }

  if (params.sourceWarehouseId === params.destinationWarehouseId) {
    return tradeFail(
      'source-destination-same',
      getWarehouseStockTransferReasonMessage('source-destination-same'),
    );
  }

  const sourceWarehouse = params.warehouses.find((w) => w.id === params.sourceWarehouseId);
  const destinationWarehouse = params.warehouses.find((w) => w.id === params.destinationWarehouseId);
  if (!sourceWarehouse || !destinationWarehouse) {
    return tradeFail('warehouse-required', getWarehouseStockTransferReasonMessage('warehouse-required'));
  }

  if (sourceWarehouse.cityId === destinationWarehouse.cityId) {
    return tradeFail(
      'source-destination-same',
      'Kaynak ve hedef şehir farklı olmalı.',
    );
  }

  const product = getProductByIdSafe(params.productId);
  if (!product) {
    return tradeFail('product-not-found', getWarehouseStockTransferReasonMessage('product-not-found'));
  }

  const storageBlock = resolveStorageBlockResult(product, destinationWarehouse.warehouseType);
  if (storageBlock) {
    return storageBlock;
  }

  const normalizedSource = normalizeWarehouse(sourceWarehouse);
  const inventoryItem = getWarehouseInventoryItem(normalizedSource, params.productId);
  const available = inventoryItem?.quantity ?? 0;
  if (!inventoryItem || available + 1e-9 < quantity) {
    return tradeFail(
      'insufficient-stock',
      `Kaynak depoda yalnızca ${available.toFixed(1)} ton var.`,
      'INSUFFICIENT_INVENTORY',
    );
  }

  const availableDest = getWarehouseEffectiveAvailableCapacityTons(
    destinationWarehouse,
    params.activeWarehouseStockTransfers,
  );
  if (quantity > availableDest + 1e-9) {
    return tradeFail(
      'destination-full',
      `Hedef depoda boş alan: ${availableDest.toFixed(1)} ton.`,
      'INSUFFICIENT_CAPACITY',
    );
  }

  const route = resolveTransferRoute(
    params.routes,
    sourceWarehouse.cityId,
    destinationWarehouse.cityId,
  );
  if (!route) {
    return tradeFail('route-not-found', getWarehouseStockTransferReasonMessage('route-not-found'));
  }

  const idleTrucksInSource = (params.trucks ?? []).filter((truck) => {
    if (truck.status !== 'idle') return false;
    if (findActiveTransferForTruck(truck.id, params.activeTransfers)) return false;
    if (findActiveWarehouseStockTransferForTruck(truck.id, params.activeWarehouseStockTransfers)) {
      return false;
    }
    if (isTruckOnActiveDelivery(truck.id, params.activeDeliveries)) return false;
    const cityId = resolveTruckCityId(truck, params.homeCityId);
    return cityId === sourceWarehouse.cityId;
  });

  const truck =
    (params.truckId
      ? idleTrucksInSource.find((candidate) => candidate.id === params.truckId)
      : undefined) ?? idleTrucksInSource[0];

  if (!truck) {
    return tradeFail('no-available-truck', getWarehouseStockTransferReasonMessage('no-available-truck'));
  }

  if (findActiveWarehouseStockTransferForTruck(truck.id, params.activeWarehouseStockTransfers)) {
    return tradeFail(
      'transfer-in-progress',
      getWarehouseStockTransferReasonMessage('transfer-in-progress'),
    );
  }

  const trailer = getAttachedTrailerForTruck(truck.id, params.trailers);
  if (requiresColdStorage(product) && !trailerSupportsColdCargo(trailer)) {
    return tradeFail(
      'incompatible-trailer',
      getWarehouseStockTransferReasonMessage('incompatible-trailer'),
    );
  }

  const effectiveCapacity = getTruckEffectiveCapacityTons(truck, params.trailers);
  if (!hasEnoughCargoCapacity(effectiveCapacity, quantity)) {
    return tradeFail(
      'insufficient-capacity',
      `Kamyon kapasitesi ${effectiveCapacity.toFixed(1)} ton; istenen ${quantity.toFixed(1)} ton.`,
    );
  }

  const driver =
    (params.driverId
      ? params.drivers.find((d) => d.id === params.driverId && isDriverIdle(d))
      : undefined) ?? selectDriverForTransfer(truck.id, params.drivers);

  if (!driver || !isDriverIdle(driver)) {
    return tradeFail('no-available-driver', getWarehouseStockTransferReasonMessage('no-available-driver'));
  }

  const durationHours = calculateTransferDurationHours(
    route.distanceKm,
    calculateVehicleSpeed({
      truck,
      driver,
      route,
      cargoWeightTons: quantity,
      trailer,
    }).effectiveSpeedKmh,
  );
  const fuelLiters = calculateStockTransferFuelLiters({
    quantityTons: quantity,
    truck,
    driver,
    route,
  });
  const fuelNorm = normalizeTruckFuel(truck);
  const fuelAtStart = fuelNorm.currentFuelL ?? 0;
  if (!params.skipFuelCheck && fuelAtStart + 1e-6 < fuelLiters) {
    return tradeFail(
      'insufficient-fuel',
      `Bu rota için ${Math.ceil(fuelLiters)} L yakıt gerekiyor. Kamyonda ${Math.floor(fuelAtStart)} L var.`,
    );
  }

  const fuelPrice = params.fuelPrice ?? economyBalance.baseFuelPrice;
  const costs = calculateStockTransferCosts({
    distanceKm: route.distanceKm,
    truck,
    driver,
    durationHours,
    fuelPrice,
    fuelLiters,
  });

  return {
    ...tradeOk('Transfer hazır.'),
    validated: {
      sourceWarehouse: normalizedSource,
      destinationWarehouse: normalizeWarehouse(destinationWarehouse),
      productId: params.productId,
      quantityTons: quantity,
      averagePurchasePrice: inventoryItem.averageBuyPrice,
      quality: inventoryItem.quality ?? 100,
      truck,
      trailer,
      driver,
      route,
      durationHours,
      fuelLiters,
      fuelLitersAtStart: fuelAtStart,
      costs,
    },
  };
}

export function createWarehouseStockTransfer(params: {
  validated: ValidatedWarehouseStockTransfer;
  currentTime: number;
  sequence: number;
}): WarehouseStockTransfer {
  const { validated, currentTime, sequence } = params;
  return {
    id: `wst_${Date.now()}_${sequence}`,
    sourceWarehouseId: validated.sourceWarehouse.id,
    destinationWarehouseId: validated.destinationWarehouse.id,
    sourceCityId: validated.sourceWarehouse.cityId,
    destinationCityId: validated.destinationWarehouse.cityId,
    productId: validated.productId,
    quantityTons: validated.quantityTons,
    averagePurchasePriceAtStart: validated.averagePurchasePrice,
    reservedInventoryCost: validated.quantityTons * validated.averagePurchasePrice,
    qualityAtStart: validated.quality,
    truckId: validated.truck.id,
    trailerId: validated.trailer?.id,
    driverId: validated.driver.id,
    routeDistanceKm: validated.route.distanceKm,
    progress: 0,
    status: 'active',
    startedAt: currentTime,
    estimatedCompletionAt: currentTime + validated.durationHours,
    fuelLitersAtStart: validated.fuelLitersAtStart,
    fuelLitersTotal: validated.fuelLiters,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    lastFuelProcessedAt: currentTime,
    distanceTraveledKm: 0,
    currentSpeedKmh: 0,
    fuelWarningsEmitted: [],
    fuelCost: validated.costs.fuelCost,
    driverCost: validated.costs.driverCost,
    totalCost: validated.costs.totalCost,
  };
}

export function updateWarehouseStockTransferProgress(
  transfer: WarehouseStockTransfer,
  hoursPassed: number,
): WarehouseStockTransfer {
  if ((transfer.status !== 'active' && transfer.status !== 'pending') || hoursPassed <= 0) {
    return transfer;
  }
  const asTruckTransfer = {
    ...transfer,
    fromCityId: transfer.sourceCityId,
    toCityId: transfer.destinationCityId,
    distanceKm: transfer.routeDistanceKm,
    estimatedArrivalAt: transfer.estimatedCompletionAt,
    status: 'active' as const,
  };
  const updated = updateTransferProgress(asTruckTransfer, hoursPassed);
  return {
    ...transfer,
    status: 'active',
    progress: clamp(updated.progress, 0, 1),
    currentSpeedKmh: updated.currentSpeedKmh,
  };
}

export function updateWarehouseStockTransferProgressWithFuel(
  transfer: WarehouseStockTransfer,
  truck: Truck,
  hoursPassed: number,
  processedAt?: number,
): { transfer: WarehouseStockTransfer; truck: Truck } {
  if (hoursPassed <= 0) {
    return { transfer, truck };
  }
  if (
    processedAt != null &&
    transfer.lastFuelProcessedAt != null &&
    transfer.lastFuelProcessedAt === processedAt
  ) {
    return { transfer, truck };
  }

  if (transfer.status === 'paused' && transfer.pausedReason === 'out-of-fuel') {
    return {
      transfer: {
        ...transfer,
        estimatedCompletionAt: transfer.estimatedCompletionAt + hoursPassed,
        lastFuelProcessedAt: processedAt ?? transfer.lastFuelProcessedAt,
        currentSpeedKmh: 0,
      },
      truck: {
        ...normalizeTruckFuel(truck),
        currentFuelL: 0,
        status: 'out_of_fuel',
      },
    };
  }

  if (transfer.status !== 'active' && transfer.status !== 'pending') {
    return { transfer, truck };
  }

  const normalizedTruck = normalizeTruckFuel(truck);
  const travelHours = Math.max(
    1,
    transfer.estimatedCompletionAt - transfer.startedAt,
  );
  const requestedProgressDelta = Math.min(
    Math.max(0, 1 - transfer.progress),
    hoursPassed / travelHours,
  );
  const result = advanceFuelConstrainedProgress({
    currentProgress: transfer.progress,
    requestedProgressDelta,
    fuelLitersAtStart: transfer.fuelLitersAtStart,
    fuelLitersTotal: transfer.fuelLitersTotal,
    currentFuelL: normalizedTruck.currentFuelL ?? 0,
    fuelConsumedL: transfer.fuelConsumedL,
    lastFuelProcessedProgress: transfer.lastFuelProcessedProgress,
    distanceKm: transfer.routeDistanceKm,
    distanceTraveledKm: transfer.distanceTraveledKm,
  });

  return {
    transfer: {
      ...transfer,
      progress: result.progress,
      status: result.outOfFuel ? 'paused' : 'active',
      pausedReason: result.outOfFuel ? 'out-of-fuel' : undefined,
      fuelConsumedL: result.fuelConsumedL,
      lastFuelProcessedProgress: result.lastFuelProcessedProgress,
      lastFuelProcessedAt: processedAt ?? transfer.lastFuelProcessedAt,
      distanceTraveledKm: result.distanceTraveledKm,
      currentSpeedKmh: calculateActualSpeedKmh({
        distanceDeltaKm: result.mileageDeltaKm,
        elapsedHoursDelta: hoursPassed,
        paused: result.actualProgressDelta <= 0,
      }),
      estimatedCompletionAt: result.outOfFuel
        ? transfer.estimatedCompletionAt +
          hoursPassed *
            Math.max(
              0,
              1 -
                result.actualProgressDelta /
                  Math.max(requestedProgressDelta, Number.EPSILON),
            )
        : transfer.estimatedCompletionAt,
    },
    truck: {
      ...normalizedTruck,
      currentFuelL: result.currentFuelL,
      totalMileageKm:
        (normalizedTruck.totalMileageKm ?? 0) + result.mileageDeltaKm,
      status: result.outOfFuel ? 'out_of_fuel' : normalizedTruck.status,
    },
  };
}

export function applySourceReservationOnStart(
  warehouses: Warehouse[],
  transfer: WarehouseStockTransfer,
  currentTime: number,
): Warehouse[] {
  return warehouses.map((warehouse) => {
    if (warehouse.id !== transfer.sourceWarehouseId) {
      return warehouse;
    }
    const normalized = normalizeWarehouse(warehouse, currentTime);
    const nextInventory = reduceInventoryOnSell(
      normalized.inventory ?? [],
      transfer.productId,
      transfer.quantityTons,
    );
    const usedCapacityTon = nextInventory.reduce((sum, item) => sum + item.quantity, 0);
    return normalizeWarehouse({
      ...normalized,
      inventory: nextInventory,
      usedCapacityTon,
    }, currentTime);
  });
}

export function applyDestinationCompletion(
  warehouses: Warehouse[],
  transfer: WarehouseStockTransfer,
  currentTime: number,
): Warehouse[] {
  return warehouses.map((warehouse) => {
    if (warehouse.id !== transfer.destinationWarehouseId) {
      return warehouse;
    }
    const normalized = normalizeWarehouse(warehouse, currentTime);
    const nextInventory = mergeInventoryOnBuy(
      normalized.inventory ?? [],
      transfer.productId,
      transfer.quantityTons,
      transfer.averagePurchasePriceAtStart,
      normalized,
      currentTime,
    );
    // Preserve quality weighting: mergeInventoryOnBuy adds at 100 quality; re-apply if needed
    const usedCapacityTon = nextInventory.reduce((sum, item) => sum + item.quantity, 0);
    return normalizeWarehouse({
      ...normalized,
      inventory: nextInventory,
      usedCapacityTon,
    }, currentTime);
  });
}

export function rollbackStockToSource(
  warehouses: Warehouse[],
  transfer: WarehouseStockTransfer,
  currentTime: number,
): Warehouse[] {
  return warehouses.map((warehouse) => {
    if (warehouse.id !== transfer.sourceWarehouseId) {
      return warehouse;
    }
    const normalized = normalizeWarehouse(warehouse, currentTime);
    const nextInventory = mergeInventoryOnBuy(
      normalized.inventory ?? [],
      transfer.productId,
      transfer.quantityTons,
      transfer.averagePurchasePriceAtStart,
      normalized,
      currentTime,
    );
    const usedCapacityTon = nextInventory.reduce((sum, item) => sum + item.quantity, 0);
    return normalizeWarehouse({
      ...normalized,
      inventory: nextInventory,
      usedCapacityTon,
    }, currentTime);
  });
}

export function appendCompletedWarehouseStockTransfer(
  completed: WarehouseStockTransfer[] | undefined,
  transfer: WarehouseStockTransfer,
): WarehouseStockTransfer[] {
  return [transfer, ...(completed ?? [])].slice(0, MAX_COMPLETED_STOCK_TRANSFERS);
}

export function markWarehouseStockTransferSettled(
  transfer: WarehouseStockTransfer,
  status: Extract<WarehouseStockTransferStatus, 'completed' | 'failed' | 'cancelled'>,
  currentTime: number,
  failureReason?: WarehouseActionReason | string,
): WarehouseStockTransfer {
  return {
    ...transfer,
    status,
    progress: status === 'completed' ? 1 : transfer.progress,
    completedAt: currentTime,
    settledAt: currentTime,
    failureReason,
  };
}

export interface WarehouseTransferPreview {
  productName: string;
  quantityTons: number;
  sourceCity: string;
  destinationCity: string;
  distanceKm: number;
  estimatedDurationHours: number;
  requiredCapacity: number;
  selectedTruckEffectiveCapacity: number;
  fuelCost: number;
  driverCost: number;
  totalEstimatedCost: number;
  targetMarketPrice: number | null;
  projectedRevenue: number | null;
  projectedGrossProfit: number | null;
  projectedNetProfit: number | null;
}

export function buildWarehouseTransferPreview(params: {
  validated: ValidatedWarehouseStockTransfer;
  destinationCity?: City;
  trailers?: Trailer[];
}): WarehouseTransferPreview {
  const { validated, destinationCity } = params;
  const product = getProductByIdSafe(validated.productId);
  const productName = product?.name ?? validated.productId;
  const effectiveCapacity = getTruckEffectiveCapacityTons(
    validated.truck,
    params.trailers ?? (validated.trailer ? [validated.trailer] : []),
  );
  let targetMarketPrice: number | null = null;
  let projectedRevenue: number | null = null;
  let projectedGrossProfit: number | null = null;
  let projectedNetProfit: number | null = null;

  if (destinationCity?.products?.[validated.productId]) {
    targetMarketPrice = getCityProductMarketPrice(destinationCity, validated.productId);
    projectedRevenue = calculateTradeSellRevenue(
      targetMarketPrice,
      validated.quantityTons,
      validated.quality,
    );
    projectedGrossProfit = calculateTradeProfit(
      targetMarketPrice,
      validated.averagePurchasePrice,
      validated.quantityTons,
      validated.quality,
    );
    projectedNetProfit = projectedGrossProfit - validated.costs.totalCost;
  }

  return {
    productName,
    quantityTons: validated.quantityTons,
    sourceCity: getCityName(validated.sourceWarehouse.cityId),
    destinationCity: getCityName(validated.destinationWarehouse.cityId),
    distanceKm: validated.route.distanceKm,
    estimatedDurationHours: validated.durationHours,
    requiredCapacity: validated.quantityTons,
    selectedTruckEffectiveCapacity: effectiveCapacity,
    fuelCost: validated.costs.fuelCost,
    driverCost: validated.costs.driverCost,
    totalEstimatedCost: validated.costs.totalCost,
    targetMarketPrice,
    projectedRevenue,
    projectedGrossProfit,
    projectedNetProfit,
  };
}

/** Destination warehouse suitability quick check for UI listing */
export function canWarehouseReceiveProduct(
  warehouse: Warehouse,
  productId: ProductId,
): boolean {
  const product = getProductByIdSafe(productId);
  if (!product) return false;
  return evaluateStorageSuitability(product, resolveWarehouseType(warehouse.warehouseType)) !== 'blocked';
}

export function listEligibleDestinationWarehouses(params: {
  warehouses: Warehouse[];
  sourceWarehouseId: string;
  productId: ProductId;
  quantityTons: number;
  activeWarehouseStockTransfers?: WarehouseStockTransfer[];
}): Warehouse[] {
  return params.warehouses.filter((warehouse) => {
    if (warehouse.id === params.sourceWarehouseId) return false;
    const source = params.warehouses.find((w) => w.id === params.sourceWarehouseId);
    if (!source || source.cityId === warehouse.cityId) return false;
    if (!canWarehouseReceiveProduct(warehouse, params.productId)) return false;
    return (
      getWarehouseEffectiveAvailableCapacityTons(warehouse, params.activeWarehouseStockTransfers) >=
      params.quantityTons
    );
  });
}
