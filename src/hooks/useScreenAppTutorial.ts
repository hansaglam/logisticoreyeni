import { useCallback, useMemo, useRef } from 'react';
import type { ScrollView } from 'react-native';

import {
  getAppTutorialSteps,
  TUTORIAL_HELP_LABELS,
} from '../tutorial/app/definitions';
import {
  createDisabledScreenTutorialResult,
  isTutorialSessionDisabled,
} from '../tutorial/app/controller';
import { warnRenderLoopSuspected } from '../tutorial/app/devInstrumentation';
import { APP_TUTORIALS_ENABLED } from '../tutorial/app/featureFlags';
import { normalizeTutorialProgress } from '../tutorial/app/persistence';
import { selectHasPendingDeliveryIncident } from '../tutorial/app/selectors';
import type { AppTutorialId } from '../tutorial/app/types';
import { useGameStore } from '../store/gameStore';
import { useAppTutorial } from './useAppTutorial';

type StepOptions = Parameters<typeof getAppTutorialSteps>[1];

export interface UseScreenAppTutorialOptions {
  tutorialId: AppTutorialId;
  layoutReady: boolean;
  blockingModals?: boolean;
  isSaveRecovery?: boolean;
  isAnotherTutorialActive?: boolean;
  autoStart?: boolean;
  stepOptions?: StepOptions;
  noticeText?: string | null;
  scrollRef?: React.RefObject<ScrollView | null>;
  scrollYRef?: React.MutableRefObject<number>;
}

