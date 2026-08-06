import { getWorldMapCityPosition } from '../../data/worldMapPositions';
import { normalizeCityId } from '../../data/networkPositions';
import type { Delivery, Truck, TruckTransfer } from '../../types/game';
import { resolveTruckCityId, isDeliveryProgressComplete } from '../../simulation/delivery';
import {
  getRoadRoute,
  getRouteHeadingDegrees,
  getRoutePoseAtProgress,
  normalizedPointToPixel,
  type MapBounds,
} from './mapRoadUtils';
import { TRUCK_ASSET_FORWARD_OFFSET_DEG } from './mapTheme';

const ACTIVE_DELIVERY_STATUSES = new Set<Delivery['status']>([
  'preparing',
  'on_route',
  'paused',
]);

export function isActiveRunningDelivery(delivery?: Delivery | null): delivery is Delivery {
  return delivery != null && ACTIVE_DELIVERY_STATUSES.has(delivery.status);
}

export function isActiveRunningTransfer(transfer?: TruckTransfer | null): transfer is TruckTransfer {
  return transfer != null && (transfer.status === 'active' || transfer.status === 'paused');
}

/** Kalıcı kamyon şehri — origin fallback kullanmaz. */
export function resolveTruckPersistentCityId(
  truck: Pick<Truck, 'currentCityId' | 'homeCityId'>,
  homeCityId?: string,
): string {
  return normalizeCityId(resolveTruckCityId(truck, homeCityId));
}

export type TruckMapLocationKind = 'route' | 'city' | 'unknown';

export interface TruckMapLocation {
  kind: TruckMapLocationKind;
  cityId?: string;
  normalizedPoint?: { x: number; y: number };
  pixelPoint?: { x: number; y: number };
  angleRadians?: number;
}

export function resolveTruckMapLocation(params: {
  truck: Truck;
  activeDelivery?: Delivery;
  activeTransfer?: TruckTransfer;
  mapBounds?: MapBounds;
  homeCityId?: string;
}): TruckMapLocation {
  const { truck, activeDelivery, activeTransfer, mapBounds, homeCityId } = params;

  if (isActiveRunningDelivery(activeDelivery)) {
    const roadRoute = getRoadRoute(activeDelivery.originCityId, activeDelivery.destinationCityId);
    if (roadRoute && roadRoute.length >= 2) {
      const samplingOptions = {
        coordinateScaleX: mapBounds?.width,
        coordinateScaleY: mapBounds?.height,
      };
      const pose = getRoutePoseAtProgress(roadRoute, activeDelivery.progress, samplingOptions);
      const displayHeadingDeg = getRouteHeadingDegrees({
        routePoints: roadRoute,
        progress: activeDelivery.progress,
        assetBaseHeadingDegrees: TRUCK_ASSET_FORWARD_OFFSET_DEG,
        coordinateScaleX: mapBounds?.width,
        coordinateScaleY: mapBounds?.height,
      });
      return {
        kind: 'route',
        cityId: normalizeCityId(activeDelivery.destinationCityId),
        normalizedPoint: pose.position,
        pixelPoint: mapBounds ? normalizedPointToPixel(pose.position, mapBounds) : undefined,
        angleRadians: (displayHeadingDeg * Math.PI) / 180,
      };
    }
  }

  if (isActiveRunningTransfer(activeTransfer)) {
    const roadRoute = getRoadRoute(activeTransfer.fromCityId, activeTransfer.toCityId);
    if (roadRoute && roadRoute.length >= 2) {
      const pose = getRoutePoseAtProgress(roadRoute, activeTransfer.progress, {
        coordinateScaleX: mapBounds?.width,
        coordinateScaleY: mapBounds?.height,
      });
      const displayHeadingDeg = getRouteHeadingDegrees({
        routePoints: roadRoute,
        progress: activeTransfer.progress,
        assetBaseHeadingDegrees: TRUCK_ASSET_FORWARD_OFFSET_DEG,
        coordinateScaleX: mapBounds?.width,
        coordinateScaleY: mapBounds?.height,
      });
      return {
        kind: 'route',
        cityId: normalizeCityId(activeTransfer.toCityId),
        normalizedPoint: pose.position,
        pixelPoint: mapBounds ? normalizedPointToPixel(pose.position, mapBounds) : undefined,
        angleRadians: (displayHeadingDeg * Math.PI) / 180,
      };
    }
  }

  const cityId = resolveTruckPersistentCityId(truck, homeCityId);
  const cityPos = getWorldMapCityPosition(cityId);
  if (!cityPos) {
    return { kind: 'unknown', cityId };
  }

  const normalizedPoint = { x: cityPos.x, y: cityPos.y };
  return {
    kind: 'city',
    cityId,
    normalizedPoint,
    pixelPoint: mapBounds ? normalizedPointToPixel(normalizedPoint, mapBounds) : undefined,
    angleRadians: 0,
  };
}

export function resolveTruckTrackingCityId(
  truck: Truck,
  delivery: Delivery | undefined,
  homeCityId?: string,
): string {
  if (isActiveRunningDelivery(delivery)) {
    if (isDeliveryProgressComplete(delivery.progress)) {
      return normalizeCityId(delivery.destinationCityId);
    }
    return resolveTruckPersistentCityId(truck, homeCityId);
  }
  return resolveTruckPersistentCityId(truck, homeCityId);
}
