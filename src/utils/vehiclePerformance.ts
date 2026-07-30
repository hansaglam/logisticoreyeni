import {
  SIMULATION_MS_PER_TRAVEL_HOUR,
  vehicleSpeedBalance,
} from '../config/balance';
import type {
  Driver,
  DriverTier,
  Route,
  Trailer,
  Truck,
  TruckStatus,
  VehicleClass,
} from '../types/game';
import { clamp } from './math';

export const MIN_OPERATIONAL_SPEED_KMH = 0;
export const MIN_MOVING_SPEED_KMH = vehicleSpeedBalance.minMovingSpeedKmh;
export const MAX_OPERATIONAL_SPEED_KMH =
  vehicleSpeedBalance.maxOperationSpeedKmh;

export type VehicleRoadType =
  | 'motorway'
  | 'divided-road'
  | 'standard-road'
  | 'mountain-road'
  | 'urban-entry';

export interface VehicleSpeedModifiers {
  speedMultiplier?: number;
  routeMultiplier?: number;
}

export interface VehicleSpeedResult {
  vehicleClass: VehicleClass;
  baseSpeedKmh: number;
  catalogSpeedMultiplier: number;
  trailerMultiplier: number;
  loadMultiplier: number;
  /** @deprecated loadMultiplier kullanın. */
  cargoMultiplier: number;
  conditionMultiplier: number;
  driverMultiplier: number;
  routeMultiplier: number;
  eventMultiplier: number;
  effectiveSpeedKmh: number;
}

export interface VehicleTravelMetrics {
  routeDistanceKm: number;
  progress: number;
  remainingKm: number;
  effectiveSpeedKmh: number;
  realWorldTravelHours: number;
  remainingTravelHours: number;
  remainingHandlingHours: number;
  remainingTotalHours: number;
  simulationDurationMs: number;
  remainingSimulationDurationMs: number;
}

type SpeedTruck = Pick<Truck, 'speed' | 'capacity' | 'condition'> &
  Partial<Pick<Truck, 'id' | 'catalogId' | 'name' | 'vehicleClass' | 'status'>>;

type SpeedDriver = Pick<Driver, 'speed'> & Partial<Pick<Driver, 'tier'>>;

type SpeedRoute = Pick<Route, 'difficulty'> & { roadType?: VehicleRoadType };

const STOPPED_STATUSES = new Set<string>([
  'paused',
  'out_of_fuel',
  'maintenance',
  'loading',
]);

export function resolveVehicleClass(truck: SpeedTruck): VehicleClass {
  if (truck.vehicleClass) return truck.vehicleClass;

  const catalogKey = `${truck.catalogId ?? ''} ${truck.id ?? ''} ${truck.name ?? ''}`.toLowerCase();
  if (catalogKey.includes('heavy-haul') || catalogKey.includes('marmara heavy')) {
    return 'special-heavy';
  }
  if (
    catalogKey.includes('volvo') ||
    catalogKey.includes('mercedes') ||
    catalogKey.includes('refrigerated') ||
    catalogKey.includes('titan') ||
    catalogKey.includes('atlas') ||
    catalogKey.includes('coldline')
  ) {
    return 'tractor';
  }

  const capacity = Math.max(0, Number(truck.capacity) || 0);
  if (capacity <= 16) return 'light-truck';
  if (capacity <= 28) return 'medium-truck';
  if (capacity <= 36) return 'heavy-truck';
  return 'special-heavy';
}

function getLoadMultiplier(loadRatio: number): number {
  const ratio = Math.max(0, Number.isFinite(loadRatio) ? loadRatio : 0);
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 0.97;
  if (ratio <= 0.75) return 0.94;
  if (ratio <= 1) return 0.9;
  return clamp(0.9 - (ratio - 1) * 0.3, 0.72, 0.9);
}

function getConditionMultiplier(conditionInput: number): number {
  const condition = clamp(
    Number.isFinite(conditionInput) ? conditionInput : 100,
    0,
    100,
  );
  if (condition >= 90) return 1;
  if (condition >= 75) return 0.97;
  if (condition >= 50) return 0.92;
  if (condition >= 25) return 0.84;
  return 0.72;
}

function getDriverMultiplier(driver?: SpeedDriver | null): number {
  if (!driver) return 1;
  const tier = driver.tier as DriverTier | undefined;
  if (tier) {
    return vehicleSpeedBalance.driverTierMultiplier[tier];
  }
  const speedSkill = clamp(Number(driver.speed) || 0, -100, 100);
  return clamp(1 + speedSkill * 0.0005, 0.96, 1.05);
}

function getRouteMultiplier(route?: SpeedRoute | null): number {
  if (route?.roadType) {
    return vehicleSpeedBalance.roadTypeMultiplier[route.roadType];
  }
  return vehicleSpeedBalance.routeAverageMultiplier;
}

function getTrailerMultiplier(trailer?: Pick<Trailer, 'type'> | null): number {
  if (!trailer) return 1;
  return vehicleSpeedBalance.trailerMultiplier[trailer.type];
}

function isStoppedStatus(status?: TruckStatus | 'paused' | 'loading' | null): boolean {
  return status != null && STOPPED_STATUSES.has(status);
}

/**
 * Araç hızı için tek source of truth.
 * Katalog speed alanı sınıf ortalamasına göre küçük bir model farkı olarak korunur.
 */
