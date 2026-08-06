import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppTutorialErrorBoundary from './AppTutorialErrorBoundary';
import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { SpotlightMask } from '../tutorial/SpotlightMask';
import { ActionButton } from '../ui';
import { colors, spacing } from '../../theme';
import { isValidTutorialRect, type TutorialLayoutRect } from '../../tutorial/types';
import { computeTooltipLayout } from '../../tutorial/app/layout';
import type {
  AppTutorialId,
  AppTutorialStep,
  TutorialPlacement,
  TutorialTransitionState,
} from '../../tutorial/app/types';

interface AppTutorialOverlayProps {
  tutorialId: AppTutorialId;
  visible: boolean;
  steps: AppTutorialStep[];
  stepIndex: number;
  transitionState: TutorialTransitionState;
  isTransitioning: boolean;
  anchorRect: TutorialLayoutRect | null;
  layoutAnchorRect: TutorialLayoutRect | null;
  fallbackMode: boolean;
  spotlightVisible: boolean;
  showPreparingLabel: boolean;
  placementRef: React.MutableRefObject<TutorialPlacement | null>;
  overlayRootRef?: React.RefObject<View | null>;
  noticeText?: string | null;
  onRequestStepChange: (direction: 'next' | 'previous') => void;
  onSkip: () => void;
  onComplete: () => void;
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

export default function AppTutorialOverlay(props: AppTutorialOverlayProps) {
  if (!props.visible) {
    return null;
  }

  return (
    <AppTutorialErrorBoundary tutorialId={props.tutorialId} fallback={null}>
      <AppTutorialOverlayContent {...props} />
    </AppTutorialErrorBoundary>
  );
}

function AppTutorialOverlayContent({
  visible,
  steps,
  stepIndex,
  transitionState,
  isTransitioning,
  anchorRect,
  layoutAnchorRect,
  fallbackMode,
  spotlightVisible,
  showPreparingLabel,
  placementRef,
  overlayRootRef,
  noticeText,
  onRequestStepChange,
  onSkip,
  onComplete,
}: AppTutorialOverlayProps) {
  const insets = useSafeAreaInsets();
  const { tabBarHeight } = useTabBarLayout();
  const [screen, setScreen] = useState(() => Dimensions.get('window'));
  const [reduceMotion, setReduceMotion] = useState(false);
  const [tooltipHeight, setTooltipHeight] = useState(180);
  const pressLockRef = useRef(false);

  const safeSteps = steps ?? [];
  const safeStepIndex =
    safeSteps.length === 0 ? 0 : Math.min(Math.max(0, stepIndex), safeSteps.length - 1);
  const step = safeSteps[safeStepIndex] ?? null;
  const isLastStep = safeSteps.length > 0 && safeStepIndex >= safeSteps.length - 1;
  const stepLabel =
    safeSteps.length > 0 ? `${safeStepIndex + 1} / ${safeSteps.length}` : '0 / 0';
  const controlsDisabled = isTransitioning || transitionState !== 'idle';

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setScreen(window));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const tooltipWidth = Math.min(screen.width - 32, 400);
  const tooltipLayout = useMemo(() => {
    const layout = computeTooltipLayout({
      anchorRect: layoutAnchorRect,
      screenWidth: screen.width,
      screenHeight: screen.height,
      safeAreaTop: insets.top,
      safeAreaBottom: insets.bottom,
      tabBarHeight,
      tooltipWidth,
      tooltipHeight,
      previousPlacement: placementRef.current,
    });
    placementRef.current = layout.placement;
    return layout;
  }, [
    layoutAnchorRect,
    insets.bottom,
    insets.top,
    placementRef,
    screen.height,
    screen.width,
    tabBarHeight,
    tooltipHeight,
    tooltipWidth,
  ]);

  const holeRect =
    spotlightVisible && isValidTutorialRect(anchorRect)
      ? clampHoleRect(anchorRect, screen.width, screen.height)
      : null;

  const handleDirectionPress = useCallback(
    (direction: 'next' | 'previous') => {
      if (controlsDisabled || pressLockRef.current) {
        return;
      }
      pressLockRef.current = true;
      onRequestStepChange(direction);
      requestAnimationFrame(() => {
        pressLockRef.current = false;
      });
    },
    [controlsDisabled, onRequestStepChange],
  );

