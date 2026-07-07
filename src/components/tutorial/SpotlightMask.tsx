import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { TutorialLayoutRect, TutorialPointerOffset } from '../../tutorial/types';
import { isValidTutorialRect } from '../../tutorial/types';

const OVERLAY_COLOR = 'rgba(5, 10, 18, 0.82)';
const HIGHLIGHT_BORDER = '#3B82F6';

interface SpotlightMaskProps {
  width: number;
  height: number;
  holeRect: TutorialLayoutRect | null;
}

function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.min(radius, width / 2, height / 2);
  return [
    `M ${x + r} ${y}`,
    `H ${x + width - r}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `V ${y + height - r}`,
    `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `H ${x + r}`,
    `Q ${x} ${y + height} ${x} ${y + height - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

export function SpotlightMask({ width, height, holeRect }: SpotlightMaskProps) {
  const hole = useMemo(() => {
    if (!isValidTutorialRect(holeRect)) {
      return null;
    }
    const x = Math.max(0, holeRect.x);
    const y = Math.max(0, holeRect.y);
    const w = Math.min(width - x, holeRect.width);
    const h = Math.min(height - y, holeRect.height);
    if (w <= 0 || h <= 0) {
      return null;
    }
    return { x, y, width: w, height: h };
  }, [height, holeRect, width]);

  const path = useMemo(() => {
    if (!hole) {
      return `M 0 0 H ${width} V ${height} H 0 Z`;
    }
    const outer = `M 0 0 H ${width} V ${height} H 0 Z`;
    const inner = roundedRectPath(hole.x, hole.y, hole.width, hole.height, 12);
    return `${outer} ${inner}`;
  }, [height, hole, width]);

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={path} fill={OVERLAY_COLOR} fillRule="evenodd" />
      {hole ? (
        <Path
          d={roundedRectPath(hole.x, hole.y, hole.width, hole.height, 12)}
          stroke={HIGHLIGHT_BORDER}
          strokeWidth={2}
          fill="transparent"
        />
      ) : null}
    </Svg>
  );
}

export function computePointerPosition({
  rect,
  screenHeight,
  screenWidth,
  safeAreaBottom,
  tabBarHeight,
  pointerOffset,
}: {
  rect: TutorialLayoutRect;
  screenHeight: number;
  screenWidth: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  pointerOffset?: TutorialPointerOffset;
}): { left: number; top: number; pointsUp: boolean } {
  const bottomLimit = screenHeight - safeAreaBottom - 16;
  const isBottomTabTarget = rect.y + rect.height > screenHeight - tabBarHeight - 24;
  const isCompactTarget = rect.height < 56;

  const defaultLeft = rect.x + rect.width * 0.55 + (pointerOffset?.x ?? 0);
  const defaultTopBelow = rect.y + rect.height + 8 + (pointerOffset?.y ?? 0);
  const defaultTopAbove = rect.y - 30 + (pointerOffset?.y ?? 0);

  let left = defaultLeft;
  let top = isBottomTabTarget || defaultTopBelow + 28 > bottomLimit ? defaultTopAbove : defaultTopBelow;
  let pointsUp = top < rect.y;

  if (isCompactTarget && !isBottomTabTarget) {
    left = rect.x + rect.width * 0.72;
    top = rect.y + rect.height * 0.35;
    pointsUp = false;
  }

  left = Math.max(8, Math.min(screenWidth - 36, left));
  top = Math.max(12, Math.min(bottomLimit - 28, top));

  return { left, top, pointsUp };
}

interface TutorialFingerHintProps {
  rect: TutorialLayoutRect;
  screenHeight: number;
  screenWidth: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  pointerOffset?: TutorialPointerOffset;
}

export function TutorialFingerHint({
  rect,
  screenHeight,
  screenWidth,
  safeAreaBottom,
  tabBarHeight,
  pointerOffset,
}: TutorialFingerHintProps) {
  const bounce = useRef(new Animated.Value(0)).current;
  const pointerPosition = useMemo(
    () =>
      computePointerPosition({
        rect,
        screenHeight,
        screenWidth,
        safeAreaBottom,
        tabBarHeight,
        pointerOffset,
      }),
    [pointerOffset, rect, safeAreaBottom, screenHeight, screenWidth, tabBarHeight],
  );

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bounce, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [bounce]);

  const translateY = bounce.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 6],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.fingerWrap,
        {
          left: pointerPosition.left,
          top: pointerPosition.top,
          transform: [
            {
              translateY: pointerPosition.pointsUp
                ? Animated.multiply(translateY, -1)
                : translateY,
            },
          ],
        },
      ]}
    >
      <View style={styles.fingerBadge}>
        <Text style={styles.fingerEmoji}>{pointerPosition.pointsUp ? '👇' : '👆'}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fingerWrap: {
    position: 'absolute',
    zIndex: 10002,
  },
  fingerBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderRadius: 16,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.45)',
  },
  fingerEmoji: {
    fontSize: 24,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
});
