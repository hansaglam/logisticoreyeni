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
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Canvas, Circle, Group, Line, LinearGradient, Path, RadialGradient, RoundedRect, matchFont, rect, rrect, Text as SkiaText, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedReaction, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import type { GeometryLodId } from '../geo/geometry';
import { pointInProjectedPolygons } from '../geo/geometry';
import {
  CAMERA_FOCUS_MS,
  FULL_WORLD_CONTENT_BOUNDS,
  WORLD_DOUBLE_TAP_ZOOM,
  WORLD_GESTURE_SNAP_MS,
  WORLD_INHABITED_BOUNDS,
  WORLD_MAX_SCALE,
  WORLD_MIN_SCALE_FACTOR,
  cameraToFitBounds,
  clampWorldCamera,
  contentFitScale,
  getVisibleWorldBounds,
  screenToWorld,
  worldToScreen,
  worldFitScale,
  zoomToFocal,
  type CameraContentBounds,
  type CameraSnapshot,
} from '../geo/worldCamera';
import type { ProjectedBoundingBox } from '../geo/webMercator';
import { dequantizePolygons } from '../geo/worldBoundaryPackage';
import type { GeoCityRecord } from '../geo/cityPackage';
import type { CountryPaint } from '../presentation/countryPaint';
import { MAP_V2_OCEAN, MAP_V2_OCEAN_DEEP, MAP_V2_STARTER_GLOW } from '../presentation/countryPaint';
import { paintForTransportStyle } from '../presentation/transportPaint';
import {
  ROAD_OVERVIEW_CORRIDOR_STYLES,
  ROAD_RENDER_PROFILE_DEBUG,
  resolveRoadDrawPlan,
  type RoadDrawPlan,
  type RoadRenderProfile,
} from '../presentation/roadRenderProfile';
import {
  CITY_LABEL_DEFAULT,
  CITY_LABEL_SELECTED,
  CITY_MARKER_GLOW,
  CITY_MARKER_LEGACY_HALO,
  CITY_MARKER_RADIUS_PX,
  CITY_NODE_CAPITAL,
  CITY_NODE_DEFAULT,
  CITY_NODE_HINT,
  CITY_NODE_LOCKED,
  CITY_NODE_SELECTED,
  cityDashboardCoreFill,
  cityDashboardHubFill,
  cityDashboardLabelNeedsConnector,
  cityDashboardLabelOffset,
  cityLabelFill,
} from '../presentation/cityPaint';
import type { CityAvailabilityState } from '../gameplay/cityProgression';
import {
  COUNTRY_DASHBOARD_COAST,
  COUNTRY_DASHBOARD_COAST_UNDER,
  COUNTRY_DASHBOARD_COAST_UNDER_WIDTH,
  COUNTRY_DASHBOARD_COAST_WIDTH,
  COUNTRY_DASHBOARD_FILL,
  COUNTRY_DASHBOARD_INNER,
  COUNTRY_DASHBOARD_INNER_WIDTH,
  COUNTRY_DASHBOARD_OCEAN,
  COUNTRY_DASHBOARD_RIDGE,
  COUNTRY_DASHBOARD_RIDGE_WIDTH,
  countryDashboardGradientPoints,
  countryDashboardInnerHighlight,
  countryDashboardRidgeBands,
  countryDashboardTintCenters,
} from '../presentation/countryDashboardPaint';
import { corridorInteractionPaint } from '../presentation/countryCorridorPaint';
import { railCorridorInteractionPaint } from '../presentation/countryRailCorridorPaint';
import { seaCorridorInteractionPaint } from '../presentation/countrySeaCorridorPaint';
import { airCorridorInteractionPaint } from '../presentation/countryAirCorridorPaint';
import {
  buildWorldCountryLabel,
  selectWorldCountryLabels,
  worldLabelTierForRelativeZoom,
  type WorldCountryLabel,
  type WorldLabelTier,
} from '../presentation/worldCountryLabel';
import { resolveCountryGameplayAvailability } from '../gameplay/mapV2CountryAvailability.fixture';
import { getCountryRecord, getRenderableCountries, getVisibleCountryGeometry, getWorldBoundaryPackage } from './worldBoundaryLoader';
import { getCountryPath } from './worldPathCache';
import { getWorldDecorGridPath } from './worldDecorGrid';
import { peekRoadChunkStylePath, peekRoadOverviewStylePath, buildRoadChunkStylePath, buildRoadOverviewStylePath } from './roadPathCache';
import { composeCorridorBatchPath } from './countryCorridorPathCache';
import { composeRailCorridorBatchPath } from './countryRailCorridorPathCache';
import { composeSeaCorridorBatchPath } from './countrySeaCorridorPathCache';
import { composeAirCorridorBatchPath } from './countryAirCorridorPathCache';
import { getRailDebugBatchPath, RAIL_DEBUG_STYLE_ORDER } from './railDebugPathCache';
import { getRailDebugView } from './transportNetworkLoader';
import { getTurkeyPlayerRoadCorridors } from './countryRoadCorridorLoader';
import { getTurkeyPlayerRailCorridors } from './countryRailCorridorLoader';
import { getTurkeyPlayerSeaCorridors } from './countrySeaCorridorLoader';
import { getTurkeyPlayerAirCorridors } from './countryAirCorridorLoader';
import {
  connectedNeighborGeoCityIds,
  COUNTRY_CORRIDOR_INTERACTION_DRAW_ORDER,
  COUNTRY_CORRIDOR_SELECTION_FADE_MS,
  groupCorridorsByInteractionState,
} from '../gameplay/countryCorridorInteraction';
import {
  groupRailCorridorsByInteractionState,
  RAIL_CORRIDOR_INTERACTION_DRAW_ORDER,
} from '../gameplay/countryRailCorridorInteraction';
import {
  groupSeaCorridorsByInteractionState,
  SEA_CORRIDOR_INTERACTION_DRAW_ORDER,
} from '../gameplay/countrySeaCorridorInteraction';
import {
  groupAirCorridorsByInteractionState,
  AIR_CORRIDOR_INTERACTION_DRAW_ORDER,
} from '../gameplay/countryAirCorridorInteraction';
import {
  getLoadedRoadChunkStats,
  getRoadRuntimeManifest,
  peekLoadedRoadChunk,
  requiredPlusPrefetchIds,
} from './roadChunkLoader';
import {
  markCountryInteractive,
  markCountrySceneMount,
  markFirstRoadPaint,
  requestRoadChunkLoads,
  setRoadGestureActive,
  setRoadSchedulerHooks,
  getRoadPerfSnapshot,
  cancelStaleRoadLoads,
} from './roadLoadScheduler';
import { getRoadOverviewLow } from './roadOverviewLoader';
import { ROAD_STYLE_FROM_CODE } from '../geo/roadRuntimePackage';
import { networkLodForRelativeZoom } from '../geo/networkLodAuto';
import type { TransportNetworkLod } from '../geo/transportNetwork';
import { lodGeometryTotals, resolveLoadedLod, selectDrawCountryIds } from './worldViewerFrame';
import {
  cityLodForVisibleWorldSpan,
  filterVisibleCities,
  hitTestCity,
  selectCityLabelIds,
} from './cityViewerFrame';

export type WorldGeometryHud = {
  zoom: number;
  selectedLod: GeometryLodId | 'AUTO';
  loadedLod: GeometryLodId;
  visibleCountries: number;
  visiblePolygons: number;
  renderedPaths: number;
  renderedPolygons: number;
  renderedVertices: number;
  totalPathsForLod: number;
  totalPolygonsForLod: number;
  totalVerticesForLod: number;
  countryCount: number;
  sourceCountries: number;
  renderedCountries: number;
  polarPolicy: string;
  omittedPolarFeatures: string[];
  culling: 'ON' | 'OFF';
  roadLod?: TransportNetworkLod | 'AUTO' | 'NONE';
  totalEdges?: number;
  visibleEdges?: number;
  renderedEdges?: number;
  pathBatchCount?: number;
  nodeCount?: number;
  requiredChunks?: number;
  loadedChunks?: number;
  visibleChunks?: number;
  cacheSizeEstimate?: number;
  evictions?: number;
  roadMode?: 'OFF' | 'OVERVIEW' | 'CHUNKS' | 'NONE';
  roadLoading?: boolean;
  firstRoadPaintMs?: number;
  timeToInteractiveMs?: number;
};

export type MapV2GeographicCanvasHandle = {
  captureCamera: () => CameraSnapshot;
  applyHome: (animate?: boolean) => void;
  applyBounds: (bounds: ProjectedBoundingBox, padding?: number, animate?: boolean) => void;
  restoreCamera: (snapshot: CameraSnapshot, animate?: boolean) => void;
};

export type MapV2CityLayer = {
  cities: GeoCityRecord[];
  selectedCityId: string | null;
  mappedGeoCityIds: readonly string[];
  showLegacyHalo: boolean;
  onSelectCity: (geoCityId: string | null) => void;
  resolveLabel: (city: GeoCityRecord) => string;
  presentation?: 'DEFAULT' | 'DASHBOARD';
  /** Lightweight visual hints only. Never a gameplay store. */
  operationHints?: Readonly<Record<string, 'HOME' | 'WAREHOUSE' | 'ACTIVE' | 'NONE'>>;
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>;
};

export type MapV2PlayerCorridorLayer = {
  enabled: boolean;
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>;
  reduceMotion?: boolean;
};

export type MapV2PlayerRailCorridorLayer = {
  enabled: boolean;
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>;
  reduceMotion?: boolean;
};

export type MapV2PlayerSeaCorridorLayer = {
  enabled: boolean;
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>;
  reduceMotion?: boolean;
};

export type MapV2PlayerAirCorridorLayer = {
  enabled: boolean;
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>;
  reduceMotion?: boolean;
};

export type MapV2RoadLayer = {
  lodOverride: TransportNetworkLod | 'AUTO';
  cullEnabled: boolean;
  roadsEnabled?: boolean;
  renderProfile?: RoadRenderProfile;
};

