/**
 * Canonical driver assignment / operational state.
 * UI and eligibility must derive from active deliveries + fleet, not stale driver.status alone.
 */

import type { Delivery, Driver, DriverStatus, Truck, TruckTransfer } from '../types/game';

export const ACTIVE_DRIVER_DELIVERY_STATUSES: Delivery['status'][] = [
  'preparing',
  'on_route',
  'paused',
];

export const ACTIVE_DRIVER_TRANSFER_STATUSES: TruckTransfer['status'][] = [
  'active',
  'paused',
];

export type DriverOperationalKind =
  | 'available'
  | 'assigned'
  | 'on_delivery'
  | 'on_transfer'
  | 'resting';

export interface DriverAssignmentContext {
  truckIds: Set<string>;
  activeDeliveryByDriverId: Map<string, Delivery>;
  activeDeliveryByTruckId: Map<string, Delivery>;
  activeTransferByDriverId: Map<string, TruckTransfer>;
  activeTransferByTruckId: Map<string, TruckTransfer>;
}

export interface DriverOperationalState {
  kind: DriverOperationalKind;
  persistedStatus: DriverStatus;
  assignedTruckId: string | null;
  activeDeliveryId: string | null;
  activeTransferId: string | null;
  selectableForDelivery: boolean;
  assignmentBlockedReason: string | null;
  statusBadgeLabel: string;
  assignmentBadgeLabel: 'ATANMIŞ' | 'ATANMADI';
}

export interface DriverReconcileSummary {
  fixedDrivers: number;
  orphanAssignments: number;
  duplicateAssignments: number;
  staleDrivingCleared: number;
  details: Array<{
    driverId: string;
    driverName: string;
    rawStatus: DriverStatus;
    derivedStatus: DriverStatus;
    assignedTruckId: string | null;
    activeDeliveryId: string | null;
  }>;
}

export interface DriverReconcileResult {
  drivers: Driver[];
  changed: boolean;
  summary: DriverReconcileSummary;
}

function isActiveDelivery(delivery: Delivery): boolean {
  return ACTIVE_DRIVER_DELIVERY_STATUSES.includes(delivery.status);
}

function isActiveTransfer(transfer: TruckTransfer): boolean {
  return ACTIVE_DRIVER_TRANSFER_STATUSES.includes(transfer.status);
}

export function buildDriverAssignmentContext(input: {
  trucks: Truck[];
  activeDeliveries: Delivery[];
  activeTransfers?: TruckTransfer[];
}): DriverAssignmentContext {
  const truckIds = new Set((input.trucks ?? []).map((truck) => truck.id));
  const activeDeliveryByDriverId = new Map<string, Delivery>();
  const activeDeliveryByTruckId = new Map<string, Delivery>();
  for (const delivery of input.activeDeliveries ?? []) {
    if (!isActiveDelivery(delivery)) continue;
    activeDeliveryByDriverId.set(delivery.driverId, delivery);
    activeDeliveryByTruckId.set(delivery.truckId, delivery);
  }

  const activeTransferByDriverId = new Map<string, TruckTransfer>();
  const activeTransferByTruckId = new Map<string, TruckTransfer>();
  for (const transfer of input.activeTransfers ?? []) {
    if (!isActiveTransfer(transfer)) continue;
    if (transfer.driverId) {
      activeTransferByDriverId.set(transfer.driverId, transfer);
    }
    activeTransferByTruckId.set(transfer.truckId, transfer);
  }

  return {
    truckIds,
    activeDeliveryByDriverId,
    activeDeliveryByTruckId,
    activeTransferByDriverId,
    activeTransferByTruckId,
  };
}

