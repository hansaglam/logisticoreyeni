/**
 * Lightweight in-memory cache of last successful getWeeklyMissions result.
 * Used by Dashboard readyWeekly without polling.
 */

import type { GetWeeklyMissionsClientResponse } from '../../services/weeklyMissionService';

export type BackendWeeklySummary = {
  weekKey: string;
  endsAt: number;
  readyWeekly: number;
  weeklyInProgress: number;
  weeklyTotal: number;
  updatedAt: number;
};

let cache: BackendWeeklySummary | null = null;

export function setBackendWeeklyMissionsCache(
  response: Extract<GetWeeklyMissionsClientResponse, { ok: true }>,
  nowMs = Date.now(),
): BackendWeeklySummary {
  let readyWeekly = 0;
  let weeklyInProgress = 0;
  for (const mission of response.missions) {
    if (mission.claimed) continue;
    if (mission.completed || mission.claimAvailable) {
      readyWeekly += 1;
    } else if (mission.progress > 0) {
      weeklyInProgress += 1;
    }
  }
  cache = {
    weekKey: response.weekKey,
    endsAt: response.endsAt,
    readyWeekly,
    weeklyInProgress,
    weeklyTotal: response.missions.length,
    updatedAt: nowMs,
  };
  return cache;
}

export function getBackendWeeklyMissionsCache(): BackendWeeklySummary | null {
  return cache;
}

export function clearBackendWeeklyMissionsCache(): void {
  cache = null;
}

export function getBackendWeeklyDashboardSlice(
  fallback: {
    readyWeekly: number;
    weeklyInProgress: number;
    weeklyTotal: number;
  },
): {
  readyWeekly: number;
  weeklyInProgress: number;
  weeklyTotal: number;
} {
  if (!cache) {
    return {
      readyWeekly: 0,
      weeklyInProgress: 0,
      weeklyTotal: fallback.weeklyTotal > 0 ? fallback.weeklyTotal : 3,
    };
  }
  return {
    readyWeekly: cache.readyWeekly,
    weeklyInProgress: cache.weeklyInProgress,
    weeklyTotal: cache.weeklyTotal,
  };
}
