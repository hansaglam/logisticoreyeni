/**
 * Kiralık kamyon yaşam döngüsü — canonical domain kuralları.
 */

import { rentalTruckConfig } from '../config/rentalTruck';
import type {
  Delivery,
  Driver,
  Player,
  RentalNotificationKind,
  RentalReturnReason,
  RentalTruckLifecycle,
  RentalTruckStatus,
  Trailer,
  Truck,
  TruckTransfer,
  WarehouseStockTransfer,
} from '../types/game';
import { detachTrailersFromTruckState } from './trailerOps';

const ACTIVE_DELIVERY_STATUSES = new Set<Delivery['status']>([
  'preparing',
  'on_route',
  'paused',
]);

export interface RentalTruckStatusResult {
  status: RentalTruckStatus;
  expiresAt: number | null;
  remainingMs: number;
  shouldRemoveFromFleet: boolean;
}

export interface RentalTruckNotificationDraft {
  id: string;
  kind: RentalNotificationKind;
  title: string;
  message: string;
  truckId: string;
  truckName: string;
}

export interface ReturnExpiredRentalTruckInput {
  truckId: string;
  reason: RentalReturnReason;
  currentTime: number;
  player: Pick<Player, 'trucks' | 'drivers' | 'trailers'>;
  activeTransfers?: TruckTransfer[];
  activeWarehouseStockTransfers?: WarehouseStockTransfer[];
}

export interface ReturnExpiredRentalTruckResult {
  applied: boolean;
  truckName: string | null;
  player: Pick<Player, 'trucks' | 'drivers' | 'trailers'>;
  activeTransfers: TruckTransfer[];
  activeWarehouseStockTransfers: WarehouseStockTransfer[];
  notification: RentalTruckNotificationDraft | null;
}

export interface ProcessExpiredRentalTrucksInput {
  player: Pick<Player, 'trucks' | 'drivers' | 'trailers'>;
  activeDeliveries: Delivery[];
  activeTransfers?: TruckTransfer[];
  activeWarehouseStockTransfers?: WarehouseStockTransfer[];
  currentTime: number;
  source: RentalReturnReason | 'game-tick';
}

export interface ProcessExpiredRentalTrucksResult {
  changed: boolean;
  player: Pick<Player, 'trucks' | 'drivers' | 'trailers'>;
  activeTransfers: TruckTransfer[];
  activeWarehouseStockTransfers: WarehouseStockTransfer[];
  notifications: RentalTruckNotificationDraft[];
}

export function isLeasedTruck(truck: Truck): boolean {
  return (truck.ownershipType ?? 'owned') === 'leased';
}

export function getLeaseExpiresAt(truck: Truck): number | null {
  if (!isLeasedTruck(truck)) {
    return null;
  }
  const expiresAt = truck.leaseExpiresAt;
  if (expiresAt == null || !Number.isFinite(expiresAt)) {
    return null;
  }
  return expiresAt;
}

export function isLeaseTimeExpired(truck: Truck, currentTime: number): boolean {
  const expiresAt = getLeaseExpiresAt(truck);
  if (expiresAt == null) {
    return false;
  }
  return currentTime >= expiresAt;
}

export function findActiveDeliveryForTruck(
  truckId: string,
  deliveries: Delivery[] | undefined,
): Delivery | undefined {
  return (deliveries ?? []).find(
    (delivery) =>
      delivery.truckId === truckId && ACTIVE_DELIVERY_STATUSES.has(delivery.status),
  );
}

export function isTruckInActiveDelivery(
  truck: Truck,
  activeDelivery?: Delivery | null,
): boolean {
  if (activeDelivery) {
    return true;
  }
  return (
    truck.status === 'on_route' ||
    truck.status === 'out_of_fuel'
  );
}

export function isRentalReturnPending(truck: Truck): boolean {
  return truck.rentalLifecycle?.returnPendingSince != null;
}

export function isRentalTruckReturned(truck: Truck): boolean {
  return truck.rentalLifecycle?.returnedAt != null;
}

