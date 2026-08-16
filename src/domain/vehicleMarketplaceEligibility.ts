/**
 * Canonical client-side eligibility for listing a truck on Araç Pazarı.
 * Mirrors backend `listingEligibility` rules using local game state — do not invent extras.
 */

import type { Delivery, DeliveryStatus, Driver, Trailer, Truck, TruckTransfer } from '../types/game';
import type { VehicleMarketplaceFailureReason } from '../types/vehicleMarketplace';
import { getMarketplaceErrorMessage } from './vehicleMarketplacePresentation';

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route', 'paused'];
const BUSY_TRUCK_STATUSES = new Set<Truck['status']>([
  'on_route',
  'transferring',
  'out_of_fuel',
]);

export type VehicleMarketplaceEligibilityReason =
  | Extract<
      VehicleMarketplaceFailureReason,
      | 'truck-not-found'
      | 'leased-truck'
      | 'already-listed'
      | 'driver-attached'
      | 'trailer-attached'
      | 'truck-busy'
      | 'active-job'
      | 'starter-protection'
      | 'invalid-price'
    >
  | 'invalid-state';

export interface VehicleMarketplaceEligibilityContext {
  trucks: Truck[];
  drivers?: Driver[];
  trailers?: Trailer[];
  activeDeliveries?: Delivery[];
  activeTransfers?: TruckTransfer[];
  /** Truck IDs with an active marketplace listing (from my-listings sync). */
  activeListingTruckIds?: Iterable<string>;
}

export interface VehicleMarketplaceEligibility {
  eligible: boolean;
  reason?: VehicleMarketplaceEligibilityReason;
  message: string;
}

function countOwnedTrucks(trucks: Truck[]): number {
  return trucks.filter(
    (truck) => (truck.ownershipType ?? 'owned') === 'owned' && !truck.leaseExpired,
  ).length;
}

function isOnActiveDelivery(truckId: string, deliveries: Delivery[] | undefined): boolean {
  return (deliveries ?? []).some(
    (delivery) =>
      delivery.truckId === truckId && ACTIVE_DELIVERY_STATUSES.includes(delivery.status),
  );
}

function isOnActiveTransfer(truckId: string, transfers: TruckTransfer[] | undefined): boolean {
  return (transfers ?? []).some(
    (transfer) =>
      transfer.truckId === truckId &&
      (transfer.status === 'active' || transfer.status === 'paused'),
  );
}

function findAssignedDriver(truckId: string, drivers: Driver[] | undefined): Driver | undefined {
  return (drivers ?? []).find((driver) => driver.assignedTruckId === truckId);
}

function findAttachedTrailer(truckId: string, trailers: Trailer[] | undefined): Trailer | undefined {
  return (trailers ?? []).find((trailer) => trailer.attachedTruckId === truckId);
}

function reasonMessage(reason: VehicleMarketplaceEligibilityReason): string {
  if (reason === 'invalid-state') {
    return 'Bu araç şu anda satışa çıkarılamaz.';
  }
  return getMarketplaceErrorMessage(reason);
}

/**
 * Returns whether a vehicle can be listed on Araç Pazarı given local game state.
 * Price range is validated separately at submit time when an asking price is known.
 */
export function getVehicleMarketplaceEligibility(
  truckId: string,
  context: VehicleMarketplaceEligibilityContext,
): VehicleMarketplaceEligibility {
  const truck = context.trucks.find((item) => item.id === truckId);
  if (!truck) {
    return {
      eligible: false,
      reason: 'truck-not-found',
      message: reasonMessage('truck-not-found'),
    };
  }

  if ((truck.ownershipType ?? 'owned') === 'leased') {
    return {
      eligible: false,
      reason: 'leased-truck',
      message: reasonMessage('leased-truck'),
    };
  }

  const listedIds = new Set(context.activeListingTruckIds ?? []);
  if (truck.status === 'marketplace_locked' || listedIds.has(truck.id)) {
    return {
      eligible: false,
      reason: 'already-listed',
      message: reasonMessage('already-listed'),
    };
  }

  if (findAssignedDriver(truck.id, context.drivers)) {
    return {
      eligible: false,
      reason: 'driver-attached',
      message: reasonMessage('driver-attached'),
    };
  }

  if (findAttachedTrailer(truck.id, context.trailers)) {
    return {
      eligible: false,
      reason: 'trailer-attached',
      message: reasonMessage('trailer-attached'),
    };
  }

  if (
    BUSY_TRUCK_STATUSES.has(truck.status) ||
    isOnActiveDelivery(truck.id, context.activeDeliveries) ||
    isOnActiveTransfer(truck.id, context.activeTransfers)
  ) {
    const reason: VehicleMarketplaceEligibilityReason = isOnActiveDelivery(
      truck.id,
      context.activeDeliveries,
    )
      ? 'active-job'
      : 'truck-busy';
    return {
      eligible: false,
      reason,
      message: reasonMessage(reason),
    };
  }

  if (truck.status !== 'idle' && truck.status !== 'maintenance') {
    return {
      eligible: false,
      reason: 'invalid-state',
      message: reasonMessage('invalid-state'),
    };
  }

  if (countOwnedTrucks(context.trucks) <= 1) {
    return {
      eligible: false,
      reason: 'starter-protection',
      message: reasonMessage('starter-protection'),
    };
  }

  return { eligible: true, message: '' };
}

export function listEligibleMarketplaceTrucks(
  context: VehicleMarketplaceEligibilityContext,
): Truck[] {
  return context.trucks.filter(
    (truck) => getVehicleMarketplaceEligibility(truck.id, context).eligible,
  );
}