export type MapV2RailDebugLayer = {
  enabled: boolean;
  lodOverride: TransportNetworkLod | 'AUTO';
  showStations?: boolean;
};

export type MapV2DevPortMarker = {
  id: string;
  x: number;
  y: number;
  eligibility: 'LOGISTICS_ELIGIBLE' | 'PASSENGER_ONLY' | 'LOCAL_MARITIME' | 'NON_LOGISTICS' | 'UNRESOLVED';
  selected?: boolean;
};

export type MapV2DevPortLayer = {
  enabled: boolean;
  markers: readonly MapV2DevPortMarker[];
  associationLines?: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>;
  maritimeEdges?: ReadonlyArray<{
    edgeId: string;
    channel: 'BOSPHORUS' | 'DARDANELLES' | null;
    layer?: 'TRUNK' | 'APPROACH' | 'CHANNEL';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
  seaAccessMarkers?: ReadonlyArray<{ id: string; x: number; y: number; unresolved: boolean }>;
  accessLines?: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>;
  smokePaths?: ReadonlyArray<{ id: string; points: ReadonlyArray<{ x: number; y: number }> }>;
  onSelect?: (portId: string | null) => void;
};

export type MapV2DevAirportMarker = {
  id: string;
  x: number;
  y: number;
  eligibility: 'LOGISTICS_ELIGIBLE' | 'LOGISTICS_ELIGIBLE_PREVIEW' | 'PASSENGER_ONLY' | 'NON_LOGISTICS' | 'MILITARY_RESTRICTED' | 'UNRESOLVED';
  selected?: boolean;
};

export type MapV2DevAirportLayer = {
  enabled: boolean;
  markers: readonly MapV2DevAirportMarker[];
  associationLines?: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>;
  runways?: ReadonlyArray<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
  onSelect?: (airportId: string | null) => void;
};

type Props = {
  selectedId: string | null;
  lodOverride: GeometryLodId | 'AUTO';
  cullEnabled: boolean;
  onSelect: (geoCountryId: string | null) => void;
  onHud?: (hud: WorldGeometryHud) => void;
  getCountryPaint: (geoCountryId: string, selected: boolean) => CountryPaint;
  homePolicy?: 'FULL_WORLD' | 'INHABITED';
  maxScaleFactor?: number;
  minScaleFactor?: number;
  contentBounds?: CameraContentBounds | null;
  forcedDrawIds?: string[] | null;
  hitTestIds?: string[] | null;
  cityLayer?: MapV2CityLayer | null;
  roadLayer?: MapV2RoadLayer | null;
  playerCorridorLayer?: MapV2PlayerCorridorLayer | null;
  playerRailCorridorLayer?: MapV2PlayerRailCorridorLayer | null;
  playerSeaCorridorLayer?: MapV2PlayerSeaCorridorLayer | null;
  playerAirCorridorLayer?: MapV2PlayerAirCorridorLayer | null;
  railDebugLayer?: MapV2RailDebugLayer | null;
  devPortLayer?: MapV2DevPortLayer | null;
  devAirportLayer?: MapV2DevAirportLayer | null;
  /** Country overview: no rubber-band. World: elastic overshoot ok. */
  elasticGestures?: boolean;
  mapGesturesEnabled?: boolean;
  countryVisualProfile?: 'DEFAULT' | 'DASHBOARD';
  viewportClip?: 'NONE' | 'ROUNDED';
};

function cityLabelFont(weight: 'normal' | 'bold' = 'normal') {
  try {
    return matchFont({
      fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }) ?? 'sans-serif',
      fontSize: CITY_LABEL_DEFAULT.fontSize,
      fontWeight: weight,
      fontStyle: 'normal',
    });
  } catch {
    return null;
  }
}

