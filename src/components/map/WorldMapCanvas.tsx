/**
 * WorldMapCanvas — gömülü etiketli lojistik harita üzerine yalnızca dinamik katmanlar.
 */

import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Image,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Asset } from 'expo-asset';
import Svg, { Circle, Path } from 'react-native-svg';

import AnimatedDeliveryTruckMarker from './AnimatedDeliveryTruckMarker';
import { resolveTruckMapLocation } from './mapTruckLocation';

import {
  getTurkeyLogisticsNetworkMap,
  getTurkeyLogisticsNetworkMapModule,
} from '../../assets/mapAssets';
import { debugConfig } from '../../config/debug';
import { getWorldMapCityPosition } from '../../data/worldMapPositions';
import { normalizeCityId } from '../../data/networkPositions';
import type { City, Contract, Delivery, Route, Truck, TruckTransfer } from '../../types/game';
import { GameIcon } from '../ui';
import IdleTruckCountBadge from './IdleTruckCountBadge';
import { getCityOverlayOffsets } from './mapCityOverlayOffsets';
import { getMapLayerOpacity, isMapLayerVisible, type MapOverlayLayer } from './mapLayerVisibility';
import InteractiveTurkeyMap, {
  type InteractiveTurkeyMapHandle,
  type MapCalibrationTapResult,
  type MapDetailLevel,
} from './InteractiveTurkeyMap';
import type { NetworkFilterKey } from './mapTypes';

export type { NetworkFilterKey };
import type { MapRoadPoint } from '../../data/mapRoadNetwork';
import {
  appendMapSegmentCalibrationPoint,
  getMapSegmentCalibrationPoints,
  registerMapSegmentCalibrationDevTools,
  syncMapSegmentCalibration,
} from './mapSegmentCalibration';
import {
  getRoadRoute,
  getTruckPositionAlongRoadRoute,
  normalizeMapDeliveryProgress,
  normalizedPointToPixel,
  polylineToSvgPath,
  splitPolylineAtProgress,
  type MapBounds as RoadMapBounds,
} from './mapRoadUtils';
import { normalizedToContentPoint, roundMapCoordinate } from './mapCoordinateUtils';
import { computeMapContentSize } from './mapTransformUtils';
import {
  MAP_ACCENT,
  MAP_DELIVERY_DESTINATION,
  MAP_DELIVERY_DESTINATION_GLOW,
  MAP_DELIVERY_ORIGIN,
  MAP_MARKER_HIT_RADIUS,
  MAP_ROUTE_COMPLETED,
  MAP_ROUTE_COMPLETED_GLOW,
  MAP_ROUTE_COMPLETED_GLOW_WIDTH,
  MAP_ROUTE_COMPLETED_WIDTH,
  MAP_ROUTE_REMAINING,
  MAP_ROUTE_REMAINING_OPACITY,
  MAP_ROUTE_REMAINING_WIDTH,
  MAP_TRANSFER_ROUTE,
  MAP_VIEWPORT_BACKGROUND,
  MAP_VIEWPORT_HEIGHT,
  MAP_VIEWPORT_HEIGHT_COMPACT,
} from './mapTheme';

const MAP_IMAGE = getTurkeyLogisticsNetworkMap();
const COMPACT_BREAKPOINT = 360;
const MAP_CALIBRATION_ENABLED = debugConfig.mapCalibrationEnabled;

function resolveMapAspectRatio(): number {
  const source = Image.resolveAssetSource(MAP_IMAGE);
  if (source?.width && source?.height && source.height > 0) {
    return source.width / source.height;
  }
  return 1672 / 941;
}

const MAP_ASPECT_RATIO = resolveMapAspectRatio();

export type WorldMapCanvasHandle = InteractiveTurkeyMapHandle;

