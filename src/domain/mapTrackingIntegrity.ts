/**
 * Map / truck-tracking integrity.
 * Derived markers must follow canonical fleet + running jobs.
 * Does not reset the game or recreate missing vehicles.
 */

import {
  reconcileDriverAssignments,
} from './driverOperationalState';
import type {
  Contract,
  Delivery,
  Driver,
  Player,
  Truck,
  TruckTransfer,
  WarehouseStockTransfer,
} from '../types/game';
import {
  findActiveDeliveryForTruck,
  getVisibleFleetTrucks,
  isLeaseTimeExpired,
  isLeasedTruck,
  shouldShowTruckInFleet,
} from '../simulation/rentalTruckLifecycle';

const ACTIVE_DELIVERY = new Set<Delivery['status']>(['preparing', 'on_route', 'paused']);
const ACTIVE_TRANSFER = new Set<TruckTransfer['status']>(['active', 'paused']);

export type MapTrackingIssueKind =
  | 'stale_marker'
  | 'missing_vehicle'
  | 'duplicate_marker'
  | 'expired_rental'
  | 'orphan_delivery'
  | 'completed_stale';

export interface VehicleTrackingIntegrityReport {
  staleMarkers: Array<{ vehicleId: string; deliveryId?: string; transferId?: string }>;
  missingVehicles: string[];
  duplicateMarkers: Array<{ vehicleId: string; deliveryIds: string[] }>;
  expiredRentals: Array<{ vehicleId: string; stillInFleet: boolean }>;
  orphanDeliveries: Array<{
    deliveryId: string;
    vehicleId: string;
    kind: 'ORPHAN_DELIVERY_MISSING_VEHICLE';
  }>;
  issueCount: number;
}

export interface MapTrackingReconcileInput {
  currentTime: number;
  player: Player;
  activeDeliveries: Delivery[];
  contracts: Contract[];
  activeTransfers: TruckTransfer[];
  activeWarehouseStockTransfers: WarehouseStockTransfer[];
}

export interface MapTrackingReconcileResult {
  report: VehicleTrackingIntegrityReport;
  player: Player;
  activeDeliveries: Delivery[];
  contracts: Contract[];
  activeTransfers: TruckTransfer[];
  activeWarehouseStockTransfers: WarehouseStockTransfer[];
  changed: boolean;
  fixedCount: number;
  removedExpiredRentals: number;
  cancelledOrphanDeliveries: number;
  cancelledOrphanTransfers: number;
}

function isRunningDelivery(delivery: Delivery): boolean {
  return ACTIVE_DELIVERY.has(delivery.status);
}

function isRunningTransfer(transfer: TruckTransfer): boolean {
  return ACTIVE_TRANSFER.has(transfer.status);
}

export function getCanonicalValidMapVehicleIds(params: {
  trucks: Truck[] | undefined;
  currentTime: number;
  activeDeliveries: Delivery[] | undefined;
}): Set<string> {
  return new Set(
    getVisibleFleetTrucks(params.trucks, params.currentTime, params.activeDeliveries).map(
      (truck) => truck.id,
    ),
  );
}

function runningJobsByVehicleId(deliveries: Delivery[]): Map<string, Delivery[]> {
  const byVehicle = new Map<string, Delivery[]>();
  for (const delivery of deliveries) {
    if (!isRunningDelivery(delivery)) continue;
    const list = byVehicle.get(delivery.truckId) ?? [];
    list.push(delivery);
    byVehicle.set(delivery.truckId, list);
  }
  return byVehicle;
}

