import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScrollView, View } from 'react-native';
import {
  Dimensions,
  InteractionManager,
  type ScrollView as ScrollViewType,
} from 'react-native';

import { hasGlobalTutorialBlockers } from '../tutorial/app/blockers';
import {
  computeTooltipLayout,
  isMeaningfullyDifferentRect,
  normalizeTutorialRect,
} from '../tutorial/app/layout';
import { logTutorialEffectRun } from '../tutorial/app/devInstrumentation';
import { logAppTutorialDev } from '../tutorial/app/logger';
import {
  measureScrollViewportInWindow,
  measureTutorialTargetInOverlaySpace,
  measureTutorialTargetWindowRect,
} from '../tutorial/app/measureTarget';
import {
  getTutorialProgressEntry,
  hasTutorialBeenPresented,
  shouldAutoPresentTutorial,
} from '../tutorial/app/persistence';
import { scrollAppTutorialTargetIntoView } from '../tutorial/app/targetRegistry';
import type {
  AppTutorialId,
  AppTutorialLogAction,
  AppTutorialStep,
  TutorialProgressState,
  TutorialTransitionState,
  TutorialPlacement,
  TutorialOutcome,
} from '../tutorial/app/types';
import { APP_TUTORIAL_VERSIONS } from '../tutorial/app/versions';
import { isValidTutorialRect, type TutorialLayoutRect } from '../tutorial/types';

const SCROLL_SETTLE_MAX_MS = 420;
const TRANSITION_LABEL_DELAY_MS = 150;
const SCROLL_VIEWPORT_MARGIN_TOP = 80;
const SCROLL_VIEWPORT_MARGIN_BOTTOM = 24;

async function measureTargetRect(
  tutorialId: AppTutorialId,
  step: AppTutorialStep | undefined,
  overlayRootRef: React.RefObject<View | null>,
  sequence: number,
  transitionSequenceRef: React.MutableRefObject<number>,
): Promise<{
  overlayRect: TutorialLayoutRect;
  windowRect: TutorialLayoutRect;
} | null> {
  if (!step?.targetId) {
    return null;
  }
  try {
    return await measureTutorialTargetInOverlaySpace({
      tutorialId,
      targetId: step.targetId,
      overlayRootRef,
      spotlightPadding: step.spotlightPadding,
      sequence,
      transitionSequenceRef,
      debug: { stepId: step.id },
    });
  } catch {
    return null;
  }
}

async function measureWindowTargetRect(
  tutorialId: AppTutorialId,
  step: AppTutorialStep | undefined,
  sequence: number,
  transitionSequenceRef: React.MutableRefObject<number>,
): Promise<TutorialLayoutRect | null> {
  if (!step?.targetId) {
    return null;
  }
  try {
    return await measureTutorialTargetWindowRect({
      tutorialId,
      targetId: step.targetId,
      spotlightPadding: step.spotlightPadding,
      sequence,
      transitionSequenceRef,
    });
  } catch {
    return null;
  }
}

export interface UseAppTutorialOptions {
  tutorialId: AppTutorialId;
  steps: AppTutorialStep[];
  enabled?: boolean;
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
  gameHydrated?: boolean;
  sessionDisabled?: boolean;
  scrollRef?: React.RefObject<ScrollViewType | null>;
  scrollYRef?: React.MutableRefObject<number>;
  onPresentPersistence: () => void;
  onTutorialOutcome: (outcome: TutorialOutcome) => void;
  onManualReplayPersistence?: () => void;
}

