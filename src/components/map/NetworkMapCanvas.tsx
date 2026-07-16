/**
 * Türkiye Lojistik Ağı — mobil tycoon network overview.
 * Zoom/pan yok; normalized layout + SVG.
 *
 * TODO: Yeni WorldMapCanvas doğrulandıktan sonra bu dosya silinecek.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';

import {
  getCityPixelPosition,
  getDeliveryPixelPosition,
  getNetworkCityPosition,
  getPointOnLine,
  getRoutePairKey,
  NODE_CARD_HEIGHT,
  NODE_CARD_WIDTH,
  normalizeCityId,
  routesMatchCityPair,
} from '../../data/networkPositions';
import type { City, CityProductState, Contract, Delivery, DeliveryStatus, Route } from '../../types/game';
import { colors } from '../../theme';

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route'];
const SHORTAGE_RATIO = 0.7;
const SURPLUS_RATIO = 1.3;
const RISKY_ROUTE_THRESHOLD = 0.85;
const ANIMATION_MS = 450;
const GRID_STEP = 36;
const CANVAS_BG = '#07111F';
const CANVAS_BORDER = '#1E293B';

export type NetworkFilterKey = 'all' | 'trucks' | 'depots' | 'routes' | 'opportunities';

export type NetworkMapCanvasProps = {
  cities?: City[];
  routes?: Route[];
  contracts?: Contract[];
  activeDeliveries?: Delivery[];
  depotCityIds?: string[];
  idleTruckCountByCity?: Record<string, number>;
  selectedFilter: NetworkFilterKey;
  /** En iyi / öne çıkan fırsat — rota highlight için */
  featuredContract?: Contract | null;
  /** Kullanıcının seçtiği sözleşme — $ marker için */
  selectedContract?: Contract | null;
  selectedDeliveryId?: string | null;
  onCityPress?: (cityId: string) => void;
  onRoutePress?: (routeId: string) => void;
  onContractPress?: (contractId: string) => void;
  onDeliveryPress?: (deliveryId: string) => void;
};

type RouteVisualKind = 'normal' | 'active' | 'risky' | 'opportunity';

interface RouteDrawModel {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: RouteVisualKind;
  opacity: number;
  contractId?: string;
}

interface TruckMarkerModel {
  key: string;
  x: number;
  y: number;
  progress: number;
  deliveryId: string;
  isSelected: boolean;
}

interface OpportunityMarkerModel {
  key: string;
  x: number;
  y: number;
  contractId: string;
  label: string;
}

type CityStatusLabel = 'Depo' | 'Açık' | 'Stok Fazla' | 'Normal';

const ROUTE_STYLES: Record<
  RouteVisualKind,
  { stroke: string; strokeWidth: number; baseOpacity: number }
> = {
  normal: { stroke: '#334155', strokeWidth: 2, baseOpacity: 0.65 },
  opportunity: { stroke: '#F59E0B', strokeWidth: 3, baseOpacity: 1 },
  active: { stroke: '#38BDF8', strokeWidth: 3.2, baseOpacity: 1 },
  risky: { stroke: '#EF4444', strokeWidth: 2.2, baseOpacity: 0.75 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getProductStockRatio(state: CityProductState): number {
  const target = state.targetStock && state.targetStock > 0 ? state.targetStock : Math.max(state.stock ?? 0, 1);
  return (state.stock ?? 0) / target;
}

function getCityStatusLabel(city: City, hasDepot: boolean): CityStatusLabel {
  if (hasDepot) return 'Depo';

  if (!city.products) return 'Normal';

  let shortageCount = 0;
  let surplusCount = 0;

  for (const state of Object.values(city.products)) {
    const ratio = getProductStockRatio(state);
    if (ratio < SHORTAGE_RATIO) shortageCount += 1;
    if (ratio > SURPLUS_RATIO) surplusCount += 1;
  }

  if (shortageCount > 0) return 'Açık';
  if (surplusCount > 0) return 'Stok Fazla';
  return 'Normal';
}

function getCityBorderColor(status: CityStatusLabel): string {
  if (status === 'Depo') return '#38BDF8';
  if (status === 'Açık') return '#EF4444';
  if (status === 'Stok Fazla') return '#22C55E';
  return '#334155';
}

function getFilterRouteOpacity(filter: NetworkFilterKey, kind: RouteVisualKind): number {
  const style = ROUTE_STYLES[kind];

  if (filter === 'all') return style.baseOpacity;
  if (filter === 'trucks') {
    return kind === 'active' ? style.baseOpacity : 0.18;
  }
  if (filter === 'depots') return 0.22;
  if (filter === 'routes') {
    return kind === 'normal' ? 0.9 : style.baseOpacity;
  }
  if (filter === 'opportunities') {
    return kind === 'opportunity' ? style.baseOpacity : 0.15;
  }
  return style.baseOpacity;
}

function getFilterCityOpacity(filter: NetworkFilterKey, hasDepot: boolean): number {
  if (filter === 'depots') return hasDepot ? 1 : 0.35;
  if (filter === 'trucks' || filter === 'routes' || filter === 'opportunities') return 0.92;
  return 1;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        stroke="rgba(148, 163, 184, 0.05)"
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
        stroke="rgba(148, 163, 184, 0.05)"
        strokeWidth={1}
      />,
    );
  }

  return <>{lines}</>;
}