export function getRentalTruckStatus(input: {
  truck: Truck;
  nowMs: number;
  activeDelivery?: Delivery | null;
}): RentalTruckStatusResult {
  const { truck, nowMs: currentTime, activeDelivery } = input;
  const expiresAt = getLeaseExpiresAt(truck);

  if (!isLeasedTruck(truck)) {
    return {
      status: 'active',
      expiresAt: null,
      remainingMs: Number.POSITIVE_INFINITY,
      shouldRemoveFromFleet: false,
    };
  }

  if (isRentalTruckReturned(truck)) {
    return {
      status: 'returned',
      expiresAt,
      remainingMs: 0,
      shouldRemoveFromFleet: true,
    };
  }

  if (isRentalReturnPending(truck)) {
    return {
      status: 'return-pending',
      expiresAt,
      remainingMs: 0,
      shouldRemoveFromFleet: false,
    };
  }

  const remainingMs =
    expiresAt == null ? Number.POSITIVE_INFINITY : Math.max(0, expiresAt - currentTime);

  if (!isLeaseTimeExpired(truck, currentTime)) {
    if (
      expiresAt != null &&
      remainingMs <= rentalTruckConfig.expiryWarningGameHours &&
      truck.rentalLifecycle?.expiryWarningSentAt == null
    ) {
      return {
        status: 'expiring-soon',
        expiresAt,
        remainingMs,
        shouldRemoveFromFleet: false,
      };
    }
    return {
      status: 'active',
      expiresAt,
      remainingMs,
      shouldRemoveFromFleet: false,
    };
  }

  if (isTruckInActiveDelivery(truck, activeDelivery)) {
    return {
      status: 'return-pending',
      expiresAt,
      remainingMs: 0,
      shouldRemoveFromFleet: false,
    };
  }

  if (truck.status === 'idle' || truck.status === 'transferring' || truck.status === 'maintenance') {
    return {
      status: 'expired-idle',
      expiresAt,
      remainingMs: 0,
      shouldRemoveFromFleet: true,
    };
  }

  return {
    status: 'expired-assigned',
    expiresAt,
    remainingMs: 0,
    shouldRemoveFromFleet: true,
  };
}

export function shouldShowTruckInFleet(
  truck: Truck,
  currentTime: number,
  activeDelivery?: Delivery | null,
): boolean {
  const rental = getRentalTruckStatus({ truck, nowMs: currentTime, activeDelivery });
  if (rental.shouldRemoveFromFleet) {
    return false;
  }
  if (rental.status === 'returned') {
    return false;
  }
  if (rental.status === 'expired-idle' || rental.status === 'expired-assigned') {
    return false;
  }
  return true;
}

export function isTruckEligibleForNewAssignment(
  truck: Truck,
  currentTime: number,
  activeDelivery?: Delivery | null,
): boolean {
  const rental = getRentalTruckStatus({ truck, nowMs: currentTime, activeDelivery });
  if (rental.status === 'return-pending' || rental.status === 'returned') {
    return false;
  }
  if (rental.shouldRemoveFromFleet) {
    return false;
  }
  if (isLeaseTimeExpired(truck, currentTime) && !isTruckInActiveDelivery(truck, activeDelivery)) {
    return false;
  }
  if (truck.leaseExpired && !isTruckInActiveDelivery(truck, activeDelivery)) {
    return false;
  }
  return true;
}

export function getVisibleFleetTrucks(
  trucks: Truck[] | undefined,
  currentTime: number,
  activeDeliveries: Delivery[] | undefined,
): Truck[] {
  return (trucks ?? []).filter((truck) => {
    const activeDelivery = findActiveDeliveryForTruck(truck.id, activeDeliveries);
    return shouldShowTruckInFleet(truck, currentTime, activeDelivery);
  });
}

export function getAssignableTrucks(
  trucks: Truck[] | undefined,
  currentTime: number,
  activeDeliveries: Delivery[] | undefined,
): Truck[] {
  return getVisibleFleetTrucks(trucks, currentTime, activeDeliveries).filter((truck) => {
    const activeDelivery = findActiveDeliveryForTruck(truck.id, activeDeliveries);
    return isTruckEligibleForNewAssignment(truck, currentTime, activeDelivery);
  });
}

export function getTransferEligibleTrucks(
  trucks: Truck[] | undefined,
  currentTime: number,
  activeDeliveries: Delivery[] | undefined,
): Truck[] {
  return getAssignableTrucks(trucks, currentTime, activeDeliveries).filter(
    (truck) => truck.status === 'idle',
  );
}

export function getContractEligibleTrucks(
  trucks: Truck[] | undefined,
  currentTime: number,
  activeDeliveries: Delivery[] | undefined,
): Truck[] {
  return getAssignableTrucks(trucks, currentTime, activeDeliveries);
}

function buildExpiryWarningNotification(
  truck: Truck,
  currentTime: number,
): RentalTruckNotificationDraft {
  return {
    id: `rental-warning:${truck.id}`,
    kind: 'rental-expiring-soon',
    title: 'Kiralama süresi yaklaşıyor',
    message: `${truck.name} aracının kiralama süresi yakında sona erecek.`,
    truckId: truck.id,
    truckName: truck.name,
  };
}

