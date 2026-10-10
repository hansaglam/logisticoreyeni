/**
 * Multimodal INTERNAL_TEST resource reservation helpers.
 * Uses assignedMultimodalShipmentId — does not invent a conflicting TruckStatus.
 * Destination trucks stay idle (not on_route) while reserved.
 */

import type { Driver, Trailer, Truck } from '../types/game';

export type PlayerFleetSlice = {
  trucks: Truck[];
  drivers: Driver[];
  trailers: Trailer[];
  money: number;
  reputation: number;
  xp: number;
};

export function isTruckReservedForMultimodal(truck: Pick<Truck, 'assignedMultimodalShipmentId'>): boolean {
  return typeof truck.assignedMultimodalShipmentId === 'string' && truck.assignedMultimodalShipmentId.length > 0;
}

export function isDriverReservedForMultimodal(
  driver: Pick<Driver, 'assignedMultimodalShipmentId'>,
): boolean {
  return (
    typeof driver.assignedMultimodalShipmentId === 'string' &&
    driver.assignedMultimodalShipmentId.length > 0
  );
}

export function isTrailerReservedForMultimodal(
  trailer: Pick<Trailer, 'assignedMultimodalShipmentId'>,
): boolean {
  return (
    typeof trailer.assignedMultimodalShipmentId === 'string' &&
    trailer.assignedMultimodalShipmentId.length > 0
  );
}

export function reservationOwnerId(
  asset: { assignedMultimodalShipmentId?: string | null },
): string | null {
  return typeof asset.assignedMultimodalShipmentId === 'string' && asset.assignedMultimodalShipmentId.length > 0
    ? asset.assignedMultimodalShipmentId
    : null;
}

export function withMultimodalReservation<T extends { assignedMultimodalShipmentId?: string | null }>(
  asset: T,
  shipmentId: string | null,
): T {
  if (!shipmentId) {
    const next = { ...asset };
    delete next.assignedMultimodalShipmentId;
    return next;
  }
  return { ...asset, assignedMultimodalShipmentId: shipmentId };
}
