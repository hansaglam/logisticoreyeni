import type { SpotlightTutorialId, SpotlightTutorialPersistence } from '../types/game';

export function createDefaultSpotlightTutorialState(): SpotlightTutorialPersistence {
  return {
    completedIds: [],
    skippedIds: [],
  };
}

function safeSpotlightIdArray(value: unknown): SpotlightTutorialId[] {
  const allowed: SpotlightTutorialId[] = ['first_contract', 'track_delivery', 'market_basics'];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is SpotlightTutorialId => allowed.includes(item as SpotlightTutorialId));
}

export function normalizeSpotlightTutorialState(
  raw?: Partial<SpotlightTutorialPersistence> | null,
): SpotlightTutorialPersistence {
  const defaults = createDefaultSpotlightTutorialState();
  if (!raw) {
    return defaults;
  }
  return {
    completedIds: safeSpotlightIdArray(raw.completedIds),
    skippedIds: safeSpotlightIdArray(raw.skippedIds),
  };
}

export function markSpotlightTutorialCompletedState(
  state: SpotlightTutorialPersistence,
  tutorialId: SpotlightTutorialId,
): SpotlightTutorialPersistence {
  const completedIds = state.completedIds.includes(tutorialId)
    ? state.completedIds
    : [...state.completedIds, tutorialId];
  const skippedIds = state.skippedIds.filter((id) => id !== tutorialId);
  return { completedIds, skippedIds };
}

export function markSpotlightTutorialSkippedState(
  state: SpotlightTutorialPersistence,
  tutorialId: SpotlightTutorialId,
): SpotlightTutorialPersistence {
  const skippedIds = state.skippedIds.includes(tutorialId)
    ? state.skippedIds
    : [...state.skippedIds, tutorialId];
  const completedIds = state.completedIds.filter((id) => id !== tutorialId);
  return { completedIds, skippedIds };
}

export function clearSpotlightTutorialProgressState(
  state: SpotlightTutorialPersistence,
  tutorialId: SpotlightTutorialId,
): SpotlightTutorialPersistence {
  return {
    completedIds: state.completedIds.filter((id) => id !== tutorialId),
    skippedIds: state.skippedIds.filter((id) => id !== tutorialId),
  };
}
