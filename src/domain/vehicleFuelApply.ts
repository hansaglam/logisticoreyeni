/**
 * Yakıt satın alma — tek source-of-truth mutation.
 * Tank, araç status ve bağlı iş kaydı (fuelLitersAtStart / pause) atomik güncellenir.
 * Tick'ler tankı "start - consumed" ile ezmesin diye start da litre kadar artar.
 */

import { getJobRemainingDistanceKm, getJobRemainingFuelRequiredL } from '../simulation/fuelWarnings';
import { resumeRoadsideJob, type RoadsideFuelJob } from '../simulation/roadsideFuel';
import { getTruckRangeKm, normalizeTruckFuel } from '../utils/truckFuel';
import type { Delivery, Truck, TruckTransfer, WarehouseStockTransfer } from '../types/game';

const FUEL_EPS = 1e-6;
const ACTIVE_DELIVERY = new Set<Delivery['status']>(['preparing', 'on_route', 'paused']);
const ACTIVE_TRANSFER = new Set<TruckTransfer['status']>(['active', 'paused']);
const ACTIVE_WAREHOUSE = new Set<WarehouseStockTransfer['status']>([
  'pending',
  'active',
  'paused',
]);

export interface ApplyPurchasedFuelInput {
  truck: Truck;
  newFuelL: number;
  litersAdded: number;
  deliveries: Delivery[];
  transfers: TruckTransfer[];
  warehouseTransfers: WarehouseStockTransfer[];
}

export interface ApplyPurchasedFuelResult {
  truck: Truck;
  deliveries: Delivery[];
  transfers: TruckTransfer[];
  warehouseTransfers: WarehouseStockTransfer[];
  litersAdded: number;
  fuelBefore: number;
  fuelAfter: number;
  fuelTankCapacityL: number;
  truckStatusBefore: Truck['status'];
  truckStatusAfter: Truck['status'];
  deliveryStatusBefore?: Delivery['status'] | TruckTransfer['status'] | WarehouseStockTransfer['status'];
  deliveryStatusAfter?: Delivery['status'] | TruckTransfer['status'] | WarehouseStockTransfer['status'];
  resumedJob: boolean;
  remainingFuelRequiredL: number;
  remainingDistanceKm: number;
  currentRangeKm: number;
  sufficientForRemainingRoute: boolean;
}

function isOutOfFuelJob(job: { status: string; pausedReason?: string }): boolean {
  return job.status === 'paused' && job.pausedReason === 'out-of-fuel';
}

