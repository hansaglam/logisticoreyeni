import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  InteractionManager,
  type ScrollView,
} from 'react-native';

import { hasGlobalTutorialBlockers } from '../tutorial/app/blockers';
import {
  computeTooltipLayout,
  isMeaningfullyDifferentRect,
  normalizeTutorialRect,
} from '../tutorial/app/layout';
import { logAppTutorialDev } from '../tutorial/app/logger';
import {
  getTutorialProgressEntry,
  shouldAutoStartTutorial,
} from '../tutorial/app/persistence';
import {
  measureAppTutorialTarget,
  scrollAppTutorialTargetIntoView,
} from '../tutorial/app/targetRegistry';
import type {
  AppTutorialId,
  AppTutorialLogAction,
  AppTutorialStep,
  TutorialProgressState,
  TutorialTransitionState,
  TutorialPlacement,
} from '../tutorial/app/types';
import { APP_TUTORIAL_VERSIONS } from '../tutorial/app/versions';
import {
  expandTutorialRect,
  isValidTutorialRect,
  type TutorialLayoutRect,
} from '../tutorial/types';

const SCROLL_SETTLE_MAX_MS = 420;
const TRANSITION_LABEL_DELAY_MS = 150;

export interface UseAppTutorialOptions {
  tutorialId: AppTutorialId;
  steps: AppTutorialStep[];
  autoStart?: boolean;
  tutorialProgress?: TutorialProgressState;
  legacyMarket?: {
    marketTutorialCompleted?: boolean;
    marketTutorialVersion?: number;
  };
  layoutReady: boolean;
  isOnboarding?: boolean;
  isSaveRecovery?: boolean;
  blockingModals?: boolean;
  hasPendingOfflineSummary?: boolean;
  hasPendingDeliveryIncident?: boolean;
  isAnotherTutorialActive?: boolean;
  scrollRef?: React.RefObject<ScrollView | null>;
  scrollYRef?: React.MutableRefObject<number>;
  onCompletePersistence: () => void;
}

async function measureTargetRect(
  tutorialId: AppTutorialId,
  targetId: string | undefined,
): Promise<TutorialLayoutRect | null> {
  if (!targetId) {
    return null;
  }
  const rect = await measureAppTutorialTarget(tutorialId, targetId);
  if (!isValidTutorialRect(rect)) {
    return null;
  }
  return normalizeTutorialRect(expandTutorialRect(rect, 6));
}

