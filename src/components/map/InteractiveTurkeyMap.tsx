import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MapScaleProvider } from './MapScaleContext';
import {
  roundMapCoordinate,
  viewportToContentPoint,
  viewportToNormalizedMapPoint,
  type ViewportToNormalizedResult,
} from './mapCoordinateUtils';
import {
  getClampedTransform,
  isNearFitScale,
  scaleToDetailLevelWorklet,
  zoomToFocalPoint,
} from './mapGestureUtils';
import {
  getMapScaleBounds,
  type MapDetailLevel,
  type MapTransform,
} from './mapTransformUtils';
import {
  MAP_DOUBLE_TAP_MAX_PROXIMITY,
  MAP_DOUBLE_TAP_ZOOM_FACTOR,
  MAP_GESTURE_SNAP_MS,
  MAP_VIEWPORT_BACKGROUND,
} from './mapTheme';

export interface MapContentSize {
  width: number;
  height: number;
}

export interface InteractiveTurkeyMapHandle {
  resetToOperational: () => void;
}

export type MapCalibrationTapResult = ViewportToNormalizedResult;

export interface InteractiveTurkeyMapProps {
  viewportHeight: number;
  contentSize: MapContentSize;
  onCityPressAtContentPoint?: (x: number, y: number) => void;
  onCalibrationTap?: (result: MapCalibrationTapResult) => void;
  onDetailLevelChange?: (level: MapDetailLevel) => void;
  onMapGestureActiveChange?: (active: boolean) => void;
  calibrationMode?: boolean;
  children: React.ReactNode;
}

export type { MapDetailLevel };