function buildExpiredIdleNotification(
  truck: Truck,
  reason: RentalReturnReason,
): RentalTruckNotificationDraft {
  const isBeforeDelivery = reason === 'rental-expired-before-delivery';
  return {
    id: `rental-expired:${truck.id}`,
    kind: 'rental-expired',
    title: isBeforeDelivery ? 'Kiralık araç filodan çıkarıldı' : 'Kiralık araç filodan çıkarıldı',
    message: isBeforeDelivery
      ? `${truck.name} aracının kiralama süresi sona erdi ve filodan çıkarıldı. Teslimat için başka bir kamyon seç.`
      : `${truck.name} aracının kiralama süresi sona erdi.`,
    truckId: truck.id,
    truckName: truck.name,
  };
}

function buildReturnPendingNotification(truck: Truck): RentalTruckNotificationDraft {
  return {
    id: `rental-return-pending:${truck.id}`,
    kind: 'rental-return-pending',
    title: 'Kiralama süresi sona erdi',
    message: `${truck.name} aracının kiralama süresi sona erdi. Mevcut teslimatı tamamladıktan sonra araç kiralama şirketine iade edilecek.`,
    truckId: truck.id,
    truckName: truck.name,
  };
}

function buildReturnedNotification(truck: Truck): RentalTruckNotificationDraft {
  return {
    id: `rental-returned:${truck.id}`,
    kind: 'rental-returned',
    title: 'Araç iade edildi',
    message: `${truck.name} kiralama şirketine iade edildi ve filodan çıkarıldı.`,
    truckId: truck.id,
    truckName: truck.name,
  };
}

function withLifecycle(
  truck: Truck,
  patch: Partial<RentalTruckLifecycle>,
): Truck {
  return {
    ...truck,
    rentalLifecycle: {
      ...(truck.rentalLifecycle ?? {}),
      ...patch,
    },
  };
}

export function returnExpiredRentalTruck(
  input: ReturnExpiredRentalTruckInput,
): ReturnExpiredRentalTruckResult {
  const truck = input.player.trucks.find((candidate) => candidate.id === input.truckId);
  if (!truck || !isLeasedTruck(truck)) {
    return {
      applied: false,
      truckName: null,
      player: input.player,
      activeTransfers: input.activeTransfers ?? [],
      activeWarehouseStockTransfers: input.activeWarehouseStockTransfers ?? [],
      notification: null,
    };
  }

  if (truck.rentalLifecycle?.returnedAt != null) {
    return {
      applied: false,
      truckName: truck.name,
      player: input.player,
      activeTransfers: input.activeTransfers ?? [],
      activeWarehouseStockTransfers: input.activeWarehouseStockTransfers ?? [],
      notification: null,
    };
  }

  const activeDelivery = findActiveDeliveryForTruck(truck.id, []);
  if (isTruckInActiveDelivery(truck, activeDelivery)) {
    return {
      applied: false,
      truckName: truck.name,
      player: input.player,
      activeTransfers: input.activeTransfers ?? [],
      activeWarehouseStockTransfers: input.activeWarehouseStockTransfers ?? [],
      notification: null,
    };
  }

  const updatedDrivers = (input.player.drivers ?? []).map((driver: Driver) =>
    driver.assignedTruckId === input.truckId ? { ...driver, assignedTruckId: null } : driver,
  );
  const updatedTrucks = (input.player.trucks ?? []).filter(
    (candidate) => candidate.id !== input.truckId,
  );
  const updatedTrailers = detachTrailersFromTruckState(
    input.player.trailers ?? [],
    input.truckId,
    input.player.trucks ?? [],
  );
  const updatedTransfers = (input.activeTransfers ?? []).filter(
    (transfer) => transfer.truckId !== input.truckId,
  );
  const updatedWarehouseTransfers = (input.activeWarehouseStockTransfers ?? []).map(
    (transfer: WarehouseStockTransfer) =>
      transfer.truckId === input.truckId && transfer.status !== 'cancelled'
        ? { ...transfer, status: 'cancelled' as const }
        : transfer,
  );

  const notification =
    input.reason === 'rental-expired-after-delivery'
      ? buildReturnedNotification(truck)
      : buildExpiredIdleNotification(truck, input.reason);

  return {
    applied: true,
    truckName: truck.name,
    player: {
      trucks: updatedTrucks,
      drivers: updatedDrivers,
      trailers: updatedTrailers,
    },
    activeTransfers: updatedTransfers,
    activeWarehouseStockTransfers: updatedWarehouseTransfers,
    notification,
  };
}

