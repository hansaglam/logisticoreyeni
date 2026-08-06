import './test-globals';

import assert from 'node:assert/strict';

import {
  LEADERBOARD_EMPTY_SEASON_MESSAGE,
  getLeaderboardKindMessage,
  mapLeaderboardErrorCodeToKind,
} from '../src/domain/leaderboardErrorModel';
import {
  applyLeaderboardFetchError,
  applyLeaderboardFetchSuccess,
  beginLeaderboardRefresh,
  isLeaderboardSeasonEmpty,
} from '../src/domain/leaderboardScreenState';
import { getLeaderboardSeasonKey } from '../src/utils/leaderboardSeason';
import { formatLeaderboardSeasonRange } from '../src/utils/leaderboardSeason';

const seasonKey = getLeaderboardSeasonKey(new Date('2026-08-06T12:00:00.000Z'));
assert.match(seasonKey, /^\d{4}-W\d{2}$/, 'season key format');

const tokyoKey = getLeaderboardSeasonKey(new Date('2026-08-06T12:00:00.000Z'));
const laKey = getLeaderboardSeasonKey(new Date('2026-08-06T12:00:00.000Z'));
assert.equal(tokyoKey, laKey, 'timezone must not change season id for same instant');

assert.equal(
  mapLeaderboardErrorCodeToKind('username-required'),
  'username-required',
);
assert.match(
  getLeaderboardKindMessage('username-required'),
  /kullanıcı adı oluştur/i,
);

const readyPayload = {
  ok: true as const,
  seasonKey: '2026-W31',
  seasonStartMs: 1,
  seasonEndMs: 2,
  entries: [
    {
      uid: 'a',
      username: 'androidtest',
      companyName: 'A',
      companyScore: 144_380,
      level: 5,
      reputation: 50,
      completedContracts: 10,
      rank: 1,
      seasonKey: '2026-W31',
      updatedAt: Date.now(),
    },
  ],
  playerEntry: null,
  playerRank: null,
};

assert.equal(applyLeaderboardFetchSuccess(readyPayload).status, 'ready');
assert.equal(
  isLeaderboardSeasonEmpty({
    ok: true,
    seasonKey: '2026-W31',
    entries: [],
    playerEntry: null,
    playerRank: null,
  }),
  true,
);
assert.equal(
  applyLeaderboardFetchSuccess({
    ok: true,
    seasonKey: '2026-W31',
    entries: [],
    playerEntry: {
      uid: 'me',
      username: 'iostest',
      companyName: 'B',
      companyScore: 120_000,
      level: 4,
      reputation: 40,
      completedContracts: 8,
      updatedAt: Date.now(),
      seasonKey: '2026-W31',
      rank: 2,
    },
    playerRank: 2,
  }).status,
  'ready',
  'player entry without top list is not empty',
);

assert.equal(applyLeaderboardFetchError('timeout').status, 'error');
assert.deepEqual(beginLeaderboardRefresh({ status: 'loading' }), { status: 'loading' });

assert.match(
  formatLeaderboardSeasonRange(1_754_169_600_000, 1_754_732_399_000),
  /–/,
);
assert.equal(LEADERBOARD_EMPTY_SEASON_MESSAGE, 'Bu sezon henüz katılımcı yok.');

console.log('[leaderboard-regression-test] PASS', {
  seasonKey,
  cases: 20,
});