export function validateVehicleTrackingIntegrity(
  input: MapTrackingReconcileInput,
): VehicleTrackingIntegrityReport {
  const trucks = input.player.trucks ?? [];
  const fleetIds = new Set(trucks.map((truck) => truck.id));
  const validIds = getCanonicalValidMapVehicleIds({
    trucks,
    currentTime: input.currentTime,
    activeDeliveries: input.activeDeliveries,
  });
  const staleMarkers: VehicleTrackingIntegrityReport['staleMarkers'] = [];
  const missingVehicles: string[] = [];
  const expiredRentals: VehicleTrackingIntegrityReport['expiredRentals'] = [];
  const orphanDeliveries: VehicleTrackingIntegrityReport['orphanDeliveries'] = [];

  const jobsByVehicle = runningJobsByVehicleId(input.activeDeliveries);
  const duplicateMarkers = [...jobsByVehicle.entries()]
    .filter(([, jobs]) => jobs.length > 1)
    .map(([vehicleId, jobs]) => ({
      vehicleId,
      deliveryIds: jobs.map((job) => job.id),
    }));

  for (const delivery of input.activeDeliveries) {
    if (!isRunningDelivery(delivery)) continue;
    if (!fleetIds.has(delivery.truckId) || !validIds.has(delivery.truckId)) {
      missingVehicles.push(delivery.truckId);
      orphanDeliveries.push({
        deliveryId: delivery.id,
        vehicleId: delivery.truckId,
        kind: 'ORPHAN_DELIVERY_MISSING_VEHICLE',
      });
      staleMarkers.push({ vehicleId: delivery.truckId, deliveryId: delivery.id });
    }
  }

  for (const transfer of input.activeTransfers ?? []) {
    if (!isRunningTransfer(transfer)) continue;
    if (!fleetIds.has(transfer.truckId) || !validIds.has(transfer.truckId)) {
      missingVehicles.push(transfer.truckId);
      staleMarkers.push({ vehicleId: transfer.truckId, transferId: transfer.id });
    }
  }

  for (const truck of trucks) {
    if (!isLeasedTruck(truck)) continue;
    const delivery = findActiveDeliveryForTruck(truck.id, input.activeDeliveries);
    if (!shouldShowTruckInFleet(truck, input.currentTime, delivery)) {
      expiredRentals.push({ vehicleId: truck.id, stillInFleet: true });
      continue;
    }
    if (isLeaseTimeExpired(truck, input.currentTime) && !delivery) {
      expiredRentals.push({ vehicleId: truck.id, stillInFleet: true });
    }
  }

  const uniqueMissing = [...new Set(missingVehicles)];
  const uniqueOrphans = orphanDeliveries.filter(
    (item, index) =>
      orphanDeliveries.findIndex((candidate) => candidate.deliveryId === item.deliveryId) === index,
  );

  return {
    staleMarkers,
    missingVehicles: uniqueMissing,
    duplicateMarkers,
    expiredRentals,
    orphanDeliveries: uniqueOrphans,
    issueCount:
      staleMarkers.length + duplicateMarkers.length + expiredRentals.length + uniqueOrphans.length,
  };
}

function pickCanonicalDuplicateDelivery(jobs: Delivery[]): Delivery {
  return [...jobs].sort((left, right) => {
    const progressDelta = (right.progress ?? 0) - (left.progress ?? 0);
    if (progressDelta !== 0) return progressDelta;
    const startedDelta = (left.startedAt ?? 0) - (right.startedAt ?? 0);
    if (startedDelta !== 0) return startedDelta;
    return left.id.localeCompare(right.id);
  })[0]!;
}

function cancelDelivery(delivery: Delivery): Delivery {
  return {
    ...delivery,
    status: 'cancelled',
    failureReason: 'cancelled',
    pausedReason: undefined,
  };
}

function cancelTransfer(transfer: TruckTransfer): TruckTransfer {
  return {
    ...transfer,
    status: 'cancelled',
    pausedReason: undefined,
  };
}

function idleDriversForMissingTrucks(
  drivers: Driver[],
  missingTruckIds: Set<string>,
): Driver[] {
  return drivers.map((driver) =>
    driver.assignedTruckId && missingTruckIds.has(driver.assignedTruckId)
      ? { ...driver, assignedTruckId: null, status: 'idle' as const }
      : driver,
  );
}

