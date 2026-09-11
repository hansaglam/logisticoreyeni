/**
 * Tiny coordinator: resume navigation + App-level tab lock helpers.
 * Not a workflow engine — only first-run / replay glue.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useGameStore } from '../store/gameStore';
import {
  getCurrentContextualGuideCardId,
  isContextualGuideAutoShowAllowed,
} from './contextualGuideSequence';
import { requestNavigationToCurrentGuideCard } from './contextualGuideNavigation';
import {
  consumeContextualGuideNavigationBypass,
  getContextualGuideSessionSnapshot,
  isContextualGuideInteractionLocked,
  peekContextualGuideNavigationBypass,
  subscribeContextualGuideSession,
} from './contextualGuideSession';

function subscribeSession(cb: () => void) {
  return subscribeContextualGuideSession(cb);
}

function getSession() {
  return getContextualGuideSessionSnapshot();
}

/**
 * Once per AppShell mount (after game ready): jump to the screen for the
 * current incomplete card so cold restart mid-tutorial resumes correctly.
 * Authority: durable contextualGuide status + completedCardIds only.
 */
export function useContextualGuideResumeNavigation(enabled: boolean): void {
  const didResume = useRef(false);
  const guideStatus = useGameStore((state) => state.contextualGuide?.status);
  const completedKey = useGameStore((state) =>
    (state.contextualGuide?.completedCardIds ?? []).join(','),
  );

  useEffect(() => {
    if (!enabled || didResume.current) {
      return;
    }
    const guide = useGameStore.getState().contextualGuide;
    if (!isContextualGuideAutoShowAllowed(guide)) {
      return;
    }
    const current = getCurrentContextualGuideCardId(guide);
    if (!current) {
      return;
    }
    didResume.current = true;
    requestNavigationToCurrentGuideCard(guide);
  }, [enabled, guideStatus, completedKey]);
}

/** True when guide is eligible/active (mandatory or replay) — block free UI. */
export function useContextualGuideInteractionLocked(): boolean {
  useSyncExternalStore(subscribeSession, getSession, getSession);
  return useGameStore((state) => isContextualGuideInteractionLocked(state.contextualGuide));
}

/**
 * Whether a user-initiated tab press should be ignored.
 * Programmatic tutorial navigation sets a one-shot bypass.
 */
export function shouldBlockManualTabPressWhileGuideActive(): boolean {
  const guide = useGameStore.getState().contextualGuide;
  if (!isContextualGuideInteractionLocked(guide)) {
    return false;
  }
  if (peekContextualGuideNavigationBypass()) {
    consumeContextualGuideNavigationBypass();
    return false;
  }
  return true;
}
