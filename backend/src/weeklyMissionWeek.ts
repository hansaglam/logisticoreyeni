/**
 * Weekly Missions week keys — aliases of canonical leaderboard ISO weeks.
 * Format: YYYY-Www (never weekly_YYYY-Www).
 */

import {
  getLeaderboardSeasonBoundsFromKey,
  getLeaderboardSeasonKey,
  isValidLeaderboardSeasonKey,
} from './leaderboardSeason';
import { getWeeklyPeriod } from './seasonPeriods';

export function getWeeklyMissionWeekKey(nowMs: number = Date.now()): string {
  return getLeaderboardSeasonKey(nowMs);
}

export function isValidWeeklyMissionWeekKey(value: unknown): value is string {
  return isValidLeaderboardSeasonKey(value);
}

export function getWeeklyMissionPeriod(nowMs: number = Date.now()): {
  weekKey: string;
  startsAt: number;
  endsAt: number;
} {
  const period = getWeeklyPeriod(nowMs);
  return {
    weekKey: period.key,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  };
}

export function getWeeklyMissionBoundsFromKey(
  weekKey: string,
): { startsAt: number; endsAt: number } | null {
  return getLeaderboardSeasonBoundsFromKey(weekKey);
}
