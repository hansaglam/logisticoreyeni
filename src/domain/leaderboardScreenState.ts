import type { LeaderboardFetchResult } from '../services/leaderboardService';
import type { LeaderboardErrorKind } from './leaderboardErrorModel';

export type LeaderboardSeason = {
  id: string;
  startsAt: number;
  endsAt: number;
  label: string;
};

export type LeaderboardScreenState =
  | { status: 'loading' }
  | { status: 'ready'; data: LeaderboardFetchResult }
  | { status: 'empty'; season: LeaderboardSeason }
  | { status: 'username-required' }
  | { status: 'unauthenticated' }
  | { status: 'error'; error: LeaderboardErrorKind }
  | { status: 'refreshing'; data: LeaderboardFetchResult };

export function isLeaderboardSeasonEmpty(data: LeaderboardFetchResult): boolean {
  return data.entries.length === 0 && !data.playerEntry;
}

export function beginLeaderboardRefresh(
  current: LeaderboardScreenState,
): LeaderboardScreenState {
  if (current.status === 'ready' || current.status === 'refreshing') {
    return { status: 'refreshing', data: current.data };
  }
  return { status: 'loading' };
}

export function applyLeaderboardFetchSuccess(
  data: LeaderboardFetchResult,
): LeaderboardScreenState {
  if (isLeaderboardSeasonEmpty(data)) {
    return {
      status: 'empty',
      season: {
        id: data.seasonKey,
        startsAt: data.seasonStartMs ?? 0,
        endsAt: data.seasonEndMs ?? 0,
        label: data.seasonKey,
      },
    };
  }
  return { status: 'ready', data };
}

export function applyLeaderboardFetchError(
  error: LeaderboardErrorKind,
): LeaderboardScreenState {
  return { status: 'error', error };
}
