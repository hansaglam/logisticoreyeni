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
  getTruckPositionAlongRoadRoute,
  normalizeMapDeliveryProgress,
  normalizedPointToPixel,
  polylineToSvgPath,
  splitPolylineAtProgress,
  type MapBounds as RoadMapBounds,
} from './mapRoadUtils';
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
  const lastValidHeadingByRouteId = useRef(new Map<string, number>());
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

  const runningDeliveries = useMemo(
    () =>
      activeDeliveries.filter(
        (d) => d.status === 'preparing' || d.status === 'on_route' || d.status === 'paused',
      ),
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
    () =>
      (activeTransfers ?? []).filter(
        (t) => t.status === 'active' || t.status === 'paused',
      ),
    [activeTransfers],
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
    if (runningDeliveries.length === 0 || mapBounds.width === 0) return [];
    if (!layerVisible('route')) return [];

    const roadBounds: RoadMapBounds = mapBounds;

    const items: DeliveryRouteRenderItem[] = [];

    for (const delivery of runningDeliveries) {
      const opacity = resolveRouteOpacity(delivery.id === selectedDeliveryId);
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
      const truckSample = getTruckPositionAlongRoadRoute(roadPoints, delivery.progress, {
        fallbackHeadingDeg: lastValidHeadingByRouteId.current.get(delivery.id),
        coordinateScaleX: roadBounds.width,
        coordinateScaleY: roadBounds.height,
      });
      if (Number.isFinite(truckSample.headingDeg)) {
        lastValidHeadingByRouteId.current.set(delivery.id, truckSample.headingDeg);
      }
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
        truckPixel,
        truckAngle: truckSample.angleRadians,
        normalizedProgress,
        opacity,
      });
    }

    return items;
  }, [
    runningDeliveries,
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
    const activeIds = new Set([
      ...runningDeliveries.map((delivery) => delivery.id),
      ...runningTransfers.map((transfer) => transfer.id),
    ]);
    for (const routeId of lastValidHeadingByRouteId.current.keys()) {
      if (!activeIds.has(routeId)) {
        lastValidHeadingByRouteId.current.delete(routeId);
      }
    }
  }, [runningDeliveries, runningTransfers]);

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
    if (runningTransfers.length === 0 || mapBounds.width === 0) return [];
    if (!layerVisible('route') && !layerVisible('truck')) return [];

    const roadBounds: RoadMapBounds = mapBounds;
    const items: TransferRouteRenderItem[] = [];

    for (const transfer of runningTransfers) {
      const opacity = resolveRouteOpacity(false);
      if (opacity <= 0) continue;

      const roadPoints = getRoadRoute(transfer.fromCityId, transfer.toCityId);
      if (!roadPoints || roadPoints.length < 2) {
        items.push({
          transfer,
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
      const truckSample = getTruckPositionAlongRoadRoute(roadPoints, transfer.progress, {
        fallbackHeadingDeg: lastValidHeadingByRouteId.current.get(transfer.id),
        coordinateScaleX: roadBounds.width,
        coordinateScaleY: roadBounds.height,
      });
      if (Number.isFinite(truckSample.headingDeg)) {
        lastValidHeadingByRouteId.current.set(transfer.id, truckSample.headingDeg);
      }

      items.push({
        transfer,
        hasRoute: true,
        routePath: polylineToSvgPath(roadPoints, roadBounds),
        truckPixel: normalizedPointToPixel(truckSample.point, roadBounds),
        truckAngle: truckSample.angleRadians,
        normalizedProgress,
        opacity,
      });
    }

    return items;
  }, [
    runningTransfers,
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
          <Svg width={mapBounds.width} height={mapBounds.height} style={StyleSheet.absoluteFill}>
            {deliveryRouteRenderData.map(
              ({
                delivery,
                hasRoute,
                completedPath,
                remainingPath,
                completedGlowPath,
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
          <Svg width={mapBounds.width} height={mapBounds.height} style={StyleSheet.absoluteFill}>
            {transferRouteRenderData.map(({ transfer, hasRoute, routePath, opacity }) =>
              hasRoute && routePath ? (
                <Path
                  key={transfer.id}
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

        {mapBounds.width > 0 && layerVisible('truck') && transferRouteRenderData.length > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {transferRouteRenderData.map(
              ({ transfer, hasRoute, truckPixel, truckAngle, normalizedProgress, opacity }) =>
                hasRoute ? (
                  <AnimatedDeliveryTruckMarker
                    key={`transfer-truck-${transfer.id}`}
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
