import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ENABLE_SPOTLIGHT_TUTORIAL } from '../../tutorial/featureFlags';
import { getSpotlightTutorial } from '../../tutorial/spotlightTutorialConfig';
import {
  expandTutorialRect,
  isValidTutorialRect,
  shouldShowTutorialPointer,
  type TutorialLayoutRect,
} from '../../tutorial/types';
import { getTabBarHeight } from '../../constants/layout';
import { useSpotlightTutorialStore } from '../../store/spotlightTutorialStore';
import { SpotlightMask, TutorialFingerHint } from './SpotlightMask';
import { TutorialTooltip } from './TutorialTooltip';

interface TutorialOverlayProps {
  layer?: 'root' | 'modal';
}

function clampHoleRect(
  rect: TutorialLayoutRect,
  screenWidth: number,
  screenHeight: number,
): TutorialLayoutRect {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const width = Math.min(screenWidth - x, rect.width);
  const height = Math.min(screenHeight - y, rect.height);
  return { x, y, width, height };
}

interface PointerLayerProps {
  rect: TutorialLayoutRect;
  screenWidth: number;
  screenHeight: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  pointerOffset?: { x?: number; y?: number };
}

function TutorialPointerLayer({
  rect,
  screenWidth,
  screenHeight,
  safeAreaBottom,
  tabBarHeight,
  pointerOffset,
}: PointerLayerProps) {
  return (
    <TutorialFingerHint
      rect={rect}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      safeAreaBottom={safeAreaBottom}
      tabBarHeight={tabBarHeight}
      pointerOffset={pointerOffset}
    />
  );
}

function SpotlightOverlay({
  screenWidth,
  screenHeight,
  safeAreaBottom,
  tabBarHeight,
  holeRect,
  showPointer,
  pointerOffset,
  onHolePress,
  tooltip,
}: {
  screenWidth: number;
  screenHeight: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  holeRect: TutorialLayoutRect;
  showPointer: boolean;
  pointerOffset?: { x?: number; y?: number };
  onHolePress: () => void;
  tooltip: React.ReactNode;
}) {
  const hole = clampHoleRect(holeRect, screenWidth, screenHeight);

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none">
      <SpotlightMask width={screenWidth} height={screenHeight} holeRect={hole} />

      <Pressable
        style={[styles.blocker, { top: 0, left: 0, right: 0, height: Math.max(0, hole.y) }]}
        onPress={() => {}}
      />
      <Pressable
        style={[
          styles.blocker,
          {
            top: hole.y,
            left: 0,
            width: Math.max(0, hole.x),
            height: hole.height,
          },
        ]}
        onPress={() => {}}
      />
      <Pressable
        style={[
          styles.blocker,
          {
            top: hole.y,
            left: hole.x + hole.width,
            right: 0,
            height: hole.height,
          },
        ]}
        onPress={() => {}}
      />
      <Pressable
        style={[
          styles.blocker,
          {
            top: hole.y + hole.height,
            left: 0,
            right: 0,
            bottom: 0,
          },
        ]}
        onPress={() => {}}
      />
      <Pressable
        style={[
          styles.holePress,
          {
            top: hole.y,
            left: hole.x,
            width: hole.width,
            height: hole.height,
          },
        ]}
        onPress={onHolePress}
      />

      {showPointer ? (
        <TutorialPointerLayer
          rect={hole}
          screenWidth={screenWidth}
          screenHeight={screenHeight}
          safeAreaBottom={safeAreaBottom}
          tabBarHeight={tabBarHeight}
          pointerOffset={pointerOffset}
        />
      ) : null}
      {tooltip}
    </View>
  );
}

function FallbackOverlay({
  tooltip,
}: {
  tooltip: React.ReactNode;
}) {
  return (
    <View style={styles.fallbackRoot} pointerEvents="box-none">
      {tooltip}
    </View>
  );
}

function NonBlockingSpotlight({
  screenWidth,
  screenHeight,
  safeAreaBottom,
  tabBarHeight,
  holeRect,
  showPointer,
  pointerOffset,
  tooltip,
}: {
  screenWidth: number;
  screenHeight: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  holeRect: TutorialLayoutRect;
  showPointer: boolean;
  pointerOffset?: { x?: number; y?: number };
  tooltip: React.ReactNode;
}) {
  const hole = clampHoleRect(holeRect, screenWidth, screenHeight);

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none">
      <SpotlightMask width={screenWidth} height={screenHeight} holeRect={hole} />
      {showPointer ? (
        <TutorialPointerLayer
          rect={hole}
          screenWidth={screenWidth}
          screenHeight={screenHeight}
          safeAreaBottom={safeAreaBottom}
          tabBarHeight={tabBarHeight}
          pointerOffset={pointerOffset}
        />
      ) : null}
      {tooltip}
    </View>
  );
}

export default function TutorialOverlay({ layer = 'root' }: TutorialOverlayProps) {
  if (!ENABLE_SPOTLIGHT_TUTORIAL) {
    return null;
  }
  return <TutorialOverlayActive layer={layer} />;
}

