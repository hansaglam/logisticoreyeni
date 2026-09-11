/**
 * Pure helpers for contextual guide card sequence (no UI).
 */

import type { ContextualGuideCardId, ContextualGuideState } from '../types/game';
import { CONTEXTUAL_GUIDE_CARD_IDS } from './contextualGuideState';

export type ContextualGuideScreenId =
  | 'dashboard'
  | 'contracts'
  | 'fleet'
  | 'map'
  | 'more';

export const CONTEXTUAL_GUIDE_CARD_SCREEN: Record<
  ContextualGuideCardId,
  ContextualGuideScreenId
> = {
  welcome: 'dashboard',
  choose_contract: 'contracts',
  manage_fleet: 'fleet',
  follow_route: 'map',
  need_help: 'more',
};

/** Map sequence screens → App NavigationTab. */
export function contextualGuideScreenToTab(
  screen: ContextualGuideScreenId,
): 'dashboard' | 'contracts' | 'fleet' | 'map' | 'more' {
  return screen;
}

export function isContextualGuideAutoShowAllowed(
  guide: Pick<ContextualGuideState, 'status'> | null | undefined,
): boolean {
  const status = guide?.status;
  return status === 'eligible' || status === 'active';
}

/** First incomplete card in fixed order, or null if finished / not showing. */
export function getCurrentContextualGuideCardId(
  guide: ContextualGuideState | null | undefined,
): ContextualGuideCardId | null {
  if (!guide || !isContextualGuideAutoShowAllowed(guide)) {
    return null;
  }
  for (const cardId of CONTEXTUAL_GUIDE_CARD_IDS) {
    if (!guide.completedCardIds.includes(cardId)) {
      return cardId;
    }
  }
  return null;
}

/**
 * Durable mandatory first-run step resolver.
 * Authority: saved status + completedCardIds only (not runtime session).
 */
export function getCurrentMandatoryTutorialStep(
  guide: ContextualGuideState | null | undefined,
): ContextualGuideCardId | null {
  return getCurrentContextualGuideCardId(guide);
}

export function getNextContextualGuideCardId(
  guide: ContextualGuideState | null | undefined,
): ContextualGuideCardId | null {
  const current = getCurrentContextualGuideCardId(guide);
  if (!current) {
    return null;
  }
  const index = CONTEXTUAL_GUIDE_CARD_IDS.indexOf(current);
  if (index < 0 || index >= CONTEXTUAL_GUIDE_CARD_IDS.length - 1) {
    return null;
  }
  return CONTEXTUAL_GUIDE_CARD_IDS[index + 1] ?? null;
}

export type CanShowContextualGuideCardOptions = {
  /** Suppress while assignment sheets / ads / conflict modals are open. */
  blockingUi?: boolean;
};

export function canShowContextualGuideCard(
  guide: ContextualGuideState | null | undefined,
  cardId: ContextualGuideCardId,
  options: CanShowContextualGuideCardOptions = {},
): boolean {
  if (options.blockingUi) {
    return false;
  }
  if (getCurrentContextualGuideCardId(guide) !== cardId) {
    return false;
  }
  return true;
}

export function getContextualGuideStepIndex(cardId: ContextualGuideCardId): number {
  return CONTEXTUAL_GUIDE_CARD_IDS.indexOf(cardId) + 1;
}

export function getContextualGuideTotalSteps(): number {
  return CONTEXTUAL_GUIDE_CARD_IDS.length;
}

/**
 * @deprecated Delivery gate removed for mandatory guided tour.
 * Kept as a cheap boolean selector for Map/perf tests that still import it.
 */
export function selectHasRunningDelivery(state: {
  activeDeliveries?: readonly { status?: string }[] | null;
}): boolean {
  const list = state.activeDeliveries;
  if (!list?.length) {
    return false;
  }
  for (let i = 0; i < list.length; i += 1) {
    const status = list[i]?.status;
    if (status === 'preparing' || status === 'on_route' || status === 'paused') {
      return true;
    }
  }
  return false;
}
