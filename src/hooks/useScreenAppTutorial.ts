import { useCallback, useMemo, useRef } from 'react';
import type { ScrollView } from 'react-native';

import {
  getAppTutorialSteps,
  TUTORIAL_HELP_LABELS,
} from '../tutorial/app/definitions';
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
  const tutorialProgress = useGameStore((state) => state.tutorialProgress);
  const completeTutorial = useGameStore((state) => state.completeTutorial);
  const onboardingCompleted = useGameStore((state) => state.onboarding?.completed === true);
  const pendingOfflineProgressSummary = useGameStore(
    (state) => state.pendingOfflineProgressSummary,
  );
  const hasPendingDeliveryIncident = useGameStore((state) =>
    state.activeDeliveries.some(
      (delivery) =>
        delivery.incident?.status === 'pending' && delivery.incidentResolved !== true,
    ),
  );
  const marketLegacy = useGameStore((state) => ({
    marketTutorialCompleted: state.marketTutorialCompleted,
    marketTutorialVersion: state.marketTutorialVersion,
  }));

  const internalScrollRef = useRef<ScrollView>(null);
  const internalScrollYRef = useRef(0);
  const scrollRef = externalScrollRef ?? internalScrollRef;
  const scrollYRef = externalScrollYRef ?? internalScrollYRef;

  const steps = useMemo(
    () => getAppTutorialSteps(tutorialId, stepOptions),
    [stepOptions, tutorialId],
  );

  const tutorial = useAppTutorial({
    tutorialId,
    steps,
    autoStart,
    tutorialProgress,
    legacyMarket: tutorialId === 'market' ? marketLegacy : undefined,
    layoutReady,
    isOnboarding: !onboardingCompleted,
    isSaveRecovery,
    blockingModals,
    hasPendingOfflineSummary: pendingOfflineProgressSummary != null,
    hasPendingDeliveryIncident,
    isAnotherTutorialActive,
    scrollRef,
    scrollYRef,
    onCompletePersistence: () => completeTutorial(tutorialId),
  });

  const helpDisabled =
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
    tutorial.notifyScrollEnd();
    void tutorial.remeasureActiveTarget();
  }, [tutorial]);

  const overlayProps = {
    tutorialId,
    visible: tutorial.visible,
    steps: tutorial.steps,
    stepIndex: tutorial.stepIndex,
    transitionState: tutorial.transitionState,
    isTransitioning: tutorial.isTransitioning,
    anchorRect: tutorial.anchorRect,
    layoutAnchorRect: tutorial.layoutAnchorRect,
    fallbackMode: tutorial.fallbackMode,
    spotlightVisible: tutorial.spotlightVisible,
    showPreparingLabel: tutorial.showPreparingLabel,
    placementRef: tutorial.placementRef,
    noticeText,
    onRequestStepChange: (direction: 'next' | 'previous') => {
      void tutorial.requestStepChange(direction);
    },
    onSkip: tutorial.onSkip,
    onComplete: tutorial.onComplete,
  };

  return {
    tutorial,
    overlayProps,
    helpButtonProps: {
      onPress: tutorial.openManual,
      disabled: helpDisabled,
      accessibilityLabel: TUTORIAL_HELP_LABELS[tutorialId],
    },
    scrollRef,
    handleScroll,
    handleScrollEnd,
  };
}
