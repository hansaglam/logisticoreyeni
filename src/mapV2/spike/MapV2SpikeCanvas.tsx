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
import { AppState, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  Blur,
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  matchFont,
  Path,
  RoundedRect,
  Text as SkiaText,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import {
  SPIKE_GESTURE_SNAP_MS,
  SPIKE_MAX_SCALE,
  SPIKE_WORLD_HEIGHT,
  SPIKE_WORLD_WIDTH,
  clampSpikeCamera,
  spikeFitScale,
  spikeFitTranslate,
  spikeVisibleWorldAabb,
  spikeZoomToFocal,
} from './spikeCamera';
import { getHeadingAtProgressXY, getPointAtProgressXY } from './spikeRouteMath';
import {
  SPIKE_ISLAND_PATH,
  SPIKE_LABELS,
  SPIKE_REGION_PATHS,
  SPIKE_VEHICLE_ROUTE,
  createSpikeMarkerPool,
  createSpikeRoutes,
  type SpikeMarker,
} from './spikeSyntheticData';

export type SpikeCanvasLayers = {
  regions: boolean;
  routes: boolean;
  markers: boolean;
  labels: boolean;
  vehicle: boolean;
};

export type MapV2SpikeCanvasHandle = {
  resetCamera: () => void;
};

export type MapV2SpikeCanvasProps = {
  markerCount: number;
  routeCount: number;
  animationPaused: boolean;
  reduceMotion: boolean;
  qualityEffects: boolean;
  cullEnabled: boolean;
  layers: SpikeCanvasLayers;
  selectedId: string;
  onSelectId: (id: string) => void;
  onCullStats: (visible: number, total: number) => void;
};

const ROUTE_COLOR: Record<string, string> = {
  ROAD: '#F59E0B',
  RAIL: '#A78BFA',
  SEA: '#22D3EE',
  AIR: '#FB7185',
};

function tryMatchSpikeFont() {
  try {
    return matchFont({
      fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }) ?? 'sans-serif',
      fontSize: 13,
      fontWeight: 'bold',
      fontStyle: 'normal',
    });
  } catch {
    return null;
  }
}

function markerColor(marker: SpikeMarker, selected: boolean): string {
  if (marker.locked) return '#EF4444';
  if (selected) return '#FDE68A';
  if (marker.kind === 'hub') return '#F59E0B';
  if (marker.kind === 'depot') return '#38BDF8';
  return '#94A3B8';
}

