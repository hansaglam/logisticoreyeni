/**
 * Kamyon yakıt tankı — varsayılan kapasite, normalize ve tüketim yardımcıları.
 */

import type { Contract, Driver, Product, Route, Truck } from '../types/game';
import { clamp } from './math';

const DEFAULT_FUEL_CONSUMPTION_PER_KM = 0.32;
const EMPTY_TRANSFER_LOAD_MULTIPLIER = 0.55;

export interface FuelCalculationContext {
  /** Yük / kapasite oranından türetilmiş açık çarpan. Verilirse cargoWeightTons yerine kullanılır. */
  loadMultiplier?: number;
  cargoWeightTons?: number;
  truckCapacityTons?: number;
  routeDifficulty?: number;
  driverFuelSaving?: number;
}

export interface FuelDistanceInput extends FuelCalculationContext {
  distanceKm: number;
  fuelConsumptionPerKm: number;
}

export interface FuelJobInput extends FuelCalculationContext {
  distanceKm: number;
  truck: Pick<Truck, 'capacity' | 'fuelConsumptionPerKm'>;
}

export interface FuelConstrainedProgressInput {
  currentProgress: number;
  requestedProgressDelta: number;
  fuelLitersAtStart: number;
  fuelLitersTotal: number;
  currentFuelL: number;
  fuelConsumedL?: number;
  lastFuelProcessedProgress?: number;
  distanceKm: number;
  distanceTraveledKm?: number;
}

export interface FuelConstrainedProgressResult {
  progress: number;
  actualProgressDelta: number;
  currentFuelL: number;
  fuelConsumedL: number;
  lastFuelProcessedProgress: number;
  distanceTraveledKm: number;
  mileageDeltaKm: number;
  outOfFuel: boolean;
}

export interface TruckFuelReadiness {
  currentFuelL: number;
  requiredFuelL: number;
  fuelDeficitL: number;
  canCompleteWithoutRefuel: boolean;
  estimatedRefuelCost: number;
}

export type TruckRefuelReason =
  | 'insufficient-funds'
  | 'tank-full'
  | 'price-changed'
  | 'truck-busy'
  | 'truck-not-found'
  | 'invalid-quantity'
  | 'market-unavailable';

export interface TruckRefuelResult {
  success: boolean;
  reason?: TruckRefuelReason;
  message: string;
  litersAdded?: number;
  totalCost?: number;
  unitPrice?: number;
}

export interface TruckRefuelQuote {
  requestedLiters: number;
  litersToAdd: number;
  currentFuelL: number;
  fuelTankCapacityL: number;
  newFuelL: number;
  unitPrice: number;
  totalCost: number;
}

export interface TruckRefuelValidation {
  result: TruckRefuelResult;
  quote?: TruckRefuelQuote;
}

const FUEL_EPSILON_L = 1e-6;