export function useAppTutorial({
  tutorialId,
  steps,
  autoStart = true,
  tutorialProgress,
  legacyMarket,
  layoutReady,
  isOnboarding = false,
  isSaveRecovery = false,
  blockingModals = false,
  hasPendingOfflineSummary = false,
  hasPendingDeliveryIncident = false,
  isAnotherTutorialActive = false,
  scrollRef,
  scrollYRef,
  onCompletePersistence,
}: UseAppTutorialOptions) {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [manualReplay, setManualReplay] = useState(false);
  const [transitionState, setTransitionState] =
    useState<TutorialTransitionState>('idle');
  const [anchorRect, setAnchorRect] = useState<TutorialLayoutRect | null>(null);
  const [layoutAnchorRect, setLayoutAnchorRect] = useState<TutorialLayoutRect | null>(null);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [spotlightVisible, setSpotlightVisible] = useState(false);
  const [showPreparingLabel, setShowPreparingLabel] = useState(false);

  const autoAttemptedRef = useRef(false);
  const transitionSequenceRef = useRef(0);
  const transitionLockRef = useRef(false);
  const placementRef = useRef<TutorialPlacement | null>(null);
  const scrollSettleResolversRef = useRef<Array<() => void>>([]);
  const preparingLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tutorialVersion = APP_TUTORIAL_VERSIONS[tutorialId];

  const log = useCallback(
    (action: AppTutorialLogAction, stepId?: string) => {
      logAppTutorialDev({
        tutorialId,
        action,
        stepId,
        tutorialVersion,
      });
    },
    [tutorialId, tutorialVersion],
  );

  const hasBlockers = useMemo(
    () =>
      hasGlobalTutorialBlockers({
        blockingModals,
        hasPendingOfflineSummary,
        hasPendingDeliveryIncident,
        isOnboarding,
        isSaveRecovery,
        isAnotherTutorialActive,
      }),
    [
      blockingModals,
      hasPendingDeliveryIncident,
      hasPendingOfflineSummary,
      isAnotherTutorialActive,
      isOnboarding,
      isSaveRecovery,
    ],
  );

  const canAutoStart = useMemo(() => {
    if (!autoStart) return false;
    if (hasBlockers) return false;
    if (!layoutReady) return false;
    return shouldAutoStartTutorial(tutorialId, tutorialProgress, legacyMarket);
  }, [autoStart, hasBlockers, layoutReady, legacyMarket, tutorialId, tutorialProgress]);

  const clearPreparingLabelTimer = useCallback(() => {
    if (preparingLabelTimerRef.current) {
      clearTimeout(preparingLabelTimerRef.current);
      preparingLabelTimerRef.current = null;
    }
    setShowPreparingLabel(false);
  }, []);

  const beginTransitionUi = useCallback(() => {
    setSpotlightVisible(false);
    clearPreparingLabelTimer();
    preparingLabelTimerRef.current = setTimeout(() => {
      setShowPreparingLabel(true);
    }, TRANSITION_LABEL_DELAY_MS);
  }, [clearPreparingLabelTimer]);

  const endTransitionUi = useCallback(() => {
    clearPreparingLabelTimer();
    setSpotlightVisible(true);
  }, [clearPreparingLabelTimer]);

  const waitForScrollSettle = useCallback(() => {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        const index = scrollSettleResolversRef.current.indexOf(done);
        if (index >= 0) {
          scrollSettleResolversRef.current.splice(index, 1);
        }
        resolve();
      }, SCROLL_SETTLE_MAX_MS);
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      scrollSettleResolversRef.current.push(done);
    });
  }, []);

  const notifyScrollEnd = useCallback(() => {
    const resolvers = scrollSettleResolversRef.current.splice(0);
    for (const resolve of resolvers) {
      resolve();
    }
  }, []);

  const scrollRectIntoView = useCallback(
    async (rect: TutorialLayoutRect) => {
      if (!scrollRef || !scrollYRef) {
        return false;
      }
      const screenHeight = Dimensions.get('window').height;
      const visibleTop = scrollYRef.current;
      const visibleBottom = visibleTop + screenHeight * 0.72;
      const targetBottom = rect.y + rect.height;
      if (rect.y >= visibleTop + 80 && targetBottom <= visibleBottom) {
        return false;
      }
      const nextY = Math.max(0, rect.y - screenHeight * 0.22);
      scrollRef.current?.scrollTo({ y: nextY, animated: true });
      await waitForScrollSettle();
      return true;
    },
    [scrollRef, scrollYRef, waitForScrollSettle],
  );

  const commitAnchorRect = useCallback((rect: TutorialLayoutRect | null) => {
    if (!rect) {
      setAnchorRect(null);
      return;
    }
    const normalized = normalizeTutorialRect(rect);
    setLayoutAnchorRect(normalized);
    setAnchorRect((prev) => {
      if (!isMeaningfullyDifferentRect(prev, normalized)) {
        return prev ?? normalized;
      }
      return normalized;
    });
  }, []);

  const prepareStepIndex = useCallback(
    async (index: number, transitionId: number) => {
      const step = steps[index];
      if (!step) {
        return;
      }

      setTransitionState('scrolling');
      beginTransitionUi();

      if (step.targetId) {
        await scrollAppTutorialTargetIntoView(tutorialId, step.targetId);
        if (transitionId !== transitionSequenceRef.current) {
          return;
        }

        let rect = await measureTargetRect(tutorialId, step.targetId);
        if (transitionId !== transitionSequenceRef.current) {
          return;
        }

        if (rect) {
          const scrolled = await scrollRectIntoView(rect);
          if (transitionId !== transitionSequenceRef.current) {
            return;
          }
          if (scrolled) {
            setTransitionState('measuring');
            rect = await measureTargetRect(tutorialId, step.targetId);
            if (transitionId !== transitionSequenceRef.current) {
              return;
            }
          }
        }

        if (!isValidTutorialRect(rect)) {
          setFallbackMode(true);
          placementRef.current = 'center';
          setAnchorRect(null);
          log('target-missing', step.id);
        } else {
          setFallbackMode(false);
          commitAnchorRect(rect);
        }
      } else {
        setFallbackMode(true);
        placementRef.current = 'center';
        setAnchorRect(null);
      }

      if (transitionId !== transitionSequenceRef.current) {
        return;
      }

      setStepIndex(index);
      log('step-viewed', step.id);
      setTransitionState('idle');
      endTransitionUi();
    },
    [
      beginTransitionUi,
      commitAnchorRect,
      endTransitionUi,
      log,
      scrollRectIntoView,
      steps,
      tutorialId,
    ],
  );

  const requestStepChange = useCallback(
    async (direction: 'next' | 'previous') => {
      if (transitionLockRef.current) {
        return;
      }
      transitionLockRef.current = true;
      try {
        if (transitionState !== 'idle') {
          return;
        }
        const nextIndex =
          direction === 'next'
            ? Math.min(stepIndex + 1, steps.length - 1)
            : Math.max(0, stepIndex - 1);
        if (nextIndex === stepIndex) {
          return;
        }

        const transitionId = ++transitionSequenceRef.current;
        await prepareStepIndex(nextIndex, transitionId);
      } finally {
        transitionLockRef.current = false;
      }
    },
    [prepareStepIndex, stepIndex, steps.length, transitionState],
  );

  const remeasureActiveTarget = useCallback(async () => {
    if (!visible || transitionState !== 'idle' || transitionLockRef.current) {
      return;
    }
    const step = steps[stepIndex];
    if (!step?.targetId) {
      return;
    }
    const transitionId = transitionSequenceRef.current;
    const rect = await measureTargetRect(tutorialId, step.targetId);
    if (transitionId !== transitionSequenceRef.current) {
      return;
    }
    if (isValidTutorialRect(rect)) {
      commitAnchorRect(rect);
    }
  }, [commitAnchorRect, stepIndex, steps, transitionState, tutorialId, visible]);

  const startTutorial = useCallback(
    (mode: 'auto-open' | 'manual-open') => {
      transitionSequenceRef.current += 1;
      transitionLockRef.current = false;
      placementRef.current = null;
      setStepIndex(0);
      setAnchorRect(null);
      setFallbackMode(false);
      setTransitionState('idle');
      setManualReplay(mode === 'manual-open');
      setVisible(true);
      log(mode === 'manual-open' ? 'replayed' : 'auto-open');
    },
    [log],
  );

  useEffect(() => {
    if (!canAutoStart || autoAttemptedRef.current || visible) {
      return;
    }
    autoAttemptedRef.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        if (!hasBlockers) {
          startTutorial('auto-open');
        }
      });
    });
    return () => task.cancel();
  }, [canAutoStart, hasBlockers, startTutorial, visible]);

  const prepareStepIndexRef = useRef(prepareStepIndex);
  prepareStepIndexRef.current = prepareStepIndex;

  useEffect(() => {
    if (!visible) {
      transitionSequenceRef.current += 1;
      transitionLockRef.current = false;
      placementRef.current = null;
      setTransitionState('idle');
      setSpotlightVisible(false);
      setAnchorRect(null);
      setLayoutAnchorRect(null);
      clearPreparingLabelTimer();
      return;
    }

    const transitionId = ++transitionSequenceRef.current;
    transitionLockRef.current = true;
    void prepareStepIndexRef.current(0, transitionId).finally(() => {
      if (transitionId === transitionSequenceRef.current) {
        transitionLockRef.current = false;
      }
    });
  }, [visible, clearPreparingLabelTimer]);

  useEffect(
    () => () => {
      transitionSequenceRef.current += 1;
      clearPreparingLabelTimer();
      scrollSettleResolversRef.current = [];
    },
    [clearPreparingLabelTimer],
  );

  const finishTutorial = useCallback(
    (action: 'completed' | 'step-skipped' | 'dismissed') => {
      transitionSequenceRef.current += 1;
      transitionLockRef.current = false;
      setVisible(false);
      setStepIndex(0);
      setTransitionState('idle');
      setSpotlightVisible(false);
      setAnchorRect(null);
      setLayoutAnchorRect(null);
      if (!manualReplay) {
        onCompletePersistence();
      }
      log(action, steps[stepIndex]?.id);
    },
    [log, manualReplay, onCompletePersistence, stepIndex, steps],
  );

  const openManual = useCallback(() => {
    if (hasBlockers || transitionLockRef.current) {
      return;
    }
    startTutorial('manual-open');
  }, [hasBlockers, startTutorial]);

  const isTransitioning = transitionState !== 'idle' || transitionLockRef.current;
  const progressEntry = getTutorialProgressEntry(
    tutorialProgress,
    tutorialId,
    legacyMarket,
  );

  return {
    visible,
    stepIndex,
    steps,
    isActive: visible,
    canAutoStart,
    transitionState,
    isTransitioning,
    anchorRect,
    layoutAnchorRect,
    fallbackMode,
    spotlightVisible,
    showPreparingLabel,
    placementRef,
    progressEntry,
    openManual,
    requestStepChange,
    notifyScrollEnd,
    remeasureActiveTarget,
    onSkip: () => {
      if (isTransitioning) return;
      finishTutorial('step-skipped');
    },
    onComplete: () => {
      if (isTransitioning) return;
      finishTutorial('completed');
    },
    log,
  };
}

export { computeTooltipLayout };
