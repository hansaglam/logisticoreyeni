import type { Driver, Route, Trailer, Truck } from '../types/game';
import { clamp } from './math';

export const MIN_OPERATIONAL_SPEED_KMH = 0;
export const MAX_OPERATIONAL_SPEED_KMH = 130;

export interface VehicleSpeedResult {
  baseSpeedKmh: number;
  effectiveSpeedKmh: number;
  cargoMultiplier: number;
  trailerMultiplier: number;
  routeMultiplier: number;
  conditionMultiplier: number;
  driverMultiplier: number;
  eventMultiplier: number;
}

export function calculateVehicleSpeed(params: {
  truck: Pick<Truck, 'speed' | 'capacity' | 'condition'>;
  driver?: Pick<Driver, 'speed'> | null;
  route?: Pick<Route, 'difficulty'> | null;
  cargoWeightTons?: number;
  trailer?: Pick<Trailer, 'type'> | null;
  eventSpeedMultiplier?: number;
}): VehicleSpeedResult {
  const condition = Number(params.truck.condition);
  const eventSpeedMultiplier = Number(params.eventSpeedMultiplier);
  const baseSpeedKmh = clamp(
    Number(params.truck.speed) || 0,
    15,
    MAX_OPERATIONAL_SPEED_KMH,
  );
  const loadRatio =
    Math.max(0, Number(params.cargoWeightTons) || 0) /
    Math.max(1, Number(params.truck.capacity) || 1);
  const cargoMultiplier = clamp(1 - loadRatio * 0.16, 0.78, 1);
  const trailerMultiplier =
    params.trailer?.type === 'heavy'
      ? 0.92
      : params.trailer?.type === 'refrigerated'
        ? 0.94
        : params.trailer
          ? 0.96
          : 1;
  const routeMultiplier = clamp(
    1 - (Number(params.route?.difficulty) || 0) * 0.3,
    0.55,
    1,
  );
  const conditionMultiplier = clamp(
    0.5 +
      (clamp(Number.isFinite(condition) ? condition : 100, 0, 100) / 100) * 0.5,
    0.45,
    1,
  );
  const driverMultiplier = clamp(
    1 + ((Number(params.driver?.speed) || 0) / 100) * 0.28,
    0.65,
    1.4,
  );
  const eventMultiplier = clamp(
    Number.isFinite(eventSpeedMultiplier) ? eventSpeedMultiplier : 1,
    0.65,
    1.15,
  );
  const effectiveSpeedKmh = clamp(
    baseSpeedKmh *
      cargoMultiplier *
      trailerMultiplier *
      routeMultiplier *
      conditionMultiplier *
      driverMultiplier *
      eventMultiplier,
    15,
    MAX_OPERATIONAL_SPEED_KMH,
  );
  return {
    baseSpeedKmh,
    effectiveSpeedKmh,
    cargoMultiplier,
    trailerMultiplier,
    routeMultiplier,
    conditionMultiplier,
    driverMultiplier,
    eventMultiplier,
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
  return Math.round(
    clamp(speed, MIN_OPERATIONAL_SPEED_KMH, MAX_OPERATIONAL_SPEED_KMH) * 10,
  ) / 10;
}