export function processExpiredRentalTrucks(
  input: ProcessExpiredRentalTrucksInput,
): ProcessExpiredRentalTrucksResult {
  let trucks = [...(input.player.trucks ?? [])];
  let drivers = [...(input.player.drivers ?? [])];
  let trailers = [...(input.player.trailers ?? [])];
  let activeTransfers = [...(input.activeTransfers ?? [])];
  let activeWarehouseStockTransfers = [...(input.activeWarehouseStockTransfers ?? [])];
  const notifications: RentalTruckNotificationDraft[] = [];
  let changed = false;

  for (const truck of input.player.trucks ?? []) {
    if (!isLeasedTruck(truck)) {
      continue;
    }

    const activeDelivery = findActiveDeliveryForTruck(truck.id, input.activeDeliveries);
    const rentalStatus = getRentalTruckStatus({
      truck,
      nowMs: input.currentTime,
      activeDelivery,
    });

    if (
      rentalStatus.status === 'expiring-soon' &&
      truck.rentalLifecycle?.expiryWarningSentAt == null
    ) {
      const warning = buildExpiryWarningNotification(truck, input.currentTime);
      trucks = trucks.map((candidate) =>
        candidate.id === truck.id
          ? withLifecycle(candidate, { expiryWarningSentAt: input.currentTime })
          : candidate,
      );
      notifications.push(warning);
      changed = true;
      continue;
    }

    if (
      rentalStatus.status === 'return-pending' &&
      !isRentalReturnPending(truck) &&
      isTruckInActiveDelivery(truck, activeDelivery)
    ) {
      trucks = trucks.map((candidate) =>
        candidate.id === truck.id
          ? withLifecycle(
              {
                ...candidate,
                leaseExpired: true,
              },
              {
                returnPendingSince: input.currentTime,
                expiredNotificationSentAt: input.currentTime,
              },
            )
          : candidate,
      );
      if (truck.rentalLifecycle?.expiredNotificationSentAt == null) {
        notifications.push(buildReturnPendingNotification(truck));
      }
      changed = true;
      continue;
    }

    if (
      rentalStatus.status === 'return-pending' &&
      isRentalReturnPending(truck) &&
      !isTruckInActiveDelivery(truck, activeDelivery) &&
      truck.status === 'idle'
    ) {
      const removal = returnExpiredRentalTruck({
        truckId: truck.id,
        reason: 'rental-expired-after-delivery',
        currentTime: input.currentTime,
        player: { trucks, drivers, trailers },
        activeTransfers,
        activeWarehouseStockTransfers,
      });
      if (removal.applied) {
        trucks = removal.player.trucks;
        drivers = removal.player.drivers;
        trailers = removal.player.trailers ?? [];
        activeTransfers = removal.activeTransfers;
        activeWarehouseStockTransfers = removal.activeWarehouseStockTransfers;
        if (removal.notification) {
          notifications.push(removal.notification);
        }
        changed = true;
      }
      continue;
    }

    if (rentalStatus.shouldRemoveFromFleet) {
      const removal = returnExpiredRentalTruck({
        truckId: truck.id,
        reason:
          input.source === 'offline-rental-expiry' || input.source === 'hydrate-rental-expiry'
            ? input.source
            : truck.status === 'transferring'
              ? 'rental-expired-before-delivery'
              : 'rental-expired-idle',
        currentTime: input.currentTime,
        player: { trucks, drivers, trailers },
        activeTransfers,
        activeWarehouseStockTransfers,
      });
      if (removal.applied) {
        trucks = removal.player.trucks;
        drivers = removal.player.drivers;
        trailers = removal.player.trailers ?? [];
        activeTransfers = removal.activeTransfers;
        activeWarehouseStockTransfers = removal.activeWarehouseStockTransfers;
        if (removal.notification && truck.rentalLifecycle?.expiredNotificationSentAt == null) {
          notifications.push(removal.notification);
        }
        changed = true;
      }
    }
  }

  return {
    changed,
    player: { trucks, drivers, trailers },
    activeTransfers,
    activeWarehouseStockTransfers,
    notifications,
  };
}

/** @deprecated processExpiredRentalTrucks kullanın */
export interface ExpiredLeaseResult {
  trucks: Truck[];
  expiredTruckNames: string[];
}

/** @deprecated processExpiredRentalTrucks kullanın */
export function processExpiredTruckLeases(
  trucks: Truck[],
  currentTime: number,
): ExpiredLeaseResult {
  const result = processExpiredRentalTrucks({
    player: { trucks, drivers: [], trailers: [] },
    activeDeliveries: [],
    currentTime,
    source: 'game-tick',
  });
  const expiredTruckNames = result.notifications
    .filter((notification) => notification.kind === 'rental-expired')
    .map((notification) => notification.truckName);
  return { trucks: result.player.trucks, expiredTruckNames };
}
