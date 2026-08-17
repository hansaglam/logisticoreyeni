/**
 * Harita Kamyon Takip kartı metrikleri — yakıt, kalan mesafe, hız.
 */

import { normalizeMapDeliveryProgress } from '../components/map/mapRoadUtils';
import { isActiveRunningDelivery } from '../components/map/mapTruckLocation';
import type { Delivery, Driver, Route, Truck, TruckTransfer } from '../types/game';
import { getTruckFuelSnapshot, normalizeTruckFuel } from './truckFuel';
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
): { currentFuelL: number; fuelTankCapacityL: number; fuelPercent: number } {
  const snapshot = getTruckFuelSnapshot(truck);
  return {
    currentFuelL: snapshot.currentLiters,
    fuelTankCapacityL: snapshot.capacityLiters,
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
    const fuel = resolveFuelState(truck);
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
    const fuel = resolveFuelState(truck);
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

  const snapshot = getTruckFuelSnapshot(normalizeTruckFuel(truck));

  return {
    fuelPercent: snapshot.percentage,
    currentFuelL: snapshot.currentLiters,
    fuelTankCapacityL: snapshot.capacityLiters,
    remainingDistanceKm: 0,
    currentSpeedKmh: 0,
    etaHours: null,
    isMoving: false,
  };
}
