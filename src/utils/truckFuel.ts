/**
 * Kamyon yakıt tankı — varsayılan kapasite, normalize ve tüketim yardımcıları.
 */

import type { Contract, Driver, Product, Route, Truck } from '../types/game';
import {
  calculateDriverFuelSkillMultiplier,
  calculateFuelUsed,
  calculateRouteFuelMultiplier,
} from '../simulation/delivery';
import { clamp } from './math';

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

export function normalizeTruckFuel(truck: Truck): Truck {
  const fuelTankCapacityL =
    truck.fuelTankCapacityL != null && truck.fuelTankCapacityL > 0
      ? truck.fuelTankCapacityL
      : getDefaultFuelTankCapacityL(truck);

  const currentFuelL =
    truck.currentFuelL != null && Number.isFinite(truck.currentFuelL)
      ? clamp(truck.currentFuelL, 0, fuelTankCapacityL)
      : Math.round(fuelTankCapacityL * getDefaultFuelFillRatio(truck.id));

  return {
    ...truck,
    fuelTankCapacityL,
    currentFuelL: Math.round(currentFuelL),
    totalMileageKm: Math.max(0, truck.totalMileageKm ?? 0),
  };
}

/** Boş transfer — hafif yük çarpanı. */
const EMPTY_TRANSFER_LOAD_MULTIPLIER = 0.55;

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
  const normalizedProgress = clamp(progress > 1 ? progress / 100 : progress, 0, 1);
  return Math.max(0, Math.round(fuelLitersAtStart - fuelLitersTotal * normalizedProgress));
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
