/**
 * V1.1 Phase 6 — Contextual Guide foundation (persistence only).
 * No visual cards / Help UI in this module.
 */

import type {
  ContextualGuideCardId,
  ContextualGuideState,
  ContextualGuideStatus,
  Delivery,
  MissionsState,
  OnboardingState,
  Player,
  TutorialState,
} from '../types/game';

export const CONTEXTUAL_GUIDE_VERSION = 1;

export const CONTEXTUAL_GUIDE_CARD_IDS = [
  'welcome',
  'choose_contract',
  'manage_fleet',
  'follow_route',
  'need_help',
] as const satisfies readonly ContextualGuideCardId[];

const KNOWN_CARD_IDS = new Set<string>(CONTEXTUAL_GUIDE_CARD_IDS);

const VALID_STATUSES = new Set<ContextualGuideStatus>([
  'eligible',
  'active',
  'dismissed',
  'completed',
]);

export type ContextualGuideProgressSignals = {
  completedContracts: number;
  activeDeliveryCount: number;
  deliveryStarted: boolean;
  tradePurchased: boolean;
  playerLevel: number;
  tutorialCompleted: boolean;
  onboardingCompleted: boolean;
  /** Derived once from raw legacy save fields — see legacyTutorialSaveSignals.ts. */
  legacyTutorialActivity: boolean;
};

export type ContextualGuideCohort = 'new_player' | 'existing_player' | 'has_guide_state';

/** Fresh save — automatic contextual guide may start later (Step 3+). */
export function createEligibleContextualGuideState(): ContextualGuideState {
  return {
    version: CONTEXTUAL_GUIDE_VERSION,
    status: 'eligible',
    completedCardIds: [],
    dismissedCardIds: [],
  };
}

/**
 * Existing / returning players without a prior contextualGuide field.
 * `dismissed` = auto-onboarding skipped for this cohort (they never saw cards).
 * Manual Help & Guide replay (future) uses resetContextualGuideForReplay.
 * Not `completed` — that would imply cards were finished.
 */
export function createSkippedAutoContextualGuideState(): ContextualGuideState {
  return {
    version: CONTEXTUAL_GUIDE_VERSION,
    status: 'dismissed',
    completedCardIds: [],
    dismissedCardIds: [],
  };
}

export function isContextualGuideCardId(value: unknown): value is ContextualGuideCardId {
  return typeof value === 'string' && KNOWN_CARD_IDS.has(value);
}

export function buildContextualGuideProgressSignals(input: {
  player?: Pick<Player, 'completedContracts' | 'level'> | null;
  activeDeliveries?: Delivery[] | null;
  missions?: Pick<MissionsState, 'flags'> | null;
  tutorial?: Pick<TutorialState, 'isCompleted'> | null;
  onboarding?: Pick<OnboardingState, 'completed'> | null;
  legacyTutorialActivity?: boolean;
}): ContextualGuideProgressSignals {
  return {
    completedContracts: Math.max(0, Math.floor(input.player?.completedContracts ?? 0)),
    activeDeliveryCount: Array.isArray(input.activeDeliveries)
      ? input.activeDeliveries.length
      : 0,
    deliveryStarted: input.missions?.flags?.deliveryStarted === true,
    tradePurchased: input.missions?.flags?.tradePurchased === true,
    playerLevel: Math.max(1, Math.floor(input.player?.level ?? 1)),
    tutorialCompleted: input.tutorial?.isCompleted === true,
    onboardingCompleted: input.onboarding?.completed === true,
    legacyTutorialActivity: input.legacyTutorialActivity === true,
  };
}

export function hasExistingPlayerProgress(
  signals: ContextualGuideProgressSignals,
): boolean {
  return (
    signals.completedContracts >= 1 ||
    signals.activeDeliveryCount > 0 ||
    signals.deliveryStarted ||
    signals.tradePurchased ||
    signals.playerLevel > 1 ||
    signals.tutorialCompleted ||
    signals.onboardingCompleted ||
    signals.legacyTutorialActivity
  );
}

export function classifyContextualGuideCohort(
  raw: unknown,
  signals: ContextualGuideProgressSignals,
): ContextualGuideCohort {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return 'has_guide_state';
  }
  return hasExistingPlayerProgress(signals) ? 'existing_player' : 'new_player';
}

