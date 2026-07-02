/**
 * @deprecated MapScreen artık NetworkMapCanvas kullanır. Kaldırılacak.
 * Eski coğrafi harita / SVG path yaklaşımı — kullanmayın.
 *
 * Responsive lojistik ağ haritası — normalized koordinatlar, zoom/pan yok.
 * TODO: Implement zoom/pan later.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import {
  getCityLabelOffset,
  getCityNetworkPosition,
  getCityPixelPosition,
  getDeliveryPixelPosition,
  normalizeCityId,
} from '../../data/mapPositions';
import MapCityNode, { type CityMarketStatus } from './MapCityNode';
import MapRoutePath from './MapRoutePath';
import MapTruckMarker from './MapTruckMarker';
import type {
  City,
  CityProductState,
  Contract,
  Delivery,
  DeliveryStatus,
  Route,
  Truck,
} from '../../types/game';

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route'];
const SHORTAGE_RATIO = 0.7;
const SURPLUS_RATIO = 1.3;
const ANIMATION_MS = 450;
const GRID_STEP = 40;
const CANVAS_BG = '#06111F';

export type MapFilterKey = 'all' | 'trucks' | 'depots' | 'routes';

export type TurkeyMapCanvasProps = {
  cities?: City[];
  routes?: Route[];
  activeDeliveries?: Delivery[];
  idleTrucks?: Truck[];
  selectedFilter: MapFilterKey;
  selectedContract?: Contract | null;
  selectedCityId?: string | null;
  selectedDeliveryId?: string | null;
  depotCityIds?: string[];
  onCityPress?: (cityId: string) => void;
  onRoutePress?: (routeId: string) => void;
  onDeliveryPress?: (deliveryId: string) => void;
  onIdleTruckPress?: (truckId: string) => void;
};

interface RouteDrawModel {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isActive: boolean;
  opacity: number;
}

interface TruckMarkerModel {
  key: string;
  x: number;
  y: number;
  angle: number;
  isSelected: boolean;
  onPress?: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function routesMatchCityPair(
  cityA: string,
  cityB: string,
  fromCityId: string,
  toCityId: string,
): boolean {
  const a = normalizeCityId(cityA);
  const b = normalizeCityId(cityB);
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);
  return (a === from && b === to) || (a === to && b === from);
}

function isRouteActive(
  route: Route,
  runningDeliveries: Delivery[],
  selectedContract?: Contract | null,
): boolean {
  for (const delivery of runningDeliveries) {
    if (routesMatchCityPair(route.fromCityId, route.toCityId, delivery.originCityId, delivery.destinationCityId)) {
      return true;
    }
  }
  if (selectedContract) {
    return routesMatchCityPair(
      route.fromCityId,
      route.toCityId,
      selectedContract.originCityId,
      selectedContract.destinationCityId,
    );
  }
  return false;
}

function getRouteOpacity(filter: MapFilterKey, isActive: boolean): number {
  if (filter === 'depots') return 0;
  if (isActive) return 1;
  if (filter === 'trucks') return 0.15;
  if (filter === 'routes') return 0.75;
  return 0.45;
}

function getProductStockRatio(state: CityProductState): number {
  const target = state.targetStock && state.targetStock > 0 ? state.targetStock : Math.max(state.stock ?? 0, 1);
  return (state.stock ?? 0) / target;
}

function getCityMarketStatus(city: City | undefined): CityMarketStatus {
  if (!city?.products) return 'Balanced';

  let shortageCount = 0;
  let surplusCount = 0;

  for (const state of Object.values(city.products)) {
    const ratio = getProductStockRatio(state);
    if (ratio < SHORTAGE_RATIO) shortageCount += 1;
    if (ratio > SURPLUS_RATIO) surplusCount += 1;
  }

  if (shortageCount > 0 && surplusCount > 0) return 'Mixed';
  if (shortageCount > 0) return 'Shortage';
  if (surplusCount > 0) return 'Surplus';
  return 'Balanced';
}

function getLineAngle(x1: number, y1: number, x2: number, y2: number): number {
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
}

function useAnimatedDeliveryProgress(activeDeliveries: Delivery[]): Map<string, number> {
  const targets = useMemo(() => {
    const next = new Map<string, number>();
    for (const delivery of activeDeliveries) {
      if (!ACTIVE_DELIVERY_STATUSES.includes(delivery.status)) continue;
      next.set(delivery.id, clamp(delivery.progress, 0, 1));
    }
    return next;
  }, [activeDeliveries]);

  const [animated, setAnimated] = useState<Map<string, number>>(() => new Map(targets));
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const fromRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    fromRef.current = new Map(animated);
    startRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const t = clamp(elapsed / ANIMATION_MS, 0, 1);
      const eased = t * (2 - t);

      const next = new Map<string, number>();
      for (const [id, target] of targets) {
        const from = fromRef.current.get(id) ?? target;
        next.set(id, lerp(from, target, eased));
      }

      setAnimated(next);

      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animated start state captured in fromRef
  }, [targets]);

  return animated;
}

function NetworkGrid({ width, height }: { width: number; height: number }) {
  const lines: React.ReactNode[] = [];

  for (let x = 0; x <= width; x += GRID_STEP) {
    lines.push(
      <Line
        key={`v-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={height}
        stroke="rgba(148, 163, 184, 0.06)"
        strokeWidth={1}
      />,
    );
  }

  for (let y = 0; y <= height; y += GRID_STEP) {
    lines.push(
      <Line
        key={`h-${y}`}
        x1={0}
        y1={y}
        x2={width}
        y2={y}
        stroke="rgba(148, 163, 184, 0.06)"
        strokeWidth={1}
      />,
    );
  }

  return <>{lines}</>;
}

/** Hafif yatay siluet — Türkiye hissi */
function NetworkLandHint({ width, height }: { width: number; height: number }) {
  const d = `
    M ${width * 0.12} ${height * 0.42}
    C ${width * 0.18} ${height * 0.18}, ${width * 0.42} ${height * 0.12}, ${width * 0.62} ${height * 0.16}
    C ${width * 0.82} ${height * 0.2}, ${width * 0.9} ${height * 0.38}, ${width * 0.84} ${height * 0.58}
    C ${width * 0.72} ${height * 0.78}, ${width * 0.42} ${height * 0.84}, ${width * 0.22} ${height * 0.68}
    C ${width * 0.1} ${height * 0.56}, ${width * 0.08} ${height * 0.48}, ${width * 0.12} ${height * 0.42}
    Z
  `;

  return (
    <Path
      d={d}
      fill="rgba(15, 40, 64, 0.35)"
      stroke="rgba(56, 189, 248, 0.08)"
      strokeWidth={1}
    />
  );
}

