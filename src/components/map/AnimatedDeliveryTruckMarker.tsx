import React, { memo, useLayoutEffect, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';

import { useMapScale } from './MapScaleContext';
import { normalizeAngleRadians, shortestAngleDelta } from './mapRoadUtils';
import {
  MAP_TRUCK_MARKER_BORDER,
  MAP_TRUCK_MARKER_CHEVRON_FILL,
  MAP_TRUCK_MARKER_FILL,
  MAP_TRUCK_MARKER_MAX_SCREEN,
  MAP_TRUCK_MARKER_MIN_SCREEN,
  MAP_TRUCK_MARKER_SIZE,
  MAP_TRUCK_MARKER_ANIM_MS,
} from './mapTheme';

export interface AnimatedDeliveryTruckMarkerProps {
  pixelX: number;
  pixelY: number;
  /** Radians — canonical chevron rotation (route tangent in screen space). */
  angleRadians: number;
  progress: number;
  opacity?: number;
  mapScale?: SharedValue<number> | null;
  onPress?: () => void;
}

function VehicleDirectionChevron() {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12">
      <Polygon
        points="2,1.5 10.5,6 2,10.5"
        fill={MAP_TRUCK_MARKER_CHEVRON_FILL}
        stroke={MAP_TRUCK_MARKER_BORDER}
        strokeWidth={0.8}
      />
    </Svg>
  );
}

function AnimatedDeliveryTruckMarkerInner({
  pixelX,
  pixelY,
  angleRadians,
  progress,
  opacity = 1,
  mapScale: mapScaleProp,
  onPress,
}: AnimatedDeliveryTruckMarkerProps) {
  const contextScale = useMapScale();
  const mapScale = mapScaleProp ?? contextScale;
  const hasInitialized = useRef(false);

  const animatedX = useSharedValue(pixelX);
  const animatedY = useSharedValue(pixelY);
  const animatedAngle = useSharedValue(normalizeAngleRadians(angleRadians));

  useLayoutEffect(() => {
    const targetAngle = normalizeAngleRadians(angleRadians);
    const duration = hasInitialized.current ? MAP_TRUCK_MARKER_ANIM_MS : 0;
    hasInitialized.current = true;

    if (duration === 0) {
      animatedX.value = pixelX;
      animatedY.value = pixelY;
      animatedAngle.value = targetAngle;
      return;
    }

    animatedX.value = withTiming(pixelX, { duration });
    animatedY.value = withTiming(pixelY, { duration });
    const delta = shortestAngleDelta(animatedAngle.value, targetAngle);
    animatedAngle.value = withTiming(animatedAngle.value + delta, { duration });
  }, [animatedAngle, animatedX, animatedY, angleRadians, pixelX, pixelY, progress]);

  const positionStyle = useAnimatedStyle(() => {
    const half = MAP_TRUCK_MARKER_SIZE / 2;
    return {
      left: animatedX.value - half,
      top: animatedY.value - half,
      opacity,
    };
  });

  const chevronRotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(animatedAngle.value * 180) / Math.PI}deg` }],
  }));

  const scaleStyle = useAnimatedStyle(() => {
    const scale = mapScale?.value ?? 1;
    const screenSize = MAP_TRUCK_MARKER_SIZE * scale;
    const clampedScreen = Math.min(
      MAP_TRUCK_MARKER_MAX_SCREEN,
      Math.max(MAP_TRUCK_MARKER_MIN_SCREEN, screenSize),
    );
    const inverseScale = screenSize > 0 ? clampedScreen / screenSize : 1;
    return {
      transform: [{ scale: inverseScale }],
    };
  });

  const markerBody = (
    <Animated.View style={[styles.scaleLayer, scaleStyle]}>
      <View style={styles.glow} />
      <View style={styles.circle}>
        <Animated.View style={[styles.chevronLayer, chevronRotationStyle]}>
          <VehicleDirectionChevron />
        </Animated.View>
      </View>
    </Animated.View>
  );

  return (
    <Animated.View
      style={[styles.container, positionStyle]}
      pointerEvents={onPress ? 'box-none' : 'none'}
    >
      {onPress ? (
        <TouchableOpacity onPress={onPress} activeOpacity={0.88} hitSlop={4} style={styles.pressFill}>
          {markerBody}
        </TouchableOpacity>
      ) : (
        markerBody
      )}
    </Animated.View>
  );
}

function areMarkerPropsEqual(
  prev: AnimatedDeliveryTruckMarkerProps,
  next: AnimatedDeliveryTruckMarkerProps,
): boolean {
  return (
    prev.pixelX === next.pixelX &&
    prev.pixelY === next.pixelY &&
    prev.angleRadians === next.angleRadians &&
    prev.progress === next.progress &&
    prev.opacity === next.opacity &&
    prev.onPress === next.onPress &&
    prev.mapScale === next.mapScale
  );
}

const AnimatedDeliveryTruckMarker = memo(AnimatedDeliveryTruckMarkerInner, areMarkerPropsEqual);
AnimatedDeliveryTruckMarker.displayName = 'AnimatedDeliveryTruckMarker';

export default AnimatedDeliveryTruckMarker;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: MAP_TRUCK_MARKER_SIZE,
    height: MAP_TRUCK_MARKER_SIZE,
  },
  scaleLayer: {
    width: MAP_TRUCK_MARKER_SIZE,
    height: MAP_TRUCK_MARKER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: MAP_TRUCK_MARKER_SIZE / 2,
    backgroundColor: 'rgba(93,212,255,0.28)',
    transform: [{ scale: 1.18 }],
  },
  pressFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: MAP_TRUCK_MARKER_SIZE,
    height: MAP_TRUCK_MARKER_SIZE,
    borderRadius: MAP_TRUCK_MARKER_SIZE / 2,
    backgroundColor: MAP_TRUCK_MARKER_FILL,
    borderWidth: 2.5,
    borderColor: MAP_TRUCK_MARKER_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronLayer: {
    width: MAP_TRUCK_MARKER_SIZE,
    height: MAP_TRUCK_MARKER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
