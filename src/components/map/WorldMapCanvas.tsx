/**
 * WorldMapCanvas — gömülü etiketli lojistik harita üzerine yalnızca dinamik katmanlar.
 * Legacy şehir/depo/fırsat/badge marker’ları kaldırıldı; aktif teslimat + kalibrasyon kalır.
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
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Asset } from 'expo-asset';
import Svg, { Path } from 'react-native-svg';

import AnimatedDeliveryTruckMarker from './AnimatedDeliveryTruckMarker';
import CalibrationDebugMarker from './CalibrationDebugMarker';

import {
  getTurkeyLogisticsNetworkMap,
  getTurkeyLogisticsNetworkMapModule,
} from '../../assets/mapAssets';
import { debugConfig, getResolvedMapDebugFlags } from '../../config/debug';
import type { Delivery, TruckTransfer } from '../../types/game';
import { getMapLayerOpacity, isMapLayerVisible, type MapOverlayLayer } from './mapLayerVisibility';
import InteractiveTurkeyMap, {
  type InteractiveTurkeyMapHandle,
  type MapCalibrationTapResult,
  type MapDetailLevel,
} from './InteractiveTurkeyMap';
import type { NetworkFilterKey } from './mapTypes';

export type { NetworkFilterKey };
import type { MapRoadPoint } from '../../data/mapRoadNetwork';
import { getMapRoadSegmentById } from '../../data/mapRoadNetwork';
import {
  addCalibrationPoint,
  logMapCalibrationInit,
  registerMapSegmentCalibrationDevTools,
  syncMapSegmentCalibration,
  useMapCalibrationSession,
} from './mapSegmentCalibration';
import {
  getRoadRoute,
  getRouteHeadingDegrees,
  getTruckPositionAlongRoadRoute,
  logMapHeadingDebug,
  buildMapHeadingDebugPayload,
  normalizeMapDeliveryProgress,
  normalizedPointToPixel,
  polylineToSvgPath,
  splitPolylineAtProgress,
  type MapBounds as RoadMapBounds,
} from './mapRoadUtils';
import {
  buildDeliveryTruckMarkerKey,
  buildRoutePathMarkerKey,
  buildTransferRouteMarkerKey,
  buildTransferTruckMarkerKey,
  buildVisibleMapMarkers,
} from './mapMarkerState';
import {
  ACTIVE_DELIVERY_ROUTE_LINE_ENABLED,
  shouldRenderActiveDeliveryMarker,
} from './mapDeliveryOverlayPolicy';
import { normalizedToContentPoint, roundMapCoordinate } from './mapCoordinateUtils';
import { computeMapContentSize } from './mapTransformUtils';
import {
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
  TRUCK_ICON_BASE_ROTATION_DEG,
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
  activeDeliveries?: Delivery[];
  activeTransfers?: TruckTransfer[];
  selectedFilter: NetworkFilterKey;
  selectedDeliveryId?: string | null;
  onDeliveryPress?: (deliveryId: string) => void;
  onMapGestureActiveChange?: (active: boolean) => void;
  calibrationMode?: boolean;
};

interface MapBounds {
  width: number;
  height: number;
}

interface DeliveryRouteRenderItem {
  delivery: Delivery;
  routeVersion: string;
  hasRoute: boolean;
  completedPath: string;
  remainingPath: string;
  completedGlowPath: string;
  truckPixel: { x: number; y: number };
  truckAngle: number;
  normalizedProgress: number;
  opacity: number;
}

interface TransferRouteRenderItem {
  transfer: TruckTransfer;
  routeVersion: string;
  hasRoute: boolean;
  routePath: string;
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
  if (!getResolvedMapDebugFlags().truck) return;
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
  if (!getResolvedMapDebugFlags().roadWarnings) return;
  console.warn('[map-road] route not found', {
    from: originCityId,
    to: destinationCityId,
  });
}

function WorldMapCanvasInner(
  {
    activeDeliveries = [],
    activeTransfers = [],
    selectedFilter,
    selectedDeliveryId,
    onDeliveryPress,
    onMapGestureActiveChange,
    calibrationMode = false,
  }: WorldMapCanvasProps,
  ref: React.ForwardedRef<WorldMapCanvasHandle>,
) {
  const mapRef = useRef<InteractiveTurkeyMapHandle>(null);
  const lastValidHeadingByRouteKey = useRef(new Map<string, number>());
  const [detailLevel, setDetailLevel] = useState<MapDetailLevel>('low');
  useImperativeHandle(ref, () => ({
    resetToOperational: () => mapRef.current?.resetToOperational(),
  }));

  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < COMPACT_BREAKPOINT;
  const viewportHeight = isCompact ? MAP_VIEWPORT_HEIGHT_COMPACT : MAP_VIEWPORT_HEIGHT;
  const [mapImageReady, setMapImageReady] = React.useState(false);
  const calibrationSession = useMapCalibrationSession();
  const calibrationDots = calibrationSession.points;
  const savedCalibrationPointCount = useMemo(() => {
    if (calibrationSession.mode !== 'segment' || !calibrationSession.segmentId) {
      return null;
    }
    return getMapRoadSegmentById(calibrationSession.segmentId)?.points.length ?? 0;
  }, [calibrationSession.mode, calibrationSession.segmentId]);
  const showCalibrationUi = __DEV__ && MAP_CALIBRATION_ENABLED;
  const segmentPointDebugOverlay = useMemo(() => {
    if (!__DEV__ || !debugConfig.mapRoadSegmentPointDebugEnabled) {
      return [];
    }
    const segment = getMapRoadSegmentById('ankara-trabzon');
    if (!segment) {
      return [];
    }
    return segment.points.map((point, index) => ({ point, index: index + 1 }));
  }, []);

  const contentSize = useMemo<MapBounds>(
    () => computeMapContentSize(viewportHeight, MAP_ASPECT_RATIO),
    [viewportHeight],
  );

  useEffect(() => {
    if (!__DEV__) {
      return;
    }

    logMapCalibrationInit({
      enabled: MAP_CALIBRATION_ENABLED,
      segmentId: debugConfig.mapCalibrationSegmentId,
    });

    if (!MAP_CALIBRATION_ENABLED) {
      return;
    }

    registerMapSegmentCalibrationDevTools();
    syncMapSegmentCalibration({
      enabled: true,
      segmentId: debugConfig.mapCalibrationSegmentId,
    });
  }, []);

  useEffect(() => {
    if (!__DEV__ || !MAP_CALIBRATION_ENABLED) {
      return;
    }

    registerMapSegmentCalibrationDevTools();
    syncMapSegmentCalibration({
      enabled: true,
      segmentId: debugConfig.mapCalibrationSegmentId,
    });
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

  const visibleMarkers = useMemo(
    () =>
      buildVisibleMapMarkers({
        activeDeliveries,
        activeTransfers,
      }),
    [activeDeliveries, activeTransfers],
  );

  const runningDeliveries = useMemo(
    () => visibleMarkers.deliveries.map((item) => item.delivery),
    [visibleMarkers.deliveries],
  );

  const runningTransfers = useMemo(
    () => visibleMarkers.transfers.map((item) => item.transfer),
    [visibleMarkers.transfers],
  );

  const overlayRenderVersion = visibleMarkers.overlayRenderVersion;

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

  const layerVisible = useCallback(
    (layer: MapOverlayLayer) =>
      isMapLayerVisible({
        layer,
        detailLevel,
        filter: selectedFilter,
      }),
    [detailLevel, selectedFilter],
  );

  const layerOpacity = useCallback(
    (layer: MapOverlayLayer) =>
      getMapLayerOpacity({
        layer,
        detailLevel,
        filter: selectedFilter,
      }),
    [detailLevel, selectedFilter],
  );

  const handleCalibrationTap = useCallback(
    (result: MapCalibrationTapResult) => {
      if (!MAP_CALIBRATION_ENABLED || mapBounds.width === 0 || !result.isInsideContent) {
        return;
      }

      const point: MapRoadPoint = {
        x: roundMapCoordinate(result.normalized.x, 4),
        y: roundMapCoordinate(result.normalized.y, 4),
      };

      addCalibrationPoint(point);
    },
    [mapBounds.width],
  );

  const resolveRouteOpacity = useCallback(
    (isSelectedDelivery: boolean) => {
      const base = isSelectedDelivery ? 1 : 0.92;
      return base * layerOpacity('route');
    },
    [layerOpacity],
  );

  /** Tümü / Kamyonlar / Depolar — aktif teslimat overlay’leri her filtrede görünür. */
  const deliveryRouteRenderData = useMemo((): DeliveryRouteRenderItem[] => {
    if (visibleMarkers.deliveries.length === 0 || mapBounds.width === 0) return [];
    if (!layerVisible('route')) return [];

    const roadBounds: RoadMapBounds = mapBounds;
    const items: DeliveryRouteRenderItem[] = [];

    for (const { delivery, routeVersion } of visibleMarkers.deliveries) {
      const opacity = resolveRouteOpacity(delivery.id === selectedDeliveryId);
      if (opacity <= 0) continue;

      const roadPoints = getRoadRoute(delivery.originCityId, delivery.destinationCityId);
      if (!roadPoints || roadPoints.length < 2) {
        logMissingRoadRoute(delivery.originCityId, delivery.destinationCityId);
        items.push({
          delivery,
          routeVersion,
          hasRoute: false,
          completedPath: '',
          remainingPath: '',
          completedGlowPath: '',
          truckPixel: { x: 0, y: 0 },
          truckAngle: 0,
          normalizedProgress: 0,
          opacity,
        });
        continue;
      }

      const normalizedProgress = normalizeMapDeliveryProgress(delivery.progress);
      const headingCacheKey = `${delivery.id}:${routeVersion}`;
      const previousHeading = lastValidHeadingByRouteKey.current.get(headingCacheKey);
      const truckSample = getTruckPositionAlongRoadRoute(roadPoints, delivery.progress, {
        fallbackHeadingDeg: previousHeading,
        coordinateScaleX: roadBounds.width,
        coordinateScaleY: roadBounds.height,
      });
      const displayHeadingDeg = getRouteHeadingDegrees({
        routePoints: roadPoints,
        progress: delivery.progress,
        assetBaseHeadingDegrees: TRUCK_ICON_BASE_ROTATION_DEG,
        fallbackHeadingDeg: previousHeading,
        previousHeadingDeg: previousHeading,
        coordinateScaleX: roadBounds.width,
        coordinateScaleY: roadBounds.height,
      });
      if (Number.isFinite(displayHeadingDeg)) {
        lastValidHeadingByRouteKey.current.set(headingCacheKey, displayHeadingDeg);
      }
      const headingDebug = buildMapHeadingDebugPayload({
        routePoints: roadPoints,
        progress: delivery.progress,
        assetBaseHeadingDegrees: TRUCK_ICON_BASE_ROTATION_DEG,
        coordinateScaleX: roadBounds.width,
        coordinateScaleY: roadBounds.height,
        routeId: delivery.id,
        origin: delivery.originCityId,
        destination: delivery.destinationCityId,
      });
      if (headingDebug) {
        logMapHeadingDebug(headingDebug);
      }
      const truckPixel = normalizedPointToPixel(truckSample.point, roadBounds);
      const truckAngleRadians = (displayHeadingDeg * Math.PI) / 180;

      logTruckPositionDebug({
        originCityId: delivery.originCityId,
        destinationCityId: delivery.destinationCityId,
        progress: delivery.progress,
        normalizedProgress,
        routeStart: roadPoints[0],
        routeEnd: roadPoints[roadPoints.length - 1],
        calculatedTruckPoint: truckSample.point,
      });

      const { completedPoints, remainingPoints } = splitPolylineAtProgress(
        roadPoints,
        normalizedProgress,
      );

      items.push({
        delivery,
        routeVersion,
        hasRoute: true,
        completedPath: polylineToSvgPath(completedPoints, roadBounds),
        remainingPath: polylineToSvgPath(remainingPoints, roadBounds),
        completedGlowPath: polylineToSvgPath(completedPoints, roadBounds),
        truckPixel,
        truckAngle: truckAngleRadians,
        normalizedProgress,
        opacity,
      });
    }

    return items;
  }, [
    visibleMarkers.deliveries,
    runningDeliveryProgressKey,
    mapBounds,
    layerVisible,
    resolveRouteOpacity,
    selectedDeliveryId,
  ]);

  useEffect(() => {
    if (!__DEV__ || !debugConfig.mapMarkerAuditEnabled) return;
    for (const item of deliveryRouteRenderData) {
      if (!item.hasRoute) continue;
      console.log('[map-marker-audit]', {
        markerType: 'moving-truck',
        sourceComponent: 'WorldMapCanvas/AnimatedDeliveryTruckMarker',
        deliveryId: item.delivery.id,
        cityId: item.delivery.destinationCityId,
        x: item.truckPixel.x,
        y: item.truckPixel.y,
      });
    }
  }, [deliveryRouteRenderData]);

  useEffect(() => {
    const activeKeys = new Set<string>();
    for (const { delivery, routeVersion } of visibleMarkers.deliveries) {
      activeKeys.add(`${delivery.id}:${routeVersion}`);
    }
    for (const { transfer, routeVersion } of visibleMarkers.transfers) {
      activeKeys.add(`${transfer.id}:${routeVersion}`);
    }
    for (const cacheKey of lastValidHeadingByRouteKey.current.keys()) {
      if (!activeKeys.has(cacheKey)) {
        lastValidHeadingByRouteKey.current.delete(cacheKey);
      }
    }
  }, [overlayRenderVersion, visibleMarkers]);

  const runningTransferProgressKey = useMemo(
    () =>
      runningTransfers
        .map(
          (t) =>
            `${t.id}:${t.fromCityId}:${t.toCityId}:${t.progress ?? 0}`,
        )
        .join('|'),
    [runningTransfers],
  );

  const transferRouteRenderData = useMemo((): TransferRouteRenderItem[] => {
    if (visibleMarkers.transfers.length === 0 || mapBounds.width === 0) return [];
    if (!layerVisible('route') && !layerVisible('truck')) return [];

    const roadBounds: RoadMapBounds = mapBounds;
    const items: TransferRouteRenderItem[] = [];

    for (const { transfer, routeVersion } of visibleMarkers.transfers) {
      const opacity = resolveRouteOpacity(false);
      if (opacity <= 0) continue;

      const roadPoints = getRoadRoute(transfer.fromCityId, transfer.toCityId);
      if (!roadPoints || roadPoints.length < 2) {
        items.push({
          transfer,
          routeVersion,
          hasRoute: false,
          routePath: '',
          truckPixel: { x: 0, y: 0 },
          truckAngle: 0,
          normalizedProgress: 0,
          opacity,
        });
        continue;
      }

      const normalizedProgress = normalizeMapDeliveryProgress(transfer.progress);
      const headingCacheKey = `${transfer.id}:${routeVersion}`;
      const previousHeading = lastValidHeadingByRouteKey.current.get(headingCacheKey);
      const truckSample = getTruckPositionAlongRoadRoute(roadPoints, transfer.progress, {
        fallbackHeadingDeg: previousHeading,
        coordinateScaleX: roadBounds.width,
        coordinateScaleY: roadBounds.height,
      });
      const displayHeadingDeg = getRouteHeadingDegrees({
        routePoints: roadPoints,
        progress: transfer.progress,
        assetBaseHeadingDegrees: TRUCK_ICON_BASE_ROTATION_DEG,
        fallbackHeadingDeg: previousHeading,
        previousHeadingDeg: previousHeading,
        coordinateScaleX: roadBounds.width,
        coordinateScaleY: roadBounds.height,
      });
      if (Number.isFinite(displayHeadingDeg)) {
        lastValidHeadingByRouteKey.current.set(headingCacheKey, displayHeadingDeg);
      }

      items.push({
        transfer,
        routeVersion,
        hasRoute: true,
        routePath: polylineToSvgPath(roadPoints, roadBounds),
        truckPixel: normalizedPointToPixel(truckSample.point, roadBounds),
        truckAngle: (displayHeadingDeg * Math.PI) / 180,
        normalizedProgress,
        opacity,
      });
    }

    return items;
  }, [
    visibleMarkers.transfers,
    runningTransferProgressKey,
    mapBounds,
    layerVisible,
    resolveRouteOpacity,
  ]);

  const handleDetailLevelChange = useCallback((level: MapDetailLevel) => {
    setDetailLevel(level);
  }, []);

  return (
    <View style={styles.wrapper}>
      {showCalibrationUi ? (
        <View style={styles.calibrationBadge} pointerEvents="none">
          <Text style={styles.calibrationBadgeText}>
            CAL:{' '}
            {calibrationSession.mode === 'segment'
              ? calibrationSession.segmentId ?? 'segment'
              : calibrationSession.mode === 'city'
                ? 'city'
                : 'off'}{' '}
            · Oturum {calibrationDots.length}
            {savedCalibrationPointCount != null
              ? ` · Kayıtlı ${savedCalibrationPointCount}`
              : ''}
          </Text>
        </View>
      ) : null}

      <InteractiveTurkeyMap
        ref={mapRef}
        viewportHeight={viewportHeight}
        contentSize={contentSize}
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

        {ACTIVE_DELIVERY_ROUTE_LINE_ENABLED &&
        mapBounds.width > 0 &&
        deliveryRouteRenderData.length > 0 ? (
          <Svg
            key={overlayRenderVersion}
            width={mapBounds.width}
            height={mapBounds.height}
            style={StyleSheet.absoluteFill}
          >
            {deliveryRouteRenderData.map(
              ({
                delivery,
                routeVersion,
                hasRoute,
                completedPath,
                remainingPath,
                completedGlowPath,
                opacity,
              }) => (
                <React.Fragment key={buildRoutePathMarkerKey(delivery.id, routeVersion, 'group')}>
                  {hasRoute ? (
                    <>
                      {remainingPath ? (
                        <Path
                          key={buildRoutePathMarkerKey(delivery.id, routeVersion, 'remaining')}
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
                          key={buildRoutePathMarkerKey(delivery.id, routeVersion, 'glow')}
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
                          key={buildRoutePathMarkerKey(delivery.id, routeVersion, 'completed')}
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
                </React.Fragment>
              ),
            )}
          </Svg>
        ) : null}

        {showCalibrationUi && calibrationDots.length > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {calibrationDots.map((point, index) => {
              const pixel = normalizedToContentPoint(point.x, point.y, mapBounds);
              return (
                <CalibrationDebugMarker
                  key={`calibration-${index}`}
                  pixelX={pixel.x}
                  pixelY={pixel.y}
                  index={index + 1}
                />
              );
            })}
          </View>
        ) : null}

        {segmentPointDebugOverlay.length > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {segmentPointDebugOverlay.map(({ point, index }) => {
              const pixel = normalizedToContentPoint(point.x, point.y, mapBounds);
              return (
                <CalibrationDebugMarker
                  key={`segment-debug-ankara-trabzon-${index}`}
                  pixelX={pixel.x}
                  pixelY={pixel.y}
                  index={index}
                />
              );
            })}
          </View>
        ) : null}

        {mapBounds.width > 0 &&
        layerVisible('route') &&
        transferRouteRenderData.some((item) => item.hasRoute) ? (
          <Svg
            key={`${overlayRenderVersion}-transfer`}
            width={mapBounds.width}
            height={mapBounds.height}
            style={StyleSheet.absoluteFill}
          >
            {transferRouteRenderData.map(({ transfer, routeVersion, hasRoute, routePath, opacity }) =>
              hasRoute && routePath ? (
                <Path
                  key={buildTransferRouteMarkerKey(transfer.id, routeVersion)}
                  d={routePath}
                  stroke={MAP_TRANSFER_ROUTE}
                  strokeWidth={2}
                  strokeOpacity={opacity * 0.75}
                  strokeDasharray="6 4"
                  fill="none"
                />
              ) : null,
            )}
          </Svg>
        ) : null}

        {shouldRenderActiveDeliveryMarker('moving-truck') &&
        mapBounds.width > 0 &&
        layerVisible('truck') &&
        deliveryRouteRenderData.length > 0 ? (
          <View
            key={`trucks-${overlayRenderVersion}`}
            style={StyleSheet.absoluteFill}
            pointerEvents="box-none"
          >
            {deliveryRouteRenderData.map(
              ({
                delivery,
                routeVersion,
                hasRoute,
                truckPixel,
                truckAngle,
                normalizedProgress,
                opacity,
              }) =>
                hasRoute ? (
                  <AnimatedDeliveryTruckMarker
                    key={buildDeliveryTruckMarkerKey(delivery.id, routeVersion)}
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

        {mapBounds.width > 0 && layerVisible('truck') && transferRouteRenderData.length > 0 ? (
          <View
            key={`transfer-trucks-${overlayRenderVersion}`}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            {transferRouteRenderData.map(
              ({
                transfer,
                routeVersion,
                hasRoute,
                truckPixel,
                truckAngle,
                normalizedProgress,
                opacity,
              }) =>
                hasRoute ? (
                  <AnimatedDeliveryTruckMarker
                    key={buildTransferTruckMarkerKey(transfer.id, routeVersion)}
                    pixelX={truckPixel.x}
                    pixelY={truckPixel.y}
                    angleRadians={truckAngle}
                    progress={normalizedProgress}
                    opacity={opacity * layerOpacity('truck') * 0.9}
                  />
                ) : null,
            )}
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
  calibrationBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 20,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(3, 18, 37, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 109, 0.7)',
  },
  calibrationBadgeText: {
    color: '#FF8FAB',
    fontSize: 9.5,
    fontWeight: '700',
  },
});
