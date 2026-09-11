/**
 * CTA-driven navigation for the guided tutorial (no timers).
 */

import type { ContextualGuideCardId } from '../types/game';
import {
  CONTEXTUAL_GUIDE_CARD_SCREEN,
  contextualGuideScreenToTab,
  getCurrentContextualGuideCardId,
  type ContextualGuideScreenId,
} from './contextualGuideSequence';
import { allowContextualGuideNavigationBypass } from './contextualGuideSession';

export type GuideNavigationTab =
  | 'dashboard'
  | 'contracts'
  | 'fleet'
  | 'map'
  | 'more';

export function getTabForContextualGuideCard(
  cardId: ContextualGuideCardId,
): GuideNavigationTab {
  const screen: ContextualGuideScreenId = CONTEXTUAL_GUIDE_CARD_SCREEN[cardId];
  return contextualGuideScreenToTab(screen);
}

/**
 * After completing `completedCardId`, navigate to the next step's screen
 * (or Dashboard after final step).
 */
export function requestNavigationAfterGuideCard(
  completedCardId: ContextualGuideCardId,
  guideAfterComplete: Parameters<typeof getCurrentContextualGuideCardId>[0],
): void {
  // Lazy require keeps Node regression scripts free of RN store side effects.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useGameStore } = require('../store/gameStore') as typeof import('../store/gameStore');

  let tab: GuideNavigationTab = 'dashboard';
  if (completedCardId === 'need_help') {
    tab = 'dashboard';
  } else {
    const next = getCurrentContextualGuideCardId(guideAfterComplete);
    tab = next ? getTabForContextualGuideCard(next) : 'dashboard';
  }

  allowContextualGuideNavigationBypass();
  useGameStore.setState({
    navigationRequest: { tab },
    pendingMoreSubRoute: tab === 'more' ? 'menu' : undefined,
  });
}

/** Resume: jump to the screen that hosts the current incomplete card. */
export function requestNavigationToCurrentGuideCard(
  guide: Parameters<typeof getCurrentContextualGuideCardId>[0],
): void {
  const current = getCurrentContextualGuideCardId(guide);
  if (!current) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useGameStore } = require('../store/gameStore') as typeof import('../store/gameStore');
  const tab = getTabForContextualGuideCard(current);
  allowContextualGuideNavigationBypass();
  useGameStore.setState({
    navigationRequest: { tab },
    pendingMoreSubRoute: tab === 'more' ? 'menu' : undefined,
  });
}