function roundFuelValue(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

/** Canonical tüketim birimi: litre / kilometre (L/km). */
export function getTruckFuelConsumptionPerKm(
  truck: Pick<Truck, 'fuelConsumptionPerKm'>,
): number {
  const value = Number(truck.fuelConsumptionPerKm);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_FUEL_CONSUMPTION_PER_KM;
}

/** Yük / kapasite oranı yakıt çarpanı. */
export function getFuelLoadMultiplier(cargoWeightTons: number, truckCapacityTons: number): number {
  const safeWeight = Math.max(0, cargoWeightTons);
  const safeCapacity = Math.max(1, truckCapacityTons);
  return 1 + (safeWeight / safeCapacity) * 0.25;
}

/** Rota zorluğu yakıt çarpanı. */
export function getFuelRouteMultiplier(routeDifficulty: number): number {
  return 1 + Math.max(0, routeDifficulty) * 0.45;
}

/** Şoför yakıt tasarrufu çarpanı. */
export function getFuelDriverMultiplier(driverFuelSaving: number): number {
  return clamp(1 - driverFuelSaving / 100, 0.35, 1);
}

function resolveFuelMultipliers(context: FuelCalculationContext): {
  load: number;
  route: number;
  driver: number;
} {
  return {
    load:
      context.loadMultiplier != null
        ? Math.max(0, context.loadMultiplier)
        : getFuelLoadMultiplier(
            context.cargoWeightTons ?? 0,
            context.truckCapacityTons ?? 1,
          ),
    route: getFuelRouteMultiplier(context.routeDifficulty ?? 0),
    driver: getFuelDriverMultiplier(context.driverFuelSaving ?? 0),
  };
}

/** Mesafe ve L/km girdisinden canonical yakıt ihtiyacını hesaplar. */
export function getFuelRequiredForDistance(input: FuelDistanceInput): number {
  const distanceKm = Math.max(0, Number(input.distanceKm) || 0);
  const consumptionPerKm = Math.max(0, Number(input.fuelConsumptionPerKm) || 0);
  const multipliers = resolveFuelMultipliers(input);
  return distanceKm * consumptionPerKm * multipliers.load * multipliers.route * multipliers.driver;
}

/** Teslimat/transfer bağlamını canonical mesafe hesabına bağlar. */
export function getFuelRequiredForJob(input: FuelJobInput): number {
  return getFuelRequiredForDistance({
    ...input,
    fuelConsumptionPerKm: getTruckFuelConsumptionPerKm(input.truck),
    truckCapacityTons: input.truckCapacityTons ?? input.truck.capacity,
  });
}

/** Canonical yakıt hesabı için isimlendirilmiş alias. */
export function calculateFuelUsed(input: FuelJobInput): number {
  return getFuelRequiredForJob(input);
}

/**
 * Bir job tick'ini mevcut yakıtla sınırlar.
 * Sonuç yalnız gerçek ilerleme için yakıt ve mileage üretir.
 */
export function advanceFuelConstrainedProgress(
  input: FuelConstrainedProgressInput,
): FuelConstrainedProgressResult {
  const currentProgress = clamp(input.currentProgress, 0, 1);
  const requestedProgressDelta = clamp(
    input.requestedProgressDelta,
    0,
    Math.max(0, 1 - currentProgress),
  );
  const fuelLitersTotal = Math.max(0, input.fuelLitersTotal);
  const distanceKm = Math.max(0, input.distanceKm);

  const previousProcessedProgress = clamp(
    input.lastFuelProcessedProgress ?? currentProgress,
    0,
    currentProgress,
  );
  const unprocessedProgress = Math.max(0, currentProgress - previousProcessedProgress);
  const totalRequestedProgress = unprocessedProgress + requestedProgressDelta;

  const previousFuelConsumed =
    input.fuelConsumedL != null
      ? clamp(input.fuelConsumedL, 0, fuelLitersTotal)
      : fuelLitersTotal * previousProcessedProgress;
  const expectedFuelAtProcessedProgress = Math.max(
    0,
    input.fuelLitersAtStart - previousFuelConsumed,
  );
  const availableFuel = clamp(
    Math.min(input.currentFuelL, expectedFuelAtProcessedProgress),
    0,
    Math.max(0, input.fuelLitersAtStart),
  );
  const requiredFuel = fuelLitersTotal * totalRequestedProgress;
  const reachableRatio =
    requiredFuel <= FUEL_EPSILON_L
      ? 1
      : clamp(availableFuel / requiredFuel, 0, 1);
  const processedProgressDelta = totalRequestedProgress * reachableRatio;
  const nextProcessedProgress = clamp(
    previousProcessedProgress + processedProgressDelta,
    0,
    1,
  );
  const progress = Math.min(
    1,
    reachableRatio >= 1 ? currentProgress + requestedProgressDelta : nextProcessedProgress,
  );
  const fuelUsedThisTick = Math.min(availableFuel, fuelLitersTotal * processedProgressDelta);
  const currentFuelL = roundFuelValue(availableFuel - fuelUsedThisTick);
  const fuelConsumedL = roundFuelValue(previousFuelConsumed + fuelUsedThisTick);

  const previousDistanceTraveled =
    input.distanceTraveledKm != null
      ? clamp(input.distanceTraveledKm, 0, distanceKm)
      : distanceKm * previousProcessedProgress;
  const nextDistanceTraveled = clamp(distanceKm * nextProcessedProgress, 0, distanceKm);
  const legacyMileageBaseline =
    input.distanceTraveledKm == null ? previousDistanceTraveled : 0;
  const mileageDeltaKm = Math.max(
    0,
    legacyMileageBaseline + (nextDistanceTraveled - previousDistanceTraveled),
  );
  const outOfFuel =
    fuelLitersTotal > FUEL_EPSILON_L &&
    currentFuelL <= FUEL_EPSILON_L &&
    progress < 1 &&
    (requestedProgressDelta > 0 || unprocessedProgress > 0);

  return {
    progress,
    actualProgressDelta: Math.max(0, progress - currentProgress),
    currentFuelL,
    fuelConsumedL,
    lastFuelProcessedProgress: nextProcessedProgress,
    distanceTraveledKm: nextDistanceTraveled,
    mileageDeltaKm,
    outOfFuel,
  };
}

function hashTruckId(truckId: string): number {
  let hash = 0;
  for (let i = 0; i < truckId.length; i += 1) {
    hash = (hash + truckId.charCodeAt(i) * 17) % 100;
  }
  return hash;
}

/** Kapasite sınıfına göre tank hacmi (L). */
export function getDefaultFuelTankCapacityL(
  truck: Pick<Truck, 'capacity' | 'fuelConsumptionPerKm'>,
): number {
  if (truck.capacity >= 28) {
    return 520;
  }
  if (truck.capacity >= 22) {
    return 400;
  }
  if (truck.capacity >= 18) {
    return 180;
  }
  return 120;
}

/** Eski save'ler için deterministik başlangıç doluluk oranı (%65–95). */
export function getDefaultFuelFillRatio(truckId: string): number {
  return 0.65 + (hashTruckId(truckId) / 100) * 0.3;
}

export function getFuelPercent(currentFuelL: number, fuelTankCapacityL: number): number {
  const capacity = Math.max(fuelTankCapacityL, 1);
  return Math.round(clamp((currentFuelL / capacity) * 100, 0, 100));
}

export function getTruckFuelPercent(truck: Truck): number {
  const normalized = normalizeTruckFuel(truck);
  return getFuelPercent(
    normalized.currentFuelL ?? 0,
    normalized.fuelTankCapacityL ?? getDefaultFuelTankCapacityL(normalized),
  );
}

export function getTruckRangeKm(
  truck: Truck,
  context: FuelCalculationContext = {},
): number {
  const normalized = normalizeTruckFuel(truck);
  const litersPerKm = getFuelRequiredForJob({
    ...context,
    distanceKm: 1,
    truck: normalized,
  });
  if (litersPerKm <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, normalized.currentFuelL ?? 0) / litersPerKm;
}

/** İşe başlamadan önce gösterilen canonical yakıt yeterlilik özeti. */
export function getTruckFuelReadiness(
  truck: Truck,
  requiredFuelL: number,
  fuelPricePerLiter: number,
): TruckFuelReadiness {
  const normalized = normalizeTruckFuel(truck);
  const currentFuelL = Math.max(0, normalized.currentFuelL ?? 0);
  const safeRequiredFuelL = Math.max(0, Number(requiredFuelL) || 0);
  const fuelDeficitL = Math.max(0, safeRequiredFuelL - currentFuelL);
  const unitPrice = Math.max(0, Number(fuelPricePerLiter) || 0);
  return {
    currentFuelL,
    requiredFuelL: safeRequiredFuelL,
    fuelDeficitL,
    canCompleteWithoutRefuel: fuelDeficitL <= FUEL_EPSILON_L,
    estimatedRefuelCost: Number((fuelDeficitL * unitPrice).toFixed(2)),
  };
}

/** Store action ve UI aynı litre/maliyet hesabını kullanır. */
export function calculateTruckRefuelQuote(
  truck: Truck,
  requestedLiters: number,
  fuelPricePerLiter: number,
): TruckRefuelQuote {
  const normalized = normalizeTruckFuel(truck);
  const currentFuelL = normalized.currentFuelL ?? 0;
  const fuelTankCapacityL =
    normalized.fuelTankCapacityL ?? getDefaultFuelTankCapacityL(normalized);
  const safeRequestedLiters = Math.max(0, Number(requestedLiters) || 0);
  const unitPrice = Math.max(0, Number(fuelPricePerLiter) || 0);
  const litersToAdd = Math.min(safeRequestedLiters, Math.max(0, fuelTankCapacityL - currentFuelL));
  return {
    requestedLiters: safeRequestedLiters,
    litersToAdd: roundFuelValue(litersToAdd),
    currentFuelL,
    fuelTankCapacityL,
    newFuelL: roundFuelValue(currentFuelL + litersToAdd),
    unitPrice,
    totalCost: Number((litersToAdd * unitPrice).toFixed(2)),
  };
}

export function validateTruckRefuelRequest(input: {
  truck: Truck;
  requestedLiters: number;
  currentMoney: number;
  currentUnitPrice: number;
  expectedUnitPrice: number;
}): TruckRefuelValidation {
  const unitPrice = Math.max(0, Number(input.currentUnitPrice) || 0);
  if (input.truck.status !== 'idle') {
    return {
      result: {
        success: false,
        reason: 'truck-busy',
        message: 'Aktif görevdeki araç şehir istasyonundan yakıt alamaz.',
      },
    };
  }
  if (
    !Number.isFinite(input.expectedUnitPrice) ||
    Math.abs(input.expectedUnitPrice - unitPrice) >= 0.005
  ) {
    return {
      result: {
        success: false,
        reason: 'price-changed',
        message: 'Yakıt fiyatı güncellendi. Yeni toplamı kontrol et.',
        unitPrice,
      },
    };
  }

  const quote = calculateTruckRefuelQuote(input.truck, input.requestedLiters, unitPrice);
  if (quote.fuelTankCapacityL - quote.currentFuelL <= FUEL_EPSILON_L) {
    return {
      result: {
        success: false,
        reason: 'tank-full',
        message: 'Yakıt deposu zaten dolu.',
        unitPrice,
      },
    };
  }
  if (
    !Number.isFinite(input.requestedLiters) ||
    input.requestedLiters <= 0 ||
    quote.litersToAdd <= 0
  ) {
    return {
      result: {
        success: false,
        reason: 'invalid-quantity',
        message: 'Geçerli bir yakıt miktarı seç.',
        unitPrice,
      },
    };
  }
  if (input.currentMoney + FUEL_EPSILON_L < quote.totalCost) {
    return {
      result: {
        success: false,
        reason: 'insufficient-funds',
        message: 'Yakıt almak için yeterli nakdin yok.',
        totalCost: quote.totalCost,
        unitPrice,
      },
    };
  }
  return {
    quote,
    result: {
      success: true,
      message: `${quote.litersToAdd.toFixed(1)} L yakıt alındı.`,
      litersAdded: quote.litersToAdd,
      totalCost: quote.totalCost,
      unitPrice,
    },
  };
}

export function normalizeTruckFuel(truck: Truck): Truck {
  const fuelTankCapacityL =
    truck.fuelTankCapacityL != null &&
    Number.isFinite(truck.fuelTankCapacityL) &&
    truck.fuelTankCapacityL > 0
      ? truck.fuelTankCapacityL
      : getDefaultFuelTankCapacityL(truck);

  const currentFuelL =
    truck.currentFuelL != null && Number.isFinite(truck.currentFuelL)
      ? clamp(truck.currentFuelL, 0, fuelTankCapacityL)
      : Math.round(fuelTankCapacityL * getDefaultFuelFillRatio(truck.id));

  return {
    ...truck,
    fuelTankCapacityL,
    currentFuelL: roundFuelValue(currentFuelL),
    totalMileageKm: Math.max(0, truck.totalMileageKm ?? 0),
  };
}

export function calculateTransferFuelLiters(
  truck: Truck,
  route: Route,
  driver?: Driver,
): number {
  const liters = getFuelRequiredForJob({
    distanceKm: route.distanceKm,
    truck,
    loadMultiplier: EMPTY_TRANSFER_LOAD_MULTIPLIER,
    routeDifficulty: route.difficulty,
    driverFuelSaving: driver?.fuelSaving ?? 0,
  });
  return Math.max(0, Math.round(liters));
}

export function calculateDeliveryFuelLiters(params: {
  contract: Contract;
  truck: Truck;
  driver: Driver;
  route: Route;
  product: Product;
}): number {
  const cargoWeightTons =
    params.contract.cargoWeight && params.contract.cargoWeight > 0
      ? params.contract.cargoWeight
      : params.contract.amount && params.contract.amount > 0
        ? params.contract.amount
        : params.product.weightPerUnit ?? 0;
  return Math.max(
    0,
    Math.round(
      getFuelRequiredForJob({
        distanceKm: params.contract.distanceKm,
        truck: params.truck,
        cargoWeightTons,
        routeDifficulty: params.route.difficulty,
        driverFuelSaving: params.driver.fuelSaving,
      }),
    ),
  );
}

export function applyFuelConsumptionForProgress(
  fuelLitersAtStart: number,
  fuelLitersTotal: number,
  progress: number,
): number {
  const normalizedProgress = clamp(progress > 1 ? progress / 100 : progress, 0, 1);
  return roundFuelValue(fuelLitersAtStart - fuelLitersTotal * normalizedProgress);
}

export function syncTruckFuelFromJob(params: {
  truck: Truck;
  fuelLitersAtStart: number;
  fuelLitersTotal: number;
  progress: number;
  distanceKm?: number;
}): Truck {
  const normalized = normalizeTruckFuel(params.truck);
  const currentFuelL = applyFuelConsumptionForProgress(
    params.fuelLitersAtStart,
    params.fuelLitersTotal,
    params.progress,
  );
  const traveledKm = params.distanceKm != null
    ? Math.round(params.distanceKm * clamp(params.progress, 0, 1))
    : 0;

  return {
    ...normalized,
    currentFuelL,
    totalMileageKm: (normalized.totalMileageKm ?? 0) + traveledKm,
  };
}

export function finalizeTruckFuelAfterJob(params: {
  truck: Truck;
  fuelLitersAtStart: number;
  fuelLitersTotal: number;
  distanceKm: number;
}): Truck {
  const normalized = normalizeTruckFuel(params.truck);
  const currentFuelL = applyFuelConsumptionForProgress(
    params.fuelLitersAtStart,
    params.fuelLitersTotal,
    1,
  );

  return {
    ...normalized,
    currentFuelL,
    totalMileageKm: (normalized.totalMileageKm ?? 0) + Math.max(0, Math.round(params.distanceKm)),
  };
}

/** Kamyon yakıtını %20–100 aralığında doldur (depo/teslimat sonrası basit simülasyon). */
export function refuelTruckPartial(truck: Truck, targetRatio = 0.85): Truck {
  const normalized = normalizeTruckFuel(truck);
  const capacity = normalized.fuelTankCapacityL ?? getDefaultFuelTankCapacityL(truck);
  return {
    ...normalized,
    currentFuelL: Math.round(capacity * clamp(targetRatio, 0.2, 1)),
  };
}
