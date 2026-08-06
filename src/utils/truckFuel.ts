/**
 * Kamyon yakıt tankı — varsayılan kapasite, normalize ve tüketim yardımcıları.
 *
 * Canonical UI/sim okuma yolu: getTruckFuelSnapshot(truck).
 */

import type { Contract, Driver, Product, Route, Truck } from '../types/game';
import {
  calculateDriverFuelSkillMultiplier,
  calculateFuelUsed,
  calculateRouteFuelMultiplier,
} from './deliveryMetrics';
import { clamp } from './math';

/** Boş transfer — hafif yük çarpanı. */
const EMPTY_TRANSFER_LOAD_MULTIPLIER = 0.55;

export type TruckFuelSnapshot = {
  currentLiters: number;
  capacityLiters: number;
  percentage: number;
  isValid: boolean;
};

function hashTruckId(truckId: string): number {
  let hash = 0;
  for (let i = 0; i < truckId.length; i += 1) {
    hash = (hash + truckId.charCodeAt(i) * 17) % 100;
  }
  return hash;
}

/**
 * Hydration-safe sayı: string "180" kabul, "" / null / NaN / Infinity reddedilir.
 * `Number("") === 0` tuzağına düşmemek için boş string → null.
 */
export function toFuelNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Kapasite sınıfına göre tank hacmi (L). */
export function getDefaultFuelTankCapacityL(
  truck: Pick<Truck, 'capacity' | 'fuelConsumptionPerKm'>,
): number {
  const capacity = toFuelNumber(truck.capacity) ?? 0;
  if (capacity >= 28) {
    return 520;
  }
  if (capacity >= 22) {
    return 400;
  }
  if (capacity >= 18) {
    return 180;
  }
  return 120;
}

/** Eski save'ler için deterministik başlangıç doluluk oranı (%65–95). */
export function getDefaultFuelFillRatio(truckId: string): number {
  return 0.65 + (hashTruckId(truckId) / 100) * 0.3;
}

export function getFuelPercent(currentFuelL: number, fuelTankCapacityL: number): number {
  const current = toFuelNumber(currentFuelL);
  const capacityRaw = toFuelNumber(fuelTankCapacityL);
  if (current == null || capacityRaw == null || capacityRaw <= 0) {
    return 0;
  }
  const capacity = Math.max(capacityRaw, 1);
  return Math.round(clamp((current / capacity) * 100, 0, 100));
}

/**
 * Tek canonical yakıt okuma — Map, Fleet ve simülasyon UI aynı snapshot'ı kullanır.
 * Eksik / string / NaN alanlarda default fill uygular; geçerli 0 litreyi korur.
 */
export function getTruckFuelSnapshot(
  truck: Pick<Truck, 'id' | 'capacity' | 'fuelConsumptionPerKm' | 'currentFuelL' | 'fuelTankCapacityL'>,
): TruckFuelSnapshot {
  const capacityFromTruck = toFuelNumber(truck.fuelTankCapacityL);
  const capacityLiters =
    capacityFromTruck != null && capacityFromTruck > 0
      ? capacityFromTruck
      : getDefaultFuelTankCapacityL(truck);

  const currentRaw = toFuelNumber(truck.currentFuelL);
  const hasExplicitCurrent = currentRaw != null;
  const currentLiters = hasExplicitCurrent
    ? clamp(currentRaw, 0, capacityLiters)
    : Math.round(capacityLiters * getDefaultFuelFillRatio(truck.id));

  const percentage = getFuelPercent(currentLiters, capacityLiters);
  const isValid = capacityLiters > 0 && Number.isFinite(currentLiters) && Number.isFinite(percentage);

  return {
    currentLiters: Math.round(currentLiters),
    capacityLiters: Math.round(capacityLiters),
    percentage: isValid ? percentage : 0,
    isValid,
  };
}

export function getTruckFuelPercent(truck: Truck): number {
  return getTruckFuelSnapshot(truck).percentage;
}

export function normalizeTruckFuel(truck: Truck): Truck {
  const snapshot = getTruckFuelSnapshot(truck);
  return {
    ...truck,
    fuelTankCapacityL: snapshot.capacityLiters,
    currentFuelL: snapshot.currentLiters,
    totalMileageKm: Math.max(0, toFuelNumber(truck.totalMileageKm) ?? 0),
  };
}

export function calculateTransferFuelLiters(
  truck: Truck,
  route: Route,
  driver?: Driver,
): number {
  const driverMultiplier = driver ? calculateDriverFuelSkillMultiplier(driver) : 1;
  const routeMultiplier = calculateRouteFuelMultiplier(route);
  const liters =
    route.distanceKm *
    truck.fuelConsumptionPerKm *
    EMPTY_TRANSFER_LOAD_MULTIPLIER *
    driverMultiplier *
    routeMultiplier;
  return Math.max(0, Math.round(liters));
}

export function calculateDeliveryFuelLiters(params: {
  contract: Contract;
  truck: Truck;
  driver: Driver;
  route: Route;
  product: Product;
}): number {
  return Math.max(0, Math.round(calculateFuelUsed(
    params.contract,
    params.truck,
    params.driver,
    params.route,
    params.product,
  )));
}

export function applyFuelConsumptionForProgress(
  fuelLitersAtStart: number,
  fuelLitersTotal: number,
  progress: number,
): number {
  const start = toFuelNumber(fuelLitersAtStart) ?? 0;
  const total = toFuelNumber(fuelLitersTotal) ?? 0;
  const progressRaw = toFuelNumber(progress) ?? 0;
  const normalizedProgress = clamp(progressRaw > 1 ? progressRaw / 100 : progressRaw, 0, 1);
  return Math.max(0, Math.round(start - total * normalizedProgress));
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

/** Map / Fleet ortak yüzde etiketi — native format tuzağı olmadan. */
export function formatFuelPercentLabel(percentage: number): string {
  const safe = Number.isFinite(percentage) ? Math.round(percentage) : 0;
  return `%${safe}`;
}