export function applyPurchasedFuelToVehicle(
  input: ApplyPurchasedFuelInput,
): ApplyPurchasedFuelResult {
  const fuelBefore = normalizeTruckFuel(input.truck).currentFuelL ?? 0;
  const litersAdded = Math.max(0, input.litersAdded);
  const fueled = normalizeTruckFuel({
    ...input.truck,
    currentFuelL: input.newFuelL,
  });
  const fuelAfter = fueled.currentFuelL ?? 0;
  const capacity = fueled.fuelTankCapacityL ?? 0;

  const delivery = input.deliveries.find(
    (item) => item.truckId === input.truck.id && ACTIVE_DELIVERY.has(item.status),
  );
  const transfer = input.transfers.find(
    (item) => item.truckId === input.truck.id && ACTIVE_TRANSFER.has(item.status),
  );
  const warehouse = input.warehouseTransfers.find(
    (item) => item.truckId === input.truck.id && ACTIVE_WAREHOUSE.has(item.status),
  );
  const job = delivery ?? transfer ?? warehouse;
  const deliveryStatusBefore = job?.status;
  const shouldResume =
    fuelAfter > FUEL_EPS &&
    (input.truck.status === 'out_of_fuel' || (job != null && isOutOfFuelJob(job)));

  let nextTruck: Truck = fueled;
  if (shouldResume && delivery) {
    nextTruck = { ...fueled, status: 'on_route' };
  } else if (shouldResume && (transfer || warehouse)) {
    nextTruck = { ...fueled, status: 'transferring' };
  } else if (delivery && (fueled.status === 'idle' || fueled.status === 'out_of_fuel')) {
    nextTruck = { ...fueled, status: fuelAfter > FUEL_EPS ? 'on_route' : 'out_of_fuel' };
  } else if ((transfer || warehouse) && (fueled.status === 'idle' || fueled.status === 'out_of_fuel')) {
    nextTruck = { ...fueled, status: fuelAfter > FUEL_EPS ? 'transferring' : 'out_of_fuel' };
  }

  const bumpJob = <T extends RoadsideFuelJob>(
    item: T,
    kind: 'delivery' | 'truck-transfer' | 'warehouse-transfer',
  ): T => {
    if (shouldResume && isOutOfFuelJob(item)) {
      return resumeRoadsideJob(item, kind, { litersAdded });
    }
    return {
      ...item,
      fuelLitersAtStart: Math.round((Math.max(0, item.fuelLitersAtStart ?? 0) + litersAdded) * 1000) / 1000,
    };
  };

  const deliveries = input.deliveries.map((item) =>
    item.id === delivery?.id ? bumpJob(item, 'delivery') : item,
  );
  const transfers = input.transfers.map((item) =>
    item.id === transfer?.id ? bumpJob(item, 'truck-transfer') : item,
  );
  const warehouseTransfers = input.warehouseTransfers.map((item) =>
    item.id === warehouse?.id ? bumpJob(item, 'warehouse-transfer') : item,
  );

  const nextJob = deliveries.find((item) => item.id === delivery?.id)
    ?? transfers.find((item) => item.id === transfer?.id)
    ?? warehouseTransfers.find((item) => item.id === warehouse?.id);
  const remainingFuelRequiredL = nextJob ? getJobRemainingFuelRequiredL(nextJob) : 0;
  const remainingDistanceKm = nextJob ? getJobRemainingDistanceKm(nextJob) : 0;
  const currentRangeKm = getTruckRangeKm(nextTruck);
  const sufficientForRemainingRoute =
    remainingFuelRequiredL <= FUEL_EPS || fuelAfter + FUEL_EPS >= remainingFuelRequiredL;

  return {
    truck: nextTruck,
    deliveries,
    transfers,
    warehouseTransfers,
    litersAdded,
    fuelBefore,
    fuelAfter,
    fuelTankCapacityL: capacity,
    truckStatusBefore: input.truck.status,
    truckStatusAfter: nextTruck.status,
    deliveryStatusBefore,
    deliveryStatusAfter: nextJob?.status,
    resumedJob: shouldResume,
    remainingFuelRequiredL,
    remainingDistanceKm,
    currentRangeKm,
    sufficientForRemainingRoute,
  };
}

export function formatRefuelSuccessMessage(result: ApplyPurchasedFuelResult): string {
  const liters = result.litersAdded.toFixed(1);
  const tank = `${result.fuelAfter.toFixed(1)} / ${result.fuelTankCapacityL.toFixed(0)} L`;
  if (result.resumedJob) {
    return `${liters} L yakıt eklendi. Yeni yakıt seviyesi: ${tank}. Teslimata devam edebilir.`;
  }
  if (result.deliveryStatusAfter === 'on_route' || result.truckStatusAfter === 'on_route') {
    return `${liters} L yakıt eklendi. Yeni yakıt seviyesi: ${tank}. Araç tekrar hareket etmeye hazır.`;
  }
  return `${liters} L yakıt eklendi. Yeni yakıt seviyesi: ${tank}.`;
}

export function formatRemainingRouteFuelWarning(result: ApplyPurchasedFuelResult): string | null {
  if (result.sufficientForRemainingRoute || result.remainingDistanceKm <= 0) {
    return null;
  }
  return (
    `Mevcut yakıt rota için yeterli değil. Tahmini gerekli menzil: ${Math.ceil(result.remainingDistanceKm)} km. ` +
    `Mevcut menzil: ${Math.floor(result.currentRangeKm)} km.`
  );
}
