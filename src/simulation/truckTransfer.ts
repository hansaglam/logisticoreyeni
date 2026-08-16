/**
 * Boş kamyon yönlendirme / geri çağırma simülasyonu.
 */

import { deliveryBalance, economyBalance } from '../config/balance';
import { getRoute } from '../data/routes';
import type { Driver, Route, Trailer, Truck, TruckTransfer } from '../types/game';
import {
  advanceFuelConstrainedProgress,
  calculateTransferFuelLiters,
  getFuelRequiredForDistance,
  getTruckFuelConsumptionPerKm,
  normalizeTruckFuel,
} from '../utils/truckFuel';
import {
  calculateActualSpeedKmh,
  calculateVehicleSpeed,
} from '../utils/vehiclePerformance';
import { isRentalReturnPending } from './rentalTruckLifecycle';

const MIN_TRANSFER_HOURS = 1;
const DEFAULT_SPEED_KMH = deliveryBalance.defaultAverageSpeed;

export type TruckTransferBlockedReason =
  | 'Teslimatta'
  | 'Transferde'
  | 'Araç Pazarı’nda'
  | 'Yakıt yetersiz'
  | 'Araç müsait değil'
  | 'Kiralama süresi doldu'
  | 'Müsait şoför yok';

/**
 * UI ve transfer başlangıcı için ortak uygunluk açıklaması.
 * Aktif bir kiralama transfer engeli değildir; yalnız süresi bitmiş kiralamalar engellenir.
 */
export function getTruckTransferBlockedReason(
  truck: Pick<Truck, 'status' | 'leaseExpired' | 'rentalLifecycle'>,
  hasIdleDriver: boolean,
): TruckTransferBlockedReason | null {
  if (truck.status === 'transferring') return 'Transferde';
  if (truck.status === 'on_route') return 'Teslimatta';
  if (truck.status === 'marketplace_locked') return 'Araç Pazarı’nda';
  if (truck.status === 'out_of_fuel') return 'Yakıt yetersiz';
  if (truck.status !== 'idle') return 'Araç müsait değil';
  if (isRentalReturnPending(truck as Truck)) return 'Kiralama süresi doldu';
  if (truck.leaseExpired) return 'Kiralama süresi doldu';
  if (!hasIdleDriver) return 'Müsait şoför yok';
  return null;
}

export function getActiveTransfers(transfers: TruckTransfer[] | undefined): TruckTransfer[] {
  return (transfers ?? []).filter(
    (transfer) => transfer.status === 'active' || transfer.status === 'paused',
  );
}

export function findActiveTransferForTruck(
  truckId: string,
  transfers: TruckTransfer[] | undefined,
): TruckTransfer | undefined {
  return getActiveTransfers(transfers).find((transfer) => transfer.truckId === truckId);
}

export function resolveTransferRoute(
  routes: Route[] | undefined,
  fromCityId: string,
  toCityId: string,
): Route | undefined {
  const direct = getRoute(fromCityId, toCityId);
  if (direct) return direct;
  return (routes ?? []).find(
    (route) => route.fromCityId === fromCityId && route.toCityId === toCityId,
  );
}

export function calculateTransferDurationHours(distanceKm: number, speedKmh?: number): number {
  const speed = Math.max(speedKmh ?? DEFAULT_SPEED_KMH, 1);
  return Math.max(MIN_TRANSFER_HOURS, distanceKm / speed);
}

/**
 * Model A: totalCost = nakit kesinti (yalnız yakıt).
 * driverCost = bilgilendirici allocated maaş payı; periodic salary ile çift kesilmez.
 */
export function calculateTransferCosts(params: {
  distanceKm: number;
  truck: Truck;
  driver: Driver;
  durationHours: number;
  fuelPrice: number;
}): { fuelCost: number; driverCost: number; totalCost: number } {
  const fuelLiters = getFuelRequiredForDistance({
    distanceKm: params.distanceKm,
    fuelConsumptionPerKm: getTruckFuelConsumptionPerKm(params.truck),
  });
  const fuelCost = fuelLiters * params.fuelPrice;
  const salaryPerDay = params.driver.salaryPerDay ?? params.driver.dailySalary ?? 0;
  const allocatedDriverCost =
    params.durationHours * (salaryPerDay / 24) * deliveryBalance.driverCostMultiplier;

  return {
    fuelCost: Number(fuelCost.toFixed(2)),
    driverCost: Number(allocatedDriverCost.toFixed(2)),
    totalCost: Number(fuelCost.toFixed(2)),
  };
}

export function estimateTransferForRoute(params: {
  truck: Truck;
  driver: Driver;
  route: Route;
  trailer?: Trailer | null;
  fuelPrice?: number;
}): {
  durationHours: number;
  fuelCost: number;
  driverCost: number;
  totalCost: number;
} {
  const fuelPrice = params.fuelPrice ?? economyBalance.baseFuelPrice;
  const effectiveSpeedKmh = calculateVehicleSpeed({
    truck: params.truck,
    driver: params.driver,
    route: params.route,
    trailer: params.trailer,
  }).effectiveSpeedKmh;
  const durationHours = calculateTransferDurationHours(
    params.route.distanceKm,
    effectiveSpeedKmh,
  );
  return {
    durationHours,
    ...calculateTransferCosts({
      distanceKm: params.route.distanceKm,
      truck: params.truck,
      driver: params.driver,
      durationHours,
      fuelPrice,
    }),
  };
}

