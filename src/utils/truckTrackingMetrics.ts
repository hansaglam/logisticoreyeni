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
  getTruckFuelSnapshot,
  normalizeTruckFuel,
  toFuelNumber,
} from './truckFuel';

export interface TruckTrackingMetrics {
  fuelPercent: number;
  currentFuelL: number;
  fuelTankCapacityL: number;
  remainingDistanceKm: number;
  currentSpeedKmh: number;
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
  const snapshot = getTruckFuelSnapshot(truck);
  const fuelTankCapacityL = snapshot.capacityLiters;
  const normalized = normalizeTruckFuel(truck);

  if (fuelConsumedL != null) {
    const currentFuelL = toFuelNumber(normalized.currentFuelL) ?? snapshot.currentLiters;
    return {
      currentFuelL,
      fuelTankCapacityL,
      fuelPercent: getFuelPercent(currentFuelL, fuelTankCapacityL),
    };
  }

  const startFuel = toFuelNumber(fuelLitersAtStart);
  const totalFuel = toFuelNumber(fuelLitersTotal);

  if (startFuel != null && totalFuel != null) {
    const currentFuelL = applyFuelConsumptionForProgress(startFuel, totalFuel, progress);
    return {
      currentFuelL,
      fuelTankCapacityL,
      fuelPercent: getFuelPercent(currentFuelL, fuelTankCapacityL),
    };
  }

  // Eski job kayıtları: mesafeden tahmini tüketim (yalnızca UI)
  const distance = toFuelNumber(distanceKm);
  if (distance != null && distance > 0 && progress > 0) {
    const estimatedBurn = Math.round(
      getFuelRequiredForDistance({
        distanceKm: distance * progress,
        fuelConsumptionPerKm: getTruckFuelConsumptionPerKm(truck),
      }),
    );
    const currentFuelL = Math.max(0, snapshot.currentLiters - estimatedBurn);
    return {
      currentFuelL,
      fuelTankCapacityL,
      fuelPercent: getFuelPercent(currentFuelL, fuelTankCapacityL),
    };
  }

  return {
    currentFuelL: snapshot.currentLiters,
    fuelTankCapacityL,
    fuelPercent: snapshot.percentage,
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
    return {
      ...fuel,
      remainingDistanceKm,
      currentSpeedKmh: resolveSpeedKmh(
        isMoving,
        activeDelivery.currentSpeedKmh,
      ),
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
    return {
      ...fuel,
      remainingDistanceKm,
      currentSpeedKmh: resolveSpeedKmh(
        isMoving,
        activeTransfer.currentSpeedKmh,
      ),
      isMoving,
    };
  }

  // Boşta / bakımdaki kamyon — canonical snapshot (Fleet ile aynı)
  const snapshot = getTruckFuelSnapshot(normalizeTruckFuel(truck));

  return {
    fuelPercent: snapshot.percentage,
    currentFuelL: snapshot.currentLiters,
    fuelTankCapacityL: snapshot.capacityLiters,
    remainingDistanceKm: 0,
    currentSpeedKmh: 0,
    isMoving: false,
  };
}
