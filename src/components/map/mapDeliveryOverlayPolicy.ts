export type ActiveDeliveryMarkerType =
  | 'moving-truck'
  | 'origin-endpoint'
  | 'destination-endpoint';

/** Production active-delivery overlay: route line + one moving truck, no endpoint nodes. */
export const ACTIVE_DELIVERY_ROUTE_LINE_ENABLED = true;

export function shouldRenderActiveDeliveryMarker(markerType: ActiveDeliveryMarkerType): boolean {
  return markerType === 'moving-truck';
}