export function selectDriverForTransfer(truckId: string, drivers: Driver[] | undefined): Driver | undefined {
  const driverList = drivers ?? [];
  const assignedIdle = driverList.find(
    (driver) => driver.assignedTruckId === truckId && driver.status === 'idle',
  );
  if (assignedIdle) return assignedIdle;
  return driverList.find((driver) => driver.status === 'idle');
}

export function createTruckTransfer(params: {
  truck: Truck;
  driver: Driver;
  fromCityId: string;
  toCityId: string;
  route: Route;
  trailer?: Trailer | null;
  fuelPrice: number;
  currentTime: number;
  sequence: number;
}): TruckTransfer {
  const effectiveSpeedKmh = calculateVehicleSpeed({
    truck: params.truck,
    driver: params.driver,
    route: params.route,
    trailer: params.trailer,
  }).effectiveSpeedKmh;
  const durationHours = calculateTransferDurationHours(
    params.route.distanceKm,
    effectiveSpeedKmh,
  );
  const costs = calculateTransferCosts({
    distanceKm: params.route.distanceKm,
    truck: params.truck,
    driver: params.driver,
    durationHours,
    fuelPrice: params.fuelPrice,
  });

  const fuelLitersTotal = calculateTransferFuelLiters(params.truck, params.route, params.driver);
  const fuelLitersAtStart = normalizeTruckFuel(params.truck).currentFuelL ?? fuelLitersTotal;

  return {
    id: `transfer_${Date.now()}_${params.sequence}`,
    truckId: params.truck.id,
    driverId: params.driver.id,
    fromCityId: params.fromCityId,
    toCityId: params.toCityId,
    distanceKm: params.route.distanceKm,
    startedAt: params.currentTime,
    estimatedArrivalAt: params.currentTime + durationHours,
    progress: 0,
    fuelCost: costs.fuelCost,
    fuelLitersAtStart,
    fuelLitersTotal,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    lastFuelProcessedAt: params.currentTime,
    distanceTraveledKm: 0,
    currentSpeedKmh: 0,
    fuelWarningsEmitted: [],
    driverCost: costs.driverCost,
    totalCost: costs.totalCost,
    status: 'active',
  };
}

export function getTransferTravelHours(transfer: TruckTransfer): number {
  return Math.max(MIN_TRANSFER_HOURS, transfer.estimatedArrivalAt - transfer.startedAt);
}

export function updateTransferProgress(
  transfer: TruckTransfer,
  hoursPassed: number,
): TruckTransfer {
  if (transfer.status !== 'active' || hoursPassed <= 0) {
    return transfer;
  }

  const travelHours = getTransferTravelHours(transfer);
  const progress = Math.min(1, transfer.progress + hoursPassed / travelHours);
  const distanceDeltaKm = Math.max(0, (progress - transfer.progress) * transfer.distanceKm);
  return {
    ...transfer,
    progress,
    currentSpeedKmh: calculateActualSpeedKmh({
      distanceDeltaKm,
      elapsedHoursDelta: hoursPassed,
    }),
  };
}

export function updateTransferProgressWithFuel(
  transfer: TruckTransfer,
  truck: Truck,
  hoursPassed: number,
  processedAt?: number,
): { transfer: TruckTransfer; truck: Truck } {
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
    const normalized = normalizeTruckFuel(truck);
    const availableFuel = normalized.currentFuelL ?? 0;
    if (availableFuel > 1e-6) {
      return {
        transfer: {
          ...transfer,
          estimatedArrivalAt: transfer.estimatedArrivalAt + hoursPassed,
          lastFuelProcessedAt: processedAt ?? transfer.lastFuelProcessedAt,
          currentSpeedKmh: 0,
        },
        truck: {
          ...normalized,
          status: 'out_of_fuel',
        },
      };
    }
    return {
      transfer: {
        ...transfer,
        estimatedArrivalAt: transfer.estimatedArrivalAt + hoursPassed,
        lastFuelProcessedAt: processedAt ?? transfer.lastFuelProcessedAt,
        currentSpeedKmh: 0,
      },
      truck: {
        ...normalized,
        currentFuelL: 0,
        status: 'out_of_fuel',
      },
    };
  }

  if (transfer.status !== 'active') {
    return { transfer, truck };
  }

  const normalizedTruck = normalizeTruckFuel(truck);
  const travelHours = getTransferTravelHours(transfer);
  const requestedProgressDelta = Math.min(
    Math.max(0, 1 - transfer.progress),
    hoursPassed / travelHours,
  );
  const result = advanceFuelConstrainedProgress({
    currentProgress: transfer.progress,
    requestedProgressDelta,
    fuelLitersAtStart:
      transfer.fuelLitersAtStart ?? normalizedTruck.currentFuelL ?? 0,
    fuelLitersTotal: transfer.fuelLitersTotal ?? 0,
    currentFuelL: normalizedTruck.currentFuelL ?? 0,
    fuelConsumedL: transfer.fuelConsumedL,
    lastFuelProcessedProgress: transfer.lastFuelProcessedProgress,
    distanceKm: transfer.distanceKm,
    distanceTraveledKm: transfer.distanceTraveledKm,
  });

  return {
    transfer: {
      ...transfer,
      progress: result.progress,
      status: result.outOfFuel ? 'paused' : transfer.status,
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
      estimatedArrivalAt: result.outOfFuel
        ? transfer.estimatedArrivalAt +
          hoursPassed *
            Math.max(
              0,
              1 -
                result.actualProgressDelta /
                  Math.max(requestedProgressDelta, Number.EPSILON),
            )
        : transfer.estimatedArrivalAt,
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