function InteractiveTurkeyMapInner(
  {
    viewportHeight,
    contentSize,
    onCityPressAtContentPoint,
    onCalibrationTap,
    onDetailLevelChange,
    onMapGestureActiveChange,
    calibrationMode = false,
    children,
  }: InteractiveTurkeyMapProps,
  ref: React.ForwardedRef<InteractiveTurkeyMapHandle>,
) {
  const [viewportWidth, setViewportWidth] = React.useState(0);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const viewportWidthSv = useSharedValue(0);
  const viewportHeightSv = useSharedValue(viewportHeight);
  const contentWidthSv = useSharedValue(0);
  const contentHeightSv = useSharedValue(0);
  const fitScaleSv = useSharedValue(1);
  const fitTranslateXSv = useSharedValue(0);
  const fitTranslateYSv = useSharedValue(0);
  const operationalScaleSv = useSharedValue(1);
  const operationalTranslateXSv = useSharedValue(0);
  const operationalTranslateYSv = useSharedValue(0);
  const maxScaleSv = useSharedValue(3);
  const detailLevelSv = useSharedValue<MapDetailLevel>('low');
  const panGestureConsumed = useSharedValue(false);
  const pinchGestureActive = useSharedValue(false);

  const didApplyInitial = useRef(false);
  const layoutKeyRef = useRef('');
  const operationalTransformRef = useRef<MapTransform>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });
  const gestureActiveCountRef = useRef(0);

  const transformInput = useMemo(
    () => ({
      viewportWidth,
      viewportHeight,
      contentWidth: contentSize.width,
      contentHeight: contentSize.height,
    }),
    [viewportWidth, viewportHeight, contentSize.width, contentSize.height],
  );

  const scaleBounds = useMemo(
    () => (viewportWidth > 0 && contentSize.width > 0 ? getMapScaleBounds(transformInput) : null),
    [contentSize.height, contentSize.width, transformInput, viewportWidth],
  );

  useEffect(() => {
    viewportHeightSv.value = viewportHeight;
  }, [viewportHeight, viewportHeightSv]);

  useEffect(() => {
    contentWidthSv.value = contentSize.width;
    contentHeightSv.value = contentSize.height;
  }, [contentSize.height, contentSize.width, contentHeightSv, contentWidthSv]);

  useEffect(() => {
    if (!scaleBounds || viewportWidth <= 0 || contentSize.width <= 0) {
      return;
    }

    viewportWidthSv.value = viewportWidth;
    fitScaleSv.value = scaleBounds.fitScale;
    fitTranslateXSv.value = scaleBounds.fitTransform.translateX;
    fitTranslateYSv.value = scaleBounds.fitTransform.translateY;
    operationalScaleSv.value = scaleBounds.operationalScale;
    operationalTranslateXSv.value = scaleBounds.operationalTransform.translateX;
    operationalTranslateYSv.value = scaleBounds.operationalTransform.translateY;
    maxScaleSv.value = scaleBounds.maxScale;
    operationalTransformRef.current = scaleBounds.operationalTransform;

    const layoutKey = `${viewportWidth}x${viewportHeight}:${contentSize.width}x${contentSize.height}`;
    const layoutChanged = layoutKeyRef.current !== layoutKey;
    layoutKeyRef.current = layoutKey;

    const op = scaleBounds.operationalTransform;

    if (!didApplyInitial.current) {
      didApplyInitial.current = true;
      scale.value = op.scale;
      translateX.value = op.translateX;
      translateY.value = op.translateY;
      return;
    }

    if (layoutChanged) {
      scale.value = withTiming(op.scale, { duration: MAP_GESTURE_SNAP_MS });
      translateX.value = withTiming(op.translateX, { duration: MAP_GESTURE_SNAP_MS });
      translateY.value = withTiming(op.translateY, { duration: MAP_GESTURE_SNAP_MS });
    }
  }, [
    contentSize.height,
    contentSize.width,
    scale,
    scaleBounds,
    translateX,
    translateY,
    viewportHeight,
    viewportWidth,
    viewportWidthSv,
    fitScaleSv,
    fitTranslateXSv,
    fitTranslateYSv,
    operationalScaleSv,
    operationalTranslateXSv,
    operationalTranslateYSv,
    maxScaleSv,
  ]);

  const emitDetailLevel = useCallback(
    (level: MapDetailLevel) => {
      onDetailLevelChange?.(level);
    },
    [onDetailLevelChange],
  );

  useAnimatedReaction(
    () => scale.value,
    (currentScale) => {
      const nextLevel = scaleToDetailLevelWorklet(currentScale, operationalScaleSv.value);
      if (nextLevel === detailLevelSv.value) return;
      detailLevelSv.value = nextLevel;
      runOnJS(emitDetailLevel)(nextLevel);
    },
    [emitDetailLevel],
  );

  const notifyGestureBegin = useCallback(() => {
    if (!onMapGestureActiveChange) return;
    gestureActiveCountRef.current += 1;
    if (gestureActiveCountRef.current === 1) {
      onMapGestureActiveChange(true);
    }
  }, [onMapGestureActiveChange]);

  const notifyGestureEnd = useCallback(() => {
    if (!onMapGestureActiveChange) return;
    gestureActiveCountRef.current = Math.max(0, gestureActiveCountRef.current - 1);
    if (gestureActiveCountRef.current === 0) {
      onMapGestureActiveChange(false);
    }
  }, [onMapGestureActiveChange]);

  const dispatchContentTap = useCallback(
    (contentX: number, contentY: number) => {
      onCityPressAtContentPoint?.(contentX, contentY);
    },
    [onCityPressAtContentPoint],
  );

  const dispatchCalibrationTap = useCallback(
    (result: MapCalibrationTapResult) => {
      onCalibrationTap?.(result);
    },
    [onCalibrationTap],
  );

  const logCalibrationOutside = useCallback(() => {
    if (__DEV__) {
      console.warn('[Map calibration] Touch outside map content');
    }
  }, []);

  const applyOperationalTransform = useCallback(
    (animated = true) => {
      const op = operationalTransformRef.current;
      if (animated) {
        scale.value = withTiming(op.scale, { duration: MAP_GESTURE_SNAP_MS });
        translateX.value = withTiming(op.translateX, { duration: MAP_GESTURE_SNAP_MS });
        translateY.value = withTiming(op.translateY, { duration: MAP_GESTURE_SNAP_MS });
      } else {
        scale.value = op.scale;
        translateX.value = op.translateX;
        translateY.value = op.translateY;
      }
    },
    [scale, translateX, translateY],
  );

  useImperativeHandle(ref, () => ({
    resetToOperational: () => applyOperationalTransform(true),
  }), [applyOperationalTransform]);

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          'worklet';
          pinchGestureActive.value = true;
          runOnJS(notifyGestureBegin)();
          savedScale.value = scale.value;
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;
        })
        .onUpdate((event) => {
          'worklet';
          const nextScale = savedScale.value * event.scale;

          if (isNearFitScale(nextScale, fitScaleSv.value)) {
            scale.value = fitScaleSv.value;
            translateX.value = fitTranslateXSv.value;
            translateY.value = fitTranslateYSv.value;
            return;
          }

          const zoomed = zoomToFocalPoint(
            event.focalX,
            event.focalY,
            savedScale.value,
            savedTranslateX.value,
            savedTranslateY.value,
            nextScale,
          );
          const clamped = getClampedTransform({
            scale: nextScale,
            translateX: zoomed.translateX,
            translateY: zoomed.translateY,
            viewportWidth: viewportWidthSv.value,
            viewportHeight: viewportHeightSv.value,
            contentWidth: contentWidthSv.value,
            contentHeight: contentHeightSv.value,
            fitScale: fitScaleSv.value,
            fitTranslateX: fitTranslateXSv.value,
            fitTranslateY: fitTranslateYSv.value,
            maxScale: maxScaleSv.value,
            elastic: true,
          });
          scale.value = clamped.scale;
          translateX.value = clamped.translateX;
          translateY.value = clamped.translateY;
        })
        .onEnd(() => {
          'worklet';
          const clamped = getClampedTransform({
            scale: scale.value,
            translateX: translateX.value,
            translateY: translateY.value,
            viewportWidth: viewportWidthSv.value,
            viewportHeight: viewportHeightSv.value,
            contentWidth: contentWidthSv.value,
            contentHeight: contentHeightSv.value,
            fitScale: fitScaleSv.value,
            fitTranslateX: fitTranslateXSv.value,
            fitTranslateY: fitTranslateYSv.value,
            maxScale: maxScaleSv.value,
            elastic: false,
          });
          scale.value = withTiming(clamped.scale, { duration: MAP_GESTURE_SNAP_MS });
          translateX.value = withTiming(clamped.translateX, { duration: MAP_GESTURE_SNAP_MS });
          translateY.value = withTiming(clamped.translateY, { duration: MAP_GESTURE_SNAP_MS });
        })
        .onFinalize(() => {
          'worklet';
          pinchGestureActive.value = false;
          runOnJS(notifyGestureEnd)();
        }),
    [
      contentHeightSv,
      contentWidthSv,
      fitScaleSv,
      fitTranslateXSv,
      fitTranslateYSv,
      maxScaleSv,
      notifyGestureBegin,
      notifyGestureEnd,
      pinchGestureActive,
      savedScale,
      savedTranslateX,
      savedTranslateY,
      scale,
      translateX,
      translateY,
      viewportHeightSv,
      viewportWidthSv,
    ],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(8)
        .maxPointers(2)
        .onBegin(() => {
          'worklet';
          panGestureConsumed.value = false;
          runOnJS(notifyGestureBegin)();
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;
        })
        .onUpdate((event) => {
          'worklet';
          if (Math.abs(event.translationX) > 2 || Math.abs(event.translationY) > 2) {
            panGestureConsumed.value = true;
          }
          const clamped = getClampedTransform({
            scale: scale.value,
            translateX: savedTranslateX.value + event.translationX,
            translateY: savedTranslateY.value + event.translationY,
            viewportWidth: viewportWidthSv.value,
            viewportHeight: viewportHeightSv.value,
            contentWidth: contentWidthSv.value,
            contentHeight: contentHeightSv.value,
            fitScale: fitScaleSv.value,
            fitTranslateX: fitTranslateXSv.value,
            fitTranslateY: fitTranslateYSv.value,
            maxScale: maxScaleSv.value,
            elastic: true,
          });
          translateX.value = clamped.translateX;
          translateY.value = clamped.translateY;
        })
        .onEnd(() => {
          'worklet';
          const clamped = getClampedTransform({
            scale: scale.value,
            translateX: translateX.value,
            translateY: translateY.value,
            viewportWidth: viewportWidthSv.value,
            viewportHeight: viewportHeightSv.value,
            contentWidth: contentWidthSv.value,
            contentHeight: contentHeightSv.value,
            fitScale: fitScaleSv.value,
            fitTranslateX: fitTranslateXSv.value,
            fitTranslateY: fitTranslateYSv.value,
            maxScale: maxScaleSv.value,
            elastic: false,
          });
          scale.value = withTiming(clamped.scale, { duration: MAP_GESTURE_SNAP_MS });
          translateX.value = withTiming(clamped.translateX, { duration: MAP_GESTURE_SNAP_MS });
          translateY.value = withTiming(clamped.translateY, { duration: MAP_GESTURE_SNAP_MS });
        })
        .onFinalize(() => {
          'worklet';
          runOnJS(notifyGestureEnd)();
        }),
    [
      contentHeightSv,
      contentWidthSv,
      fitScaleSv,
      fitTranslateXSv,
      fitTranslateYSv,
      maxScaleSv,
      notifyGestureBegin,
      notifyGestureEnd,
      panGestureConsumed,
      savedTranslateX,
      savedTranslateY,
      scale,
      translateX,
      translateY,
      viewportHeightSv,
      viewportWidthSv,
    ],
  );

  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(280)
        .maxDistance(14)
        .onEnd((event) => {
          'worklet';
          const currentScale = scale.value;
          const fitScale = fitScaleSv.value;
          const opScale = operationalScaleSv.value;
          const maxScale = maxScaleSv.value;

          if (currentScale >= maxScale * MAP_DOUBLE_TAP_MAX_PROXIMITY) {
            scale.value = withTiming(opScale, { duration: MAP_GESTURE_SNAP_MS });
            translateX.value = withTiming(operationalTranslateXSv.value, {
              duration: MAP_GESTURE_SNAP_MS,
            });
            translateY.value = withTiming(operationalTranslateYSv.value, {
              duration: MAP_GESTURE_SNAP_MS,
            });
            return;
          }

          let targetScale = currentScale;
          if (isNearFitScale(currentScale, fitScale)) {
            targetScale = opScale;
          } else {
            targetScale = Math.min(maxScale, currentScale * MAP_DOUBLE_TAP_ZOOM_FACTOR);
          }

          const zoomed = zoomToFocalPoint(
            event.x,
            event.y,
            currentScale,
            translateX.value,
            translateY.value,
            targetScale,
          );
          const clamped = getClampedTransform({
            scale: targetScale,
            translateX: zoomed.translateX,
            translateY: zoomed.translateY,
            viewportWidth: viewportWidthSv.value,
            viewportHeight: viewportHeightSv.value,
            contentWidth: contentWidthSv.value,
            contentHeight: contentHeightSv.value,
            fitScale,
            fitTranslateX: fitTranslateXSv.value,
            fitTranslateY: fitTranslateYSv.value,
            maxScale,
            elastic: false,
          });
          scale.value = withTiming(clamped.scale, { duration: MAP_GESTURE_SNAP_MS });
          translateX.value = withTiming(clamped.translateX, { duration: MAP_GESTURE_SNAP_MS });
          translateY.value = withTiming(clamped.translateY, { duration: MAP_GESTURE_SNAP_MS });
        }),
    [
      fitScaleSv,
      fitTranslateXSv,
      fitTranslateYSv,
      maxScaleSv,
      operationalScaleSv,
      operationalTranslateXSv,
      operationalTranslateYSv,
      scale,
      translateX,
      translateY,
    ],
  );

  const mapTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(250)
        .maxDistance(10)
        .onEnd((event) => {
          'worklet';
          if (panGestureConsumed.value || pinchGestureActive.value) {
            return;
          }

          const transform = {
            scale: scale.value,
            translateX: translateX.value,
            translateY: translateY.value,
          };
          const bounds = {
            width: contentWidthSv.value,
            height: contentHeightSv.value,
          };

          if (calibrationMode) {
            const mapped = viewportToNormalizedMapPoint(event.x, event.y, transform, bounds);
            if (!mapped.isInsideContent) {
              runOnJS(logCalibrationOutside)();
              return;
            }
            runOnJS(dispatchCalibrationTap)({
              ...mapped,
              normalized: {
                x: roundMapCoordinate(mapped.normalized.x, 4),
                y: roundMapCoordinate(mapped.normalized.y, 4),
              },
            });
            return;
          }

          const point = viewportToContentPoint(event.x, event.y, transform);
          runOnJS(dispatchContentTap)(point.x, point.y);
        }),
    [
      calibrationMode,
      contentHeightSv,
      contentWidthSv,
      dispatchCalibrationTap,
      dispatchContentTap,
      logCalibrationOutside,
      panGestureConsumed,
      pinchGestureActive,
      scale,
      translateX,
      translateY,
    ],
  );

  const mapGestures = useMemo(
    () =>
      Gesture.Simultaneous(
        pinchGesture,
        panGesture,
        Gesture.Exclusive(doubleTapGesture, mapTapGesture),
      ),
    [doubleTapGesture, mapTapGesture, panGesture, pinchGesture],
  );

  const animatedContentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) {
      setViewportWidth(width);
    }
  }, []);

  return (
    <GestureDetector gesture={mapGestures}>
      <View
        style={[styles.viewport, { height: viewportHeight }]}
        onLayout={handleViewportLayout}
      >
        {viewportWidth > 0 && contentSize.width > 0 ? (
          <Animated.View
            style={[
              styles.contentLayer,
              {
                width: contentSize.width,
                height: contentSize.height,
                transformOrigin: 'top left',
              },
              animatedContentStyle,
            ]}
          >
            <MapScaleProvider mapScale={scale}>{children}</MapScaleProvider>
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const InteractiveTurkeyMap = memo(forwardRef(InteractiveTurkeyMapInner));
InteractiveTurkeyMap.displayName = 'InteractiveTurkeyMap';

export default InteractiveTurkeyMap;

const styles = StyleSheet.create({
  viewport: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: MAP_VIEWPORT_BACKGROUND,
  },
  contentLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
