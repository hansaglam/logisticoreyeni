import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useMapScale } from './MapScaleContext';
import {
  MAP_CALIBRATION_INDEX_COLOR,
  MAP_CALIBRATION_INDEX_FONT,
  MAP_CALIBRATION_MARKER_CORE,
  MAP_CALIBRATION_MARKER_FILL,
  MAP_CALIBRATION_MARKER_RING,
  MAP_CALIBRATION_MARKER_RING_FILL,
  MAP_CALIBRATION_MARKER_RING_STROKE,
} from './mapTheme';

export interface CalibrationDebugMarkerProps {
  pixelX: number;
  pixelY: number;
  index: number;
}

const HIT_BOX = 22;
const HALF = HIT_BOX / 2;

function CalibrationDebugMarkerInner({ pixelX, pixelY, index }: CalibrationDebugMarkerProps) {
  const mapScale = useMapScale();

  const animatedStyle = useAnimatedStyle(() => {
    const scale = mapScale?.value ?? 1;
    const inverseScale = scale > 0.001 ? 1 / scale : 1;
    return {
      left: pixelX - HALF,
      top: pixelY - HALF,
      transform: [{ scale: inverseScale }],
    };
  });

  return (
    <Animated.View style={[styles.container, animatedStyle]} pointerEvents="none">
      <View style={styles.ring} />
      <View style={styles.core} />
      <Text style={styles.index}>{index}</Text>
    </Animated.View>
  );
}

const CalibrationDebugMarker = memo(CalibrationDebugMarkerInner);
CalibrationDebugMarker.displayName = 'CalibrationDebugMarker';

export default CalibrationDebugMarker;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: HIT_BOX,
    height: HIT_BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: MAP_CALIBRATION_MARKER_RING,
    height: MAP_CALIBRATION_MARKER_RING,
    borderRadius: MAP_CALIBRATION_MARKER_RING / 2,
    backgroundColor: MAP_CALIBRATION_MARKER_RING_FILL,
    borderWidth: 1.25,
    borderColor: MAP_CALIBRATION_MARKER_RING_STROKE,
  },
  core: {
    position: 'absolute',
    width: MAP_CALIBRATION_MARKER_CORE,
    height: MAP_CALIBRATION_MARKER_CORE,
    borderRadius: MAP_CALIBRATION_MARKER_CORE / 2,
    backgroundColor: MAP_CALIBRATION_MARKER_FILL,
  },
  index: {
    position: 'absolute',
    left: HALF + 6,
    top: HALF - 6 - MAP_CALIBRATION_INDEX_FONT,
    fontSize: MAP_CALIBRATION_INDEX_FONT,
    fontWeight: '700',
    color: MAP_CALIBRATION_INDEX_COLOR,
    lineHeight: MAP_CALIBRATION_INDEX_FONT + 1,
  },
});
