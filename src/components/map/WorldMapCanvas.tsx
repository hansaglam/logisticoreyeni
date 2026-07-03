/**
 * WorldMapCanvas.tsx
 *
 * Illüstratif harita görseli üzerine SVG rotalar, şehir pin'leri ve kamyon
 * marker'ları. Tüm overlay koordinatları tek mapBounds kaynağından hesaplanır.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  ImageBackground,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import { getWorldMapCityPosition } from '../../data/worldMapPositions';
import type { City, Contract, Delivery, Route } from '../../types/game';

const MAP_IMAGE = require('../../../assets/maps/turkey-relief.png');
const mapImageSize = Image.resolveAssetSource(MAP_IMAGE);
const MAP_ASPECT_RATIO = mapImageSize.width / mapImageSize.height;

console.log('map image size', mapImageSize);

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

const ACTIVE_ROUTE_WIDTH = 1;
const ACTIVE_ROUTE_OPACITY = 0.4;
const ACTIVE_ROUTE_SELECTED_OPACITY = 0.6;

export type WorldMapCanvasProps = {
  cities?: City[];
  routes?: Route[];
  contracts?: Contract[];
  activeDeliveries?: Delivery[];
  depotCityIds?: string[];
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

export default function WorldMapCanvas({
  cities = [],
  routes: _routes = [],
  activeDeliveries = [],
  depotCityIds = [],
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
    (locationX: number, locationY: number) => {
      if (!calibrationMode || mapBounds.width === 0 || mapBounds.height === 0) {
        return;
      }
      const xPct = Math.round((locationX / mapBounds.width) * 1000) / 10;
      const yPct = Math.round((locationY / mapBounds.height) * 1000) / 10;
      console.log('[calibration]', { xPct, yPct });
    },
    [calibrationMode, mapBounds.width, mapBounds.height],
  );

  const showTrucks = selectedFilter === 'all' || selectedFilter === 'trucks';
  const showDepots = selectedFilter === 'all' || selectedFilter === 'depots';
  const showActiveRoutes =
    selectedFilter === 'all' || selectedFilter === 'trucks' || selectedFilter === 'routes';

  return (
    <View style={styles.wrapper} onLayout={handleWrapperLayout}>
      <View
        style={
          containerWidth > 0
            ? { width: mapBounds.width, height: mapBounds.height }
            : { width: '100%', aspectRatio: MAP_ASPECT_RATIO }
        }
      >
        <ImageBackground
          source={MAP_IMAGE}
          style={styles.mapFill}
          imageStyle={styles.mapImageInner}
        >
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

          {calibrationMode && mapBounds.width > 0 ? (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={(event) => {
                const { locationX, locationY } = event.nativeEvent;
                handleCalibrationTap(locationX, locationY);
              }}
            />
          ) : null}
        </ImageBackground>
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
  },
  mapFill: {
    width: '100%',
    height: '100%',
  },
  mapImageInner: {
    resizeMode: 'cover',
  },
});