export function useScreenAppTutorial({
  tutorialId,
  layoutReady,
  blockingModals = false,
  isSaveRecovery = false,
  isAnotherTutorialActive = false,
  autoStart = true,
  stepOptions,
  noticeText,
  scrollRef: externalScrollRef,
  scrollYRef: externalScrollYRef,
}: UseScreenAppTutorialOptions) {
  warnRenderLoopSuspected(`useScreenAppTutorial:${tutorialId}`, 0, {
    tutorialId,
  });

  const internalScrollRef = useRef<ScrollView>(null);
  const internalScrollYRef = useRef(0);
  const scrollRef = externalScrollRef ?? internalScrollRef;
  const scrollYRef = externalScrollYRef ?? internalScrollYRef;

  const killSwitchOff = !APP_TUTORIALS_ENABLED || isTutorialSessionDisabled(tutorialId);

  const rawTutorialProgress = useGameStore((state) => state.tutorialProgress);
  const tutorialProgress = useMemo(
    () => normalizeTutorialProgress(rawTutorialProgress),
    [rawTutorialProgress],
  );
  const isGameReady = useGameStore((state) => state.isGameReady);
  const markTutorialPresented = useGameStore((state) => state.markTutorialPresented);
  const recordTutorialOutcome = useGameStore((state) => state.recordTutorialOutcome);
  const recordTutorialManualReplay = useGameStore((state) => state.recordTutorialManualReplay);
  const onboardingCompleted = useGameStore((state) => state.onboarding?.completed === true);
  const pendingOfflineProgressSummary = useGameStore(
    (state) => state.pendingOfflineProgressSummary,
  );
  const hasPendingDeliveryIncident = useGameStore(selectHasPendingDeliveryIncident);
  const marketTutorialCompleted = useGameStore(
    (state) => state.marketTutorialCompleted === true,
  );
  const marketTutorialVersion = useGameStore((state) => state.marketTutorialVersion ?? 0);
  const legacyMarket = useMemo(
    () =>
      tutorialId === 'market'
        ? {
            marketTutorialCompleted,
            marketTutorialVersion,
          }
        : undefined,
    [marketTutorialCompleted, marketTutorialVersion, tutorialId],
  );

  const steps = useMemo(() => {
    const resolved = getAppTutorialSteps(tutorialId, stepOptions);
    if (
      resolved.length === 0 &&
      typeof __DEV__ !== 'undefined' &&
      __DEV__ &&
      tutorialId !== 'market'
    ) {
      console.warn('[tutorial] definition-missing', { tutorialId });
    }
    return resolved;
  }, [stepOptions, tutorialId]);

  const tutorialEnabled = !killSwitchOff && steps.length > 0;
  const sessionDisabled = killSwitchOff;

  const onPresentPersistence = useCallback(() => {
    markTutorialPresented(tutorialId);
  }, [markTutorialPresented, tutorialId]);

  const onTutorialOutcome = useCallback(
    (outcome: Parameters<typeof recordTutorialOutcome>[1]) => {
      recordTutorialOutcome(tutorialId, outcome);
    },
    [recordTutorialOutcome, tutorialId],
  );

  const onManualReplayPersistence = useCallback(() => {
    recordTutorialManualReplay(tutorialId);
  }, [recordTutorialManualReplay, tutorialId]);

  const tutorial = useAppTutorial({
    tutorialId,
    steps,
    enabled: tutorialEnabled,
    autoStart,
    tutorialProgress,
    legacyMarket,
    layoutReady,
    gameHydrated: isGameReady,
    sessionDisabled,
    isOnboarding: !onboardingCompleted,
    isSaveRecovery,
    blockingModals,
    hasPendingOfflineSummary: pendingOfflineProgressSummary != null,
    hasPendingDeliveryIncident,
    isAnotherTutorialActive,
    scrollRef,
    scrollYRef,
    onPresentPersistence,
    onTutorialOutcome,
    onManualReplayPersistence,
  });

  const {
    notifyScrollEnd,
    remeasureActiveTarget,
    requestStepChange,
    openManual,
    onSkip,
    onDismiss,
    onComplete,
    visible: tutorialVisible,
    steps: tutorialSteps,
    stepIndex: tutorialStepIndex,
    transitionState: tutorialTransitionState,
    isTransitioning: tutorialIsTransitioning,
    anchorRect: tutorialAnchorRect,
    layoutAnchorRect: tutorialLayoutAnchorRect,
    fallbackMode: tutorialFallbackMode,
    spotlightVisible: tutorialSpotlightVisible,
    showPreparingLabel: tutorialShowPreparingLabel,
    placementRef: tutorialPlacementRef,
    overlayRootRef: tutorialOverlayRootRef,
  } = tutorial;

  const helpDisabled =
    !tutorialEnabled ||
    sessionDisabled ||
    pendingOfflineProgressSummary != null ||
    hasPendingDeliveryIncident ||
    blockingModals ||
    isSaveRecovery;

  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollYRef.current = event.nativeEvent.contentOffset.y;
    },
    [scrollYRef],
  );

  const handleScrollEnd = useCallback(() => {
    notifyScrollEnd();
    void remeasureActiveTarget();
  }, [notifyScrollEnd, remeasureActiveTarget]);

  const onRequestStepChange = useCallback(
    (direction: 'next' | 'previous') => {
      void requestStepChange(direction);
    },
    [requestStepChange],
  );

  if (killSwitchOff) {
    return createDisabledScreenTutorialResult(scrollRef, tutorialId);
  }

  const overlayProps = useMemo(
    () => ({
      tutorialId,
      visible: tutorialVisible,
      steps: tutorialSteps,
      stepIndex: tutorialStepIndex,
      transitionState: tutorialTransitionState,
      isTransitioning: tutorialIsTransitioning,
      anchorRect: tutorialAnchorRect,
      layoutAnchorRect: tutorialLayoutAnchorRect,
      fallbackMode: tutorialFallbackMode,
      spotlightVisible: tutorialSpotlightVisible,
      showPreparingLabel: tutorialShowPreparingLabel,
      placementRef: tutorialPlacementRef,
      overlayRootRef: tutorialOverlayRootRef,
      noticeText,
      onRequestStepChange,
      onSkip,
      onDismiss,
      onComplete,
    }),
    [
      noticeText,
      onComplete,
      onDismiss,
      onRequestStepChange,
      onSkip,
      tutorialAnchorRect,
      tutorialFallbackMode,
      tutorialIsTransitioning,
      tutorialLayoutAnchorRect,
      tutorialOverlayRootRef,
      tutorialPlacementRef,
      tutorialShowPreparingLabel,
      tutorialSpotlightVisible,
      tutorialStepIndex,
      tutorialSteps,
      tutorialTransitionState,
      tutorialVisible,
      tutorialId,
    ],
  );

  const helpButtonProps = useMemo(
    () => ({
      onPress: openManual,
      disabled: helpDisabled,
      accessibilityLabel: TUTORIAL_HELP_LABELS[tutorialId] ?? 'Rehber',
    }),
    [helpDisabled, openManual, tutorialId],
  );

  return {
    tutorial,
    overlayProps,
    helpButtonProps,
    scrollRef,
    handleScroll,
    handleScrollEnd,
  };
}