export type WorldMapCanvasProps = {
  cities?: City[];
  routes?: Route[];
  contracts?: Contract[];
  activeDeliveries?: Delivery[];
  activeTransfers?: TruckTransfer[];
  trucks?: Truck[];
  homeCityId?: string;
  depotCityIds?: string[];
  idleTruckCountByCity?: Record<string, number>;
  selectedFilter: NetworkFilterKey;
  selectedCityId?: string | null;
  featuredContract?: Contract | null;
  selectedContract?: Contract | null;
  selectedDeliveryId?: string | null;
  onCityPress?: (cityId: string) => void;
  onBackgroundPress?: () => void;
  onRoutePress?: (routeId: string) => void;
  onContractPress?: (contractId: string) => void;
  onDeliveryPress?: (deliveryId: string) => void;
  onMapGestureActiveChange?: (active: boolean) => void;
  calibrationMode?: boolean;
};

interface MapBounds {
  width: number;
  height: number;
}

function buildCurvePath(x1: number, y1: number, x2: number, y2: number, bend = 0.18) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  return { d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, cx, cy };
}

function pointOnQuadratic(
  t: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
) {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * x1 + 2 * oneMinusT * t * cx + t * t * x2,
    y: oneMinusT * oneMinusT * y1 + 2 * oneMinusT * t * cy + t * t * y2,
  };
}

function normToPixel(xNorm: number, yNorm: number, bounds: MapBounds) {
  return { x: xNorm * bounds.width, y: yNorm * bounds.height };
}

function routeTouchesCity(
  originCityId: string,
  destinationCityId: string,
  cityId: string | null | undefined,
): boolean {
  if (!cityId) return true;
  const normalized = normalizeCityId(cityId);
  return (
    normalizeCityId(originCityId) === normalized ||
    normalizeCityId(destinationCityId) === normalized
  );
}

function SelectedCityRing({ cx, cy }: { cx: number; cy: number }) {
  return (
    <>
      <Circle cx={cx} cy={cy} r={18} fill="none" stroke={MAP_ACCENT} strokeWidth={1.4} strokeOpacity={0.35} />
      <Circle cx={cx} cy={cy} r={14} fill="none" stroke={MAP_ACCENT} strokeWidth={2} strokeOpacity={0.92} />
    </>
  );
}

function DeliveryOriginMarker({ cx, cy, opacity }: { cx: number; cy: number; opacity: number }) {
  return (
    <>
      <Circle
        cx={cx}
        cy={cy}
        r={11}
        fill="none"
        stroke={MAP_DELIVERY_ORIGIN}
        strokeWidth={1.5}
        strokeOpacity={0.45 * opacity}
      />
      <Circle
        cx={cx}
        cy={cy}
        r={7.5}
        fill="none"
        stroke={MAP_DELIVERY_ORIGIN}
        strokeWidth={2}
        strokeOpacity={opacity}
      />
      <Circle cx={cx} cy={cy} r={3} fill={MAP_DELIVERY_ORIGIN} fillOpacity={opacity} />
    </>
  );
}

function DeliveryDestinationMarker({ cx, cy, opacity }: { cx: number; cy: number; opacity: number }) {
  return (
    <>
      <Circle
        cx={cx}
        cy={cy}
        r={14}
        fill="none"
        stroke={MAP_DELIVERY_DESTINATION_GLOW}
        strokeWidth={2}
        strokeOpacity={opacity}
      />
      <Circle
        cx={cx}
        cy={cy}
        r={10}
        fill="none"
        stroke={MAP_DELIVERY_DESTINATION}
        strokeWidth={2.5}
        strokeOpacity={opacity}
      />
      <Circle cx={cx} cy={cy} r={4} fill={MAP_DELIVERY_DESTINATION} fillOpacity={opacity} />
    </>
  );
}

interface DeliveryRouteRenderItem {
  delivery: Delivery;
  hasRoute: boolean;
  completedPath: string;
  remainingPath: string;
  completedGlowPath: string;
  origin: { x: number; y: number };
  destination: { x: number; y: number };
  truckPixel: { x: number; y: number };
  truckAngle: number;
  normalizedProgress: number;
  opacity: number;
}

