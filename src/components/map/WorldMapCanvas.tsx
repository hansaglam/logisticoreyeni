/**
 * WorldMapCanvas.tsx
 *
 * Illüstratif harita görseli üzerine SVG rotalar, şehir pin'leri ve kamyon
 * marker'ları. Tüm overlay koordinatları tek mapBounds kaynağından hesaplanır.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Asset } from 'expo-asset';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import { debugConfig } from '../../config/debug';
import { getWorldMapCityPosition } from '../../data/worldMapPositions';
import { normalizeCityId } from '../../data/networkPositions';
import type { City, Contract, Delivery, Route, TruckTransfer } from '../../types/game';
import IdleTruckCountBadge from './IdleTruckCountBadge';

const MAP_IMAGE = require('../../../assets/maps/turkey-relief.png');

function resolveMapAspectRatio(): number {
  const source = Image.resolveAssetSource(MAP_IMAGE);
  if (source?.width && source?.height && source.height > 0) {
    return source.width / source.height;
  }
  return 1.55;
}

const MAP_ASPECT_RATIO = resolveMapAspectRatio();

// Enable debugConfig.mapCalibrationEnabled temporarily to calibrate map city positions.
// Tap on the map and copy xPct/yPct values into worldMapPositions.ts.
const MAP_CALIBRATION_ENABLED = debugConfig.mapCalibrationEnabled;

export type NetworkFilterKey = 'all' | 'trucks' | 'depots' | 'routes' | 'opportunities';

const PIN_RADIUS = 2.5;
const PIN_STROKE_WIDTH = 1;
const PIN_LABEL_OFFSET = 9;
const LABELED_CITY_IDS = new Set(['istanbul', 'ankara']);

const COLORS = {
  routeActive: '#94A3B8',
  pinFill: '#EF4444',
  pinDepot: '#38BDF8',
  pinStroke: '#0F172A',
  text: '#F9FAFB',
};

const TRANSFER_ROUTE_COLOR = '#64748B';
const TRANSFER_ROUTE_OPACITY = 0.55;
const ACTIVE_ROUTE_WIDTH = 1;
const ACTIVE_ROUTE_OPACITY = 0.4;
const ACTIVE_ROUTE_SELECTED_OPACITY = 0.6;

export type WorldMapCanvasProps = {
  cities?: City[];
  routes?: Route[];
  contracts?: Contract[];
  activeDeliveries?: Delivery[];
  activeTransfers?: TruckTransfer[];
  depotCityIds?: string[];
  idleTruckCountByCity?: Record<string, number>;
  selectedFilter: NetworkFilterKey;
  featuredContract?: Contract | null;
  selectedContract?: Contract | null;
  selectedDeliveryId?: string | null;
  onCityPress?: (cityId: string) => void;
  onRoutePress?: (routeId: string) => void;
  onContractPress?: (contractId: string) => void;
  onDeliveryPress?: (deliveryId: string) => void;
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
  const x = oneMinusT * oneMinusT * x1 + 2 * oneMinusT * t * cx + t * t * x2;
  const y = oneMinusT * oneMinusT * y1 + 2 * oneMinusT * t * cy + t * t * y2;
  return { x, y };
}

function pctToPixel(xPct: number, yPct: number, bounds: MapBounds) {
  return {
    x: (xPct / 100) * bounds.width,
    y: (yPct / 100) * bounds.height,
  };
}

function getIdleBadgeVisual(filter: NetworkFilterKey): { opacity: number; prominent: boolean } {
  if (filter === 'trucks') return { opacity: 1, prominent: true };
  if (filter === 'routes') return { opacity: 0.45, prominent: false };
  if (filter === 'depots') return { opacity: 0.65, prominent: false };
  return { opacity: 0.92, prominent: false };
}

export default function WorldMapCanvas({
  cities = [],
  routes: _routes = [],
  activeDeliveries = [],
  activeTransfers = [],
  depotCityIds = [],
  idleTruckCountByCity,
  selectedFilter,
  featuredContract: _featuredContract,
  selectedContract: _selectedContract,
  selectedDeliveryId,
  onCityPress,
  onRoutePress: _onRoutePress,
  onContractPress: _onContractPress,
  onDeliveryPress,
  calibrationMode = false,
}: WorldMapCanvasProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [mapImageReady, setMapImageReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const asset = Asset.fromModule(MAP_IMAGE);
        await asset.downloadAsync();
        if (!cancelled && __DEV__) {
          console.log('[map] asset preloaded', asset.localUri ?? asset.uri);
        }
      } catch (error) {
        if (!cancelled && __DEV__) {
          console.warn('[map] asset preload failed', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const mapBounds = useMemo<MapBounds>(() => {
    const width = containerWidth;
    const height = width > 0 ? width / MAP_ASPECT_RATIO : 0;
    return { width, height };
  }, [containerWidth]);

  const handleWrapperLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) {
      setContainerWidth(width);
    }
  }, []);

  const handleCalibrationTap = useCallback(
    (viewportX: number, viewportY: number) => {
      if (!MAP_CALIBRATION_ENABLED || mapBounds.width === 0 || mapBounds.height === 0) {
        return;
      }
      const xPct = Math.round((viewportX / mapBounds.width) * 1000) / 10;
      const yPct = Math.round((viewportY / mapBounds.height) * 1000) / 10;
      console.log('[calibration]', { xPct, yPct });
    },
    [mapBounds],
  );

  const handleMapImageLoad = useCallback(() => {
    setMapImageReady(true);
    if (__DEV__) {
      console.log('[map] image loaded');
    }
  }, []);

  const handleMapImageError = useCallback(() => {
    setMapImageReady(false);
    if (__DEV__) {
      console.warn('[map] image failed to load');
    }
  }, []);

  const showTrucks = selectedFilter === 'all' || selectedFilter === 'trucks';
  const showDepots = selectedFilter === 'all' || selectedFilter === 'depots';
  const showActiveRoutes =
    selectedFilter === 'all' || selectedFilter === 'trucks' || selectedFilter === 'routes';
  const idleBadgeVisual = getIdleBadgeVisual(selectedFilter);
  const showIdleTruckBadges =
    selectedFilter === 'all' ||
    selectedFilter === 'trucks' ||
    selectedFilter === 'routes' ||
    selectedFilter === 'depots';
  const runningTransfers = (activeTransfers ?? []).filter((transfer) => transfer.status === 'active');
  const showTransfers = showTrucks && runningTransfers.length > 0;

  const viewportStyle =
    containerWidth > 0
      ? { width: mapBounds.width, height: mapBounds.height }
      : { width: '100%' as const, aspectRatio: MAP_ASPECT_RATIO };

  return (
    <View style={styles.wrapper} onLayout={handleWrapperLayout}>
      <View style={[styles.viewport, viewportStyle]}>
        <View
          collapsable={false}
          style={
            containerWidth > 0
              ? { width: mapBounds.width, height: mapBounds.height }
              : styles.viewportPlaceholder
          }
        >
          <Image
            source={MAP_IMAGE}
            style={[StyleSheet.absoluteFill, styles.mapImage]}
            resizeMode="cover"
            onLoad={handleMapImageLoad}
            onError={handleMapImageError}
          />

          {!mapImageReady ? <View style={styles.mapImageFallback} pointerEvents="none" /> : null}

          {mapBounds.width > 0 && (
            <Svg width={mapBounds.width} height={mapBounds.height} style={StyleSheet.absoluteFill}>
              {showActiveRoutes &&
                showTrucks &&
                activeDeliveries.map((delivery) => {
                  const from = getWorldMapCityPosition(delivery.originCityId);
                  const to = getWorldMapCityPosition(delivery.destinationCityId);
                  if (!from || !to) return null;
                  const p1 = pctToPixel(from.xPct, from.yPct, mapBounds);
                  const p2 = pctToPixel(to.xPct, to.yPct, mapBounds);
                  const { d, cx, cy } = buildCurvePath(p1.x, p1.y, p2.x, p2.y);
                  const isSelected = delivery.id === selectedDeliveryId;
                  const truckPos = pointOnQuadratic(
                    Math.max(0, Math.min(1, delivery.progress)),
                    p1.x,
                    p1.y,
                    cx,
                    cy,
                    p2.x,
                    p2.y,
                  );
                  return (
                    <React.Fragment key={delivery.id}>
                      <Path
                        d={d}
                        stroke={COLORS.routeActive}
                        strokeWidth={ACTIVE_ROUTE_WIDTH}
                        strokeOpacity={isSelected ? ACTIVE_ROUTE_SELECTED_OPACITY : ACTIVE_ROUTE_OPACITY}
                        fill="none"
                      />
                      <Circle
                        cx={truckPos.x}
                        cy={truckPos.y}
                        r={isSelected ? 4 : 3}
                        fill="#0F172A"
                        stroke={COLORS.routeActive}
                        strokeWidth={1.5}
                        strokeOpacity={isSelected ? 0.85 : 0.65}
                        onPress={() => onDeliveryPress?.(delivery.id)}
                      />
                    </React.Fragment>
                  );
                })}

              {showTransfers &&
                runningTransfers.map((transfer) => {
                  const from = getWorldMapCityPosition(transfer.fromCityId);
                  const to = getWorldMapCityPosition(transfer.toCityId);
                  if (!from || !to) return null;
                  const p1 = pctToPixel(from.xPct, from.yPct, mapBounds);
                  const p2 = pctToPixel(to.xPct, to.yPct, mapBounds);
                  const { d, cx, cy } = buildCurvePath(p1.x, p1.y, p2.x, p2.y);
                  const truckPos = pointOnQuadratic(
                    Math.max(0, Math.min(1, transfer.progress)),
                    p1.x,
                    p1.y,
                    cx,
                    cy,
                    p2.x,
                    p2.y,
                  );
                  return (
                    <React.Fragment key={transfer.id}>
                      <Path
                        d={d}
                        stroke={TRANSFER_ROUTE_COLOR}
                        strokeWidth={ACTIVE_ROUTE_WIDTH}
                        strokeOpacity={TRANSFER_ROUTE_OPACITY}
                        strokeDasharray="4 3"
                        fill="none"
                      />
                      <Circle
                        cx={truckPos.x}
                        cy={truckPos.y}
                        r={3}
                        fill="#0F172A"
                        stroke={TRANSFER_ROUTE_COLOR}
                        strokeWidth={1.5}
                        strokeOpacity={0.8}
                      />
                    </React.Fragment>
                  );
                })}

              {cities.map((city) => {
                const pos = getWorldMapCityPosition(city.id);
                if (!pos) return null;
                const isDepot = depotCityIds.includes(city.id);
                if (isDepot && !showDepots) return null;

                const pixel = pctToPixel(pos.xPct, pos.yPct, mapBounds);
                const fill = isDepot ? COLORS.pinDepot : COLORS.pinFill;
                const showLabel = LABELED_CITY_IDS.has(city.id);

                return (
                  <React.Fragment key={city.id}>
                    <Circle
                      cx={pixel.x}
                      cy={pixel.y}
                      r={PIN_RADIUS}
                      fill={fill}
                      stroke={COLORS.pinStroke}
                      strokeWidth={PIN_STROKE_WIDTH}
                      onPress={() => onCityPress?.(city.id)}
                    />
                    {showLabel ? (
                      <SvgText
                        x={pixel.x}
                        y={pixel.y + PIN_LABEL_OFFSET}
                        fill={COLORS.text}
                        fontSize={9}
                        fontWeight="700"
                        textAnchor="middle"
                        onPress={() => onCityPress?.(city.id)}
                      >
                        {city.name}
                      </SvgText>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </Svg>
          )}

          {mapBounds.width > 0 && showIdleTruckBadges ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              {cities.map((city) => {
                const pos = getWorldMapCityPosition(city.id);
                if (!pos) return null;

                const idleCount = idleTruckCountByCity?.[normalizeCityId(city.id)] ?? 0;
                if (idleCount <= 0) return null;

                const pixel = pctToPixel(pos.xPct, pos.yPct, mapBounds);

                return (
                  <IdleTruckCountBadge
                    key={`idle-badge-${city.id}`}
                    count={idleCount}
                    opacity={idleBadgeVisual.opacity}
                    prominent={idleBadgeVisual.prominent}
                    style={{
                      position: 'absolute',
                      left: pixel.x + 5,
                      top: pixel.y - 16,
                    }}
                  />
                );
              })}
            </View>
          ) : null}
        </View>

        {MAP_CALIBRATION_ENABLED && calibrationMode && mapBounds.width > 0 ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={(event) => {
              const { locationX, locationY } = event.nativeEvent;
              handleCalibrationTap(locationX, locationY);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
    position: 'relative',
  },
  viewport: {
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  viewportPlaceholder: {
    width: '100%',
    aspectRatio: MAP_ASPECT_RATIO,
  },
  mapImage: {
    width: '100%',
    height: '100%',
  },
  mapImageFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1E293B',
  },
});