function uniqueKnownCardIds(values: unknown): ContextualGuideCardId[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<ContextualGuideCardId>();
  const result: ContextualGuideCardId[] = [];
  for (const value of values) {
    if (!isContextualGuideCardId(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeStatus(raw: unknown): ContextualGuideStatus | null {
  if (typeof raw !== 'string') {
    return null;
  }
  return VALID_STATUSES.has(raw as ContextualGuideStatus)
    ? (raw as ContextualGuideStatus)
    : null;
}

/** Normalize a present contextualGuide object (preserve durable fields). */
export function normalizeContextualGuideState(
  raw: Partial<ContextualGuideState> | null | undefined,
): ContextualGuideState {
  const status = normalizeStatus(raw?.status) ?? 'eligible';
  const version =
    typeof raw?.version === 'number' && Number.isFinite(raw.version)
      ? Math.max(1, Math.floor(raw.version))
      : CONTEXTUAL_GUIDE_VERSION;

  return {
    version,
    status,
    completedCardIds: uniqueKnownCardIds(raw?.completedCardIds),
    dismissedCardIds: uniqueKnownCardIds(raw?.dismissedCardIds),
  };
}

/**
 * Resolve guide state for save load.
 * Missing field ≠ new player: infer from progression signals.
 */
export function resolveContextualGuideFromSave(
  raw: unknown,
  signals: ContextualGuideProgressSignals,
): ContextualGuideState {
  const cohort = classifyContextualGuideCohort(raw, signals);
  if (cohort === 'has_guide_state') {
    return normalizeContextualGuideState(raw as Partial<ContextualGuideState>);
  }
  if (cohort === 'existing_player') {
    return createSkippedAutoContextualGuideState();
  }
  return createEligibleContextualGuideState();
}

/** True when auto-showing contextual cards is allowed (future UI). */
export function shouldAutoPresentContextualGuide(
  guide: ContextualGuideState | null | undefined,
): boolean {
  return guide?.status === 'eligible' || guide?.status === 'active';
}

function appendUniqueCardId(
  ids: ContextualGuideCardId[],
  cardId: ContextualGuideCardId,
): ContextualGuideCardId[] {
  if (ids.includes(cardId)) {
    return ids;
  }
  return [...ids, cardId];
}

export function markContextualGuideCardCompletedState(
  guide: ContextualGuideState,
  cardId: ContextualGuideCardId,
): ContextualGuideState {
  if (!isContextualGuideCardId(cardId)) {
    return guide;
  }
  const completedCardIds = appendUniqueCardId(guide.completedCardIds, cardId);
  if (
    completedCardIds === guide.completedCardIds &&
    (guide.status === 'active' || guide.status === 'completed')
  ) {
    return guide;
  }
  const allDone = CONTEXTUAL_GUIDE_CARD_IDS.every((id) => completedCardIds.includes(id));
  return {
    ...guide,
    version: CONTEXTUAL_GUIDE_VERSION,
    status: allDone ? 'completed' : guide.status === 'eligible' ? 'active' : guide.status,
    completedCardIds,
  };
}

export function dismissContextualGuideCardState(
  guide: ContextualGuideState,
  cardId: ContextualGuideCardId,
): ContextualGuideState {
  if (!isContextualGuideCardId(cardId)) {
    return guide;
  }
  const dismissedCardIds = appendUniqueCardId(guide.dismissedCardIds, cardId);
  if (dismissedCardIds === guide.dismissedCardIds) {
    return guide;
  }
  return {
    ...guide,
    version: CONTEXTUAL_GUIDE_VERSION,
    status: guide.status === 'eligible' ? 'active' : guide.status,
    dismissedCardIds,
  };
}

export function completeContextualGuideState(
  guide: ContextualGuideState,
): ContextualGuideState {
  if (guide.status === 'completed') {
    return guide;
  }
  return {
    ...guide,
    version: CONTEXTUAL_GUIDE_VERSION,
    status: 'completed',
  };
}

export function dismissContextualGuideState(
  guide: ContextualGuideState,
): ContextualGuideState {
  if (guide.status === 'dismissed') {
    return guide;
  }
  return {
    ...guide,
    version: CONTEXTUAL_GUIDE_VERSION,
    status: 'dismissed',
  };
}

/**
 * Future Help & Guide manual replay — does not invent completed card history.
 * Clears per-card dismiss/complete lists so cards can show again.
 */
export function resetContextualGuideForReplayState(
  _guide?: ContextualGuideState | null,
): ContextualGuideState {
  return {
    version: CONTEXTUAL_GUIDE_VERSION,
    status: 'active',
    completedCardIds: [],
    dismissedCardIds: [],
  };
}
