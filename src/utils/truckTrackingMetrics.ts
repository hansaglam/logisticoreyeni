/**
 * Harita Kamyon Takip kartı metrikleri — yakıt, kalan mesafe, hız.
 */

import { getRoute } from '../data/routes';
import {
  calculateAverageSpeed,
  calculateConditionSpeedMultiplier,
} from '../simulation/delivery';
import { normalizeMapDeliveryProgress } from '../components/map/mapRoadUtils';
import { isActiveRunningDelivery } from '../components/map/mapTruckLocation';
import type { Delivery, Driver, Route, Truck, TruckTransfer } from '../types/game';
import {
  applyFuelConsumptionForProgress,
  getFuelPercent,
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
  progress: number,
  distanceKm?: number,
): { currentFuelL: number; fuelTankCapacityL: number; fuelPercent: number } {
  const snapshot = getTruckFuelSnapshot(truck);
  const fuelTankCapacityL = snapshot.capacityLiters;

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
    const consumption = toFuelNumber(truck.fuelConsumptionPerKm) ?? 0.32;
    const estimatedBurn = Math.round(distance * consumption * progress);
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
  truck: Truck,
  driver: Driver | null | undefined,
  route: Route | null | undefined,
  isMoving: boolean,
): number {
  if (!isMoving) {
    return 0;
  }

  if (driver && route) {
    return Math.round(calculateAverageSpeed(truck, driver, route));
  }

  const conditionMultiplier = calculateConditionSpeedMultiplier(truck);
  return Math.round(Math.max(0, truck.speed * conditionMultiplier));
}

function resolveJobRoute(
  fromCityId: string,
  toCityId: string,
  route?: Route | null,
): Route | undefined {
  if (route) {
    return route;
  }
  return getRoute(fromCityId, toCityId);
}

export function getTruckTrackingMetrics(
  params: GetTruckTrackingMetricsParams,
): TruckTrackingMetrics {
  const { truck, delivery, transfer, driver } = params;
  const activeDelivery = isActiveRunningDelivery(delivery) ? delivery : undefined;
  const activeTransfer =
    transfer != null && transfer.status === 'active' ? transfer : undefined;

  if (activeDelivery) {
    const progress = normalizeProgress(activeDelivery.progress);
    const fuel = resolveFuelState(
      truck,
      activeDelivery.fuelLitersAtStart,
      activeDelivery.fuelLitersTotal,
      progress,
      activeDelivery.distanceKm,
    );
    const remainingDistanceKm = Math.max(
      0,
      Math.round((activeDelivery.distanceKm ?? 0) * (1 - progress)),
    );
    const isMoving = progress < 1;
    const route = resolveJobRoute(
      activeDelivery.originCityId,
      activeDelivery.destinationCityId,
      params.route,
    );

    return {
      ...fuel,
      remainingDistanceKm,
      currentSpeedKmh: resolveSpeedKmh(truck, driver, route, isMoving),
      isMoving,
    };
  }

  if (activeTransfer) {
    const progress = normalizeProgress(activeTransfer.progress);
    const fuel = resolveFuelState(
      truck,
      activeTransfer.fuelLitersAtStart,
      activeTransfer.fuelLitersTotal,
      progress,
      activeTransfer.distanceKm,
    );
    const remainingDistanceKm = Math.max(
      0,
      Math.round(activeTransfer.distanceKm * (1 - progress)),
    );
    const isMoving = progress < 1;
    const route = resolveJobRoute(
      activeTransfer.fromCityId,
      activeTransfer.toCityId,
      params.route,
    );

    return {
      ...fuel,
      remainingDistanceKm,
      currentSpeedKmh: resolveSpeedKmh(truck, driver, route, isMoving),
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
