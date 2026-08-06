import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  InteractionManager,
  type ScrollView,
} from 'react-native';

import { MARKET_TUTORIAL_VERSION } from '../config/marketTutorial';
import { getMarketTutorialSteps } from '../components/market/marketTutorialSteps';
import type { MarketTutorialStep } from '../components/market/marketTutorialSteps';
import {
  logMarketTutorialDev,
  type MarketTutorialLogAction,
} from '../components/market/MarketTutorialOverlay';
import {
  measureMarketTutorialTarget,
  scrollMarketTutorialTargetIntoView,
} from '../components/market/marketTutorialTargetRegistry';
import {
  isMeaningfullyDifferentRect,
  normalizeTutorialRect,
  type TutorialTransitionState,
  type TooltipPlacement,
} from '../components/market/marketTutorialLayout';
import { isCloudSaveAccountConflictPending } from '../services/cloudSaveConflictState';
import { isRewardedAdShowing } from '../services/adProvider';
import {
  expandTutorialRect,
  isValidTutorialRect,
  type TutorialLayoutRect,
} from '../tutorial/types';
import {
  shouldAutoStartMarketTutorial,
  type MarketTutorialMarketState,
  type MarketTutorialPersistence,
} from '../tutorial/marketTutorialState';

const SCROLL_SETTLE_MAX_MS = 420;
const TRANSITION_LABEL_DELAY_MS = 150;

export interface UseMarketTutorialOptions {
  persistence: MarketTutorialPersistence;
  marketState: MarketTutorialMarketState;
  layoutReady: boolean;
  isOnboarding: boolean;
  blockingModals: boolean;
  hasPendingOfflineSummary: boolean;
  hasPendingDeliveryIncident: boolean;
  scrollRef: React.RefObject<ScrollView | null>;
  scrollYRef: React.MutableRefObject<number>;
  onCompletePersistence: () => void;
}

async function measureTargetRect(
  targetId: MarketTutorialStep['targetId'],
): Promise<TutorialLayoutRect | null> {
  if (!targetId) {
    return null;
  }
  const rect = await measureMarketTutorialTarget(targetId);
  if (!isValidTutorialRect(rect)) {
    return null;
  }
  return normalizeTutorialRect(expandTutorialRect(rect, 6));
}

export function useMarketTutorial({
  persistence,
  marketState,
  layoutReady,
  isOnboarding,
  blockingModals,
  hasPendingOfflineSummary,
  hasPendingDeliveryIncident,
  scrollRef,
  scrollYRef,
  onCompletePersistence,
}: UseMarketTutorialOptions) {
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
  const placementRef = useRef<TooltipPlacement | null>(null);
  const scrollSettleResolversRef = useRef<Array<() => void>>([]);
  const preparingLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const steps = useMemo(() => getMarketTutorialSteps(marketState), [marketState]);

  const log = useCallback(
    (action: MarketTutorialLogAction, stepId?: string) => {
      logMarketTutorialDev({
        action,
        stepId,
        tutorialVersion: MARKET_TUTORIAL_VERSION,
        marketState,
      });
    },
    [marketState],
  );

  const hasGlobalBlockers = useMemo(() => {
    return (
      blockingModals ||
      hasPendingOfflineSummary ||
      hasPendingDeliveryIncident ||
      isCloudSaveAccountConflictPending() ||
      isRewardedAdShowing()
    );
  }, [blockingModals, hasPendingDeliveryIncident, hasPendingOfflineSummary]);

  const canAutoStart = useMemo(() => {
    if (isOnboarding) return false;
    if (hasGlobalBlockers) return false;
    if (!layoutReady) return false;
    return shouldAutoStartMarketTutorial(persistence);
  }, [hasGlobalBlockers, isOnboarding, layoutReady, persistence]);

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
        await scrollMarketTutorialTargetIntoView(step.targetId);
        if (transitionId !== transitionSequenceRef.current) {
          return;
        }

        let rect = await measureTargetRect(step.targetId);
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
            rect = await measureTargetRect(step.targetId);
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
    [beginTransitionUi, commitAnchorRect, endTransitionUi, log, scrollRectIntoView, steps],
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
    const rect = await measureTargetRect(step.targetId);
    if (transitionId !== transitionSequenceRef.current) {
      return;
    }
    if (isValidTutorialRect(rect)) {
      commitAnchorRect(rect);
    }
  }, [commitAnchorRect, stepIndex, steps, transitionState, visible]);

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
      log(mode);
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
        if (!hasGlobalBlockers) {
          startTutorial('auto-open');
        }
      });
    });
    return () => task.cancel();
  }, [canAutoStart, hasGlobalBlockers, startTutorial, visible]);

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
    if (hasGlobalBlockers || transitionLockRef.current) {
      return;
    }
    startTutorial('manual-open');
  }, [hasGlobalBlockers, startTutorial]);

  const isTransitioning = transitionState !== 'idle' || transitionLockRef.current;

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

export { resolveMarketTutorialMarketState } from '../tutorial/marketTutorialState';
export type { MarketTutorialMarketState } from '../tutorial/marketTutorialState';