export default function TurkeyMapCanvas({
  cities = [],
  routes = [],
  activeDeliveries = [],
  selectedFilter,
  selectedContract,
  selectedCityId,
  selectedDeliveryId,
  depotCityIds = [],
  onCityPress,
  onRoutePress,
  onDeliveryPress,
}: TurkeyMapCanvasProps) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const runningDeliveries = useMemo(
    () => (activeDeliveries ?? []).filter((d) => ACTIVE_DELIVERY_STATUSES.includes(d.status)),
    [activeDeliveries],
  );

  const animatedProgress = useAnimatedDeliveryProgress(runningDeliveries);

  const depotSet = useMemo(() => new Set((depotCityIds ?? []).map(normalizeCityId)), [depotCityIds]);

  const mapCities = useMemo(
    () => (cities ?? []).filter((city) => getCityNetworkPosition(city.id) != null),
    [cities],
  );

  const routeDrawModels = useMemo((): RouteDrawModel[] => {
    if (layout.width <= 0 || layout.height <= 0) return [];

    return (routes ?? [])
      .map((route) => {
        const from = getCityPixelPosition(route.fromCityId, layout.width, layout.height);
        const to = getCityPixelPosition(route.toCityId, layout.width, layout.height);
        if (!from || !to) return null;

        const active = isRouteActive(route, runningDeliveries, selectedContract);
        const opacity = getRouteOpacity(selectedFilter, active);

        return {
          id: route.id,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          isActive: active,
          opacity,
        };
      })
      .filter((model): model is RouteDrawModel => model != null);
  }, [layout.height, layout.width, routes, runningDeliveries, selectedContract, selectedFilter]);

  const truckMarkers = useMemo((): TruckMarkerModel[] => {
    if (selectedFilter === 'depots' || layout.width <= 0 || layout.height <= 0) {
      return [];
    }

    const markers: TruckMarkerModel[] = [];

    runningDeliveries.forEach((delivery) => {
      const start = getCityPixelPosition(delivery.originCityId, layout.width, layout.height);
      const end = getCityPixelPosition(delivery.destinationCityId, layout.width, layout.height);
      if (!start || !end) return;

      const progress = animatedProgress.get(delivery.id) ?? clamp(delivery.progress, 0, 1);
      const point =
        delivery.status === 'preparing'
          ? start
          : getDeliveryPixelPosition(
              { ...delivery, progress },
              layout.width,
              layout.height,
            );
      if (!point) return;

      markers.push({
        key: `delivery-${delivery.id}`,
        x: point.x,
        y: point.y,
        angle: getLineAngle(start.x, start.y, end.x, end.y),
        isSelected: delivery.id === selectedDeliveryId,
        onPress: () => onDeliveryPress?.(delivery.id),
      });
    });

    return markers;
  }, [
    animatedProgress,
    layout.height,
    layout.width,
    onDeliveryPress,
    runningDeliveries,
    selectedDeliveryId,
    selectedFilter,
  ]);

  const ready = layout.width > 0 && layout.height > 0;

  return (
    <View
      style={styles.container}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) {
          setLayout({ width, height });
        }
      }}
    >
      {ready ? (
        <Svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
          <Defs>
            <RadialGradient id="networkBg" cx="50%" cy="38%" rx="70%" ry="65%">
              <Stop offset="0%" stopColor="#0C1E32" stopOpacity={1} />
              <Stop offset="100%" stopColor={CANVAS_BG} stopOpacity={1} />
            </RadialGradient>
          </Defs>

          <Rect x={0} y={0} width={layout.width} height={layout.height} fill="url(#networkBg)" />
          <NetworkGrid width={layout.width} height={layout.height} />
          <NetworkLandHint width={layout.width} height={layout.height} />

          {routeDrawModels.map((route) => (
            <MapRoutePath
              key={route.id}
              x1={route.x1}
              y1={route.y1}
              x2={route.x2}
              y2={route.y2}
              isActive={route.isActive}
              opacity={route.opacity}
              onPress={() => onRoutePress?.(route.id)}
            />
          ))}

          {mapCities.map((city) => {
            const point = getCityPixelPosition(city.id, layout.width, layout.height);
            if (!point) return null;

            return (
              <MapCityNode
                key={city.id}
                x={point.x}
                y={point.y}
                cityName={city.name}
                labelOffset={getCityLabelOffset(city.id)}
                isSelected={city.id === selectedCityId}
                hasDepot={depotSet.has(normalizeCityId(city.id))}
                marketStatus={getCityMarketStatus(city)}
                dimmed={selectedFilter === 'depots' && !depotSet.has(normalizeCityId(city.id))}
                onPress={() => onCityPress?.(city.id)}
              />
            );
          })}

          {truckMarkers.map((marker) => (
            <MapTruckMarker
              key={marker.key}
              x={marker.x}
              y={marker.y}
              angle={marker.angle}
              isSelected={marker.isSelected}
              onPress={marker.onPress}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CANVAS_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
  },
});