function logTruckPositionDebug(params: {
  originCityId: string;
  destinationCityId: string;
  progress: number | undefined;
  normalizedProgress: number;
  routeStart: { x: number; y: number };
  routeEnd: { x: number; y: number };
  calculatedTruckPoint: { x: number; y: number };
}) {
  if (!__DEV__) return;
  console.log('[map-truck]', {
    originCityId: params.originCityId,
    destinationCityId: params.destinationCityId,
    progress: params.progress,
    normalizedProgress: params.normalizedProgress,
    routeStart: params.routeStart,
    routeEnd: params.routeEnd,
    calculatedTruckPoint: params.calculatedTruckPoint,
  });
}

function logMissingRoadRoute(originCityId: string, destinationCityId: string) {
  if (__DEV__) {
    console.warn('[map-road] route not found', {
      from: originCityId,
      to: destinationCityId,
    });
  }
}

function WorldMapCanvasInner(
  {
    cities = [],
    contracts = [],
    activeDeliveries = [],
    activeTransfers = [],
    trucks = [],
    homeCityId,
    depotCityIds = [],
    idleTruckCountByCity,
    selectedFilter,
    selectedCityId,
    featuredContract,
    selectedContract: _selectedContract,
    selectedDeliveryId,
    onCityPress,
    onBackgroundPress,
    onRoutePress: _onRoutePress,
    onContractPress: _onContractPress,
    onDeliveryPress,
    onMapGestureActiveChange,
    calibrationMode = false,
  }: WorldMapCanvasProps,
  ref: React.ForwardedRef<WorldMapCanvasHandle>,
) {
  const mapRef = useRef<InteractiveTurkeyMapHandle>(null);
  const [detailLevel, setDetailLevel] = useState<MapDetailLevel>('low');
  useImperativeHandle(ref, () => ({
    resetToOperational: () => mapRef.current?.resetToOperational(),
  }));

  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < COMPACT_BREAKPOINT;
  const viewportHeight = isCompact ? MAP_VIEWPORT_HEIGHT_COMPACT : MAP_VIEWPORT_HEIGHT;
  const [mapImageReady, setMapImageReady] = React.useState(false);
  const [calibrationDots, setCalibrationDots] = useState<MapRoadPoint[]>([]);

  const contentSize = useMemo<MapBounds>(
    () => computeMapContentSize(viewportHeight, MAP_ASPECT_RATIO),
    [viewportHeight],
  );

  useEffect(() => {
    if (__DEV__ && MAP_CALIBRATION_ENABLED) {
      registerMapSegmentCalibrationDevTools();
      syncMapSegmentCalibration(debugConfig.mapCalibrationSegmentId);
    }
  }, []);

  useEffect(() => {
    if (__DEV__ && MAP_CALIBRATION_ENABLED) {
      syncMapSegmentCalibration(debugConfig.mapCalibrationSegmentId);
      setCalibrationDots(getMapSegmentCalibrationPoints());
    }
  }, [debugConfig.mapCalibrationSegmentId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const asset = Asset.fromModule(getTurkeyLogisticsNetworkMapModule());
        await asset.downloadAsync();
        if (!cancelled && __DEV__) {
          console.log('[map] logistics network asset preloaded');
        }
      } catch (error) {
        if (!cancelled && __DEV__) {
          console.warn('[map] logistics network asset preload failed', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const mapBounds = contentSize;
  const normalizedDepotIds = useMemo(
    () => new Set(depotCityIds.map(normalizeCityId)),
    [depotCityIds],
  );

  const opportunityCityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const contract of contracts) {
      if (contract.status !== 'available') continue;
      ids.add(normalizeCityId(contract.originCityId));
    }
    if (featuredContract?.originCityId) {
      ids.add(normalizeCityId(featuredContract.originCityId));
    }
    return ids;
  }, [contracts, featuredContract]);

  const tappableCities = useMemo(() => {
    return cities.filter((city) => {
      const pos = getWorldMapCityPosition(city.id);
      if (!pos) return false;
      const cityNorm = normalizeCityId(city.id);
      const isDepot = normalizedDepotIds.has(cityNorm);
      if (selectedFilter === 'depots') return isDepot;
      if (selectedFilter === 'opportunities') return opportunityCityIds.has(cityNorm);
      return true;
    });
  }, [cities, normalizedDepotIds, opportunityCityIds, selectedFilter]);

  const runningDeliveries = useMemo(
    () => activeDeliveries.filter((d) => d.status === 'preparing' || d.status === 'on_route'),
    [activeDeliveries],
  );

  const runningDeliveryProgressKey = useMemo(
    () =>
      runningDeliveries
        .map(
          (d) =>
            `${d.id}:${d.originCityId}:${d.destinationCityId}:${d.progress ?? 0}`,
        )
        .join('|'),
    [runningDeliveries],
  );
  const runningTransfers = useMemo(
    () => (activeTransfers ?? []).filter((t) => t.status === 'active'),
    [activeTransfers],
  );

  const featuredCityId = useMemo(
    () => (featuredContract?.originCityId ? normalizeCityId(featuredContract.originCityId) : null),
    [featuredContract],
  );

  const showRoutes =
    selectedFilter === 'all' ||
    selectedFilter === 'trucks' ||
    selectedFilter === 'routes';

  const layerVisible = useCallback(
    (layer: MapOverlayLayer, cityId?: string, isFeaturedOpportunity = false) =>
      isMapLayerVisible({
        layer,
        detailLevel,
        filter: selectedFilter,
        selectedCityId,
        cityId,
        isFeaturedOpportunity,
      }),
    [detailLevel, selectedCityId, selectedFilter],
  );

  const layerOpacity = useCallback(
    (layer: MapOverlayLayer, cityId?: string, isFeaturedOpportunity = false) =>
      getMapLayerOpacity({
        layer,
        detailLevel,
        filter: selectedFilter,
        selectedCityId,
        cityId,
        isFeaturedOpportunity,
      }),
    [detailLevel, selectedCityId, selectedFilter],
  );

  const handleCalibrationTap = useCallback(
    (result: MapCalibrationTapResult) => {
      if (!MAP_CALIBRATION_ENABLED || mapBounds.width === 0 || !result.isInsideContent) return;

      const point: MapRoadPoint = {
        x: roundMapCoordinate(result.normalized.x, 4),
        y: roundMapCoordinate(result.normalized.y, 4),
      };

      if (__DEV__ && debugConfig.mapCalibrationSegmentId) {
        const nextPoints = appendMapSegmentCalibrationPoint(point);
        setCalibrationDots(nextPoints);
        return;
      }

      console.log('[Map calibration] city center');
      console.log('normalized:', point);
      console.log('paste into worldMapPositions.ts:', `{ x: ${point.x}, y: ${point.y} }`);

      if (__DEV__) {
        setCalibrationDots((prev) => [...prev, point]);
      }
    },
    [mapBounds.width],
  );

  const handleCityPressAtContentPoint = useCallback(
    (contentX: number, contentY: number) => {
      let nearestCityId: string | null = null;
      let nearestDistance = MAP_MARKER_HIT_RADIUS * MAP_MARKER_HIT_RADIUS;

      for (const city of tappableCities) {
        const pos = getWorldMapCityPosition(city.id);
        if (!pos) continue;
        const pixel = normToPixel(pos.x, pos.y, mapBounds);
        const dx = pixel.x - contentX;
        const dy = pixel.y - contentY;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq <= nearestDistance) {
          nearestDistance = distanceSq;
          nearestCityId = city.id;
        }
      }

      if (nearestCityId) {
        onCityPress?.(nearestCityId);
      } else {
        onBackgroundPress?.();
      }
    },
    [mapBounds, onBackgroundPress, onCityPress, tappableCities],
  );

  const resolveRouteOpacity = useCallback(
    (originCityId: string, destinationCityId: string, isSelectedDelivery: boolean) => {
      const base = isSelectedDelivery ? 1 : 0.92;
      const routeDim = layerOpacity('route');
      if (!selectedCityId) return base * routeDim;
      if (routeTouchesCity(originCityId, destinationCityId, selectedCityId)) {
        return base;
      }
      return 0.18 * routeDim;
    },
    [layerOpacity, selectedCityId],
  );

  const deliveryRouteRenderData = useMemo((): DeliveryRouteRenderItem[] => {
    if (!showRoutes || runningDeliveries.length === 0 || mapBounds.width === 0) return [];
    if (!layerVisible('route')) return [];

    const roadBounds: RoadMapBounds = mapBounds;

    const items: DeliveryRouteRenderItem[] = [];

    for (const delivery of runningDeliveries) {
      const from = getWorldMapCityPosition(delivery.originCityId);
      const to = getWorldMapCityPosition(delivery.destinationCityId);
      if (!from || !to) continue;

      const origin = normToPixel(from.x, from.y, mapBounds);
      const destination = normToPixel(to.x, to.y, mapBounds);
      const opacity = resolveRouteOpacity(
        delivery.originCityId,
        delivery.destinationCityId,
        delivery.id === selectedDeliveryId,
      );
      if (opacity <= 0) continue;

      const roadPoints = getRoadRoute(delivery.originCityId, delivery.destinationCityId);
      if (!roadPoints || roadPoints.length < 2) {
        logMissingRoadRoute(delivery.originCityId, delivery.destinationCityId);
        items.push({
          delivery,
          hasRoute: false,
          completedPath: '',
          remainingPath: '',
          completedGlowPath: '',
          origin,
          destination,
          truckPixel: { x: 0, y: 0 },
          truckAngle: 0,
          normalizedProgress: 0,
          opacity,
        });
        continue;
      }

      const normalizedProgress = normalizeMapDeliveryProgress(delivery.progress);
      const { completedPoints, remainingPoints } = splitPolylineAtProgress(
        roadPoints,
        normalizedProgress,
      );
      const truckSample = getTruckPositionAlongRoadRoute(roadPoints, delivery.progress);
      const truckPixel = normalizedPointToPixel(truckSample.point, roadBounds);

      logTruckPositionDebug({
        originCityId: delivery.originCityId,
        destinationCityId: delivery.destinationCityId,
        progress: delivery.progress,
        normalizedProgress,
        routeStart: roadPoints[0],
        routeEnd: roadPoints[roadPoints.length - 1],
        calculatedTruckPoint: truckSample.point,
      });

      items.push({
        delivery,
        hasRoute: true,
        completedPath: polylineToSvgPath(completedPoints, roadBounds),
        remainingPath: polylineToSvgPath(remainingPoints, roadBounds),
        completedGlowPath: polylineToSvgPath(completedPoints, roadBounds),
        origin,
        destination,
        truckPixel,
        truckAngle: truckSample.angleRadians,
        normalizedProgress,
        opacity,
      });
    }

    return items;
  }, [
    showRoutes,
    runningDeliveries,
    runningDeliveryProgressKey,
    mapBounds,
    layerVisible,
    resolveRouteOpacity,
    selectedDeliveryId,
  ]);

  const idleTruckMarkers = useMemo(() => {
    if (!showRoutes || trucks.length === 0 || mapBounds.width === 0) return [];
    if (!layerVisible('truck')) return [];

    const onRouteTruckIds = new Set<string>();
    for (const delivery of runningDeliveries) {
      onRouteTruckIds.add(delivery.truckId);
    }
    for (const transfer of runningTransfers) {
      onRouteTruckIds.add(transfer.truckId);
    }

    return trucks
      .filter((truck) => !onRouteTruckIds.has(truck.id))
      .map((truck) => {
        const location = resolveTruckMapLocation({ truck, mapBounds, homeCityId });
        if (location.kind !== 'city' || !location.pixelPoint) {
          return null;
        }
        const opacity = layerOpacity('truck') * 0.82;
        if (opacity <= 0) {
          return null;
        }
        return { truck, location, opacity };
      })
      .filter((item): item is NonNullable<typeof item> => item != null);
  }, [
    showRoutes,
    trucks,
    runningDeliveries,
    runningTransfers,
    mapBounds,
    layerVisible,
    layerOpacity,
    homeCityId,
  ]);

  const handleDetailLevelChange = useCallback((level: MapDetailLevel) => {
    setDetailLevel(level);
  }, []);

  return (
    <View style={styles.wrapper}>
      <InteractiveTurkeyMap
        ref={mapRef}
        viewportHeight={viewportHeight}
        contentSize={contentSize}
        onCityPressAtContentPoint={handleCityPressAtContentPoint}
        onCalibrationTap={handleCalibrationTap}
        onDetailLevelChange={handleDetailLevelChange}
        onMapGestureActiveChange={onMapGestureActiveChange}
        calibrationMode={calibrationMode}
      >
        <Image
          source={MAP_IMAGE}
          style={{ width: contentSize.width, height: contentSize.height }}
          onLoad={() => setMapImageReady(true)}
          onError={() => setMapImageReady(false)}
        />

        {!mapImageReady ? <View style={styles.fallback} pointerEvents="none" /> : null}

        {mapBounds.width > 0 && deliveryRouteRenderData.length > 0 ? (
          <Svg width={mapBounds.width} height={mapBounds.height} style={StyleSheet.absoluteFill}>
            {deliveryRouteRenderData.map(
              ({
                delivery,
                hasRoute,
                completedPath,
                remainingPath,
                completedGlowPath,
                origin,
                destination,
                opacity,
              }) => (
                <React.Fragment key={delivery.id}>
                  {hasRoute ? (
                    <>
                      {remainingPath ? (
                        <Path
                          d={remainingPath}
                          stroke={MAP_ROUTE_REMAINING}
                          strokeWidth={MAP_ROUTE_REMAINING_WIDTH}
                          strokeOpacity={MAP_ROUTE_REMAINING_OPACITY * opacity}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      ) : null}
                      {completedGlowPath ? (
                        <Path
                          d={completedGlowPath}
                          stroke={MAP_ROUTE_COMPLETED_GLOW}
                          strokeWidth={MAP_ROUTE_COMPLETED_GLOW_WIDTH}
                          strokeOpacity={opacity}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      ) : null}
                      {completedPath ? (
                        <Path
                          d={completedPath}
                          stroke={MAP_ROUTE_COMPLETED}
                          strokeWidth={MAP_ROUTE_COMPLETED_WIDTH}
                          strokeOpacity={opacity}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      ) : null}
                    </>
                  ) : null}
                  <DeliveryOriginMarker cx={origin.x} cy={origin.y} opacity={opacity} />
                  <DeliveryDestinationMarker cx={destination.x} cy={destination.y} opacity={opacity} />
                </React.Fragment>
              ),
            )}
          </Svg>
        ) : null}

        {__DEV__ && MAP_CALIBRATION_ENABLED && calibrationDots.length > 0 ? (
          <Svg width={mapBounds.width} height={mapBounds.height} style={StyleSheet.absoluteFill} pointerEvents="none">
            {calibrationDots.map((point, index) => {
              const pixel = normalizedToContentPoint(point.x, point.y, mapBounds);
              return (
                <Circle
                  key={`calibration-${index}`}
                  cx={pixel.x}
                  cy={pixel.y}
                  r={4}
                  fill="#FF4D6D"
                  fillOpacity={0.9}
                />
              );
            })}
          </Svg>
        ) : null}

        {mapBounds.width > 0 && showRoutes && runningTransfers.length > 0 ? (
          <Svg width={mapBounds.width} height={mapBounds.height} style={StyleSheet.absoluteFill}>
            {runningTransfers.map((transfer) => {
              const from = getWorldMapCityPosition(transfer.fromCityId);
              const to = getWorldMapCityPosition(transfer.toCityId);
              if (!from || !to) return null;
              const p1 = normToPixel(from.x, from.y, mapBounds);
              const p2 = normToPixel(to.x, to.y, mapBounds);
              const { d, cx, cy } = buildCurvePath(p1.x, p1.y, p2.x, p2.y);
              const opacity = resolveRouteOpacity(transfer.fromCityId, transfer.toCityId, false);
              if (!layerVisible('route')) return null;
              const truckPos = pointOnQuadratic(
                Math.max(0, Math.min(1, transfer.progress ?? 0)),
                p1.x,
                p1.y,
                cx,
                cy,
                p2.x,
                p2.y,
              );
              const showTruckMarker = layerVisible('truck');
              return (
                <React.Fragment key={transfer.id}>
                  <Path
                    d={d}
                    stroke={MAP_TRANSFER_ROUTE}
                    strokeWidth={2}
                    strokeOpacity={opacity * 0.75}
                    strokeDasharray="6 4"
                    fill="none"
                  />
                  {showTruckMarker ? (
                    <Circle
                      cx={truckPos.x}
                      cy={truckPos.y}
                      r={4.5}
                      fill={MAP_VIEWPORT_BACKGROUND}
                      stroke={MAP_TRANSFER_ROUTE}
                      strokeWidth={1.8}
                      strokeOpacity={opacity}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </Svg>
        ) : null}

        {mapBounds.width > 0 ? (
          <Svg width={mapBounds.width} height={mapBounds.height} style={StyleSheet.absoluteFill}>
            {tappableCities.map((city) => {
              const pos = getWorldMapCityPosition(city.id);
              if (!pos) return null;
              const isSelected =
                normalizeCityId(city.id) === normalizeCityId(selectedCityId ?? '');
              const pixel = normToPixel(pos.x, pos.y, mapBounds);
              return (
                <React.Fragment key={city.id}>
                  <Circle
                    cx={pixel.x}
                    cy={pixel.y}
                    r={MAP_MARKER_HIT_RADIUS}
                    fill="transparent"
                    onPress={() => onCityPress?.(city.id)}
                  />
                  {isSelected ? <SelectedCityRing cx={pixel.x} cy={pixel.y} /> : null}
                </React.Fragment>
              );
            })}
          </Svg>
        ) : null}

        {mapBounds.width > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {tappableCities.map((city) => {
              const pos = getWorldMapCityPosition(city.id);
              if (!pos) return null;
              const idleCount = idleTruckCountByCity?.[normalizeCityId(city.id)] ?? 0;
              if (idleCount <= 0) return null;
              if (!layerVisible('badge', city.id)) return null;
              const pixel = normToPixel(pos.x, pos.y, mapBounds);
              const offsets = getCityOverlayOffsets(normalizeCityId(city.id));
              const opacity = layerOpacity('badge', city.id);
              if (opacity <= 0) return null;
              return (
                <IdleTruckCountBadge
                  key={`idle-${city.id}`}
                  count={idleCount}
                  opacity={opacity}
                  prominent={selectedFilter === 'trucks'}
                  style={{
                    position: 'absolute',
                    left: pixel.x + offsets.countBadge.x,
                    top: pixel.y + offsets.countBadge.y,
                  }}
                />
              );
            })}
          </View>
        ) : null}

        {mapBounds.width > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {tappableCities
              .filter((city) => normalizedDepotIds.has(normalizeCityId(city.id)))
              .map((city) => {
                if (!layerVisible('depot', city.id)) return null;
                const pos = getWorldMapCityPosition(city.id);
                if (!pos) return null;
                const pixel = normToPixel(pos.x, pos.y, mapBounds);
                const offsets = getCityOverlayOffsets(normalizeCityId(city.id));
                const opacity = layerOpacity('depot', city.id);
                if (opacity <= 0) return null;
                return (
                  <View
                    key={`depot-${city.id}`}
                    style={{
                      position: 'absolute',
                      left: pixel.x + offsets.depot.x - 7,
                      top: pixel.y + offsets.depot.y - 7,
                      opacity,
                    }}
                  >
                    <GameIcon name="warehouse" size={13} color={MAP_ACCENT} />
                  </View>
                );
              })}
          </View>
        ) : null}

        {mapBounds.width > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {tappableCities
              .filter((city) => opportunityCityIds.has(normalizeCityId(city.id)))
              .map((city) => {
                const cityNorm = normalizeCityId(city.id);
                const isFeatured = featuredCityId === cityNorm;
                if (!layerVisible('opportunity', city.id, isFeatured)) return null;
                const pos = getWorldMapCityPosition(city.id);
                if (!pos) return null;
                const pixel = normToPixel(pos.x, pos.y, mapBounds);
                const offsets = getCityOverlayOffsets(cityNorm);
                const opacity = layerOpacity('opportunity', city.id, isFeatured);
                if (opacity <= 0) return null;
                return (
                  <View
                    key={`opp-${city.id}`}
                    style={{
                      position: 'absolute',
                      left: pixel.x + offsets.opportunity.x - 7,
                      top: pixel.y + offsets.opportunity.y - 7,
                      opacity,
                    }}
                  >
                    <GameIcon name="market" size={13} color="#F59E0B" />
                  </View>
                );
              })}
          </View>
        ) : null}

        {mapBounds.width > 0 && showRoutes && layerVisible('truck') && deliveryRouteRenderData.length > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {deliveryRouteRenderData.map(
              ({ delivery, hasRoute, truckPixel, truckAngle, normalizedProgress, opacity }) =>
                hasRoute ? (
                  <AnimatedDeliveryTruckMarker
                    key={`delivery-truck-${delivery.id}`}
                    pixelX={truckPixel.x}
                    pixelY={truckPixel.y}
                    angleRadians={truckAngle}
                    progress={normalizedProgress}
                    opacity={opacity * layerOpacity('truck')}
                    onPress={() => onDeliveryPress?.(delivery.id)}
                  />
                ) : null,
            )}
          </View>
        ) : null}

        {mapBounds.width > 0 && showRoutes && layerVisible('truck') && idleTruckMarkers.length > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {idleTruckMarkers.map(({ truck, location, opacity }) => (
              <AnimatedDeliveryTruckMarker
                key={`idle-truck-${truck.id}`}
                pixelX={location.pixelPoint!.x}
                pixelY={location.pixelPoint!.y}
                angleRadians={location.angleRadians ?? 0}
                progress={1}
                opacity={opacity}
              />
            ))}
          </View>
        ) : null}

        {mapBounds.width > 0 && showRoutes && layerVisible('truck') && runningTransfers.length > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {runningTransfers.map((transfer) => {
              const from = getWorldMapCityPosition(transfer.fromCityId);
              const to = getWorldMapCityPosition(transfer.toCityId);
              if (!from || !to) return null;
              const p1 = normToPixel(from.x, from.y, mapBounds);
              const p2 = normToPixel(to.x, to.y, mapBounds);
              const { cx, cy } = buildCurvePath(p1.x, p1.y, p2.x, p2.y);
              const progress = Math.max(0, Math.min(1, transfer.progress ?? 0));
              const truckPos = pointOnQuadratic(progress, p1.x, p1.y, cx, cy, p2.x, p2.y);
              const opacity =
                layerOpacity('truck') * resolveRouteOpacity(transfer.fromCityId, transfer.toCityId, false);
              if (opacity <= 0) return null;
              return (
                <View
                  key={`transfer-truck-${transfer.id}`}
                  style={{
                    position: 'absolute',
                    left: truckPos.x - 8,
                    top: truckPos.y - 8,
                    opacity: opacity * 0.75,
                  }}
                >
                  <GameIcon name="truck" size={14} color={MAP_TRANSFER_ROUTE} />
                </View>
              );
            })}
          </View>
        ) : null}
      </InteractiveTurkeyMap>
    </View>
  );
}

const WorldMapCanvas = memo(forwardRef(WorldMapCanvasInner));
WorldMapCanvas.displayName = 'WorldMapCanvas';

export default WorldMapCanvas;

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  fallback: { ...StyleSheet.absoluteFillObject, backgroundColor: MAP_VIEWPORT_BACKGROUND },
});