export function useAppTutorial({
  tutorialId,
  steps,
  enabled = true,
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
  gameHydrated = true,
  sessionDisabled = false,
  scrollRef,
  scrollYRef,
  onPresentPersistence,
  onTutorialOutcome,
  onManualReplayPersistence,
}: UseAppTutorialOptions) {
  const safeSteps = steps ?? [];
  const hasSteps = safeSteps.length > 0;
  const isEnabled = enabled && hasSteps;

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
  const presentedMarkedRef = useRef(false);
  const transitionSequenceRef = useRef(0);
  const transitionLockRef = useRef(false);
  const placementRef = useRef<TutorialPlacement | null>(null);
  const scrollSettleResolversRef = useRef<Array<() => void>>([]);
  const preparingLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRootRef = useRef<View | null>(null);

  const tutorialVersion = APP_TUTORIAL_VERSIONS[tutorialId] ?? 0;
  const clampedStepIndex =
    safeSteps.length === 0 ? 0 : Math.min(Math.max(0, stepIndex), safeSteps.length - 1);

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

  const hasBeenPresented = useMemo(
    () => hasTutorialBeenPresented(tutorialId, tutorialProgress, legacyMarket),
    [legacyMarket, tutorialId, tutorialProgress],
  );

  const canAutoStart = useMemo(
    () =>
      shouldAutoPresentTutorial({
        enabled: isEnabled,
        hydrated: gameHydrated,
        layoutReady,
        definitionAvailable: hasSteps,
        hasBeenPresented,
        blockerActive: hasBlockers,
        sessionDisabled,
        autoStart,
      }),
    [
      autoStart,
      gameHydrated,
      hasBeenPresented,
      hasBlockers,
      hasSteps,
      isEnabled,
      layoutReady,
      sessionDisabled,
    ],
  );

  const markTutorialPresentedOnce = useCallback(() => {
    if (presentedMarkedRef.current) {
      return;
    }
    presentedMarkedRef.current = true;
    try {
      onPresentPersistence();
      log('presented');
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[tutorial] present-persistence-failed', {
          tutorialId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, [log, onPresentPersistence, tutorialId]);

  const clearPreparingLabelTimer = useCallback(() => {
    if (preparingLabelTimerRef.current) {
      clearTimeout(preparingLabelTimerRef.current);
      preparingLabelTimerRef.current = null;
    }
    setShowPreparingLabel((previous) => (previous ? false : previous));
  }, []);

  const beginTransitionUi = useCallback(() => {
    setSpotlightVisible(false);
    setAnchorRect(null);
    setLayoutAnchorRect(null);
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
      const scrollViewport = await measureScrollViewportInWindow(scrollRef);
      if (!scrollViewport) {
        return false;
      }

      const viewportTop = scrollViewport.y;
      const viewportBottom = scrollViewport.y + scrollViewport.height;
      const targetTop = rect.y;
      const targetBottom = rect.y + rect.height;

      if (
        targetTop >= viewportTop + SCROLL_VIEWPORT_MARGIN_TOP &&
        targetBottom <= viewportBottom - SCROLL_VIEWPORT_MARGIN_BOTTOM
      ) {
        return false;
      }

      const desiredTop = viewportTop + Dimensions.get('window').height * 0.22;
      const delta = targetTop - desiredTop;
      const nextY = Math.max(0, scrollYRef.current + delta);
      scrollRef.current?.scrollTo({ y: nextY, animated: true });
      await waitForScrollSettle();
      return true;
    },
    [scrollRef, scrollYRef, waitForScrollSettle],
  );

  const commitAnchorRect = useCallback(
    (overlayRect: TutorialLayoutRect | null, windowRect: TutorialLayoutRect | null) => {
      if (!overlayRect || !windowRect) {
        setAnchorRect(null);
        setLayoutAnchorRect(null);
        return;
      }
      const normalizedOverlay = normalizeTutorialRect(overlayRect);
      const normalizedWindow = normalizeTutorialRect(windowRect);
      setLayoutAnchorRect(normalizedWindow);
      setAnchorRect((prev) => {
        if (!isMeaningfullyDifferentRect(prev, normalizedOverlay)) {
          return prev ?? normalizedOverlay;
        }
        return normalizedOverlay;
      });
    },
    [],
  );

  const closeTutorial = useCallback(() => {
    transitionSequenceRef.current += 1;
    transitionLockRef.current = false;
    setVisible((previous) => (previous ? false : previous));
    setStepIndex((previous) => (previous === 0 ? previous : 0));
    setTransitionState((previous) => (previous === 'idle' ? previous : 'idle'));
    setSpotlightVisible((previous) => (previous ? false : previous));
    setAnchorRect((previous) => (previous === null ? previous : null));
    setLayoutAnchorRect((previous) => (previous === null ? previous : null));
    setFallbackMode((previous) => (previous ? false : previous));
    clearPreparingLabelTimer();
  }, [clearPreparingLabelTimer]);

  const prepareStepIndex = useCallback(
    async (index: number, transitionId: number) => {
      const step = safeSteps[index];
      if (!step) {
        closeTutorial();
        return;
      }

      setTransitionState('scrolling');
      beginTransitionUi();

      try {
        if (step.targetId) {
          await scrollAppTutorialTargetIntoView(tutorialId, step.targetId);
          if (transitionId !== transitionSequenceRef.current) {
            return;
          }

          let windowRect = await measureWindowTargetRect(
            tutorialId,
            step,
            transitionId,
            transitionSequenceRef,
          );
          if (transitionId !== transitionSequenceRef.current) {
            return;
          }

          if (windowRect) {
            const scrolled = await scrollRectIntoView(windowRect);
            if (transitionId !== transitionSequenceRef.current) {
              return;
            }
            if (scrolled) {
              setTransitionState('measuring');
              windowRect = await measureWindowTargetRect(
                tutorialId,
                step,
                transitionId,
                transitionSequenceRef,
              );
              if (transitionId !== transitionSequenceRef.current) {
                return;
              }
            }
          }

          const measured = await measureTargetRect(
            tutorialId,
            step,
            overlayRootRef,
            transitionId,
            transitionSequenceRef,
          );
          if (transitionId !== transitionSequenceRef.current) {
            return;
          }

          const rect = measured?.overlayRect ?? null;

          if (!isValidTutorialRect(rect)) {
            setFallbackMode(true);
            placementRef.current = 'center';
            setAnchorRect(null);
            setLayoutAnchorRect(null);
            log('target-missing', step.id);
          } else if (measured) {
            setFallbackMode(false);
            commitAnchorRect(measured.overlayRect, measured.windowRect);
          }
        } else {
          setFallbackMode(true);
          placementRef.current = 'center';
          setAnchorRect(null);
        }
      } catch {
        setFallbackMode(true);
        placementRef.current = 'center';
        setAnchorRect(null);
        log('target-missing', step.id);
      }

      if (transitionId !== transitionSequenceRef.current) {
        return;
      }

      setStepIndex(index);
      log('step-viewed', step.id);
      setTransitionState('idle');
      endTransitionUi();
      if (index === 0) {
        markTutorialPresentedOnce();
      }
    },
    [
      beginTransitionUi,
      closeTutorial,
      commitAnchorRect,
      endTransitionUi,
      log,
      markTutorialPresentedOnce,
      safeSteps,
      scrollRectIntoView,
      tutorialId,
    ],
  );

  const requestStepChange = useCallback(
    async (direction: 'next' | 'previous') => {
      if (!isEnabled || transitionLockRef.current) {
        return;
      }
      transitionLockRef.current = true;
      try {
        if (transitionState !== 'idle') {
          return;
        }
        const nextIndex =
          direction === 'next'
            ? Math.min(clampedStepIndex + 1, safeSteps.length - 1)
            : Math.max(0, clampedStepIndex - 1);
        if (nextIndex === clampedStepIndex) {
          return;
        }

        const transitionId = ++transitionSequenceRef.current;
        await prepareStepIndex(nextIndex, transitionId);
      } finally {
        transitionLockRef.current = false;
      }
    },
    [clampedStepIndex, isEnabled, prepareStepIndex, safeSteps.length, transitionState],
  );

  const remeasureActiveTarget = useCallback(async () => {
    if (!isEnabled || !visible || transitionState !== 'idle' || transitionLockRef.current) {
      return;
    }
    const step = safeSteps[clampedStepIndex];
    if (!step?.targetId) {
      return;
    }
    const transitionId = transitionSequenceRef.current;
    const measured = await measureTargetRect(
      tutorialId,
      step,
      overlayRootRef,
      transitionId,
      transitionSequenceRef,
    );
    if (transitionId !== transitionSequenceRef.current) {
      return;
    }
    if (measured && isValidTutorialRect(measured.overlayRect)) {
      commitAnchorRect(measured.overlayRect, measured.windowRect);
    }
  }, [
    clampedStepIndex,
    commitAnchorRect,
    isEnabled,
    safeSteps,
    transitionState,
    tutorialId,
    visible,
  ]);

  const startTutorial = useCallback(
    (mode: 'auto-open' | 'manual-open') => {
      if (!isEnabled) {
        return;
      }
      transitionSequenceRef.current += 1;
      transitionLockRef.current = false;
      placementRef.current = null;
      setStepIndex((previous) => (previous === 0 ? previous : 0));
      setAnchorRect((previous) => (previous === null ? previous : null));
      setFallbackMode((previous) => (previous ? false : previous));
      setTransitionState((previous) => (previous === 'idle' ? previous : 'idle'));
      setManualReplay(mode === 'manual-open');
      setVisible((previous) => (previous ? previous : true));
      log(mode === 'manual-open' ? 'replayed' : 'auto-open');
    },
    [isEnabled, log],
  );

  const startTutorialAutomatically = useCallback(() => {
    if (!isEnabled || hasBeenPresented) {
      return;
    }
    startTutorial('auto-open');
  }, [hasBeenPresented, isEnabled, startTutorial]);

  const replayTutorialManually = useCallback(() => {
    if (!isEnabled || hasBlockers || transitionLockRef.current) {
      return;
    }
    try {
      onManualReplayPersistence?.();
    } catch {
      // manual replay metadata is best-effort
    }
    startTutorial('manual-open');
  }, [hasBlockers, isEnabled, onManualReplayPersistence, startTutorial]);

  useEffect(() => {
    if (!canAutoStart || visible) {
      return;
    }
    logTutorialEffectRun({
      tutorialId,
      effect: 'auto-start',
      details: {
        shouldAutoStart: canAutoStart,
        isOpen: visible,
        layoutReady,
        blockersClear: !hasBlockers,
        hasBeenPresented,
      },
    });
    const task = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        if (!canAutoStart || visible || autoAttemptedRef.current || hasBeenPresented) {
          return;
        }
        autoAttemptedRef.current = true;
        startTutorialAutomatically();
      });
    });
    return () => task.cancel();
  }, [
    canAutoStart,
    hasBeenPresented,
    hasBlockers,
    layoutReady,
    startTutorialAutomatically,
    tutorialId,
    visible,
  ]);

  const prepareStepIndexRef = useRef(prepareStepIndex);
  prepareStepIndexRef.current = prepareStepIndex;

  useEffect(() => {
    if (!visible) {
      transitionSequenceRef.current += 1;
      transitionLockRef.current = false;
      placementRef.current = null;
      setTransitionState((previous) => (previous === 'idle' ? previous : 'idle'));
      setSpotlightVisible((previous) => (previous ? false : previous));
      setAnchorRect((previous) => (previous === null ? previous : null));
      setLayoutAnchorRect((previous) => (previous === null ? previous : null));
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

  useEffect(() => {
    if (!isEnabled && visible) {
      closeTutorial();
    }
  }, [closeTutorial, isEnabled, visible]);

  const finishTutorial = useCallback(
    (action: TutorialOutcome) => {
      transitionSequenceRef.current += 1;
      transitionLockRef.current = false;
      setVisible((previous) => (previous ? false : previous));
      setStepIndex((previous) => (previous === 0 ? previous : 0));
      setTransitionState((previous) => (previous === 'idle' ? previous : 'idle'));
      setSpotlightVisible((previous) => (previous ? false : previous));
      setAnchorRect((previous) => (previous === null ? previous : null));
      setLayoutAnchorRect((previous) => (previous === null ? previous : null));
      if (!manualReplay) {
        try {
          onTutorialOutcome(action);
        } catch (error) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[tutorial] outcome-persistence-failed', {
              tutorialId,
              action,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      const logAction: AppTutorialLogAction =
        action === 'completed'
          ? 'completed'
          : action === 'dismissed'
            ? 'dismissed'
            : 'step-skipped';
      log(logAction, safeSteps[clampedStepIndex]?.id);
    },
    [clampedStepIndex, log, manualReplay, onTutorialOutcome, safeSteps, tutorialId],
  );

  const openManual = replayTutorialManually;

  const isTransitioning = transitionState !== 'idle' || transitionLockRef.current;
  const progressEntry = useMemo(
    () => getTutorialProgressEntry(tutorialProgress, tutorialId, legacyMarket),
    [legacyMarket, tutorialId, tutorialProgress],
  );

  const onSkip = useCallback(() => {
    if (transitionState !== 'idle' || transitionLockRef.current) {
      return;
    }
    finishTutorial('skipped');
  }, [finishTutorial, transitionState]);

  const onDismiss = useCallback(() => {
    if (transitionState !== 'idle' || transitionLockRef.current) {
      return;
    }
    finishTutorial('dismissed');
  }, [finishTutorial, transitionState]);

  const onComplete = useCallback(() => {
    if (transitionState !== 'idle' || transitionLockRef.current) {
      return;
    }
    finishTutorial('completed');
  }, [finishTutorial, transitionState]);

  return useMemo(
    () => ({
      visible: isEnabled && visible,
      stepIndex: clampedStepIndex,
      steps: safeSteps,
      isActive: isEnabled && visible,
      isEnabled,
      canAutoStart,
      transitionState,
      isTransitioning,
      anchorRect,
      layoutAnchorRect,
      fallbackMode,
      spotlightVisible,
      showPreparingLabel,
      placementRef,
      overlayRootRef,
      progressEntry,
      openManual,
      requestStepChange,
      notifyScrollEnd,
      remeasureActiveTarget,
      onSkip,
      onDismiss,
      onComplete,
      log,
    }),
    [
      anchorRect,
      canAutoStart,
      clampedStepIndex,
      fallbackMode,
      isEnabled,
      isTransitioning,
      layoutAnchorRect,
      log,
      notifyScrollEnd,
      onComplete,
      onDismiss,
      onSkip,
      openManual,
      progressEntry,
      remeasureActiveTarget,
      requestStepChange,
      safeSteps,
      showPreparingLabel,
      spotlightVisible,
      transitionState,
      visible,
    ],
  );
}

export { computeTooltipLayout };
