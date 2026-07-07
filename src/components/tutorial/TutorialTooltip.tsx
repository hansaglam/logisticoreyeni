import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '../ui';
import { getTabBarHeight } from '../../constants/layout';
import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import type { TutorialLayoutRect } from '../../tutorial/types';
import { isValidTutorialRect } from '../../tutorial/types';

const SCREEN_PADDING = 20;
const TARGET_GAP = 14;
const ESTIMATED_TOOLTIP_HEIGHT = 148;
const HEIGHT_UPDATE_THRESHOLD = 8;

interface TutorialTooltipProps {
  stepId: string;
  title: string;
  description: string;
  stepLabel: string;
  primaryButtonLabel: string;
  onNext: () => void;
  onSkip: () => void;
  anchorRect: TutorialLayoutRect | null;
  fallbackMode?: boolean;
  screenWidth: number;
  screenHeight: number;
}

function computeTooltipLayout({
  anchorRect,
  screenWidth,
  screenHeight,
  safeAreaTop,
  safeAreaBottom,
  tabBarHeight,
  tooltipWidth,
  tooltipHeight,
}: {
  anchorRect: TutorialLayoutRect | null;
  screenWidth: number;
  screenHeight: number;
  safeAreaTop: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  tooltipWidth: number;
  tooltipHeight: number;
}): { top: number; left: number } {
  const minTop = safeAreaTop + 12;
  const maxTop = screenHeight - tooltipHeight - safeAreaBottom - 16;
  const minLeft = SCREEN_PADDING;
  const maxLeft = screenWidth - tooltipWidth - SCREEN_PADDING;

  if (!isValidTutorialRect(anchorRect)) {
    return {
      top: Math.max(minTop, Math.min(maxTop, screenHeight * 0.14)),
      left: Math.max(minLeft, (screenWidth - tooltipWidth) / 2),
    };
  }

  const targetBottom = anchorRect.y + anchorRect.height;
  const targetCenterX = anchorRect.x + anchorRect.width / 2;
  const isBottomTabTarget = targetBottom > screenHeight - tabBarHeight - 24;

  const spaceBelow =
    screenHeight - targetBottom - TARGET_GAP - safeAreaBottom - (isBottomTabTarget ? tabBarHeight : 0);
  const spaceAbove = anchorRect.y - TARGET_GAP - minTop;

  let top: number;
  if (isBottomTabTarget) {
    top = anchorRect.y - TARGET_GAP - tooltipHeight;
  } else if (spaceBelow >= tooltipHeight && spaceBelow >= spaceAbove) {
    top = targetBottom + TARGET_GAP;
  } else if (spaceAbove >= tooltipHeight) {
    top = anchorRect.y - TARGET_GAP - tooltipHeight;
  } else if (spaceBelow >= spaceAbove) {
    top = targetBottom + TARGET_GAP;
  } else {
    top = anchorRect.y - TARGET_GAP - tooltipHeight;
  }

  top = Math.max(minTop, Math.min(maxTop, top));

  let left = targetCenterX - tooltipWidth / 2;
  left = Math.max(minLeft, Math.min(maxLeft, left));

  return { top, left };
}

export function TutorialTooltip({
  stepId,
  title,
  description,
  stepLabel,
  primaryButtonLabel,
  onNext,
  onSkip,
  anchorRect,
  fallbackMode = false,
  screenWidth,
  screenHeight,
}: TutorialTooltipProps) {
  const insets = useSafeAreaInsets();
  const { tabBarHeight } = useTabBarLayout();
  const tooltipWidth = Math.min(screenWidth - 48, 320);
  const [measuredHeight, setMeasuredHeight] = useState(ESTIMATED_TOOLTIP_HEIGHT);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    setMeasuredHeight(ESTIMATED_TOOLTIP_HEIGHT);
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, stepId]);

  const tooltipHeight = measuredHeight || ESTIMATED_TOOLTIP_HEIGHT;
  const position = useMemo(
    () =>
      computeTooltipLayout({
        anchorRect: fallbackMode ? null : anchorRect,
        screenWidth,
        screenHeight,
        safeAreaTop: insets.top,
        safeAreaBottom: insets.bottom,
        tabBarHeight: getTabBarHeight(insets.bottom),
        tooltipWidth,
        tooltipHeight,
      }),
    [
      anchorRect,
      fallbackMode,
      insets.bottom,
      insets.top,
      screenHeight,
      screenWidth,
      stepId,
      tooltipHeight,
      tooltipWidth,
    ],
  );

  const handleLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
    const nextHeight = event.nativeEvent.layout.height;
    if (nextHeight <= 0) {
      return;
    }
    setMeasuredHeight((current) => {
      if (Math.abs(nextHeight - current) <= HEIGHT_UPDATE_THRESHOLD) {
        return current;
      }
      return nextHeight;
    });
  }, []);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.tooltipWrap,
        {
          top: position.top,
          left: position.left,
          width: tooltipWidth,
          opacity: fadeAnim,
          transform: [
            {
              scale: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.98, 1],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.tooltipCard} onLayout={handleLayout}>
        <View style={styles.tooltipAccent} />
        <Text style={styles.stepLabel}>{stepLabel}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <View style={styles.actionsRow}>
          <Pressable onPress={onSkip} hitSlop={8} style={styles.skipButton}>
            <Text style={styles.skipText}>Atla</Text>
          </Pressable>
          <ActionButton
            label={primaryButtonLabel}
            onPress={onNext}
            variant="primary"
            compact
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tooltipWrap: {
    position: 'absolute',
    zIndex: 10003,
  },
  tooltipCard: {
    backgroundColor: '#121527',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.75)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    overflow: 'hidden',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  tooltipAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
  },
  stepLabel: {
    fontSize: 11,
    lineHeight: 14,
    color: '#F59E0B',
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 16,
    lineHeight: 20,
    color: '#F8FAFC',
    fontWeight: '800',
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    color: '#94A3B8',
    marginBottom: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  skipButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  skipText: {
    fontSize: 13,
    color: 'rgba(148, 163, 184, 0.75)',
    fontWeight: '700',
  },
});