  if (!visible || !step) {
    return null;
  }

  const defaultLastLabel = step.finalCtaLabel ?? 'Anladım';
  const primaryLabel = showPreparingLabel
    ? 'Hazırlanıyor…'
    : (step.primaryLabel ?? (isLastStep ? defaultLastLabel : 'İleri'));

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={controlsDisabled ? undefined : onSkip}
      accessibilityViewIsModal
    >
      <View ref={overlayRootRef} style={styles.overlayRoot} pointerEvents="box-none" collapsable={false}>
        <SpotlightMask width={screen.width} height={screen.height} holeRect={holeRect} />

        {holeRect ? (
          <>
            <Pressable style={[styles.blocker, { top: 0, left: 0, right: 0, height: holeRect.y }]} />
            <Pressable
              style={[
                styles.blocker,
                { top: holeRect.y, left: 0, width: holeRect.x, height: holeRect.height },
              ]}
            />
            <Pressable
              style={[
                styles.blocker,
                {
                  top: holeRect.y,
                  left: holeRect.x + holeRect.width,
                  right: 0,
                  height: holeRect.height,
                },
              ]}
            />
            <Pressable
              style={[
                styles.blocker,
                {
                  top: holeRect.y + holeRect.height,
                  left: 0,
                  right: 0,
                  bottom: 0,
                },
              ]}
            />
            <Pressable
              style={[
                styles.blocker,
                {
                  top: holeRect.y,
                  left: holeRect.x,
                  width: holeRect.width,
                  height: holeRect.height,
                },
              ]}
            />
          </>
        ) : (
          <Pressable style={StyleSheet.absoluteFill} />
        )}

        <View
          style={[
            styles.tooltip,
            {
              top: tooltipLayout.top,
              left: tooltipLayout.left,
              width: tooltipWidth,
              maxHeight: screen.height * 0.55,
            },
          ]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          onLayout={(event) => {
            const nextHeight = Math.round(event.nativeEvent.layout.height);
            if (Math.abs(nextHeight - tooltipHeight) > 8) {
              setTooltipHeight(nextHeight);
            }
          }}
        >
          <Text style={styles.stepLabel}>{stepLabel}</Text>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.description}>{step.description}</Text>
          {noticeText ? <Text style={styles.noticeText}>{noticeText}</Text> : null}
          {fallbackMode ? (
            <Text style={styles.fallbackHint}>
              Bu alan şu an görünmüyor; genel rehber gösteriliyor.
            </Text>
          ) : null}

          <View style={styles.actionsRow}>
            <Pressable
              onPress={onSkip}
              style={styles.textButton}
              disabled={controlsDisabled}
              accessibilityRole="button"
              accessibilityLabel="Atla"
              accessibilityState={{ disabled: controlsDisabled }}
            >
              <Text style={[styles.textButtonLabel, controlsDisabled && styles.disabledText]}>
                Atla
              </Text>
            </Pressable>
            <View style={styles.navButtons}>
              {safeStepIndex > 0 ? (
                <Pressable
                  onPress={() => handleDirectionPress('previous')}
                  style={[styles.secondaryBtn, controlsDisabled && styles.disabledBtn]}
                  disabled={controlsDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Geri"
                  accessibilityState={{ disabled: controlsDisabled }}
                >
                  <Text
                    style={[styles.secondaryBtnLabel, controlsDisabled && styles.disabledText]}
                  >
                    Geri
                  </Text>
                </Pressable>
              ) : null}
              <ActionButton
                label={primaryLabel}
                onPress={isLastStep ? onComplete : () => handleDirectionPress('next')}
                variant="primary"
                compact
                style={styles.primaryBtn}
                disabled={controlsDisabled}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
  },
  blocker: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: colors.surface2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: `${colors.info}55`,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  stepLabel: {
    color: colors.info,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  description: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  noticeText: {
    color: colors.warning,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  fallbackHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  textButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  textButtonLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  navButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  secondaryBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnLabel: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.55,
  },
  disabledText: {
    opacity: 0.55,
  },
  primaryBtn: {
    minWidth: 120,
  },
});