export function getDriverOperationalState(
  driver: Driver,
  context: DriverAssignmentContext,
): DriverOperationalState {
  const activeDelivery = context.activeDeliveryByDriverId.get(driver.id) ?? null;
  const activeTransfer = context.activeTransferByDriverId.get(driver.id) ?? null;
  const assignedTruckValid =
    driver.assignedTruckId != null && context.truckIds.has(driver.assignedTruckId);

  if (activeDelivery) {
    return {
      kind: 'on_delivery',
      persistedStatus: 'driving',
      assignedTruckId: activeDelivery.truckId,
      activeDeliveryId: activeDelivery.id,
      activeTransferId: null,
      selectableForDelivery: false,
      assignmentBlockedReason: 'Şoför başka bir teslimatta',
      statusBadgeLabel: 'TESLİMATTA',
      assignmentBadgeLabel: 'ATANMIŞ',
    };
  }

  if (activeTransfer) {
    return {
      kind: 'on_transfer',
      persistedStatus: 'driving',
      assignedTruckId: activeTransfer.truckId,
      activeDeliveryId: null,
      activeTransferId: activeTransfer.id,
      selectableForDelivery: false,
      assignmentBlockedReason: 'Şoför aktif transferde',
      statusBadgeLabel: 'YOLDA',
      assignmentBadgeLabel: 'ATANMIŞ',
    };
  }

  if (driver.status === 'resting') {
    return {
      kind: 'resting',
      persistedStatus: 'resting',
      assignedTruckId: assignedTruckValid ? driver.assignedTruckId : null,
      activeDeliveryId: null,
      activeTransferId: null,
      selectableForDelivery: false,
      assignmentBlockedReason: 'Şoför dinleniyor',
      statusBadgeLabel: 'DİNLENİYOR',
      assignmentBadgeLabel: assignedTruckValid ? 'ATANMIŞ' : 'ATANMADI',
    };
  }

  if (assignedTruckValid) {
    return {
      kind: 'assigned',
      persistedStatus: 'idle',
      assignedTruckId: driver.assignedTruckId,
      activeDeliveryId: null,
      activeTransferId: null,
      selectableForDelivery: true,
      assignmentBlockedReason: null,
      statusBadgeLabel: 'BOŞTA',
      assignmentBadgeLabel: 'ATANMIŞ',
    };
  }

  return {
    kind: 'available',
    persistedStatus: 'idle',
    assignedTruckId: null,
    activeDeliveryId: null,
    activeTransferId: null,
    selectableForDelivery: true,
    assignmentBlockedReason: null,
    statusBadgeLabel: 'BOŞTA',
    assignmentBadgeLabel: 'ATANMADI',
  };
}

function driversEqual(a: Driver, b: Driver): boolean {
  return (
    a.status === b.status &&
    a.assignedTruckId === b.assignedTruckId &&
    (a.currentCityId ?? null) === (b.currentCityId ?? null)
  );
}

export function reconcileDriverAssignments(input: {
  drivers: Driver[];
  trucks: Truck[];
  activeDeliveries: Delivery[];
  activeTransfers?: TruckTransfer[];
}): DriverReconcileResult {
  const context = buildDriverAssignmentContext(input);
  const claimedTruckIds = new Set<string>();
  const summary: DriverReconcileSummary = {
    fixedDrivers: 0,
    orphanAssignments: 0,
    duplicateAssignments: 0,
    staleDrivingCleared: 0,
    details: [],
  };

  const nextDrivers = (input.drivers ?? []).map((driver) => {
    const operational = getDriverOperationalState(driver, context);
    let next: Driver = { ...driver };

    if (operational.kind === 'on_delivery' || operational.kind === 'on_transfer') {
      next = {
        ...next,
        status: 'driving',
        assignedTruckId: operational.assignedTruckId,
      };
      if (operational.assignedTruckId) {
        if (claimedTruckIds.has(operational.assignedTruckId)) {
          summary.duplicateAssignments += 1;
        }
        claimedTruckIds.add(operational.assignedTruckId);
      }
    } else if (operational.kind === 'resting') {
      next = {
        ...next,
        status: 'resting',
        assignedTruckId: operational.assignedTruckId,
      };
      if (operational.assignedTruckId) {
        claimedTruckIds.add(operational.assignedTruckId);
      }
    } else {
      const hadStaleDriving = driver.status === 'driving';
      const hadOrphanTruck =
        driver.assignedTruckId != null && !context.truckIds.has(driver.assignedTruckId);
      let assignedTruckId = operational.assignedTruckId;

      if (assignedTruckId && claimedTruckIds.has(assignedTruckId)) {
        assignedTruckId = null;
        summary.duplicateAssignments += 1;
      }

      if (hadOrphanTruck) {
        summary.orphanAssignments += 1;
      }
      if (hadStaleDriving) {
        summary.staleDrivingCleared += 1;
      }

      next = {
        ...next,
        status: 'idle',
        assignedTruckId,
      };
      if (assignedTruckId) {
        claimedTruckIds.add(assignedTruckId);
      }
    }

    if (!driversEqual(driver, next)) {
      summary.fixedDrivers += 1;
      summary.details.push({
        driverId: driver.id,
        driverName: driver.name,
        rawStatus: driver.status,
        derivedStatus: next.status,
        assignedTruckId: next.assignedTruckId,
        activeDeliveryId: operational.activeDeliveryId,
      });
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.info('[DRIVER_INTEGRITY]', {
          driverId: driver.id,
          driverName: driver.name,
          rawStatus: driver.status,
          derivedStatus: next.status,
          assignedTruckId: next.assignedTruckId,
          activeDeliveryId: operational.activeDeliveryId,
        });
      }
    }

    return next;
  });

  const changed = summary.fixedDrivers > 0;
  if (changed && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[DRIVER_RECONCILE]', {
      fixedDrivers: summary.fixedDrivers,
      orphanAssignments: summary.orphanAssignments,
      duplicateAssignments: summary.duplicateAssignments,
      staleDrivingCleared: summary.staleDrivingCleared,
    });
  }

  return {
    drivers: nextDrivers,
    changed,
    summary,
  };
}
