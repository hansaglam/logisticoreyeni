import type { Delivery, TruckTransfer } from '../../types/game';
import { isActiveRunningDelivery, isActiveRunningTransfer } from './mapTruckLocation';

/** Topology fingerprint — progress tick'lerinde değil, rota kimliği değişince artar. */
export function computeRouteTopologyVersion(params: {
  originCityId: string;
  destinationCityId: string;
  routeId?: string | null;
}): string {
  const routeId = params.routeId?.trim();
  return routeId && routeId.length > 0
    ? `${params.originCityId}|${params.destinationCityId}|${routeId}`
    : `${params.originCityId}|${params.destinationCityId}`;
}

export function computeDeliveryRouteVersion(delivery: Delivery): string {
  return computeRouteTopologyVersion({
    originCityId: delivery.originCityId,
    destinationCityId: delivery.destinationCityId,
    routeId: delivery.contractId,
  });
}

export function computeTransferRouteVersion(transfer: TruckTransfer): string {
  return computeRouteTopologyVersion({
    originCityId: transfer.fromCityId,
    destinationCityId: transfer.toCityId,
    routeId: transfer.id,
  });
}

export function buildRoutePathMarkerKey(
  deliveryId: string,
  routeVersion: string,
  segmentRole: 'remaining' | 'completed' | 'glow' | 'full' | 'group',
): string {
  return `route-${deliveryId}-${routeVersion}-${segmentRole}`;
}

export function buildTransferRouteMarkerKey(
  transferId: string,
  routeVersion: string,
): string {
  return `route-transfer-${transferId}-${routeVersion}`;
}

export function buildCityMarkerKey(
  cityId: string,
  markerRole: string,
  activeRouteId: string,
): string {
  return `city-${cityId}-${markerRole}-${activeRouteId}`;
}

export function buildTruckMarkerKey(
  truckId: string,
  activeDeliveryId: string | null | undefined,
): string {
  return `truck-${truckId}-${activeDeliveryId ?? 'idle'}`;
}

export function buildDeliveryTruckMarkerKey(
  deliveryId: string,
  routeVersion: string,
): string {
  return `truck-delivery-${deliveryId}-${routeVersion}`;
}

export function buildTransferTruckMarkerKey(
  transferId: string,
  routeVersion: string,
): string {
  return `truck-transfer-${transferId}-${routeVersion}`;
}

export type MapOverlayRenderVersion = string;

/** Tüm aktif overlay katmanları için remount anahtarı (topology değişince). */
export function buildMapOverlayRenderVersion(params: {
  deliveries: Delivery[];
  transfers: TruckTransfer[];
}): MapOverlayRenderVersion {
  const deliveryPart = params.deliveries
    .filter(isActiveRunningDelivery)
    .map((d) => `${d.id}:${computeDeliveryRouteVersion(d)}`)
    .sort()
    .join(';');
  const transferPart = params.transfers
    .filter(isActiveRunningTransfer)
    .map((t) => `${t.id}:${computeTransferRouteVersion(t)}`)
    .sort()
    .join(';');
  return `overlay-${deliveryPart}|${transferPart}`;
}

export interface VisibleDeliveryMapMarker {
  delivery: Delivery;
  routeVersion: string;
  truckId: string;
}

export interface VisibleTransferMapMarker {
  transfer: TruckTransfer;
  routeVersion: string;
  truckId: string;
}

export interface VisibleMapMarkers {
  deliveries: VisibleDeliveryMapMarker[];
  transfers: VisibleTransferMapMarker[];
  overlayRenderVersion: MapOverlayRenderVersion;
}

/**
 * Yalnızca aktif/in-progress teslimat ve transferlerden türetilmiş marker listesi.
 * Tamamlanan/iptal edilen kayıtlar dahil edilmez; state mutate edilmez.
 */
export function buildVisibleMapMarkers(params: {
  activeDeliveries: Delivery[];
  activeTransfers: TruckTransfer[];
  validTruckIds?: Set<string>;
}): VisibleMapMarkers {
  const deliveries: VisibleDeliveryMapMarker[] = [];
  const seenDeliveryIds = new Set<string>();
  const seenDeliveryTruckIds = new Set<string>();

  for (const delivery of params.activeDeliveries) {
    if (!isActiveRunningDelivery(delivery)) continue;
    if (seenDeliveryIds.has(delivery.id)) continue;
    if (params.validTruckIds && !params.validTruckIds.has(delivery.truckId)) continue;
    if (seenDeliveryTruckIds.has(delivery.truckId)) continue;
    seenDeliveryIds.add(delivery.id);
    seenDeliveryTruckIds.add(delivery.truckId);
    deliveries.push({
      delivery,
      routeVersion: computeDeliveryRouteVersion(delivery),
      truckId: delivery.truckId,
    });
  }

  const transfers: VisibleTransferMapMarker[] = [];
  const seenTransferIds = new Set<string>();
  const seenTransferTruckIds = new Set<string>();

  for (const transfer of params.activeTransfers) {
    if (!isActiveRunningTransfer(transfer)) continue;
    if (seenTransferIds.has(transfer.id)) continue;
    if (params.validTruckIds && !params.validTruckIds.has(transfer.truckId)) continue;
    if (seenDeliveryTruckIds.has(transfer.truckId) || seenTransferTruckIds.has(transfer.truckId)) {
      continue;
    }
    seenTransferIds.add(transfer.id);
    seenTransferTruckIds.add(transfer.truckId);
    transfers.push({
      transfer,
      routeVersion: computeTransferRouteVersion(transfer),
      truckId: transfer.truckId,
    });
  }

  return {
    deliveries,
    transfers,
    overlayRenderVersion: buildMapOverlayRenderVersion({
      deliveries: deliveries.map((item) => item.delivery),
      transfers: transfers.map((item) => item.transfer),
    }),
  };
}
