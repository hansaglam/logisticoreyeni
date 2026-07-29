import type { MissionsState, RetentionState } from '../types/game';

function stringSetEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  if (setA.size !== b.length) return false;
  return b.every((id) => setA.has(id));
}

function retentionObjectiveProgressEqual(
  prev: Record<string, { progress: number; isClaimed: boolean }> | undefined,
  next: Record<string, { progress: number; isClaimed: boolean }>,
): boolean {
  for (const [id, nextEntry] of Object.entries(next)) {
    const prevEntry = prev?.[id];
    if (!prevEntry) return false;
    if (
      prevEntry.progress !== nextEntry.progress ||
      prevEntry.isClaimed !== nextEntry.isClaimed
    ) {
      return false;
    }
  }
  return true;
}

function retentionWeeklyStatsEqual(
  prev: RetentionState['weeklyStats'],
  next: RetentionState['weeklyStats'],
): boolean {
  return (
    prev.deliveriesCompleted === next.deliveriesCompleted &&
    prev.tradeProfit === next.tradeProfit &&
    prev.stockStoredTons === next.stockStoredTons &&
    prev.onTimeDeliveries === next.onTimeDeliveries &&
    prev.tradeBuyCount === next.tradeBuyCount &&
    prev.tradeSellCount === next.tradeSellCount &&
    stringSetEqual(prev.citiesOperated, next.citiesOperated)
  );
}

export function missionsProgressUnchanged(
  prev: MissionsState | undefined,
  next: MissionsState,
): boolean {
  if (!prev) return false;
  if (!stringSetEqual(prev.completedMissionIds, next.completedMissionIds)) return false;
  const previousTimes = prev.completedAtByMissionId ?? {};
  const nextTimes = next.completedAtByMissionId ?? {};
  const nextEntries = Object.entries(nextTimes);
  if (Object.keys(previousTimes).length !== nextEntries.length) return false;
  return nextEntries.every(([missionId, completedAt]) => previousTimes[missionId] === completedAt);
}

export function retentionProgressUnchanged(
  prev: RetentionState | undefined,
  next: RetentionState,
): boolean {
  if (!prev) return false;
  if (prev.currentWeeklySeasonKey !== next.currentWeeklySeasonKey) return false;
  if (!retentionWeeklyStatsEqual(prev.weeklyStats, next.weeklyStats)) return false;
  if (!retentionObjectiveProgressEqual(prev.milestones, next.milestones)) return false;
  if (!retentionObjectiveProgressEqual(prev.weeklyObjectives, next.weeklyObjectives)) {
    return false;
  }
  return true;
}
