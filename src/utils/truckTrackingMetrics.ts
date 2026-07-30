/**
 * Harita Kamyon Takip kartı metrikleri — yakıt, kalan mesafe, hız.
 */

import { normalizeMapDeliveryProgress } from '../components/map/mapRoadUtils';
import { isActiveRunningDelivery } from '../components/map/mapTruckLocation';
import type { Delivery, Driver, Route, Truck, TruckTransfer } from '../types/game';
import {
  applyFuelConsumptionForProgress,
  getFuelPercent,
  getFuelRequiredForDistance,
  getTruckFuelConsumptionPerKm,
  normalizeTruckFuel,
} from './truckFuel';
import { calculateVehicleTravelMetrics } from './vehiclePerformance';

export interface TruckTrackingMetrics {
  fuelPercent: number;
  currentFuelL: number;
  fuelTankCapacityL: number;
  remainingDistanceKm: number;
  currentSpeedKmh: number;
  etaHours: number | null;
  isMoving: boolean;
}

export interface GetTruckTrackingMetricsParams {
  truck: Truck;
  delivery?: Delivery | null;
  transfer?: TruckTransfer | null;
  driver?: Driver | null;
  route?: Route | null;
}

function normalizeProgress(progress: number | undefined | null): number {
  return normalizeMapDeliveryProgress(progress);
}

function resolveFuelState(
  truck: Truck,
  fuelLitersAtStart: number | undefined,
  fuelLitersTotal: number | undefined,
  fuelConsumedL: number | undefined,
  progress: number,
  distanceKm?: number,
): { currentFuelL: number; fuelTankCapacityL: number; fuelPercent: number } {
  const normalized = normalizeTruckFuel(truck);
  const fuelTankCapacityL = normalized.fuelTankCapacityL ?? 120;

  if (fuelConsumedL != null) {
    const currentFuelL = normalized.currentFuelL ?? 0;
    return {
      currentFuelL,
      fuelTankCapacityL,
      fuelPercent: getFuelPercent(currentFuelL, fuelTankCapacityL),
    };
  }

  if (fuelLitersAtStart != null && fuelLitersTotal != null) {
    const currentFuelL = applyFuelConsumptionForProgress(
      fuelLitersAtStart,
      fuelLitersTotal,
      progress,
    );
    return {
      currentFuelL,
      fuelTankCapacityL,
      fuelPercent: getFuelPercent(currentFuelL, fuelTankCapacityL),
    };
  }

  // Eski job kayıtları: mesafeden tahmini tüketim (yalnızca UI)
  if (distanceKm != null && distanceKm > 0 && progress > 0) {
    const estimatedBurn = Math.round(
      getFuelRequiredForDistance({
        distanceKm: distanceKm * progress,
        fuelConsumptionPerKm: getTruckFuelConsumptionPerKm(truck),
      }),
    );
    const startFuel = normalized.currentFuelL ?? fuelTankCapacityL;
    const currentFuelL = Math.max(0, startFuel - estimatedBurn);
    return {
      currentFuelL,
      fuelTankCapacityL,
      fuelPercent: getFuelPercent(currentFuelL, fuelTankCapacityL),
    };
  }

  const currentFuelL = normalized.currentFuelL ?? fuelTankCapacityL;
  return {
    currentFuelL,
    fuelTankCapacityL,
    fuelPercent: getFuelPercent(currentFuelL, fuelTankCapacityL),
  };
}

function resolveSpeedKmh(
  isMoving: boolean,
  actualSpeedKmh?: number,
): number {
  if (!isMoving) {
    return 0;
  }

  if (
    actualSpeedKmh != null &&
    Number.isFinite(actualSpeedKmh) &&
    actualSpeedKmh >= 0
  ) {
    return Math.round(actualSpeedKmh);
  }

  return 0;
}

export function getTruckTrackingMetrics(
  params: GetTruckTrackingMetricsParams,
): TruckTrackingMetrics {
  const { truck, delivery, transfer } = params;
  const activeDelivery = isActiveRunningDelivery(delivery) ? delivery : undefined;
  const activeTransfer =
    transfer != null && (transfer.status === 'active' || transfer.status === 'paused')
      ? transfer
      : undefined;

  if (activeDelivery) {
    const progress = normalizeProgress(activeDelivery.progress);
    const fuel = resolveFuelState(
      truck,
      activeDelivery.fuelLitersAtStart,
      activeDelivery.fuelLitersTotal,
      activeDelivery.fuelConsumedL,
      progress,
      activeDelivery.distanceKm,
    );
    const remainingDistanceKm = Math.max(
      0,
      Math.round((activeDelivery.distanceKm ?? 0) * (1 - progress)),
    );
    const isMoving = progress < 1 && activeDelivery.status !== 'paused';
    const currentSpeedKmh = resolveSpeedKmh(
      isMoving,
      activeDelivery.currentSpeedKmh,
    );
    const eta = calculateVehicleTravelMetrics({
      routeDistanceKm: activeDelivery.distanceKm ?? 0,
      progress,
      effectiveSpeedKmh: currentSpeedKmh,
    });
    return {
      ...fuel,
      remainingDistanceKm,
      currentSpeedKmh,
      etaHours: isMoving && currentSpeedKmh > 0 ? eta.remainingTravelHours : null,
      isMoving,
    };
  }

  if (activeTransfer) {
    const progress = normalizeProgress(activeTransfer.progress);
    const fuel = resolveFuelState(
      truck,
      activeTransfer.fuelLitersAtStart,
      activeTransfer.fuelLitersTotal,
      activeTransfer.fuelConsumedL,
      progress,
      activeTransfer.distanceKm,
    );
    const remainingDistanceKm = Math.max(
      0,
      Math.round(activeTransfer.distanceKm * (1 - progress)),
    );
    const isMoving = progress < 1 && activeTransfer.status !== 'paused';
    const currentSpeedKmh = resolveSpeedKmh(
      isMoving,
      activeTransfer.currentSpeedKmh,
    );
    const eta = calculateVehicleTravelMetrics({
      routeDistanceKm: activeTransfer.distanceKm,
      progress,
      effectiveSpeedKmh: currentSpeedKmh,
    });
    return {
      ...fuel,
      remainingDistanceKm,
      currentSpeedKmh,
      etaHours: isMoving && currentSpeedKmh > 0 ? eta.remainingTravelHours : null,
      isMoving,
    };
  }

  const normalized = normalizeTruckFuel(truck);
  const fuelTankCapacityL = normalized.fuelTankCapacityL ?? 120;
  const currentFuelL = normalized.currentFuelL ?? fuelTankCapacityL;

  return {
    fuelPercent: getFuelPercent(currentFuelL, fuelTankCapacityL),
    currentFuelL,
    fuelTankCapacityL,
    remainingDistanceKm: 0,
    currentSpeedKmh: 0,
    etaHours: null,
    isMoving: false,
  };
}
