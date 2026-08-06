import { MARKET_TUTORIAL_VERSION } from '../../config/marketTutorial';
import type { AppTutorialId, TutorialProgressEntry, TutorialProgressState } from './types';
import { APP_TUTORIAL_VERSIONS } from './versions';

const VALID_TUTORIAL_IDS = new Set<AppTutorialId>(Object.keys(APP_TUTORIAL_VERSIONS) as AppTutorialId[]);

function isTutorialProgressEntry(value: unknown): value is Partial<TutorialProgressEntry> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeTutorialProgressEntry(
  raw: Partial<TutorialProgressEntry> | null | undefined,
): TutorialProgressEntry {
  return {
    completed: raw?.completed === true,
    version:
      typeof raw?.version === 'number' && Number.isFinite(raw.version)
        ? Math.max(0, Math.floor(raw.version))
        : 0,
  };
}

export function normalizeTutorialProgress(raw: unknown): TutorialProgressState {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: TutorialProgressState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_TUTORIAL_IDS.has(key as AppTutorialId)) {
      continue;
    }
    if (!isTutorialProgressEntry(value)) {
      continue;
    }
    result[key as AppTutorialId] = normalizeTutorialProgressEntry(value);
  }
  return result;
}

export function mergeLegacyMarketTutorialProgress(
  progress: TutorialProgressState,
  legacy?: {
    marketTutorialCompleted?: boolean;
    marketTutorialVersion?: number;
  },
): TutorialProgressState {
  const merged = { ...progress };
  if (!merged.market && legacy) {
    merged.market = {
      completed: legacy.marketTutorialCompleted === true,
      version:
        typeof legacy.marketTutorialVersion === 'number' &&
        Number.isFinite(legacy.marketTutorialVersion)
          ? Math.max(0, Math.floor(legacy.marketTutorialVersion))
          : legacy.marketTutorialCompleted === true
            ? MARKET_TUTORIAL_VERSION
            : 0,
    };
  }
  return merged;
}

export function getTutorialProgressEntry(
  progress: TutorialProgressState | undefined,
  tutorialId: AppTutorialId,
  legacy?: {
    marketTutorialCompleted?: boolean;
    marketTutorialVersion?: number;
  },
): TutorialProgressEntry {
  const merged = mergeLegacyMarketTutorialProgress(normalizeTutorialProgress(progress), legacy);
  return merged[tutorialId] ?? { completed: false, version: 0 };
}

export function shouldAutoStartTutorial(
  tutorialId: AppTutorialId,
  progress: TutorialProgressState | undefined,
  legacy?: {
    marketTutorialCompleted?: boolean;
    marketTutorialVersion?: number;
  },
): boolean {
  const entry = getTutorialProgressEntry(progress, tutorialId, legacy);
  const currentVersion = APP_TUTORIAL_VERSIONS[tutorialId];
  if (entry.completed !== true) {
    return true;
  }
  return entry.version < currentVersion;
}

export function createCompletedTutorialEntry(tutorialId: AppTutorialId): TutorialProgressEntry {
  return {
    completed: true,
    version: APP_TUTORIAL_VERSIONS[tutorialId],
  };
}

export function applyTutorialCompletion(
  progress: TutorialProgressState | undefined,
  tutorialId: AppTutorialId,
): TutorialProgressState {
  return {
    ...normalizeTutorialProgress(progress),
    [tutorialId]: createCompletedTutorialEntry(tutorialId),
  };
}