function getFilterIdleBadgeOpacity(filter: NetworkFilterKey): number {
  if (filter === 'trucks') return 1;
  if (filter === 'routes') return 0.45;
  if (filter === 'depots') return 0.65;
  return 0.92;
}

function getFilterShowsIdleBadges(filter: NetworkFilterKey): boolean {
  return filter === 'all' || filter === 'trucks' || filter === 'routes' || filter === 'depots';
}

function CityIdleTruckBadge({
  cardX,
  cardY,
  count,
  opacity,
  prominent,
}: {
  cardX: number;
  cardY: number;
  count: number;
  opacity: number;
  prominent: boolean;
}) {
  const badgeWidth = prominent ? 30 : 28;
  const badgeHeight = prominent ? 20 : 18;
  const badgeX = cardX + NODE_CARD_WIDTH - badgeWidth + 4;
  const badgeY = cardY - 6;
  const textX = badgeX + badgeWidth / 2 + 4;
  const iconX = badgeX + 7;

  return (
    <G opacity={opacity}>
      <Rect
        x={badgeX}
        y={badgeY}
        width={badgeWidth}
        height={badgeHeight}
        rx={badgeHeight / 2}
        fill={colors.accentBlueSoft}
        stroke={colors.accentBlue}
        strokeWidth={prominent ? 1.5 : 1}
      />
      <Rect x={iconX} y={badgeY + 6} width={5} height={4} rx={1} fill={colors.accentBlue} />
      <Rect x={iconX + 5} y={badgeY + 7} width={6} height={3} rx={0.8} fill={colors.accentBlue} />
      <SvgText
        x={textX}
        y={badgeY + badgeHeight - 5}
        fill={colors.accentBlue}
        fontSize={prominent ? 11 : 10}
        fontWeight="800"
        textAnchor="middle"
      >
        {count}
      </SvgText>
    </G>
  );
}

function CityNodeCard({
  cx,
  cy,
  cityName,
  statusLabel,
  borderColor,
  opacity,
  idleTruckCount = 0,
  idleBadgeOpacity = 1,
  idleBadgeProminent = false,
  showIdleBadge = true,
  onPress,
}: {
  cx: number;
  cy: number;
  cityName: string;
  statusLabel: CityStatusLabel;
  borderColor: string;
  opacity: number;
  idleTruckCount?: number;
  idleBadgeOpacity?: number;
  idleBadgeProminent?: boolean;
  showIdleBadge?: boolean;
  onPress?: () => void;
}) {
  const x = cx - NODE_CARD_WIDTH / 2;
  const y = cy - NODE_CARD_HEIGHT / 2;

  return (
    <G opacity={opacity} onPress={onPress}>
      {showIdleBadge && idleTruckCount > 0 ? (
        <CityIdleTruckBadge
          cardX={x}
          cardY={y}
          count={idleTruckCount}
          opacity={idleBadgeOpacity}
          prominent={idleBadgeProminent}
        />
      ) : null}
      <Rect
        x={x}
        y={y}
        width={NODE_CARD_WIDTH}
        height={NODE_CARD_HEIGHT}
        rx={12}
        fill="#0F172A"
        stroke={borderColor}
        strokeWidth={1.5}
      />
      <SvgText
        x={cx}
        y={y + 18}
        fill="#F9FAFB"
        fontSize={11}
        fontWeight="700"
        textAnchor="middle"
      >
        {cityName}
      </SvgText>
      <SvgText
        x={cx}
        y={y + 32}
        fill="#94A3B8"
        fontSize={9}
        fontWeight="500"
        textAnchor="middle"
      >
        {statusLabel}
      </SvgText>
    </G>
  );
}