export function reconcileMapTrackingState(
  input: MapTrackingReconcileInput,
): MapTrackingReconcileResult {
  const report = validateVehicleTrackingIntegrity(input);
  const orphanDeliveryIds = new Set(report.orphanDeliveries.map((item) => item.deliveryId));
  const orphanVehicleIds = new Set(report.orphanDeliveries.map((item) => item.vehicleId));
  const staleTransferIds = new Set(
    report.staleMarkers
      .map((item) => item.transferId)
      .filter((value): value is string => value != null),
  );
  const duplicateExtraDeliveryIds = new Set<string>();
  for (const duplicate of report.duplicateMarkers) {
    const jobs = (runningJobsByVehicleId(input.activeDeliveries).get(duplicate.vehicleId) ?? []).filter(
      (delivery) => !orphanDeliveryIds.has(delivery.id),
    );
    if (jobs.length <= 1) continue;
    const keep = pickCanonicalDuplicateDelivery(jobs);
    for (const extra of jobs) {
      if (extra.id !== keep.id) {
        duplicateExtraDeliveryIds.add(extra.id);
      }
    }
  }

  let cancelledOrphanDeliveries = 0;
  let cancelledDuplicateDeliveries = 0;
  const nextDeliveries = input.activeDeliveries.map((delivery) => {
    if (!isRunningDelivery(delivery)) {
      return delivery;
    }
    if (orphanDeliveryIds.has(delivery.id)) {
      cancelledOrphanDeliveries += 1;
      return cancelDelivery(delivery);
    }
    if (duplicateExtraDeliveryIds.has(delivery.id)) {
      cancelledDuplicateDeliveries += 1;
      return cancelDelivery(delivery);
    }
    return delivery;
  });

  const orphanContractIds = new Set(
    input.activeDeliveries
      .filter(
        (delivery) =>
          orphanDeliveryIds.has(delivery.id) || duplicateExtraDeliveryIds.has(delivery.id),
      )
      .map((delivery) => delivery.contractId),
  );
  const nextContracts = input.contracts.map((contract) =>
    orphanContractIds.has(contract.id) && contract.status === 'active'
      ? { ...contract, status: 'failed' as const }
      : contract,
  );

  let cancelledOrphanTransfers = 0;
  const nextTransfers = (input.activeTransfers ?? []).map((transfer) => {
    if (!staleTransferIds.has(transfer.id) || !isRunningTransfer(transfer)) {
      return transfer;
    }
    cancelledOrphanTransfers += 1;
    return cancelTransfer(transfer);
  });

  const nextWarehouseTransfers = (input.activeWarehouseStockTransfers ?? []).map((transfer) =>
    orphanVehicleIds.has(transfer.truckId) &&
    (transfer.status === 'active' || transfer.status === 'pending' || transfer.status === 'paused')
      ? { ...transfer, status: 'cancelled' as const, pausedReason: undefined }
      : transfer,
  );

  const driverReconcile = reconcileDriverAssignments({
    drivers: idleDriversForMissingTrucks(input.player.drivers ?? [], orphanVehicleIds),
    trucks: input.player.trucks ?? [],
    activeDeliveries: nextDeliveries,
    activeTransfers: nextTransfers,
  });

  const nextPlayer: Player = {
    ...input.player,
    drivers: driverReconcile.drivers,
  };

  const driversChanged =
    driverReconcile.changed ||
    (nextPlayer.drivers ?? []).some((driver, index) => {
      const previous = (input.player.drivers ?? [])[index];
      return previous?.assignedTruckId !== driver.assignedTruckId || previous?.status !== driver.status;
    });
  const warehouseChanged = nextWarehouseTransfers.some(
    (item, index) => item !== (input.activeWarehouseStockTransfers ?? [])[index],
  );
  const cancelledWarehouse = nextWarehouseTransfers.filter(
    (item, index) =>
      item.status === 'cancelled' &&
      (input.activeWarehouseStockTransfers ?? [])[index]?.status !== 'cancelled',
  ).length;

  const fixedCount =
    cancelledOrphanDeliveries +
    cancelledDuplicateDeliveries +
    cancelledOrphanTransfers +
    cancelledWarehouse +
    driverReconcile.summary.fixedDrivers;
  const changed = fixedCount > 0 || driversChanged || warehouseChanged;

  return {
    report,
    player: nextPlayer,
    activeDeliveries: nextDeliveries,
    contracts: nextContracts,
    activeTransfers: nextTransfers,
    activeWarehouseStockTransfers: nextWarehouseTransfers,
    changed,
    fixedCount,
    removedExpiredRentals: report.expiredRentals.length,
    cancelledOrphanDeliveries,
    cancelledOrphanTransfers,
  };
}

export function emptyVehicleTrackingIntegrityReport(): VehicleTrackingIntegrityReport {
  return {
    staleMarkers: [],
    missingVehicles: [],
    duplicateMarkers: [],
    expiredRentals: [],
    orphanDeliveries: [],
    issueCount: 0,
  };
}

export function formatMapSyncToast(params: {
  inspectedOnly?: boolean;
  fixedCount: number;
  removedExpiredRentals?: number;
}): string {
  if (params.inspectedOnly) {
    return params.fixedCount > 0
      ? `${params.fixedCount} tutarsız kayıt bulundu.`
      : 'Harita durumu güncel.';
  }
  if (params.fixedCount <= 0) {
    return 'Harita senkronize edildi.';
  }
  if ((params.removedExpiredRentals ?? 0) > 0 && params.removedExpiredRentals === params.fixedCount) {
    return `${params.removedExpiredRentals} eski araç kaydı temizlendi.`;
  }
  return `Harita senkronize edildi. ${params.fixedCount} tutarsız kayıt düzeltildi.`;
}
