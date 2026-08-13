import { MARKET_TUTORIAL_VERSION } from '../../config/marketTutorial';
import type {
  AppTutorialId,
  TutorialOutcome,
  TutorialProgressEntry,
  TutorialProgressState,
  TutorialProgressStatus,
} from './types';
import { APP_TUTORIAL_VERSIONS } from './versions';

const VALID_TUTORIAL_IDS = new Set<AppTutorialId>(Object.keys(APP_TUTORIAL_VERSIONS) as AppTutorialId[]);

function isTutorialProgressEntry(value: unknown): value is Partial<TutorialProgressEntry> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStatus(raw: Partial<TutorialProgressEntry> | null | undefined): TutorialProgressStatus {
  if (raw?.status === 'completed' || raw?.status === 'skipped' || raw?.status === 'dismissed') {
    return raw.status;
  }
  if (raw?.completed === true) {
    return 'completed';
  }
  return 'never-seen';
}

export function createDefaultTutorialProgressEntry(): TutorialProgressEntry {
  return {
    version: 0,
    hasBeenPresented: false,
    status: 'never-seen',
    completed: false,
  };
}

export function normalizeTutorialProgressEntry(
  raw: Partial<TutorialProgressEntry> | null | undefined,
): TutorialProgressEntry {
  const version =
    typeof raw?.version === 'number' && Number.isFinite(raw.version)
      ? Math.max(0, Math.floor(raw.version))
      : 0;
  const status = normalizeStatus(raw);
  const legacyCompleted = raw?.completed === true || status === 'completed';
  const hasBeenPresented =
    raw?.hasBeenPresented === true ||
    legacyCompleted ||
    status === 'skipped' ||
    status === 'dismissed';

  return {
    version,
    hasBeenPresented,
    status: hasBeenPresented && status === 'never-seen' ? 'completed' : status,
    completed: legacyCompleted,
    completedAt: typeof raw?.completedAt === 'number' ? raw.completedAt : undefined,
    skippedAt: typeof raw?.skippedAt === 'number' ? raw.skippedAt : undefined,
    dismissedAt: typeof raw?.dismissedAt === 'number' ? raw.dismissedAt : undefined,
    lastManualReplayAt:
      typeof raw?.lastManualReplayAt === 'number' ? raw.lastManualReplayAt : undefined,
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
    const completed = legacy.marketTutorialCompleted === true;
    merged.market = normalizeTutorialProgressEntry({
      completed,
      hasBeenPresented: completed,
      status: completed ? 'completed' : 'never-seen',
      version:
        typeof legacy.marketTutorialVersion === 'number' &&
        Number.isFinite(legacy.marketTutorialVersion)
          ? Math.max(0, Math.floor(legacy.marketTutorialVersion))
          : completed
            ? MARKET_TUTORIAL_VERSION
            : 0,
    });
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
  return merged[tutorialId] ?? createDefaultTutorialProgressEntry();
}

export function hasTutorialBeenPresented(
  tutorialId: AppTutorialId,
  progress: TutorialProgressState | undefined,
  legacy?: {
    marketTutorialCompleted?: boolean;
    marketTutorialVersion?: number;
  },
): boolean {
  return getTutorialProgressEntry(progress, tutorialId, legacy).hasBeenPresented === true;
}

export function shouldAutoPresentTutorial(input: {
  enabled: boolean;
  hydrated: boolean;
  layoutReady: boolean;
  definitionAvailable: boolean;
  hasBeenPresented: boolean;
  blockerActive: boolean;
  sessionDisabled: boolean;
  autoStart: boolean;
}): boolean {
  if (!input.enabled) {
    return false;
  }
  if (input.sessionDisabled) {
    return false;
  }
  if (!input.hydrated) {
    return false;
  }
  if (!input.layoutReady) {
    return false;
  }
  if (!input.definitionAvailable) {
    return false;
  }
  if (!input.autoStart) {
    return false;
  }
  if (input.hasBeenPresented) {
    return false;
  }
  if (input.blockerActive) {
    return false;
  }
  return true;
}

/** First-visit only — version bumps do not re-trigger auto presentation. */
export function shouldAutoStartTutorial(
  tutorialId: AppTutorialId,
  progress: TutorialProgressState | undefined,
  legacy?: {
    marketTutorialCompleted?: boolean;
    marketTutorialVersion?: number;
  },
): boolean {
  return !hasTutorialBeenPresented(tutorialId, progress, legacy);
}

export function createTutorialProgressEntry(
  tutorialId: AppTutorialId,
  partial: Partial<TutorialProgressEntry>,
): TutorialProgressEntry {
  return normalizeTutorialProgressEntry({
    version: APP_TUTORIAL_VERSIONS[tutorialId],
    ...partial,
  });
}

export function applyTutorialPresented(
  progress: TutorialProgressState | undefined,
  tutorialId: AppTutorialId,
): TutorialProgressState {
  const current = getTutorialProgressEntry(progress, tutorialId);
  if (current.hasBeenPresented) {
    return normalizeTutorialProgress(progress);
  }
  return {
    ...normalizeTutorialProgress(progress),
    [tutorialId]: createTutorialProgressEntry(tutorialId, {
      ...current,
      hasBeenPresented: true,
      completed: current.completed,
    }),
  };
}

export function applyTutorialOutcome(
  progress: TutorialProgressState | undefined,
  tutorialId: AppTutorialId,
  outcome: TutorialOutcome,
): TutorialProgressState {
  const now = Date.now();
  const current = getTutorialProgressEntry(progress, tutorialId);
  const next: TutorialProgressEntry = createTutorialProgressEntry(tutorialId, {
    ...current,
    hasBeenPresented: true,
    status: outcome,
    completed: outcome === 'completed',
    completedAt: outcome === 'completed' ? now : current.completedAt,
    skippedAt: outcome === 'skipped' ? now : current.skippedAt,
    dismissedAt: outcome === 'dismissed' ? now : current.dismissedAt,
  });
  return {
    ...normalizeTutorialProgress(progress),
    [tutorialId]: next,
  };
}

export function applyManualTutorialReplay(
  progress: TutorialProgressState | undefined,
  tutorialId: AppTutorialId,
): TutorialProgressState {
  const current = getTutorialProgressEntry(progress, tutorialId);
  return {
    ...normalizeTutorialProgress(progress),
    [tutorialId]: createTutorialProgressEntry(tutorialId, {
      ...current,
      lastManualReplayAt: Date.now(),
    }),
  };
}

/** @deprecated Use applyTutorialOutcome(..., 'completed') */
export function createCompletedTutorialEntry(tutorialId: AppTutorialId): TutorialProgressEntry {
  return createTutorialProgressEntry(tutorialId, {
    hasBeenPresented: true,
    status: 'completed',
    completed: true,
    completedAt: Date.now(),
  });
}

/** @deprecated Use applyTutorialOutcome */
export function applyTutorialCompletion(
  progress: TutorialProgressState | undefined,
  tutorialId: AppTutorialId,
): TutorialProgressState {
  return applyTutorialOutcome(progress, tutorialId, 'completed');
}