export function calculateEffectiveVehicleSpeed(params: {
  truck: SpeedTruck;
  trailer?: Pick<Trailer, 'type'> &
    Partial<Pick<Trailer, 'capacityBonusTons'>> | null;
  cargoWeightTons?: number;
  effectiveCargoCapacityTons?: number;
  route?: SpeedRoute | null;
  driver?: SpeedDriver | null;
  condition?: number;
  status?: TruckStatus | 'paused' | 'loading' | null;
  modifiers?: VehicleSpeedModifiers;
  eventSpeedMultiplier?: number;
}): VehicleSpeedResult {
  const vehicleClass = resolveVehicleClass(params.truck);
  const classBaseSpeed =
    vehicleSpeedBalance.baseAverageSpeedKmh[vehicleClass];
  const catalogSpeed = Number(params.truck.speed);
  const catalogSpeedMultiplier = clamp(
    Number.isFinite(catalogSpeed) && catalogSpeed > 0
      ? catalogSpeed / classBaseSpeed
      : 1,
    vehicleSpeedBalance.minCatalogPerformanceMultiplier,
    vehicleSpeedBalance.maxCatalogPerformanceMultiplier,
  );
  const baseSpeedKmh = classBaseSpeed * catalogSpeedMultiplier;
  const trailerMultiplier = getTrailerMultiplier(params.trailer);
  const effectiveCapacity = Math.max(
    1,
    Number(params.effectiveCargoCapacityTons) ||
      (Number(params.truck.capacity) || 0) +
        (Number(params.trailer?.capacityBonusTons) || 0),
  );
  const loadRatio =
    Math.max(0, Number(params.cargoWeightTons) || 0) / effectiveCapacity;
  const loadMultiplier = getLoadMultiplier(loadRatio);
  const conditionMultiplier = getConditionMultiplier(
    params.condition ?? params.truck.condition,
  );
  const driverMultiplier = getDriverMultiplier(params.driver);
  const routeMultiplier = clamp(
    getRouteMultiplier(params.route) *
      clamp(
        Number(params.modifiers?.routeMultiplier) || 1,
        vehicleSpeedBalance.minExternalModifier,
        vehicleSpeedBalance.maxExternalModifier,
      ),
    0.65,
    1,
  );
  const eventMultiplier = clamp(
    Number.isFinite(params.eventSpeedMultiplier)
      ? Number(params.eventSpeedMultiplier)
      : Number(params.modifiers?.speedMultiplier) || 1,
    vehicleSpeedBalance.minExternalModifier,
    vehicleSpeedBalance.maxExternalModifier,
  );
  const stopped = isStoppedStatus(params.status ?? params.truck.status);
  const effectiveSpeedKmh = stopped
    ? 0
    : clamp(
        baseSpeedKmh *
          trailerMultiplier *
          loadMultiplier *
          conditionMultiplier *
          driverMultiplier *
          routeMultiplier *
          eventMultiplier,
        MIN_MOVING_SPEED_KMH,
        MAX_OPERATIONAL_SPEED_KMH,
      );

  return {
    vehicleClass,
    baseSpeedKmh: Math.round(baseSpeedKmh * 10) / 10,
    catalogSpeedMultiplier,
    trailerMultiplier,
    loadMultiplier,
    cargoMultiplier: loadMultiplier,
    conditionMultiplier,
    driverMultiplier,
    routeMultiplier,
    eventMultiplier,
    effectiveSpeedKmh: Math.round(effectiveSpeedKmh * 10) / 10,
  };
}

/** Geriye dönük isim; bütün çağrılar aynı canonical modele gider. */
export const calculateVehicleSpeed = calculateEffectiveVehicleSpeed;

export function calculateVehicleTravelMetrics(params: {
  routeDistanceKm: number;
  progress?: number;
  effectiveSpeedKmh: number;
  remainingHandlingHours?: number;
}): VehicleTravelMetrics {
  const routeDistanceKm = Math.max(
    0,
    Number.isFinite(params.routeDistanceKm) ? params.routeDistanceKm : 0,
  );
  const progress = clamp(
    Number.isFinite(params.progress) ? (params.progress ?? 0) : 0,
    0,
    1,
  );
  const effectiveSpeedKmh = Math.max(
    0,
    Number.isFinite(params.effectiveSpeedKmh) ? params.effectiveSpeedKmh : 0,
  );
  const remainingKm = routeDistanceKm * (1 - progress);
  const realWorldTravelHours =
    effectiveSpeedKmh > 0 ? routeDistanceKm / effectiveSpeedKmh : 0;
  const remainingTravelHours =
    effectiveSpeedKmh > 0 ? remainingKm / effectiveSpeedKmh : 0;
  const remainingHandlingHours = Math.max(
    0,
    Number(params.remainingHandlingHours) || 0,
  );
  return {
    routeDistanceKm,
    progress,
    remainingKm,
    effectiveSpeedKmh,
    realWorldTravelHours,
    remainingTravelHours,
    remainingHandlingHours,
    remainingTotalHours: remainingTravelHours + remainingHandlingHours,
    simulationDurationMs:
      realWorldTravelHours * SIMULATION_MS_PER_TRAVEL_HOUR,
    remainingSimulationDurationMs:
      remainingTravelHours * SIMULATION_MS_PER_TRAVEL_HOUR,
  };
}

/** Tick'te gerçekten kat edilen km / geçen simulation saati. */
export function calculateActualSpeedKmh(params: {
  distanceDeltaKm: number;
  elapsedHoursDelta: number;
  paused?: boolean;
}): number {
  if (params.paused || params.elapsedHoursDelta <= 0) return 0;
  const speed =
    Math.max(0, Number(params.distanceDeltaKm) || 0) /
    Math.max(Number.EPSILON, Number(params.elapsedHoursDelta) || 0);
  return (
    Math.round(
      clamp(speed, MIN_OPERATIONAL_SPEED_KMH, MAX_OPERATIONAL_SPEED_KMH) * 10,
    ) / 10
  );
}