export default function NetworkMapCanvas({
  cities = [],
  routes = [],
  contracts = [],
  activeDeliveries = [],
  depotCityIds = [],
  idleTruckCountByCity,
  selectedFilter,
  featuredContract,
  selectedContract,
  selectedDeliveryId,
  onCityPress,
  onRoutePress,
  onContractPress,
  onDeliveryPress,
}: NetworkMapCanvasProps) {
  const { height: screenHeight } = useWindowDimensions();
  const canvasHeight = Math.min(500, Math.max(390, Math.round(screenHeight * 0.52)));

  const [layout, setLayout] = useState({ width: 0, height: canvasHeight });

  const runningDeliveries = useMemo(
    () => (activeDeliveries ?? []).filter((d) => ACTIVE_DELIVERY_STATUSES.includes(d.status)),
    [activeDeliveries],
  );

  const availableContracts = useMemo(
    () => (contracts ?? []).filter((c) => c.status === 'available'),
    [contracts],
  );

  const animatedProgress = useAnimatedDeliveryProgress(runningDeliveries);
  const depotSet = useMemo(() => new Set((depotCityIds ?? []).map(normalizeCityId)), [depotCityIds]);
  const showIdleBadges = getFilterShowsIdleBadges(selectedFilter);
  const idleBadgeOpacity = getFilterIdleBadgeOpacity(selectedFilter);
  const idleBadgeProminent = selectedFilter === 'trucks';

  const highlightContract = featuredContract ?? null;

  const mapCities = useMemo(
    () => (cities ?? []).filter((city) => getNetworkCityPosition(city.id) != null),
    [cities],
  );

  const routeDrawModels = useMemo((): RouteDrawModel[] => {
    if (layout.width <= 0 || layout.height <= 0) return [];

    const pairMap = new Map<
      string,
      { id: string; fromCityId: string; toCityId: string; maxDifficulty: number; contractId?: string }
    >();

    for (const route of routes ?? []) {
      const key = getRoutePairKey(route.fromCityId, route.toCityId);
      const existing = pairMap.get(key);

      const matchingContracts = availableContracts.filter((c) =>
        routesMatchCityPair(route.fromCityId, route.toCityId, c.originCityId, c.destinationCityId),
      );
      const topContract = [...matchingContracts].sort((a, b) => b.payment - a.payment)[0];

      if (!existing) {
        pairMap.set(key, {
          id: route.id,
          fromCityId: route.fromCityId,
          toCityId: route.toCityId,
          maxDifficulty: route.difficulty,
          contractId: topContract?.id,
        });
      } else {
        existing.maxDifficulty = Math.max(existing.maxDifficulty, route.difficulty);
        if (topContract) {
          const current = existing.contractId
            ? availableContracts.find((c) => c.id === existing.contractId)
            : undefined;
          if (!current || topContract.payment > current.payment) {
            existing.contractId = topContract.id;
          }
        }
      }
    }

    const models: RouteDrawModel[] = [];

    for (const merged of pairMap.values()) {
      const from = getCityPixelPosition(merged.fromCityId, layout.width, layout.height);
      const to = getCityPixelPosition(merged.toCityId, layout.width, layout.height);
      if (!from || !to) continue;

      const isActive = runningDeliveries.some((d) =>
        routesMatchCityPair(merged.fromCityId, merged.toCityId, d.originCityId, d.destinationCityId),
      );

      const isOpportunity =
        highlightContract != null &&
        routesMatchCityPair(
          merged.fromCityId,
          merged.toCityId,
          highlightContract.originCityId,
          highlightContract.destinationCityId,
        );

      const isRisky = !isActive && !isOpportunity && merged.maxDifficulty >= RISKY_ROUTE_THRESHOLD;

      let kind: RouteVisualKind = 'normal';
      if (isActive) {
        kind = 'active';
      } else if (isOpportunity) {
        kind = 'opportunity';
      } else if (isRisky) {
        kind = 'risky';
      }

      const opacity = getFilterRouteOpacity(selectedFilter, kind);

      models.push({
        id: merged.id,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        kind,
        opacity,
        contractId: merged.contractId,
      });
    }

    return models;
  }, [
    availableContracts,
    highlightContract,
    layout.height,
    layout.width,
    routes,
    runningDeliveries,
    selectedFilter,
  ]);

  const truckMarkers = useMemo((): TruckMarkerModel[] => {
    if (layout.width <= 0 || layout.height <= 0 || selectedFilter === 'depots') return [];

    return runningDeliveries
      .map((delivery) => {
        const start = getCityPixelPosition(delivery.originCityId, layout.width, layout.height);
        const end = getCityPixelPosition(delivery.destinationCityId, layout.width, layout.height);
        if (!start || !end) return null;

        const progress = animatedProgress.get(delivery.id) ?? clamp(delivery.progress, 0, 1);
        const point =
          delivery.status === 'preparing'
            ? start
            : getDeliveryPixelPosition({ ...delivery, progress }, layout.width, layout.height);
        if (!point) return null;

        return {
          key: `truck-${delivery.id}`,
          x: point.x,
          y: point.y,
          progress,
          deliveryId: delivery.id,
          isSelected: delivery.id === selectedDeliveryId,
        };
      })
      .filter((marker): marker is TruckMarkerModel => marker != null);
  }, [animatedProgress, layout.height, layout.width, runningDeliveries, selectedDeliveryId, selectedFilter]);

  const opportunityMarkers = useMemo((): OpportunityMarkerModel[] => {
    if (layout.width <= 0 || layout.height <= 0 || !selectedContract) return [];
    if (selectedFilter === 'trucks' || selectedFilter === 'depots') return [];

    const start = getCityPixelPosition(selectedContract.originCityId, layout.width, layout.height);
    const end = getCityPixelPosition(selectedContract.destinationCityId, layout.width, layout.height);
    if (!start || !end) return [];

    const mid = getPointOnLine(start, end, 0.5);

    return [
      {
        key: `opp-${selectedContract.id}`,
        x: mid.x,
        y: mid.y,
        contractId: selectedContract.id,
        label: '$',
      },
    ];
  }, [layout.height, layout.width, selectedContract, selectedFilter]);

  const ready = layout.width > 0 && layout.height > 0;

  return (
    <View
      style={[styles.container, { minHeight: canvasHeight }]}
      onLayout={(event) => {
        const { width } = event.nativeEvent.layout;
        if (width > 0) {
          setLayout({ width, height: canvasHeight });
        }
      }}
    >
      {ready ? (
        <Svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
          <Rect x={0} y={0} width={layout.width} height={layout.height} fill={CANVAS_BG} rx={20} />
          <NetworkGrid width={layout.width} height={layout.height} />

          {routeDrawModels.map((route) => {
            const style = ROUTE_STYLES[route.kind];
            return (
              <Line
                key={route.id}
                x1={route.x1}
                y1={route.y1}
                x2={route.x2}
                y2={route.y2}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeLinecap="round"
                opacity={route.opacity}
                onPress={() => {
                  onRoutePress?.(route.id);
                  if (route.contractId) onContractPress?.(route.contractId);
                }}
              />
            );
          })}

          {mapCities.map((city) => {
            const point = getCityPixelPosition(city.id, layout.width, layout.height);
            if (!point) return null;

            const hasDepot = depotSet.has(normalizeCityId(city.id));
            const statusLabel = getCityStatusLabel(city, hasDepot);
            const borderColor = getCityBorderColor(statusLabel);
            const opacity = getFilterCityOpacity(selectedFilter, hasDepot);
            const idleTruckCount = idleTruckCountByCity?.[normalizeCityId(city.id)] ?? 0;

            return (
              <CityNodeCard
                key={city.id}
                cx={point.x}
                cy={point.y}
                cityName={city.name}
                statusLabel={statusLabel}
                borderColor={borderColor}
                opacity={opacity}
                idleTruckCount={idleTruckCount}
                idleBadgeOpacity={idleBadgeOpacity}
                idleBadgeProminent={idleBadgeProminent}
                showIdleBadge={showIdleBadges}
                onPress={() => onCityPress?.(city.id)}
              />
            );
          })}

          {truckMarkers.map((marker) => (
            <G
              key={marker.key}
              onPress={() => onDeliveryPress?.(marker.deliveryId)}
            >
              <Circle
                cx={marker.x}
                cy={marker.y}
                r={15}
                fill="#020617"
                stroke="#38BDF8"
                strokeWidth={marker.isSelected ? 2.5 : 1.8}
              />
              <SvgText
                x={marker.x}
                y={marker.y + 4}
                fill="#38BDF8"
                fontSize={11}
                fontWeight="700"
                textAnchor="middle"
              >
                🚚
              </SvgText>
              <SvgText
                x={marker.x}
                y={marker.y - 20}
                fill="#E2E8F0"
                fontSize={10}
                fontWeight="700"
                textAnchor="middle"
              >
                {`${Math.round(marker.progress * 100)}%`}
              </SvgText>
            </G>
          ))}

          {opportunityMarkers.map((marker) => (
            <G
              key={marker.key}
              onPress={() => onContractPress?.(marker.contractId)}
            >
              <Circle cx={marker.x} cy={marker.y} r={12} fill="#020617" stroke="#F59E0B" strokeWidth={1.8} />
              <SvgText
                x={marker.x}
                y={marker.y + 4}
                fill="#F59E0B"
                fontSize={11}
                fontWeight="800"
                textAnchor="middle"
              >
                {marker.label}
              </SvgText>
            </G>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: CANVAS_BG,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: CANVAS_BORDER,
    padding: 12,
    overflow: 'hidden',
  },
});
