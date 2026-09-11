/**
 * Host hook for mounting a single contextual guide card on a screen.
 * Narrow Zustand selectors — visibility is a boolean (no full guide object sub).
 * CTA advances + navigates; dismiss only in manual_replay.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { ContextualGuideCardId } from '../../types/game';
import { useGameStore } from '../../store/gameStore';
import { getContextualGuideCardIcon } from '../contextualGuideIcons';
import { CONTEXTUAL_GUIDE_CARD_COPY } from '../contextualGuideCopy';
import {
  canShowContextualGuideCard,
  getContextualGuideStepIndex,
  getContextualGuideTotalSteps,
} from '../contextualGuideSequence';
import { requestNavigationAfterGuideCard } from '../contextualGuideNavigation';
import {
  clearContextualGuideManualReplay,
  getContextualGuideSessionSnapshot,
  resolveContextualGuideRunMode,
  subscribeContextualGuideSession,
} from '../contextualGuideSession';

export type UseContextualGuideHostOptions = {
  blockingUi?: boolean;
};

function subscribeSession(onStoreChange: () => void) {
  return subscribeContextualGuideSession(onStoreChange);
}

function getSessionSnapshot() {
  return getContextualGuideSessionSnapshot();
}

export function useContextualGuideHost(
  cardId: ContextualGuideCardId,
  options: UseContextualGuideHostOptions = {},
) {
  const blockingUi = Boolean(options.blockingUi);
  const session = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getSessionSnapshot,
  );

  const visible = useGameStore((state) =>
    canShowContextualGuideCard(state.contextualGuide, cardId, { blockingUi }),
  );
  const guideStatus = useGameStore((state) => state.contextualGuide?.status);

  const markContextualGuideCardCompleted = useGameStore(
    (state) => state.markContextualGuideCardCompleted,
  );
  const completeContextualGuide = useGameStore((state) => state.completeContextualGuide);
  const exitContextualGuideReplay = useGameStore((state) => state.exitContextualGuideReplay);

  const copy = CONTEXTUAL_GUIDE_CARD_COPY[cardId];
  const iconName = getContextualGuideCardIcon(cardId);
  const currentStep = getContextualGuideStepIndex(cardId);
  const totalSteps = getContextualGuideTotalSteps();

  const runMode = resolveContextualGuideRunMode(
    guideStatus != null ? { status: guideStatus } : null,
  );
  // Touch session.replayActive so mode flips re-render this host.
  void session.replayActive;
  const allowDismiss = runMode === 'manual_replay';

  const onPrimaryPress = useCallback(() => {
    if (cardId === 'need_help') {
      // Navigate first so lock stays until tab switch starts; then complete unlocks.
      requestNavigationAfterGuideCard(cardId, useGameStore.getState().contextualGuide);
      markContextualGuideCardCompleted(cardId);
      completeContextualGuide();
      clearContextualGuideManualReplay();
      useGameStore.getState().markSaveDirty?.();
      return;
    }
    markContextualGuideCardCompleted(cardId);
    const guideAfter = useGameStore.getState().contextualGuide;
    requestNavigationAfterGuideCard(cardId, guideAfter);
  }, [cardId, completeContextualGuide, markContextualGuideCardCompleted]);

  const onDismiss = useCallback(() => {
    if (!allowDismiss) {
      return;
    }
    exitContextualGuideReplay();
  }, [allowDismiss, exitContextualGuideReplay]);

  return useMemo(
    () => ({
      visible,
      cardId,
      title: copy.title,
      description: copy.description,
      primaryLabel: copy.primaryLabel,
      iconName,
      currentStep,
      totalSteps,
      allowDismiss,
      runMode,
      onPrimaryPress,
      onDismiss: allowDismiss ? onDismiss : undefined,
    }),
    [
      allowDismiss,
      cardId,
      copy.description,
      copy.primaryLabel,
      copy.title,
      currentStep,
      iconName,
      onDismiss,
      onPrimaryPress,
      runMode,
      totalSteps,
      visible,
    ],
  );
}
