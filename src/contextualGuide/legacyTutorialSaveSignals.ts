/**
 * One-shot legacy tutorial signals read from raw save payloads only.
 * Used for contextual-guide cohort inference — never re-persisted.
 */

export function hasLegacyTutorialActivityFromRawSave(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;

  if (record.marketTutorialCompleted === true) {
    return true;
  }

  const spotlight = record.spotlightTutorial;
  if (spotlight && typeof spotlight === 'object' && !Array.isArray(spotlight)) {
    const completed = (spotlight as { completedIds?: unknown }).completedIds;
    const skipped = (spotlight as { skippedIds?: unknown }).skippedIds;
    if (Array.isArray(completed) && completed.length > 0) return true;
    if (Array.isArray(skipped) && skipped.length > 0) return true;
  }

  const progress = record.tutorialProgress;
  if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
    for (const entry of Object.values(progress as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (e.hasBeenPresented === true) return true;
      if (
        e.status === 'completed' ||
        e.status === 'skipped' ||
        e.status === 'dismissed'
      ) {
        return true;
      }
      if (e.completed === true) return true;
      if (
        typeof e.lastManualReplayAt === 'number' ||
        typeof e.completedAt === 'number' ||
        typeof e.skippedAt === 'number' ||
        typeof e.dismissedAt === 'number'
      ) {
        return true;
      }
    }
  }

  return false;
}
