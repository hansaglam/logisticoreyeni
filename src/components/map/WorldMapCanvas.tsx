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
import Svg, { Circle, Path } from 'react-native-svg';

import AnimatedDeliveryTruckMarker from './AnimatedDeliveryTruckMarker';
import CalibrationDebugMarker from './CalibrationDebugMarker';

import {
  getTurkeyLogisticsNetworkMap,
  getTurkeyLogisticsNetworkMapModule,
} from '../../assets/mapAssets';
import { debugConfig, getResolvedMapDebugFlags } from '../../config/debug';
import { getWorldMapCityPosition } from '../../data/worldMapPositions';
import type { Delivery, TruckTransfer } from '../../types/game';
import { GameIcon } from '../ui';
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
import { normalizedToContentPoint, roundMapCoordinate } from './mapCoordinateUtils';
import { computeMapContentSize } from './mapTransformUtils';
import {
  MAP_DELIVERY_DESTINATION,
  MAP_DELIVERY_DESTINATION_GLOW,
  MAP_DELIVERY_ORIGIN,
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

/** Aktif teslimat başlangıç göstergesi — legacy city ring kullanılmaz. */
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

/** Aktif teslimat hedef göstergesi — legacy city ring kullanılmaz. */
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
      const from = getWorldMapCityPosition(delivery.originCityId);
      const to = getWorldMapCityPosition(delivery.destinationCityId);
      if (!from || !to) continue;

      const origin = normToPixel(from.x, from.y, mapBounds);
      const destination = normToPixel(to.x, to.y, mapBounds);
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
    runningDeliveries,
    runningDeliveryProgressKey,
    mapBounds,
    layerVisible,
    resolveRouteOpacity,
    selectedDeliveryId,
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

        {mapBounds.width > 0 && runningTransfers.length > 0 ? (
          <Svg width={mapBounds.width} height={mapBounds.height} style={StyleSheet.absoluteFill}>
            {runningTransfers.map((transfer) => {
              const from = getWorldMapCityPosition(transfer.fromCityId);
              const to = getWorldMapCityPosition(transfer.toCityId);
              if (!from || !to) return null;
              const p1 = normToPixel(from.x, from.y, mapBounds);
              const p2 = normToPixel(to.x, to.y, mapBounds);
              const { d, cx, cy } = buildCurvePath(p1.x, p1.y, p2.x, p2.y);
              const opacity = resolveRouteOpacity(false);
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

        {mapBounds.width > 0 && layerVisible('truck') && deliveryRouteRenderData.length > 0 ? (
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

        {mapBounds.width > 0 && layerVisible('truck') && runningTransfers.length > 0 ? (
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
              const opacity = layerOpacity('truck') * resolveRouteOpacity(false);
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