function MapV2GeographicCanvasInner(
  {
    selectedId,
    lodOverride,
    cullEnabled,
    onSelect,
    onHud,
    getCountryPaint,
    homePolicy = 'FULL_WORLD',
    maxScaleFactor = WORLD_MAX_SCALE,
    minScaleFactor = WORLD_MIN_SCALE_FACTOR,
    contentBounds = null,
    forcedDrawIds = null,
    hitTestIds = null,
    cityLayer = null,
    roadLayer = null,
    playerCorridorLayer = null,
    playerRailCorridorLayer = null,
    playerSeaCorridorLayer = null,
    playerAirCorridorLayer = null,
    railDebugLayer = null,
    devPortLayer = null,
    devAirportLayer = null,
    elasticGestures = true,
    mapGesturesEnabled = true,
    countryVisualProfile = 'DEFAULT',
    viewportClip = 'NONE',
  }: Props,
  ref: React.Ref<MapV2GeographicCanvasHandle>,
) {
  const pkg = useMemo(() => getWorldBoundaryPackage(), []);
  const renderable = useMemo(() => getRenderableCountries(), [pkg]);
  const allIds = useMemo(() => renderable.map((c) => c.geoCountryId), [renderable]);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [visibleIds, setVisibleIds] = useState<string[]>(allIds);
  const [activeLod, setActiveLod] = useState<GeometryLodId>('WORLD_LOW');
  const fittedRef = useRef(false);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  const maxScaleSv = useSharedValue(maxScaleFactor);
  const minScaleSv = useSharedValue(minScaleFactor);
  const elasticSv = useSharedValue(elasticGestures ? 1 : 0);
  const boundMinX = useSharedValue(FULL_WORLD_CONTENT_BOUNDS.minX);
  const boundMinY = useSharedValue(FULL_WORLD_CONTENT_BOUNDS.minY);
  const boundMaxX = useSharedValue(FULL_WORLD_CONTENT_BOUNDS.maxX);
  const boundMaxY = useSharedValue(FULL_WORLD_CONTENT_BOUNDS.maxY);
  const pinchActive = useSharedValue(false);
  const panConsumed = useSharedValue(false);
  const lastHudAt = useSharedValue(0);
  const markerInvScale = useDerivedValue(() => [{ scale: 1 / Math.max(scale.value, 0.0001) }]);
  const lodOverrideRef = useRef(lodOverride);
  lodOverrideRef.current = lodOverride;
  const cullRef = useRef(cullEnabled);
  cullRef.current = cullEnabled;
  const lodRef = useRef(activeLod);
  lodRef.current = activeLod;
  const forcedRef = useRef(forcedDrawIds);
  forcedRef.current = forcedDrawIds;
  const hitRef = useRef(hitTestIds);
  hitRef.current = hitTestIds;
  const cityLayerRef = useRef(cityLayer);
  cityLayerRef.current = cityLayer;
  const portLayerRef = useRef(devPortLayer);
  portLayerRef.current = devPortLayer;
  const airportLayerRef = useRef(devAirportLayer);
  airportLayerRef.current = devAirportLayer;
  const roadLayerRef = useRef(roadLayer);
  roadLayerRef.current = roadLayer;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const viewportClipRef = useRef(viewportClip);
  viewportClipRef.current = viewportClip;
  const contentBoundsRef = useRef(contentBounds);
  contentBoundsRef.current = contentBounds;
  const roadLodRef = useRef<TransportNetworkLod>('NETWORK_LOW');
  const roadChunkIdsRef = useRef<string[]>([]);
  const roadFade = useSharedValue(0);
  const corridorFade = useSharedValue(0);
  const railCorridorFade = useSharedValue(0);
  const seaCorridorFade = useSharedValue(0);
  const airCorridorFade = useSharedValue(0);
  const roadRevealReadyRef = useRef(false);
  const [cityDrawIds, setCityDrawIds] = useState<string[]>([]);
  const [cityLabelIdSet, setCityLabelIdSet] = useState<ReadonlySet<string>>(new Set());
  const [roadChunkIds, setRoadChunkIds] = useState<string[]>([]);
  const [activeRoadLod, setActiveRoadLod] = useState<TransportNetworkLod>('NETWORK_LOW');
  const [roadPaintRev, setRoadPaintRev] = useState(0);
  const [roadMode, setRoadMode] = useState<'OFF' | 'OVERVIEW' | 'CHUNKS' | 'NONE'>('NONE');
  const [worldLabels, setWorldLabels] = useState<WorldCountryLabel[]>([]);
  const worldLabelTierRef = useRef<WorldLabelTier>('WORLD_LABEL_MAJOR');
  const labelLayoutKeyRef = useRef('');
  const [roadDrawPlan, setRoadDrawPlan] = useState<RoadDrawPlan | null>(null);
  const overviewModeRef = useRef(true);
  const overviewQueuedRef = useRef(false);
  const overviewBuildCompleteRef = useRef(false);
  const cityById = useMemo(() => {
    const map = new Map<string, GeoCityRecord>();
    for (const city of cityLayer?.cities ?? []) map.set(city.geoCityId, city);
    return map;
  }, [cityLayer?.cities]);
  const mappedSet = useMemo(() => new Set(cityLayer?.mappedGeoCityIds ?? []), [cityLayer?.mappedGeoCityIds]);
  const font = useMemo(() => cityLabelFont(), []);
  const fontBold = useMemo(() => cityLabelFont('bold'), []);

  useEffect(() => {
    markCountrySceneMount();
    const tti = requestAnimationFrame(() => markCountryInteractive());
    const quantize = () => getRoadRuntimeManifest().quantization;
    setRoadSchedulerHooks({
      onUpdate: () => {
        markFirstRoadPaint();
        setRoadPaintRev((value) => value + 1);
      },
      pathBuilder: (chunk, styleCode) => {
        const style = ROAD_STYLE_FROM_CODE[styleCode];
        if (!style) return false;
        return buildRoadChunkStylePath(chunk, chunk.lod, style, quantize());
      },
    });
    return () => {
      cancelAnimationFrame(tti);
      setRoadSchedulerHooks({});
      cancelStaleRoadLoads();
    };
  }, []);

  useEffect(() => {
    maxScaleSv.value = maxScaleFactor;
    minScaleSv.value = minScaleFactor;
    elasticSv.value = elasticGestures ? 1 : 0;
    const box = contentBounds ?? FULL_WORLD_CONTENT_BOUNDS;
    boundMinX.value = box.minX;
    boundMinY.value = box.minY;
    boundMaxX.value = box.maxX;
    boundMaxY.value = box.maxY;
  }, [
    boundMaxX,
    boundMaxY,
    boundMinX,
    boundMinY,
    contentBounds,
    maxScaleFactor,
    maxScaleSv,
    minScaleFactor,
    minScaleSv,
    elasticGestures,
    elasticSv,
  ]);

  const applyCamera = useCallback(
    (next: CameraSnapshot, animate: boolean) => {
      const box = contentBounds ?? FULL_WORLD_CONTENT_BOUNDS;
      const clamped = clampWorldCamera({
        scale: next.scale,
        translateX: next.translateX,
        translateY: next.translateY,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        elastic: false,
        maxScaleFactor,
        minScaleFactor,
        contentBounds: box,
      });
      const duration = animate ? CAMERA_FOCUS_MS : 0;
      scale.value = animate ? withTiming(clamped.scale, { duration }) : clamped.scale;
      translateX.value = animate ? withTiming(clamped.translateX, { duration }) : clamped.translateX;
      translateY.value = animate ? withTiming(clamped.translateY, { duration }) : clamped.translateY;
    },
    [
      contentBounds,
      maxScaleFactor,
      minScaleFactor,
      scale,
      translateX,
      translateY,
      viewport.height,
      viewport.width,
    ],
  );

  const applyHome = useCallback(
    (animate = false) => {
      if (viewport.width <= 0 || viewport.height <= 0) return;
      if (homePolicy === 'INHABITED') {
        applyCamera(
          cameraToFitBounds({
            ...WORLD_INHABITED_BOUNDS,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
            padding: 0.04,
            maxScaleFactor,
            minScaleFactor,
            contentBounds: contentBounds ?? FULL_WORLD_CONTENT_BOUNDS,
          }),
          animate,
        );
        return;
      }
      const nextScale = worldFitScale(viewport.width, viewport.height) * 1.12;
      applyCamera(
        clampWorldCamera({
          scale: nextScale,
          translateX: (viewport.width - nextScale) / 2,
          translateY: (viewport.height - nextScale) / 2,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          elastic: false,
          maxScaleFactor,
          minScaleFactor,
          contentBounds: contentBounds ?? FULL_WORLD_CONTENT_BOUNDS,
        }),
        animate,
      );
    },
    [applyCamera, contentBounds, homePolicy, maxScaleFactor, minScaleFactor, viewport.height, viewport.width],
  );

  const applyBounds = useCallback(
    (bounds: ProjectedBoundingBox, padding = 0.18, animate = true) => {
      if (viewport.width <= 0 || viewport.height <= 0) return;
      applyCamera(
        cameraToFitBounds({
          ...bounds,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          padding,
          maxScaleFactor,
          minScaleFactor,
          contentBounds: contentBounds ?? FULL_WORLD_CONTENT_BOUNDS,
        }),
        animate,
      );
    },
    [applyCamera, contentBounds, maxScaleFactor, minScaleFactor, viewport.height, viewport.width],
  );

  useImperativeHandle(
    ref,
    () => ({
      captureCamera: () => ({
        scale: scale.value,
        translateX: translateX.value,
        translateY: translateY.value,
      }),
      applyHome,
      applyBounds,
      restoreCamera: (snapshot, animate = true) => applyCamera(snapshot, animate),
    }),
    [applyBounds, applyCamera, applyHome, scale, translateX, translateY],
  );

  const publishHud = useCallback(
    (cam: { x: number; y: number; s: number; w: number; h: number }) => {
      if (cam.w <= 0 || cam.h <= 0) return;
      const override = lodOverrideRef.current;
      const cullOn = cullRef.current;
      const lod = resolveLoadedLod(override, cam.s, cam.w, cam.h);
      const bounds = getVisibleWorldBounds(cam.x, cam.y, cam.s, cam.w, cam.h, 0.01);
      const visible = getVisibleCountryGeometry(bounds, lod);
      const visibleIdsNext = visible.map((c) => c.geoCountryId);
      const drawn = forcedRef.current
        ? renderable.filter((c) => forcedRef.current!.includes(c.geoCountryId))
        : cullOn
          ? visible
          : renderable;
      const visibleStats = lodGeometryTotals(visible, lod);
      const drawnStats = lodGeometryTotals(drawn, lod);
      const totalStats = lodGeometryTotals(renderable, lod);
      setVisibleIds(visibleIdsNext);
      setActiveLod(lod);
      lodRef.current = lod;
      const layer = cityLayerRef.current;
      if (layer && layer.cities.length > 0) {
        const cityLod = cityLodForVisibleWorldSpan(bounds);
        const cityVisible = filterVisibleCities(
          layer.cities,
          cityLod,
          bounds,
          layer.selectedCityId,
          new Set(layer.mappedGeoCityIds),
        );
        const labels =
          layer.presentation === 'DASHBOARD'
            ? cityVisible.map((city) => city.geoCityId)
            : selectCityLabelIds(
                cityVisible,
                cityLod,
                layer.selectedCityId,
                new Set(layer.mappedGeoCityIds),
                cam.x,
                cam.y,
                cam.s,
              );
        setCityDrawIds(cityVisible.map((city) => city.geoCityId));
        setCityLabelIdSet(new Set(labels));
      } else {
        setCityDrawIds((prev) => (prev.length === 0 ? prev : []));
        setCityLabelIdSet((prev) => (prev.size === 0 ? prev : new Set()));
      }
      if (viewportClipRef.current === 'ROUNDED') {
        const fit = worldFitScale(cam.w, cam.h);
        const relZoom = fit <= 0 ? 1 : cam.s / fit;
        const tier = worldLabelTierForRelativeZoom(relZoom, worldLabelTierRef.current);
        worldLabelTierRef.current = tier;
        const selected = selectedIdRef.current;
        const inset = 18;
        const candidates = visible.map((country) =>
          buildWorldCountryLabel(
            country,
            resolveCountryGameplayAvailability(country.geoCountryId),
            country.geoCountryId === selected,
            'tr',
          ),
        );
        const placed = selectWorldCountryLabels({
          labels: candidates,
          viewTier: tier,
          translateX: cam.x,
          translateY: cam.y,
          scale: cam.s,
          clip: { minX: inset, minY: inset, maxX: cam.w - inset, maxY: cam.h - inset },
        });
        const key = `${tier}:${selected ?? ''}:${Math.round(cam.x / 10)}:${Math.round(cam.y / 10)}:${Math.round(cam.s * 6)}:${placed.map((row) => row.geoCountryId).join(',')}`;
        if (key !== labelLayoutKeyRef.current) {
          labelLayoutKeyRef.current = key;
          setWorldLabels(placed);
        }
      } else if (labelLayoutKeyRef.current !== '') {
        labelLayoutKeyRef.current = '';
        setWorldLabels((prev) => (prev.length === 0 ? prev : []));
      }
      const overlay = roadLayerRef.current;
      let roadLodHud: TransportNetworkLod | 'AUTO' | 'NONE' = 'NONE';
      let totalEdges = 0;
      let visibleEdges = 0;
      let renderedEdges = 0;
      let pathBatchCount = 0;
      let nodeCount = 0;
      let requiredChunksHud = 0;
      let loadedChunksHud = 0;
      let visibleChunksHud = 0;
      let cacheBytesHud = 0;
      let evictionsHud = 0;
      let hudRoadMode: 'OFF' | 'OVERVIEW' | 'CHUNKS' | 'NONE' = 'NONE';
      const worldFit = worldFitScale(cam.w, cam.h);
      const boundsForFit = contentBoundsRef.current;
      const contentFit = boundsForFit ? contentFitScale(cam.w, cam.h, boundsForFit) : worldFit;
      const roadRelZoom = contentFit <= 0 ? 1 : cam.s / contentFit;
      const hudZoom = roadRelZoom;
      if (overlay && overlay.roadsEnabled !== false) {
        const profile = overlay.renderProfile ?? ROAD_RENDER_PROFILE_DEBUG;
        const nextRoadLod =
          overlay.lodOverride === 'AUTO'
            ? networkLodForRelativeZoom(roadRelZoom, roadLodRef.current)
            : overlay.lodOverride;
        roadLodRef.current = nextRoadLod;
        setActiveRoadLod(nextRoadLod);
        const plan = resolveRoadDrawPlan(profile, roadRelZoom, overlay.lodOverride, overviewModeRef.current);
        overviewModeRef.current = plan.useOverview;
        setRoadDrawPlan(plan);
        const hudMode: 'OFF' | 'OVERVIEW' | 'CHUNKS' | 'NONE' = plan.useChunks && !plan.keepOverviewCorridors ? 'CHUNKS' : 'OVERVIEW';
        setRoadMode(hudMode);
        hudRoadMode = hudMode;
        const runtime = getRoadRuntimeManifest();
        const stats = getLoadedRoadChunkStats();
        const perf = getRoadPerfSnapshot();
        totalEdges =
          nextRoadLod === 'NETWORK_LOW'
            ? runtime.totalCounts.edgesLow
            : nextRoadLod === 'NETWORK_MEDIUM'
              ? runtime.totalCounts.edgesLow + runtime.totalCounts.edgesMediumAdditional
              : runtime.totalCounts.sourceEdges;
        nodeCount = runtime.totalCounts.sourceNodes;
        if (plan.useOverview) {
          if (!overviewQueuedRef.current) {
            overviewQueuedRef.current = true;
            const stylesToBuild = [...plan.overviewStyles];
            setTimeout(() => {
              const overview = getRoadOverviewLow();
              if (!overview) return;
              const remaining = stylesToBuild;
              const step = () => {
                const style = remaining.shift();
                if (!style) {
                  overviewBuildCompleteRef.current = true;
                  setRoadPaintRev((value) => value + 1);
                  return;
                }
                if (buildRoadOverviewStylePath(overview, style)) markFirstRoadPaint();
                setRoadPaintRev((value) => value + 1);
                if (remaining.length > 0) setTimeout(step, 0);
                else {
                  overviewBuildCompleteRef.current = true;
                  setRoadPaintRev((value) => value + 1);
                }
              };
              step();
            }, 0);
          }
          requiredChunksHud = 0;
          visibleChunksHud = 0;
          pathBatchCount = plan.overviewStyles.filter((style) => peekRoadOverviewStylePath(style)).length;
          visibleEdges = runtime.overviewLow?.edgeCount ?? runtime.totalCounts.edgesLow;
          renderedEdges = visibleEdges;
        }
        if (plan.useChunks) {
          const { required, prefetch } = requiredPlusPrefetchIds(bounds, nextRoadLod, overlay.cullEnabled);
          const drawIds = overlay.cullEnabled ? required : prefetch;
          requestRoadChunkLoads(drawIds);
          const prev = roadChunkIdsRef.current;
          const same = prev.length === drawIds.length && prev.every((id, i) => id === drawIds[i]);
          if (!same) {
            roadChunkIdsRef.current = drawIds;
            setRoadChunkIds(drawIds);
          }
          requiredChunksHud = required.length;
          visibleChunksHud = drawIds.filter((id) => peekLoadedRoadChunk(id)).length;
          visibleEdges = drawIds.reduce((sum, id) => sum + (peekLoadedRoadChunk(id)?.e.length ?? 0), 0);
          renderedEdges = visibleEdges;
          pathBatchCount += drawIds.reduce((sum, id) => {
            const chunk = peekLoadedRoadChunk(id);
            if (!chunk) return sum;
            return sum + plan.chunkStyles.filter((style) => peekRoadChunkStylePath(id, chunk.lod, style)).length;
          }, 0);
        } else if (roadChunkIdsRef.current.length > 0) {
          cancelStaleRoadLoads();
          roadChunkIdsRef.current = [];
          setRoadChunkIds([]);
        }
        const motorwayReady = Boolean(peekRoadOverviewStylePath('ROAD_MOTORWAY'));
        const trunkReady = Boolean(peekRoadOverviewStylePath('ROAD_TRUNK'));
        const playerOverview = profile !== ROAD_RENDER_PROFILE_DEBUG;
        const roadsReady = playerOverview ? motorwayReady && trunkReady : motorwayReady || trunkReady || plan.useChunks;
        if (roadsReady && !roadRevealReadyRef.current) {
          roadRevealReadyRef.current = true;
          roadFade.value = withTiming(1, { duration: playerOverview ? 480 : 0 });
        }
        if (!playerOverview && roadsReady) {
          roadFade.value = 1;
          roadRevealReadyRef.current = true;
        }
        roadLodHud = overlay.lodOverride === 'AUTO' ? nextRoadLod : overlay.lodOverride;
        loadedChunksHud = stats.loadedChunkCount;
        cacheBytesHud = stats.loadedByteEstimate;
        evictionsHud = stats.evictionCount;
        void perf;
      } else if (overlay && overlay.roadsEnabled === false) {
        setRoadMode('OFF');
        hudRoadMode = 'OFF';
        overviewQueuedRef.current = false;
        overviewBuildCompleteRef.current = false;
        setRoadDrawPlan(null);
        roadRevealReadyRef.current = false;
        roadFade.value = 0;
        cancelStaleRoadLoads();
        if (roadChunkIdsRef.current.length > 0) {
          roadChunkIdsRef.current = [];
          setRoadChunkIds([]);
        }
      } else if (roadChunkIdsRef.current.length > 0) {
        setRoadMode('NONE');
        roadChunkIdsRef.current = [];
        setRoadChunkIds([]);
      }
      if (!onHud) return;
      onHud({
        zoom: hudZoom,
        selectedLod: override,
        loadedLod: lod,
        visibleCountries: visible.length,
        visiblePolygons: visibleStats.polygons,
        renderedPaths: drawnStats.paths,
        renderedPolygons: drawnStats.polygons,
        renderedVertices: drawnStats.vertices,
        totalPathsForLod: totalStats.paths,
        totalPolygonsForLod: totalStats.polygons,
        totalVerticesForLod: totalStats.vertices,
        countryCount: pkg.countries.length,
        sourceCountries: pkg.sourceCountryCount,
        renderedCountries: pkg.renderedCountryCount,
        polarPolicy: pkg.polarRenderPolicy,
        omittedPolarFeatures: pkg.omittedPolarFeatures.map((f) => f.sourceDisplayName),
        culling: overlay ? (overlay.cullEnabled ? 'ON' : 'OFF') : cullOn ? 'ON' : 'OFF',
        roadLod: roadLodHud,
        totalEdges,
        visibleEdges,
        renderedEdges,
        pathBatchCount,
        nodeCount,
        requiredChunks: requiredChunksHud,
        loadedChunks: loadedChunksHud,
        visibleChunks: visibleChunksHud,
        cacheSizeEstimate: cacheBytesHud,
        evictions: evictionsHud,
        roadMode: hudRoadMode,
        roadLoading: hudRoadMode === 'CHUNKS' && visibleChunksHud < requiredChunksHud,
        firstRoadPaintMs: getRoadPerfSnapshot().firstRoadPaintMs,
        timeToInteractiveMs: getRoadPerfSnapshot().timeToInteractiveMs,
      });
    },
    [onHud, pkg.countries.length, pkg.omittedPolarFeatures, pkg.polarRenderPolicy, pkg.renderedCountryCount, pkg.sourceCountryCount, renderable],
  );

  const syncFromCamera = useCallback(() => {
    publishHud({
      x: translateX.value,
      y: translateY.value,
      s: scale.value,
      w: vw.value,
      h: vh.value,
    });
  }, [publishHud, scale, translateX, translateY, vh, vw]);

  useEffect(() => {
    syncFromCamera();
  }, [cullEnabled, cityLayer, roadLayer, forcedDrawIds, lodOverride, syncFromCamera, viewport.height, viewport.width]);

  useEffect(() => {
    const overlay = roadLayerRef.current;
    if (!overlay || overlay.roadsEnabled === false) return;
    const profile = overlay.renderProfile ?? ROAD_RENDER_PROFILE_DEBUG;
    const motorway = Boolean(peekRoadOverviewStylePath('ROAD_MOTORWAY'));
    const trunk = Boolean(peekRoadOverviewStylePath('ROAD_TRUNK'));
    if (profile === ROAD_RENDER_PROFILE_DEBUG) {
      if (motorway || trunk || roadChunkIds.length > 0) {
        roadRevealReadyRef.current = true;
        roadFade.value = 1;
      }
      return;
    }
    if ((motorway && trunk && !roadRevealReadyRef.current) || (overviewBuildCompleteRef.current && motorway && !roadRevealReadyRef.current)) {
      roadRevealReadyRef.current = true;
      roadFade.value = withTiming(1, { duration: 480 });
    }
  }, [roadPaintRev, roadChunkIds, roadFade]);

  useEffect(() => {
    vw.value = viewport.width;
    vh.value = viewport.height;
    if (viewport.width > 0 && !fittedRef.current) {
      applyHome(false);
      fittedRef.current = true;
    }
  }, [applyHome, vh, viewport.height, viewport.width, vw]);

  const cameraTransform = useDerivedValue(() => [
    { translateX: translateX.value },
    { translateY: translateY.value },
    { scale: scale.value },
  ]);

  useAnimatedReaction(
    () => ({
      x: translateX.value,
      y: translateY.value,
      s: scale.value,
      w: vw.value,
      h: vh.value,
    }),
    (cam) => {
      if (cam.w <= 0 || cam.h <= 0) return;
      const now = Date.now();
      if (now - lastHudAt.value < 220) return;
      lastHudAt.value = now;
      runOnJS(publishHud)(cam);
    },
  );

  const selectAtScreen = useCallback(
    (sx: number, sy: number) => {
      const airports = airportLayerRef.current;
      if (airports?.enabled && airports.onSelect && airports.markers.length > 0) {
        let bestAirportId: string | null = null;
        let bestAirportDist = 18;
        for (const marker of airports.markers) {
          const screen = worldToScreen(marker.x, marker.y, translateX.value, translateY.value, scale.value);
          const dist = Math.hypot(screen.x - sx, screen.y - sy);
          if (dist <= bestAirportDist) {
            bestAirportDist = dist;
            bestAirportId = marker.id;
          }
        }
        if (bestAirportId) {
          airports.onSelect(bestAirportId);
          return;
        }
      }
      const ports = portLayerRef.current;
      if (ports?.enabled && ports.onSelect && ports.markers.length > 0) {
        let bestPortId: string | null = null;
        let bestPortDist = 18;
        for (const marker of ports.markers) {
          const screen = worldToScreen(marker.x, marker.y, translateX.value, translateY.value, scale.value);
          const dist = Math.hypot(screen.x - sx, screen.y - sy);
          if (dist <= bestPortDist) {
            bestPortDist = dist;
            bestPortId = marker.id;
          }
        }
        if (bestPortId) {
          ports.onSelect(bestPortId);
          return;
        }
      }
      const layer = cityLayerRef.current;
      if (layer && layer.cities.length > 0) {
        const visibleCities = cityDrawIds
          .map((id) => cityById.get(id))
          .filter((city): city is GeoCityRecord => Boolean(city));
        const hit = hitTestCity(sx, sy, visibleCities, translateX.value, translateY.value, scale.value);
        layer.onSelectCity(hit);
        if (hit) return;
      }
      const world = screenToWorld(sx, sy, translateX.value, translateY.value, scale.value);
      const lod = lodRef.current;
      const allow = hitRef.current ?? allIds;
      const allowSet = new Set(allow);
      let bestId: string | null = null;
      let bestArea = Number.POSITIVE_INFINITY;
      for (const country of renderable) {
        if (!allowSet.has(country.geoCountryId)) continue;
        const b = country.lods[lod].projectedBounds;
        if (world.x < b.minX || world.x > b.maxX || world.y < b.minY || world.y > b.maxY) {
          continue;
        }
        const polygons = dequantizePolygons(country.lods[lod].polygons);
        if (!pointInProjectedPolygons(world, polygons)) continue;
        const area = (b.maxX - b.minX) * (b.maxY - b.minY);
        if (area < bestArea) {
          bestArea = area;
          bestId = country.geoCountryId;
        }
      }
      onSelect(bestId);
    },
    [allIds, cityById, cityDrawIds, onSelect, renderable, scale, translateX, translateY],
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          'worklet';
          pinchActive.value = true;
          runOnJS(setRoadGestureActive)(true);
          savedScale.value = scale.value;
          savedTx.value = translateX.value;
          savedTy.value = translateY.value;
        })
        .onUpdate((event) => {
          'worklet';
          const nextScale = savedScale.value * event.scale;
          const zoomed = zoomToFocal(
            event.focalX,
            event.focalY,
            savedScale.value,
            savedTx.value,
            savedTy.value,
            nextScale,
          );
          const clamped = clampWorldCamera({
            scale: nextScale,
            translateX: zoomed.translateX,
            translateY: zoomed.translateY,
            viewportWidth: vw.value,
            viewportHeight: vh.value,
            elastic: elasticSv.value === 1,
            maxScaleFactor: maxScaleSv.value,
            minScaleFactor: minScaleSv.value,
            contentBounds: {
              minX: boundMinX.value,
              minY: boundMinY.value,
              maxX: boundMaxX.value,
              maxY: boundMaxY.value,
            },
          });
          scale.value = clamped.scale;
          translateX.value = clamped.translateX;
          translateY.value = clamped.translateY;
        })
        .onFinalize(() => {
          'worklet';
          pinchActive.value = false;
          runOnJS(setRoadGestureActive)(false);
          const clamped = clampWorldCamera({
            scale: scale.value,
            translateX: translateX.value,
            translateY: translateY.value,
            viewportWidth: vw.value,
            viewportHeight: vh.value,
            elastic: false,
            maxScaleFactor: maxScaleSv.value,
            minScaleFactor: minScaleSv.value,
            contentBounds: {
              minX: boundMinX.value,
              minY: boundMinY.value,
              maxX: boundMaxX.value,
              maxY: boundMaxY.value,
            },
          });
          scale.value = withTiming(clamped.scale, { duration: WORLD_GESTURE_SNAP_MS });
          translateX.value = withTiming(clamped.translateX, { duration: WORLD_GESTURE_SNAP_MS });
          translateY.value = withTiming(clamped.translateY, { duration: WORLD_GESTURE_SNAP_MS });
        })
        .enabled(mapGesturesEnabled),
    [mapGesturesEnabled, maxScaleSv, pinchActive, savedScale, savedTx, savedTy, scale, translateX, translateY, vh, vw],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(8)
        .maxPointers(2)
        .onBegin(() => {
          'worklet';
          panConsumed.value = false;
          runOnJS(setRoadGestureActive)(true);
          savedTx.value = translateX.value;
          savedTy.value = translateY.value;
        })
        .onUpdate((event) => {
          'worklet';
          if (pinchActive.value) return;
          if (Math.abs(event.translationX) > 2 || Math.abs(event.translationY) > 2) {
            panConsumed.value = true;
          }
          const clamped = clampWorldCamera({
            scale: scale.value,
            translateX: savedTx.value + event.translationX,
            translateY: savedTy.value + event.translationY,
            viewportWidth: vw.value,
            viewportHeight: vh.value,
            elastic: elasticSv.value === 1,
            maxScaleFactor: maxScaleSv.value,
            minScaleFactor: minScaleSv.value,
            contentBounds: {
              minX: boundMinX.value,
              minY: boundMinY.value,
              maxX: boundMaxX.value,
              maxY: boundMaxY.value,
            },
          });
          translateX.value = clamped.translateX;
          translateY.value = clamped.translateY;
        })
        .onEnd(() => {
          'worklet';
          runOnJS(setRoadGestureActive)(false);
          const clamped = clampWorldCamera({
            scale: scale.value,
            translateX: translateX.value,
            translateY: translateY.value,
            viewportWidth: vw.value,
            viewportHeight: vh.value,
            elastic: false,
            maxScaleFactor: maxScaleSv.value,
            minScaleFactor: minScaleSv.value,
            contentBounds: {
              minX: boundMinX.value,
              minY: boundMinY.value,
              maxX: boundMaxX.value,
              maxY: boundMaxY.value,
            },
          });
          translateX.value = withTiming(clamped.translateX, { duration: WORLD_GESTURE_SNAP_MS });
          translateY.value = withTiming(clamped.translateY, { duration: WORLD_GESTURE_SNAP_MS });
        })
        .enabled(mapGesturesEnabled),
    [mapGesturesEnabled, maxScaleSv, panConsumed, pinchActive, savedTx, savedTy, scale, translateX, translateY, vh, vw],
  );

  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(280)
        .onEnd((event) => {
          'worklet';
          const nextScale = scale.value * WORLD_DOUBLE_TAP_ZOOM;
          const zoomed = zoomToFocal(
            event.x,
            event.y,
            scale.value,
            translateX.value,
            translateY.value,
            nextScale,
          );
          const clamped = clampWorldCamera({
            scale: nextScale,
            translateX: zoomed.translateX,
            translateY: zoomed.translateY,
            viewportWidth: vw.value,
            viewportHeight: vh.value,
            elastic: false,
            maxScaleFactor: maxScaleSv.value,
            minScaleFactor: minScaleSv.value,
            contentBounds: {
              minX: boundMinX.value,
              minY: boundMinY.value,
              maxX: boundMaxX.value,
              maxY: boundMaxY.value,
            },
          });
          scale.value = withTiming(clamped.scale, { duration: WORLD_GESTURE_SNAP_MS });
          translateX.value = withTiming(clamped.translateX, { duration: WORLD_GESTURE_SNAP_MS });
          translateY.value = withTiming(clamped.translateY, { duration: WORLD_GESTURE_SNAP_MS });
        })
        .enabled(mapGesturesEnabled),
    [mapGesturesEnabled, maxScaleSv, scale, translateX, translateY, vh, vw],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDuration(250)
        .onEnd((event, success) => {
          'worklet';
          if (!success || panConsumed.value || pinchActive.value) return;
          runOnJS(selectAtScreen)(event.x, event.y);
        }),
    [panConsumed, pinchActive, selectAtScreen],
  );

  const composed = useMemo(
    () =>
      Gesture.Simultaneous(pinchGesture, panGesture, Gesture.Exclusive(doubleTapGesture, tapGesture)),
    [doubleTapGesture, panGesture, pinchGesture, tapGesture],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setViewport({ width, height });
    }
  }, []);

  const loadedLod = lodOverride === 'AUTO' ? activeLod : lodOverride;
  const drawIds = forcedDrawIds ?? selectDrawCountryIds(cullEnabled, visibleIds, allIds);
  const roadProfile = roadLayer?.renderProfile ?? ROAD_RENDER_PROFILE_DEBUG;
  const overviewRoadStyles = roadDrawPlan?.overviewStyles ?? ROAD_OVERVIEW_CORRIDOR_STYLES;
  const chunkRoadStyles = roadDrawPlan?.chunkStyles ?? [];
  const playerRoadProfile = roadProfile !== ROAD_RENDER_PROFILE_DEBUG;
  const corridorReady =
    (Boolean(peekRoadOverviewStylePath('ROAD_MOTORWAY')) && Boolean(peekRoadOverviewStylePath('ROAD_TRUNK'))) ||
    (overviewBuildCompleteRef.current && Boolean(peekRoadOverviewStylePath('ROAD_MOTORWAY')));
  const showOverviewRoads =
    Boolean(roadDrawPlan?.useOverview) && roadMode !== 'OFF' && roadMode !== 'NONE' && (!playerRoadProfile || corridorReady);
  const showChunkRoads = Boolean(roadDrawPlan?.useChunks) && roadChunkIds.length > 0;
  const playerCorridors = playerCorridorLayer?.enabled ? getTurkeyPlayerRoadCorridors() : null;
  const selectedGeoCityId = cityLayer?.selectedCityId ?? null;
  const playerCorridorPaths = useMemo(() => {
    if (!playerCorridors || playerCorridors.corridors.length === 0) return null;
    const grouped = groupCorridorsByInteractionState(
      playerCorridors.corridors,
      selectedGeoCityId,
      playerCorridorLayer?.availabilityByGeoCityId,
    );
    const paths: Partial<Record<(typeof COUNTRY_CORRIDOR_INTERACTION_DRAW_ORDER)[number], ReturnType<typeof composeCorridorBatchPath>>> = {};
    for (const state of COUNTRY_CORRIDOR_INTERACTION_DRAW_ORDER) {
      paths[state] = composeCorridorBatchPath(playerCorridors.contentHash, grouped[state]);
    }
    return paths;
  }, [playerCorridorLayer?.availabilityByGeoCityId, playerCorridors, selectedGeoCityId]);
  const playerRailCorridors = playerRailCorridorLayer?.enabled ? getTurkeyPlayerRailCorridors() : null;
  const playerRailCorridorPaths = useMemo(() => {
    if (!playerRailCorridors || playerRailCorridors.corridors.length === 0) return null;
    const grouped = groupRailCorridorsByInteractionState(
      playerRailCorridors.corridors,
      selectedGeoCityId,
      playerRailCorridorLayer?.availabilityByGeoCityId,
    );
    const paths: Partial<
      Record<(typeof RAIL_CORRIDOR_INTERACTION_DRAW_ORDER)[number], ReturnType<typeof composeRailCorridorBatchPath>>
    > = {};
    for (const state of RAIL_CORRIDOR_INTERACTION_DRAW_ORDER) {
      paths[state] = composeRailCorridorBatchPath(playerRailCorridors.contentHash, grouped[state]);
    }
    return paths;
  }, [playerRailCorridorLayer?.availabilityByGeoCityId, playerRailCorridors, selectedGeoCityId]);
  const connectedLabelIds = useMemo(() => {
    if (!playerCorridors) return new Set<string>();
    return connectedNeighborGeoCityIds(playerCorridors.corridors, selectedGeoCityId);
  }, [playerCorridors, selectedGeoCityId]);
  const corridorRevealDoneRef = useRef(false);
  useEffect(() => {
    if (!playerCorridorPaths) {
      corridorFade.value = 0;
      corridorRevealDoneRef.current = false;
      return;
    }
    if (playerCorridorLayer?.reduceMotion) {
      corridorFade.value = 1;
      corridorRevealDoneRef.current = true;
      return;
    }
    if (!corridorRevealDoneRef.current) {
      corridorFade.value = 0;
      corridorFade.value = withTiming(1, { duration: 420 });
      corridorRevealDoneRef.current = true;
      return;
    }
    corridorFade.value = 0.86;
    corridorFade.value = withTiming(1, { duration: COUNTRY_CORRIDOR_SELECTION_FADE_MS });
  }, [corridorFade, playerCorridorLayer?.reduceMotion, playerCorridorPaths, selectedGeoCityId]);
  const railRevealDoneRef = useRef(false);
  useEffect(() => {
    if (!playerRailCorridorPaths) {
      railCorridorFade.value = 0;
      railRevealDoneRef.current = false;
      return;
    }
    if (playerRailCorridorLayer?.reduceMotion) {
      railCorridorFade.value = 1;
      railRevealDoneRef.current = true;
      return;
    }
    if (!railRevealDoneRef.current) {
      railCorridorFade.value = 0;
      railCorridorFade.value = withTiming(1, { duration: 360 });
      railRevealDoneRef.current = true;
    }
  }, [playerRailCorridorLayer?.reduceMotion, playerRailCorridorPaths, railCorridorFade]);
  const playerSeaCorridors = playerSeaCorridorLayer?.enabled ? getTurkeyPlayerSeaCorridors() : null;
  const playerSeaCorridorPaths = useMemo(() => {
    if (!playerSeaCorridors || playerSeaCorridors.corridors.length === 0) return null;
    const grouped = groupSeaCorridorsByInteractionState(
      playerSeaCorridors.corridors,
      selectedGeoCityId,
      playerSeaCorridorLayer?.availabilityByGeoCityId,
    );
    const paths: Partial<
      Record<(typeof SEA_CORRIDOR_INTERACTION_DRAW_ORDER)[number], ReturnType<typeof composeSeaCorridorBatchPath>>
    > = {};
    for (const state of SEA_CORRIDOR_INTERACTION_DRAW_ORDER) {
      paths[state] = composeSeaCorridorBatchPath(playerSeaCorridors.contentHash, grouped[state]);
    }
    return paths;
  }, [playerSeaCorridorLayer?.availabilityByGeoCityId, playerSeaCorridors, selectedGeoCityId]);
  const seaRevealDoneRef = useRef(false);
  useEffect(() => {
    if (!playerSeaCorridorPaths) {
      seaCorridorFade.value = 0;
      seaRevealDoneRef.current = false;
      return;
    }
    if (playerSeaCorridorLayer?.reduceMotion) {
      seaCorridorFade.value = 1;
      seaRevealDoneRef.current = true;
      return;
    }
    if (!seaRevealDoneRef.current) {
      seaCorridorFade.value = 0;
      seaCorridorFade.value = withTiming(1, { duration: 360 });
      seaRevealDoneRef.current = true;
      return;
    }
    seaCorridorFade.value = 0.86;
    seaCorridorFade.value = withTiming(1, { duration: 220 });
  }, [playerSeaCorridorLayer?.reduceMotion, playerSeaCorridorPaths, seaCorridorFade, selectedGeoCityId]);
  const playerAirCorridors = playerAirCorridorLayer?.enabled ? getTurkeyPlayerAirCorridors() : null;
  const playerAirCorridorPaths = useMemo(() => {
    if (!playerAirCorridors || playerAirCorridors.corridors.length === 0) return null;
    const grouped = groupAirCorridorsByInteractionState(
      playerAirCorridors.corridors,
      selectedGeoCityId,
      playerAirCorridorLayer?.availabilityByGeoCityId,
    );
    const paths: Partial<
      Record<(typeof AIR_CORRIDOR_INTERACTION_DRAW_ORDER)[number], ReturnType<typeof composeAirCorridorBatchPath>>
    > = {};
    for (const state of AIR_CORRIDOR_INTERACTION_DRAW_ORDER) {
      paths[state] = composeAirCorridorBatchPath(playerAirCorridors.contentHash, grouped[state]);
    }
    return paths;
  }, [playerAirCorridorLayer?.availabilityByGeoCityId, playerAirCorridors, selectedGeoCityId]);
  const airRevealDoneRef = useRef(false);
  useEffect(() => {
    if (!playerAirCorridorPaths) {
      airCorridorFade.value = 0;
      airRevealDoneRef.current = false;
      return;
    }
    if (playerAirCorridorLayer?.reduceMotion) {
      airCorridorFade.value = 1;
      airRevealDoneRef.current = true;
      return;
    }
    if (!airRevealDoneRef.current) {
      airCorridorFade.value = 0;
      airCorridorFade.value = withTiming(1, { duration: 360 });
      airRevealDoneRef.current = true;
      return;
    }
    airCorridorFade.value = 0.86;
    airCorridorFade.value = withTiming(1, { duration: 220 });
  }, [playerAirCorridorLayer?.reduceMotion, playerAirCorridorPaths, airCorridorFade, selectedGeoCityId]);
  const roundedWorld = viewportClip === 'ROUNDED' && viewport.width > 0 && viewport.height > 0;
  const countryHero = countryVisualProfile === 'DASHBOARD' && viewport.width > 0 && viewport.height > 0;
  const framePad = countryHero ? 8 : 5;
  const frameRx = countryHero ? 18 : Math.min(viewport.width, viewport.height) * 0.2;
  const frameRect = rect(framePad, framePad, Math.max(viewport.width - framePad * 2, 1), Math.max(viewport.height - framePad * 2, 1));
  const clipRound = roundedWorld || countryHero;
  const frameRRect = rrect(frameRect, clipRound ? frameRx : 0, clipRound ? (countryHero ? frameRx : frameRx * 0.86) : 0);
  const gridH = [0.22, 0.42, 0.62, 0.82];
  const gridV = [0.28, 0.5, 0.72];

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.fill} onLayout={onLayout} collapsable={false}>
        {viewport.width > 0 ? (
          <Canvas style={styles.fill}>
            <Group clip={frameRRect}>
              {countryHero ? (
                <>
                  <RoundedRect rect={frameRRect} color={COUNTRY_DASHBOARD_OCEAN[0]} />
                  <RoundedRect rect={frameRRect}>
                    <RadialGradient
                      c={vec(viewport.width * 0.48, viewport.height * 0.42)}
                      r={Math.max(viewport.width, viewport.height) * 0.72}
                      colors={[COUNTRY_DASHBOARD_OCEAN[1], COUNTRY_DASHBOARD_OCEAN[0]]}
                    />
                  </RoundedRect>
                  {gridH.map((t, index) => (
                    <Line
                      key={`dash-h:${index}`}
                      p1={vec(framePad, framePad + frameRect.height * t)}
                      p2={vec(viewport.width - framePad, framePad + frameRect.height * t)}
                      color="rgba(90, 140, 180, 0.06)"
                      strokeWidth={1}
                    />
                  ))}
                  {gridV.map((t, index) => (
                    <Line
                      key={`dash-v:${index}`}
                      p1={vec(framePad + frameRect.width * t, framePad)}
                      p2={vec(framePad + frameRect.width * t, viewport.height - framePad)}
                      color="rgba(90, 140, 180, 0.045)"
                      strokeWidth={1}
                    />
                  ))}
                </>
              ) : null}
              {roundedWorld ? (
                <RoundedRect rect={frameRRect}>
                  <LinearGradient
                    start={vec(0, 0)}
                    end={vec(0, viewport.height)}
                    colors={[MAP_V2_OCEAN_DEEP, MAP_V2_OCEAN, '#04182A']}
                  />
                </RoundedRect>
              ) : null}
              <Group transform={cameraTransform}>
              {roundedWorld ? (
                <Path
                  path={getWorldDecorGridPath()}
                  color="rgba(90, 140, 180, 0.07)"
                  style="stroke"
                  strokeWidth={0.0007}
                />
              ) : null}
              {drawIds.map((id) => {
                const path = getCountryPath(id, loadedLod);
                if (!path) return null;
                const selected = id === selectedId;
                const paint = getCountryPaint(id, selected);
                const record = getCountryRecord(id);
                const bounds = record?.lods[loadedLod].projectedBounds;
                if (countryVisualProfile === 'DASHBOARD' && bounds) {
                  const gradient = countryDashboardGradientPoints(bounds);
                  const tints = countryDashboardTintCenters(bounds);
                  const highlight = countryDashboardInnerHighlight(bounds);
                  const ridges = countryDashboardRidgeBands(bounds);
                  return (
                    <Group key={`${id}:${loadedLod}:dashboard`}>
                      <Path path={path} style="fill" fillType="evenOdd">
                        <LinearGradient start={gradient.start} end={gradient.end} colors={[...COUNTRY_DASHBOARD_FILL]} />
                      </Path>
                      <Group clip={path}>
                        {tints.map((tint, index) => (
                          <Circle key={`tint:${index}`} cx={tint.cx} cy={tint.cy} r={tint.r} color={tint.color} />
                        ))}
                        <Circle cx={highlight.cx} cy={highlight.cy} r={highlight.r} color={highlight.color} />
                        {ridges.map((ridge, index) => (
                          <Line
                            key={`ridge:${index}`}
                            p1={vec(ridge.x1, ridge.y1)}
                            p2={vec(ridge.x2, ridge.y2)}
                            color={COUNTRY_DASHBOARD_RIDGE}
                            strokeWidth={COUNTRY_DASHBOARD_RIDGE_WIDTH}
                          />
                        ))}
                      </Group>
                      <Path
                        path={path}
                        color={COUNTRY_DASHBOARD_COAST_UNDER}
                        style="stroke"
                        strokeWidth={COUNTRY_DASHBOARD_COAST_UNDER_WIDTH}
                        strokeJoin="round"
                      />
                      <Path
                        path={path}
                        color={COUNTRY_DASHBOARD_COAST}
                        style="stroke"
                        strokeWidth={COUNTRY_DASHBOARD_COAST_WIDTH}
                        strokeJoin="round"
                      />
                      <Path
                        path={path}
                        color={COUNTRY_DASHBOARD_INNER}
                        style="stroke"
                        strokeWidth={COUNTRY_DASHBOARD_INNER_WIDTH}
                        strokeJoin="round"
                      />
                    </Group>
                  );
                }
                return (
                  <Group key={`${id}:${loadedLod}`}>
                    {id === selectedId || resolveCountryGameplayAvailability(id) === 'STARTER_AVAILABLE' ? (
                      <Path
                        path={path}
                        color={MAP_V2_STARTER_GLOW}
                        style="stroke"
                        strokeWidth={paint.strokeWidth * 2.4}
                        strokeJoin="round"
                      />
                    ) : null}
                    <Path path={path} color={paint.fill} style="fill" fillType="evenOdd" />
                    <Path
                      path={path}
                      color={paint.border}
                      style="stroke"
                      strokeWidth={paint.strokeWidth}
                      strokeJoin="round"
                    />
                  </Group>
                );
              })}
              {playerCorridorPaths ? (
                <Group opacity={corridorFade}>
                  {COUNTRY_CORRIDOR_INTERACTION_DRAW_ORDER.map((state) => {
                    const path = playerCorridorPaths[state];
                    if (!path) return null;
                    const paint = corridorInteractionPaint(state);
                    return (
                      <Group key={`player-corridor:${state}`} opacity={paint.opacity}>
                        {paint.strokes.map((stroke, index) => (
                          <Path
                            key={`${state}:${index}`}
                            path={path}
                            color={stroke.color}
                            style="stroke"
                            strokeWidth={stroke.width}
                            strokeJoin="round"
                            strokeCap="round"
                          />
                        ))}
                      </Group>
                    );
                  })}
                </Group>
              ) : null}
              {playerRailCorridorPaths ? (
                <Group opacity={railCorridorFade}>
                  {RAIL_CORRIDOR_INTERACTION_DRAW_ORDER.map((state) => {
                    const path = playerRailCorridorPaths[state];
                    if (!path) return null;
                    const paint = railCorridorInteractionPaint(state);
                    return (
                      <Group key={`player-rail-corridor:${state}`} opacity={paint.opacity}>
                        {paint.strokes.map((stroke, index) => (
                          <Path
                            key={`${state}:${index}`}
                            path={path}
                            color={stroke.color}
                            style="stroke"
                            strokeWidth={stroke.width}
                            strokeJoin="round"
                            strokeCap="round"
                          />
                        ))}
                      </Group>
                    );
                  })}
                </Group>
              ) : null}
              {playerSeaCorridorPaths ? (
                <Group opacity={seaCorridorFade}>
                  {SEA_CORRIDOR_INTERACTION_DRAW_ORDER.map((state) => {
                    const path = playerSeaCorridorPaths[state];
                    if (!path) return null;
                    const paint = seaCorridorInteractionPaint(state);
                    return (
                      <Group key={`player-sea-corridor:${state}`} opacity={paint.opacity}>
                        {paint.strokes.map((stroke, index) => (
                          <Path
                            key={`${state}:${index}`}
                            path={path}
                            color={stroke.color}
                            style="stroke"
                            strokeWidth={stroke.width}
                            strokeJoin="round"
                            strokeCap="round"
                          />
                        ))}
                      </Group>
                    );
                  })}
                </Group>
              ) : null}
              {playerAirCorridorPaths ? (
                <Group opacity={airCorridorFade}>
                  {AIR_CORRIDOR_INTERACTION_DRAW_ORDER.map((state) => {
                    const path = playerAirCorridorPaths[state];
                    if (!path) return null;
                    const paint = airCorridorInteractionPaint(state);
                    return (
                      <Group key={`player-air-corridor:${state}`} opacity={paint.opacity}>
                        {paint.strokes.map((stroke, index) => (
                          <Path
                            key={`${state}:${index}`}
                            path={path}
                            color={stroke.color}
                            style="stroke"
                            strokeWidth={stroke.width}
                            strokeJoin="round"
                            strokeCap="round"
                          />
                        ))}
                      </Group>
                    );
                  })}
                </Group>
              ) : null}
              {railDebugLayer?.enabled
                ? RAIL_DEBUG_STYLE_ORDER.map((style) => {
                    const lod =
                      railDebugLayer.lodOverride === 'AUTO' ? 'NETWORK_MEDIUM' : railDebugLayer.lodOverride;
                    const path = getRailDebugBatchPath(lod, style);
                    if (!path) return null;
                    const paint = paintForTransportStyle(style);
                    return (
                      <Path
                        key={`rail-debug:${lod}:${style}`}
                        path={path}
                        color={paint.color}
                        style="stroke"
                        strokeWidth={paint.strokeWidth}
                        strokeJoin="round"
                        strokeCap="round"
                      />
                    );
                  })
                : null}
              <Group opacity={roadFade}>
                {showOverviewRoads
                  ? overviewRoadStyles.map((style) => {
                      const path = peekRoadOverviewStylePath(style);
                      if (!path) return null;
                      const paint = paintForTransportStyle(style, roadProfile);
                      return (
                        <Path
                          key={`road-overview:${style}:${roadPaintRev}`}
                          path={path}
                          color={paint.color}
                          style="stroke"
                          strokeWidth={paint.strokeWidth}
                          strokeJoin="round"
                          strokeCap="round"
                        />
                      );
                    })
                  : null}
                {showChunkRoads
                  ? roadChunkIds.flatMap((chunkId) => {
                      const chunk = peekLoadedRoadChunk(chunkId);
                      if (!chunk) return [];
                      return chunkRoadStyles.map((style) => {
                        const path = peekRoadChunkStylePath(chunkId, chunk.lod, style);
                        if (!path) return null;
                        const paint = paintForTransportStyle(style, roadProfile);
                        return (
                          <Path
                            key={`road:${chunkId}:${style}:${roadPaintRev}`}
                            path={path}
                            color={paint.color}
                            style="stroke"
                            strokeWidth={paint.strokeWidth}
                            strokeJoin="round"
                            strokeCap="round"
                          />
                        );
                      });
                    })
                  : null}
              </Group>
              {railDebugLayer?.enabled && railDebugLayer.showStations !== false
                ? getRailDebugView()
                    .stations.filter((row) => row.associated)
                    .slice(0, railDebugLayer.lodOverride === 'NETWORK_HIGH' ? 120 : 24)
                    .map((station) => (
                      <Group key={`rail-station:${station.nodeId}`} transform={[{ translateX: station.x }, { translateY: station.y }]}>
                        <Group transform={markerInvScale}>
                          <Circle cx={0} cy={0} r={3.2} color="#D7DEE4" />
                          <Circle cx={0} cy={0} r={2.1} color="#2A333A" />
                          {railDebugLayer.lodOverride === 'NETWORK_HIGH' && station.name && font ? (
                            <SkiaText
                              x={6}
                              y={-6}
                              text={station.name}
                              font={font}
                              color="rgba(220,226,232,0.82)"
                            />
                          ) : null}
                        </Group>
                      </Group>
                    ))
                : null}
              {devPortLayer?.enabled
                ? (devPortLayer.maritimeEdges ?? []).map((edge) => (
                    <Line
                      key={`dev-sea-edge:${edge.edgeId}`}
                      p1={vec(edge.x1, edge.y1)}
                      p2={vec(edge.x2, edge.y2)}
                      color={
                        edge.channel || edge.layer === 'CHANNEL'
                          ? 'rgba(92, 148, 186, 0.62)'
                          : edge.layer === 'APPROACH'
                            ? 'rgba(86, 118, 138, 0.42)'
                            : 'rgba(78, 96, 112, 0.28)'
                      }
                      strokeWidth={edge.channel || edge.layer === 'CHANNEL' ? 0.00016 : 0.0001}
                    />
                  ))
                : null}
              {devPortLayer?.enabled
                ? (devPortLayer.smokePaths ?? []).map((path) =>
                    path.points.slice(1).map((point, index) => (
                      <Line
                        key={`dev-sea-smoke:${path.id}:${index}`}
                        p1={vec(path.points[index].x, path.points[index].y)}
                        p2={vec(point.x, point.y)}
                        color="rgba(110, 150, 170, 0.45)"
                        strokeWidth={0.00018}
                      />
                    )),
                  )
                : null}
              {devPortLayer?.enabled
                ? (devPortLayer.accessLines ?? []).map((line, index) => (
                    <Line
                      key={`dev-port-access:${index}`}
                      p1={vec(line.x1, line.y1)}
                      p2={vec(line.x2, line.y2)}
                      color="rgba(140, 160, 168, 0.4)"
                      strokeWidth={0.0001}
                    />
                  ))
                : null}
              {devPortLayer?.enabled
                ? (devPortLayer.associationLines ?? []).map((line, index) => (
                    <Line
                      key={`dev-port-assoc:${index}`}
                      p1={vec(line.x1, line.y1)}
                      p2={vec(line.x2, line.y2)}
                      color="rgba(120, 132, 140, 0.35)"
                      strokeWidth={0.00012}
                    />
                  ))
                : null}
              {devPortLayer?.enabled
                ? (devPortLayer.seaAccessMarkers ?? []).map((marker) => (
                    <Group key={`dev-sea-access:${marker.id}`} transform={[{ translateX: marker.x }, { translateY: marker.y }]}>
                      <Group transform={markerInvScale}>
                        <Circle cx={0} cy={0} r={marker.unresolved ? 4.2 : 3.1} color={marker.unresolved ? '#B08968' : '#7E98A6'} />
                      </Group>
                    </Group>
                  ))
                : null}
              {devPortLayer?.enabled
                ? devPortLayer.markers.map((marker) => {
                    const color =
                      marker.eligibility === 'LOGISTICS_ELIGIBLE'
                        ? '#8A9A86'
                        : marker.eligibility === 'PASSENGER_ONLY'
                          ? '#7A8894'
                          : '#8E8680';
                    return (
                      <Group key={`dev-port:${marker.id}`} transform={[{ translateX: marker.x }, { translateY: marker.y }]}>
                        <Group transform={markerInvScale}>
                          <Circle cx={0} cy={0} r={marker.selected ? 5.2 : 3.6} color={color} />
                        </Group>
                      </Group>
                    );
                  })
                : null}
              {devAirportLayer?.enabled
                ? (devAirportLayer.associationLines ?? []).map((line, index) => (
                    <Line
                      key={`dev-air-assoc:${index}`}
                      p1={vec(line.x1, line.y1)}
                      p2={vec(line.x2, line.y2)}
                      color="rgba(140, 128, 168, 0.35)"
                      strokeWidth={0.00012}
                    />
                  ))
                : null}
              {devAirportLayer?.enabled
                ? (devAirportLayer.runways ?? []).map((line) => (
                    <Line
                      key={`dev-air-rwy:${line.id}`}
                      p1={vec(line.x1, line.y1)}
                      p2={vec(line.x2, line.y2)}
                      color="rgba(168, 164, 156, 0.55)"
                      strokeWidth={0.00008}
                    />
                  ))
                : null}
              {devAirportLayer?.enabled
                ? devAirportLayer.markers.map((marker) => {
                    const color =
                      marker.eligibility === 'LOGISTICS_ELIGIBLE'
                        ? '#8A9A86'
                        : marker.eligibility === 'LOGISTICS_ELIGIBLE_PREVIEW'
                          ? '#9AA87A'
                        : marker.eligibility === 'PASSENGER_ONLY'
                          ? '#7A8894'
                          : marker.eligibility === 'MILITARY_RESTRICTED'
                            ? '#A07868'
                            : marker.eligibility === 'UNRESOLVED'
                              ? '#B0A070'
                              : '#8E8680';
                    return (
                      <Group key={`dev-air:${marker.id}`} transform={[{ translateX: marker.x }, { translateY: marker.y }]}>
                        <Group transform={markerInvScale}>
                          <Circle cx={0} cy={0} r={marker.selected ? 5.2 : 3.6} color={color} />
                        </Group>
                      </Group>
                    );
                  })
                : null}
              {cityDrawIds.map((id) => {
                const city = cityById.get(id);
                if (!city) return null;
                const selected = city.geoCityId === cityLayer?.selectedCityId;
                const dashboard = cityLayer?.presentation === 'DASHBOARD';
                const availability = cityLayer?.availabilityByGeoCityId?.[city.geoCityId];
                const locked = availability === 'LOCKED' || availability === 'NOT_AVAILABLE';
                const capital = dashboard && city.settlementClass === 'CAPITAL' && !locked;
                const hub = dashboard
                  ? capital
                    ? CITY_NODE_CAPITAL.hubRadius
                    : CITY_NODE_DEFAULT.hubRadius
                  : CITY_MARKER_RADIUS_PX;
                const ringR = dashboard
                  ? capital
                    ? CITY_NODE_CAPITAL.ringRadius
                    : CITY_NODE_DEFAULT.ringRadius
                  : hub + 1.35;
                const hubFill = dashboard ? cityDashboardHubFill(availability) : CITY_NODE_DEFAULT.fill;
                const coreFill = dashboard
                  ? cityDashboardCoreFill({ availability, capital })
                  : CITY_NODE_DEFAULT.core;
                const ringColor = locked ? CITY_NODE_LOCKED.ring : CITY_NODE_DEFAULT.ring;
                const legacy = Boolean(cityLayer?.showLegacyHalo && mappedSet.has(city.geoCityId));
                const label = cityLabelIdSet.has(city.geoCityId) ? cityLayer?.resolveLabel(city) : undefined;
                const labelOffset = dashboard ? cityDashboardLabelOffset(city) : { x: 8, y: -10 };
                const connector = dashboard && label ? cityDashboardLabelNeedsConnector(labelOffset) : false;
                const labelWidth = label ? Math.max(28, label.length * 6.1) : 0;
                const useBold = selected || capital;
                const labelFont = useBold ? fontBold ?? font : font;
                return (
                  <Group key={city.geoCityId} transform={[{ translateX: city.projected.x }, { translateY: city.projected.y }]}>
                    <Group transform={markerInvScale}>
                      {legacy ? <Circle cx={0} cy={0} r={hub + 6} color={CITY_MARKER_LEGACY_HALO} opacity={0.45} /> : null}
                      {selected ? (
                        <Circle
                          cx={0}
                          cy={0}
                          r={hub + CITY_NODE_SELECTED.haloRadiusAdd}
                          color={CITY_NODE_SELECTED.halo}
                        />
                      ) : dashboard ? null : (
                        <Circle cx={0} cy={0} r={CITY_MARKER_RADIUS_PX + 3.5} color={CITY_MARKER_GLOW} />
                      )}
                      {capital ? (
                        <Circle
                          cx={0}
                          cy={0}
                          r={CITY_NODE_CAPITAL.ringRadius + 1.1}
                          color={CITY_NODE_CAPITAL.goldRing}
                          style="stroke"
                          strokeWidth={CITY_NODE_CAPITAL.goldWidth}
                        />
                      ) : null}
                      <Circle cx={0} cy={0} r={hub} color={hubFill} />
                      <Circle
                        cx={0}
                        cy={0}
                        r={ringR}
                        color={ringColor}
                        style="stroke"
                        strokeWidth={dashboard ? CITY_NODE_DEFAULT.ringWidth : 1}
                        opacity={dashboard ? (locked ? 0.72 : 1) : 0.7}
                      />
                      <Circle
                        cx={0}
                        cy={0}
                        r={dashboard ? CITY_NODE_DEFAULT.coreRadius : 1.1}
                        color={coreFill}
                      />
                      {dashboard && locked ? (
                        <Circle cx={hub + 3.2} cy={hub + 2.4} r={1.55} color={CITY_NODE_LOCKED.marker} />
                      ) : null}
                      {dashboard && !locked && !selected && cityLayer?.operationHints?.[city.geoCityId] === 'HOME' ? (
                        <Circle cx={hub + 3.2} cy={hub + 2.4} r={1.7} color={CITY_NODE_HINT.home} />
                      ) : null}
                      {dashboard && !locked && !selected && cityLayer?.operationHints?.[city.geoCityId] === 'WAREHOUSE' ? (
                        <Circle cx={hub + 3.2} cy={hub + 2.4} r={1.55} color={CITY_NODE_HINT.warehouse} />
                      ) : null}
                      {dashboard && !locked && !selected && cityLayer?.operationHints?.[city.geoCityId] === 'ACTIVE' ? (
                        <Circle cx={hub + 3.2} cy={hub + 2.4} r={1.55} color={CITY_NODE_HINT.active} />
                      ) : null}
                      {selected ? (
                        <Circle
                          cx={0}
                          cy={0}
                          r={hub + CITY_NODE_SELECTED.ringAdd}
                          color={CITY_NODE_SELECTED.ring}
                          style="stroke"
                          strokeWidth={CITY_NODE_SELECTED.ringWidth}
                        />
                      ) : null}
                      {selected && dashboard ? (
                        <Line
                          p1={vec(0, hub + CITY_NODE_SELECTED.ringAdd + 1)}
                          p2={vec(0, hub + CITY_NODE_SELECTED.ringAdd + 11)}
                          color={CITY_NODE_SELECTED.stem}
                          strokeWidth={1}
                        />
                      ) : null}
                      {connector ? (
                        <Line
                          p1={vec(0, 0)}
                          p2={vec(labelOffset.x, labelOffset.y + 3)}
                          color="rgba(210, 232, 242, 0.35)"
                          strokeWidth={1}
                        />
                      ) : null}
                      {label && selected ? (
                        <RoundedRect
                          x={labelOffset.x - 3}
                          y={labelOffset.y - 11}
                          width={labelWidth + 6}
                          height={14}
                          r={3}
                          color={CITY_LABEL_SELECTED.backplate}
                        />
                      ) : null}
                      {label && labelFont ? (
                        <SkiaText
                          x={labelOffset.x}
                          y={labelOffset.y}
                          text={label}
                          font={labelFont}
                          color={cityLabelFill({
                            selected,
                            capital,
                            locked,
                            connected: !selected && connectedLabelIds.has(city.geoCityId),
                          })}
                        />
                      ) : null}
                    </Group>
                  </Group>
                );
              })}
              {worldLabels.map((label) => {
                const color =
                  label.gameplayState === 'STARTER_AVAILABLE' || label.geoCountryId === selectedId
                    ? '#E8F7FF'
                    : label.gameplayState === 'UNLOCKED'
                      ? '#C5D8EA'
                      : '#8A9BB0';
                const width = Math.max(8, label.displayName.length * 6.4);
                return (
                  <Group
                    key={`wlabel:${label.geoCountryId}`}
                    transform={[{ translateX: label.projectedAnchor.x }, { translateY: label.projectedAnchor.y }]}
                  >
                    <Group transform={markerInvScale}>
                      {font ? (
                        <SkiaText x={-width / 2} y={4} text={label.displayName} font={font} color={color} />
                      ) : null}
                    </Group>
                  </Group>
                );
              })}
            </Group>
            </Group>
            {roundedWorld ? (
              <RoundedRect
                rect={frameRRect}
                color="rgba(90, 170, 220, 0.28)"
                style="stroke"
                strokeWidth={1.6}
              />
            ) : null}
            {countryHero ? (
              <RoundedRect
                rect={frameRRect}
                color="rgba(150, 210, 230, 0.22)"
                style="stroke"
                strokeWidth={1.2}
              />
            ) : null}
          </Canvas>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: MAP_V2_OCEAN },
});

const MapV2GeographicCanvas = memo(forwardRef(MapV2GeographicCanvasInner));
export default MapV2GeographicCanvas;