function TutorialOverlayActive({ layer = 'root' }: TutorialOverlayProps) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = getTabBarHeight(insets.bottom);
  const [screenSize, setScreenSize] = useState({
    width: 0,
    height: 0,
  });

  const isActive = useSpotlightTutorialStore((state) => state.isActive);
  const tutorialId = useSpotlightTutorialStore((state) => state.tutorialId);
  const currentStepIndex = useSpotlightTutorialStore((state) => state.currentStepIndex);
  const targetRect = useSpotlightTutorialStore((state) => state.targetRect);
  const resolvedTargetId = useSpotlightTutorialStore((state) => state.resolvedTargetId);
  const targetFallbackActive = useSpotlightTutorialStore((state) => state.targetFallbackActive);
  const activeTab = useSpotlightTutorialStore((state) => state.activeTab);
  const pendingAdvanceToStepIndex = useSpotlightTutorialStore(
    (state) => state.pendingAdvanceToStepIndex,
  );
  const executePrimaryAction = useSpotlightTutorialStore((state) => state.executePrimaryAction);
  const skipTutorial = useSpotlightTutorialStore((state) => state.skipTutorial);
  const handleTargetPress = useSpotlightTutorialStore((state) => state.handleTargetPress);
  const refreshTargetRect = useSpotlightTutorialStore((state) => state.refreshTargetRect);
  const unlockTargetMeasurement = useSpotlightTutorialStore(
    (state) => state.unlockTargetMeasurement,
  );

  const step = useMemo(() => {
    if (!tutorialId) {
      return null;
    }
    return getSpotlightTutorial(tutorialId).steps[currentStepIndex] ?? null;
  }, [tutorialId, currentStepIndex]);

  const isTransitioning = pendingAdvanceToStepIndex != null;
  const shouldRender = isActive && step?.layer === layer && !isTransitioning;
  const wrongTab = step?.requiredTab != null && step.requiredTab !== activeTab;
  const hasValidTarget = isValidTutorialRect(targetRect) && !targetFallbackActive;
  const showPointer = step ? shouldShowTutorialPointer(step) : false;

  const stableTargetRect = hasValidTarget ? targetRect : null;

  const holeRect = useMemo(() => {
    if (!stableTargetRect || !step) {
      return null;
    }
    return expandTutorialRect(stableTargetRect, step.targetPadding ?? 8);
  }, [stableTargetRect, step]);

  useEffect(() => {
    if (!shouldRender || wrongTab) {
      return;
    }
    void refreshTargetRect({ force: true });
  }, [refreshTargetRect, shouldRender, wrongTab, step?.id, currentStepIndex]);

  useEffect(() => {
    if (!shouldRender || wrongTab || screenSize.width === 0) {
      return;
    }
    // Only remeasure on real dimension changes after initial layout.
    unlockTargetMeasurement();
    void refreshTargetRect({ force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on size changes
  }, [screenSize.width, screenSize.height]);

  useEffect(() => {
    const window = Dimensions.get('window');
    setScreenSize({ width: window.width, height: window.height });

    const subscription = Dimensions.addEventListener('change', ({ window: nextWindow }) => {
      setScreenSize({ width: nextWindow.width, height: nextWindow.height });
    });
    return () => subscription.remove();
  }, []);

  const handlePrimaryPress = useCallback(() => {
    void executePrimaryAction();
  }, [executePrimaryAction]);

  const handleHolePress = useCallback(() => {
    void handleTargetPress();
  }, [handleTargetPress]);

  if (!shouldRender || !tutorialId || !step || screenSize.width === 0) {
    return null;
  }

  if (wrongTab) {
    return null;
  }

  const tutorial = getSpotlightTutorial(tutorialId);
  const stepLabel = `${currentStepIndex + 1}/${tutorial.steps.length}`;
  const usingAlternateTarget =
    resolvedTargetId != null &&
    resolvedTargetId !== step.targetId &&
    (step.fallbackTargetIds?.includes(resolvedTargetId) ?? false);
  const useFallbackCopy = targetFallbackActive || usingAlternateTarget;
  const displayTitle =
    useFallbackCopy && step.fallbackTitle ? step.fallbackTitle : step.title;
  const displayDescription =
    useFallbackCopy && step.fallbackDescription
      ? step.fallbackDescription
      : step.description;
  const primaryButtonLabel = step.primaryButtonLabel ?? 'Sonraki';

  const tooltip = (
    <TutorialTooltip
      stepId={step.id}
      title={displayTitle}
      description={displayDescription}
      stepLabel={stepLabel}
      primaryButtonLabel={primaryButtonLabel}
      onNext={handlePrimaryPress}
      onSkip={skipTutorial}
      anchorRect={stableTargetRect}
      fallbackMode={!hasValidTarget}
      screenWidth={screenSize.width}
      screenHeight={screenSize.height}
    />
  );

  const overlayCommonProps = {
    screenWidth: screenSize.width,
    screenHeight: screenSize.height,
    safeAreaBottom: insets.bottom,
    tabBarHeight,
    showPointer,
    pointerOffset: step.pointerOffset,
    tooltip,
  };

  let content: React.ReactNode = null;

  if (hasValidTarget && holeRect) {
    if (step.interactionMode === 'next') {
      content = <NonBlockingSpotlight holeRect={holeRect} {...overlayCommonProps} />;
    } else {
      content = (
        <SpotlightOverlay
          holeRect={holeRect}
          onHolePress={handleHolePress}
          {...overlayCommonProps}
        />
      );
    }
  } else if (targetFallbackActive || step.interactionMode === 'next') {
    content = <FallbackOverlay tooltip={tooltip} />;
  } else {
    return null;
  }

  return (
    <View
      style={[styles.rootHost, layer === 'modal' && styles.modalLayerHost]}
      pointerEvents="box-none"
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  rootHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
  },
  modalLayerHost: {
    zIndex: 20000,
    elevation: 20000,
  },
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
  },
  fallbackRoot: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'box-none',
  },
  blocker: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  holePress: {
    position: 'absolute',
    backgroundColor: 'transparent',
    zIndex: 10001,
  },
});