const MapV2SpikeCanvasInner = forwardRef<MapV2SpikeCanvasHandle, MapV2SpikeCanvasProps>(
  function MapV2SpikeCanvasInner(
    {
      markerCount,
      routeCount,
      animationPaused,
      reduceMotion,
      qualityEffects,
      cullEnabled,
      layers,
      selectedId,
      onSelectId,
      onCullStats,
    },
    ref,
  ) {
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const font = useMemo(() => tryMatchSpikeFont(), []);
    const allMarkers = useMemo(() => createSpikeMarkerPool(markerCount), [markerCount]);
    const routes = useMemo(() => createSpikeRoutes(routeCount), [routeCount]);
    const [visibleMarkers, setVisibleMarkers] = useState<SpikeMarker[]>(allMarkers);
    const markersRef = useRef(allMarkers);
    markersRef.current = allMarkers;
    const cullEnabledRef = useRef(cullEnabled);
    cullEnabledRef.current = cullEnabled;

    const scale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedScale = useSharedValue(1);
    const savedTx = useSharedValue(0);
    const savedTy = useSharedValue(0);
    const vw = useSharedValue(0);
    const vh = useSharedValue(0);
    const pinchActive = useSharedValue(false);
    const panConsumed = useSharedValue(false);
    const progress = useSharedValue(0);
    const lastCullPublishAt = useSharedValue(0);

    const vx = SPIKE_VEHICLE_ROUTE.points.map((p) => p.x);
    const vy = SPIKE_VEHICLE_ROUTE.points.map((p) => p.y);
    const vCum = SPIKE_VEHICLE_ROUTE.cumLen;

    const applyFit = useCallback(
      (animated: boolean) => {
        if (viewport.width <= 0 || viewport.height <= 0) return;
        const nextScale = spikeFitScale(viewport.width, viewport.height);
        const fit = spikeFitTranslate(viewport.width, viewport.height, nextScale);
        if (animated) {
          scale.value = withTiming(nextScale, { duration: SPIKE_GESTURE_SNAP_MS });
          translateX.value = withTiming(fit.translateX, { duration: SPIKE_GESTURE_SNAP_MS });
          translateY.value = withTiming(fit.translateY, { duration: SPIKE_GESTURE_SNAP_MS });
        } else {
          scale.value = nextScale;
          translateX.value = fit.translateX;
          translateY.value = fit.translateY;
        }
      },
      [scale, translateX, translateY, viewport.height, viewport.width],
    );

    useImperativeHandle(ref, () => ({ resetCamera: () => applyFit(true) }), [applyFit]);

    useEffect(() => {
      vw.value = viewport.width;
      vh.value = viewport.height;
      if (viewport.width > 0) applyFit(false);
    }, [applyFit, vh, viewport.height, viewport.width, vw]);

    useEffect(() => {
      cancelAnimation(progress);
      if (animationPaused) return;
      progress.value = withRepeat(
        withTiming(1, { duration: reduceMotion ? 28000 : 10000, easing: Easing.linear }),
        -1,
        false,
      );
      return () => {
        cancelAnimation(progress);
      };
    }, [animationPaused, progress, reduceMotion]);

    useEffect(() => {
      const sub = AppState.addEventListener('change', (state) => {
        if (state !== 'active') {
          cancelAnimation(progress);
        } else if (!animationPaused) {
          progress.value = withRepeat(
            withTiming(1, { duration: reduceMotion ? 28000 : 10000, easing: Easing.linear }),
            -1,
            false,
          );
        }
      });
      return () => {
        sub.remove();
        cancelAnimation(progress);
      };
    }, [animationPaused, progress, reduceMotion]);

    const cameraTransform = useDerivedValue(() => [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ]);

    const invertScaleTransform = useDerivedValue(() => [{ scale: scale.value === 0 ? 1 : 1 / scale.value }]);

    const vehicleTransform = useDerivedValue(() => {
      const p = getPointAtProgressXY(vx, vy, vCum, progress.value);
      const heading = getHeadingAtProgressXY(vx, vy, vCum, progress.value);
      return [{ translateX: p.x }, { translateY: p.y }, { rotate: heading }];
    });

    const publishCull = useCallback(
      (minX: number, minY: number, maxX: number, maxY: number) => {
        const pool = markersRef.current;
        const inside: SpikeMarker[] = [];
        for (const marker of pool) {
          if (marker.x >= minX && marker.x <= maxX && marker.y >= minY && marker.y <= maxY) {
            inside.push(marker);
          }
        }
        if (cullEnabledRef.current) {
          onCullStats(inside.length, pool.length);
          setVisibleMarkers(inside);
        }
      },
      [onCullStats],
    );

    useEffect(() => {
      setVisibleMarkers(allMarkers);
      onCullStats(allMarkers.length, allMarkers.length);
    }, [allMarkers, onCullStats]);

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
        if (now - lastCullPublishAt.value < 140) return;
        lastCullPublishAt.value = now;
        const aabb = spikeVisibleWorldAabb(cam.x, cam.y, cam.s, cam.w, cam.h, 24);
        runOnJS(publishCull)(aabb.minX, aabb.minY, aabb.maxX, aabb.maxY);
      },
    );

    const selectAt = useCallback(
      (worldX: number, worldY: number) => {
        let best: SpikeMarker | null = null;
        let bestD = 28;
        for (const marker of markersRef.current) {
          const d = Math.hypot(marker.x - worldX, marker.y - worldY);
          if (d < bestD) {
            bestD = d;
            best = marker;
          }
        }
        if (best) onSelectId(best.id);
      },
      [onSelectId],
    );

    const pinchGesture = useMemo(
      () =>
        Gesture.Pinch()
          .onBegin(() => {
            'worklet';
            pinchActive.value = true;
            savedScale.value = scale.value;
            savedTx.value = translateX.value;
            savedTy.value = translateY.value;
          })
          .onUpdate((event) => {
            'worklet';
            const nextScale = savedScale.value * event.scale;
            const zoomed = spikeZoomToFocal(
              event.focalX,
              event.focalY,
              savedScale.value,
              savedTx.value,
              savedTy.value,
              nextScale,
            );
            const clamped = clampSpikeCamera({
              scale: nextScale,
              translateX: zoomed.translateX,
              translateY: zoomed.translateY,
              viewportWidth: vw.value,
              viewportHeight: vh.value,
              elastic: true,
            });
            scale.value = clamped.scale;
            translateX.value = clamped.translateX;
            translateY.value = clamped.translateY;
          })
          .onFinalize(() => {
            'worklet';
            pinchActive.value = false;
            const clamped = clampSpikeCamera({
              scale: scale.value,
              translateX: translateX.value,
              translateY: translateY.value,
              viewportWidth: vw.value,
              viewportHeight: vh.value,
              elastic: false,
            });
            scale.value = withTiming(clamped.scale, { duration: SPIKE_GESTURE_SNAP_MS });
            translateX.value = withTiming(clamped.translateX, { duration: SPIKE_GESTURE_SNAP_MS });
            translateY.value = withTiming(clamped.translateY, { duration: SPIKE_GESTURE_SNAP_MS });
          }),
      [pinchActive, savedScale, savedTx, savedTy, scale, translateX, translateY, vh, vw],
    );

    const panGesture = useMemo(
      () =>
        Gesture.Pan()
          .minDistance(8)
          .maxPointers(2)
          .onBegin(() => {
            'worklet';
            panConsumed.value = false;
            savedTx.value = translateX.value;
            savedTy.value = translateY.value;
          })
          .onUpdate((event) => {
            'worklet';
            if (Math.abs(event.translationX) > 2 || Math.abs(event.translationY) > 2) {
              panConsumed.value = true;
            }
            const clamped = clampSpikeCamera({
              scale: scale.value,
              translateX: savedTx.value + event.translationX,
              translateY: savedTy.value + event.translationY,
              viewportWidth: vw.value,
              viewportHeight: vh.value,
              elastic: true,
            });
            translateX.value = clamped.translateX;
            translateY.value = clamped.translateY;
          })
          .onEnd(() => {
            'worklet';
            const clamped = clampSpikeCamera({
              scale: scale.value,
              translateX: translateX.value,
              translateY: translateY.value,
              viewportWidth: vw.value,
              viewportHeight: vh.value,
              elastic: false,
            });
            translateX.value = withTiming(clamped.translateX, { duration: SPIKE_GESTURE_SNAP_MS });
            translateY.value = withTiming(clamped.translateY, { duration: SPIKE_GESTURE_SNAP_MS });
          }),
      [panConsumed, savedTx, savedTy, scale, translateX, translateY, vh, vw],
    );

    const doubleTapGesture = useMemo(
      () =>
        Gesture.Tap()
          .numberOfTaps(2)
          .maxDuration(280)
          .onEnd((event) => {
            'worklet';
            const current = scale.value;
            const target = Math.min(SPIKE_MAX_SCALE, current * 1.75);
            const zoomed = spikeZoomToFocal(
              event.x,
              event.y,
              current,
              translateX.value,
              translateY.value,
              target,
            );
            const clamped = clampSpikeCamera({
              scale: target,
              translateX: zoomed.translateX,
              translateY: zoomed.translateY,
              viewportWidth: vw.value,
              viewportHeight: vh.value,
              elastic: false,
            });
            scale.value = withTiming(clamped.scale, { duration: SPIKE_GESTURE_SNAP_MS });
            translateX.value = withTiming(clamped.translateX, { duration: SPIKE_GESTURE_SNAP_MS });
            translateY.value = withTiming(clamped.translateY, { duration: SPIKE_GESTURE_SNAP_MS });
          }),
      [scale, translateX, translateY, vh, vw],
    );

    const tapGesture = useMemo(
      () =>
        Gesture.Tap()
          .numberOfTaps(1)
          .maxDuration(250)
          .onEnd((event, success) => {
            'worklet';
            if (!success || panConsumed.value || pinchActive.value) return;
            const worldX = (event.x - translateX.value) / scale.value;
            const worldY = (event.y - translateY.value) / scale.value;
            runOnJS(selectAt)(worldX, worldY);
          }),
      [panConsumed, pinchActive, scale, selectAt, translateX, translateY],
    );

    const composed = useMemo(
      () =>
        Gesture.Simultaneous(
          pinchGesture,
          panGesture,
          Gesture.Exclusive(doubleTapGesture, tapGesture),
        ),
      [doubleTapGesture, panGesture, pinchGesture, tapGesture],
    );

    const onLayout = useCallback((event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      if (width > 0 && height > 0) {
        setViewport({ width, height });
      }
    }, []);

    const drawnMarkers = cullEnabled ? visibleMarkers : allMarkers;

    return (
      <GestureDetector gesture={composed}>
        <View style={styles.fill} onLayout={onLayout} collapsable={false}>
          {viewport.width > 0 ? (
            <Canvas style={styles.fill}>
              <RoundedRect
                x={0}
                y={0}
                width={viewport.width}
                height={viewport.height}
                r={0}
                color="#020617"
              />
              <Group transform={cameraTransform} origin={{ x: 0, y: 0 }}>
                <RoundedRect
                  x={0}
                  y={0}
                  width={SPIKE_WORLD_WIDTH}
                  height={SPIKE_WORLD_HEIGHT}
                  r={0}
                  color="#0B1C2C"
                />
                <Path path={SPIKE_ISLAND_PATH} color="#134E4A" style="fill" />
                {layers.regions
                  ? SPIKE_REGION_PATHS.map((path, index) => (
                      <Path
                        key={`reg-${index}`}
                        path={path}
                        color={index === 0 ? '#1E3A5F' : index === 1 ? '#3F2A4A' : '#3F3F1A'}
                        style="fill"
                        opacity={0.85}
                      />
                    ))
                  : null}
                {layers.routes
                  ? routes.map((route) => (
                      <Path
                        key={route.id}
                        path={route.path}
                        color={ROUTE_COLOR[route.mode] ?? '#94A3B8'}
                        style="stroke"
                        strokeWidth={route.mode === 'AIR' ? 2 : route.mode === 'SEA' ? 5 : 4}
                        strokeJoin="round"
                        strokeCap="round"
                      >
                        {route.mode === 'RAIL' || route.mode === 'AIR' ? (
                          <DashPathEffect intervals={route.mode === 'AIR' ? [10, 10] : [14, 8]} />
                        ) : null}
                      </Path>
                    ))
                  : null}
                {layers.markers
                  ? drawnMarkers.map((marker) => {
                      const selected = marker.id === selectedId;
                      const color = markerColor(marker, selected);
                      const radius = marker.kind === 'hub' ? 9 : marker.kind === 'depot' ? 6 : 4;
                      const circle = (
                        <Circle cx={0} cy={0} r={radius} color={color}>
                          {selected && qualityEffects && !reduceMotion ? <Blur blur={3} /> : null}
                        </Circle>
                      );
                      if (marker.scaleMode === 'screen') {
                        return (
                          <Group key={marker.id} transform={[{ translateX: marker.x }, { translateY: marker.y }]}>
                            <Group transform={invertScaleTransform}>{circle}</Group>
                          </Group>
                        );
                      }
                      return (
                        <Group key={marker.id} transform={[{ translateX: marker.x }, { translateY: marker.y }]}>
                          {circle}
                        </Group>
                      );
                    })
                  : null}
                {layers.vehicle ? (
                  <Group transform={vehicleTransform}>
                    <Circle cx={0} cy={0} r={8} color="#F8FAFC" />
                    <Circle cx={10} cy={0} r={3} color="#0F172A" />
                  </Group>
                ) : null}
                {layers.labels && font
                  ? SPIKE_LABELS.map((label) => (
                      <SkiaText
                        key={label.id}
                        x={label.x}
                        y={label.y}
                        text={label.text}
                        font={font}
                        color="#E2E8F0"
                      />
                    ))
                  : null}
              </Group>
            </Canvas>
          ) : null}
        </View>
      </GestureDetector>
    );
  },
);

const MapV2SpikeCanvas = memo(MapV2SpikeCanvasInner);
export default MapV2SpikeCanvas;

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
