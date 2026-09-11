/**
 * Phase 7 Step 2 / 3.5 — season close unit tests (no emulator required).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getLeaderboardSeasonBoundsFromKey,
  getLeaderboardSeasonKey,
  getPreviousLeaderboardSeasonKey,
  isValidLeaderboardSeasonKey,
} from '../src/leaderboardSeason';
import {
  classifySeasonCloseTiming,
  compareSeasonCloseEntryOrder,
  isSeasonCloseSnapshotEnabled,
  paginateSeasonCloseEntries,
  parseSeasonCloseResultDocument,
} from '../src/seasonClose';
import { SEASON_CLOSE_SNAPSHOT_VERSION } from '../src/seasonCloseTypes';
import { LEADERBOARD_SCORE_VERSION } from '../src/leaderboardScore';

test('season close snapshot version is 1', () => {
  assert.equal(SEASON_CLOSE_SNAPSHOT_VERSION, 1);
});

test('score formula version is v3 (zero-start)', () => {
  assert.equal(LEADERBOARD_SCORE_VERSION, 3);
});

test('feature flag defaults off', () => {
  const previous = process.env.SEASON_CLOSE_SNAPSHOT_ENABLED;
  delete process.env.SEASON_CLOSE_SNAPSHOT_ENABLED;
  assert.equal(isSeasonCloseSnapshotEnabled(), false);
  process.env.SEASON_CLOSE_SNAPSHOT_ENABLED = 'false';
  assert.equal(isSeasonCloseSnapshotEnabled(), false);
  process.env.SEASON_CLOSE_SNAPSHOT_ENABLED = 'true';
  assert.equal(isSeasonCloseSnapshotEnabled(), true);
  if (previous === undefined) {
    delete process.env.SEASON_CLOSE_SNAPSHOT_ENABLED;
  } else {
    process.env.SEASON_CLOSE_SNAPSHOT_ENABLED = previous;
  }
});

test('previous season key is prior ISO week', () => {
  // Monday 2026-09-07 00:10 UTC → current 2026-W37, previous 2026-W36
  const nowMs = Date.UTC(2026, 8, 7, 0, 10, 0, 0);
  assert.equal(getLeaderboardSeasonKey(nowMs), '2026-W37');
  assert.equal(getPreviousLeaderboardSeasonKey(nowMs), '2026-W36');
});

test('season bounds half-open Monday window', () => {
  const bounds = getLeaderboardSeasonBoundsFromKey('2026-W36');
  assert.ok(bounds);
  assert.equal(getLeaderboardSeasonKey(bounds!.startsAt), '2026-W36');
  assert.equal(getLeaderboardSeasonKey(bounds!.endsAt), '2026-W37');
  assert.equal(bounds!.endsAt - bounds!.startsAt, 7 * 86_400_000);
});

test('classify timing rejects active and future', () => {
  const nowMs = Date.UTC(2026, 8, 9, 12, 0, 0, 0); // mid 2026-W37
  assert.equal(getLeaderboardSeasonKey(nowMs), '2026-W37');
  assert.equal(classifySeasonCloseTiming('2026-W37', nowMs), 'active');
  assert.equal(classifySeasonCloseTiming('2026-W36', nowMs), 'ended');
  assert.equal(classifySeasonCloseTiming('2026-W40', nowMs), 'future');
  assert.equal(classifySeasonCloseTiming('nope', nowMs), 'invalid');
});

test('UTC week edges: Sunday still active, Monday previous ended', () => {
  const sunday = Date.UTC(2026, 8, 6, 23, 59, 59, 999); // 2026-09-06
  assert.equal(getLeaderboardSeasonKey(sunday), '2026-W36');
  assert.equal(classifySeasonCloseTiming('2026-W36', sunday), 'active');

  const monday = Date.UTC(2026, 8, 7, 0, 0, 0, 0);
  assert.equal(getLeaderboardSeasonKey(monday), '2026-W37');
  assert.equal(classifySeasonCloseTiming('2026-W36', monday), 'ended');
  assert.equal(classifySeasonCloseTiming('2026-W37', monday), 'active');
  assert.equal(getPreviousLeaderboardSeasonKey(monday), '2026-W36');

  const scheduler = Date.UTC(2026, 8, 7, 0, 10, 0, 0);
  assert.equal(getPreviousLeaderboardSeasonKey(scheduler), '2026-W36');
  assert.notEqual(getPreviousLeaderboardSeasonKey(scheduler), getLeaderboardSeasonKey(scheduler));
});

test('ISO year boundary and week 52/53 / week 1', () => {
  // 2025-W01 starts Monday 2024-12-30
  const w01 = getLeaderboardSeasonBoundsFromKey('2025-W01');
  assert.ok(w01);
  assert.equal(getLeaderboardSeasonKey(w01!.startsAt), '2025-W01');
  assert.equal(getPreviousLeaderboardSeasonKey(w01!.startsAt), '2024-W52');

  // 2020 had 53 ISO weeks
  const w53 = getLeaderboardSeasonBoundsFromKey('2020-W53');
  assert.ok(w53);
  assert.equal(getLeaderboardSeasonKey(w53!.startsAt), '2020-W53');
  const after = getLeaderboardSeasonKey(w53!.endsAt);
  assert.equal(after, '2021-W01');
  assert.equal(getPreviousLeaderboardSeasonKey(w53!.endsAt), '2020-W53');

  assert.equal(getLeaderboardSeasonBoundsFromKey('2019-W53'), null);
});

test('rank order semantics: higher score first, uid ASC on tie', () => {
  const rows = [
    { uid: 'b', companyScore: 100 },
    { uid: 'a', companyScore: 100 },
    { uid: 'c', companyScore: 200 },
  ];
  rows.sort(compareSeasonCloseEntryOrder);
  assert.deepEqual(
    rows.map((row) => row.uid),
    ['c', 'a', 'b'],
  );
  const ranks = rows.map((row, index) => ({ uid: row.uid, rank: index + 1 }));
  assert.deepEqual(ranks, [
    { uid: 'c', rank: 1 },
    { uid: 'a', rank: 2 },
    { uid: 'b', rank: 3 },
  ]);
});

test('season key validation', () => {
  assert.equal(isValidLeaderboardSeasonKey('2026-W01'), true);
  assert.equal(isValidLeaderboardSeasonKey('2026-W1'), false);
  assert.equal(isValidLeaderboardSeasonKey('weekly_2026-W01'), false);
});

test('strict result parse rejects fake rank 0 / missing fields', () => {
  assert.equal(parseSeasonCloseResultDocument(undefined), null);
  assert.equal(
    parseSeasonCloseResultDocument({
      uid: 'u1',
      seasonKey: '2026-W36',
      finalScore: 10,
      finalRank: 0,
      participantCount: 3,
      snapshottedAt: 1,
      snapshotVersion: 1,
      scoreVersion: 2,
    }),
    null,
  );
  assert.equal(
    parseSeasonCloseResultDocument({
      uid: 'u1',
      seasonKey: '2026-W36',
      finalScore: 10,
      // missing finalRank
      participantCount: 3,
      snapshottedAt: 1,
      snapshotVersion: 1,
      scoreVersion: 2,
    }),
    null,
  );
  const ok = parseSeasonCloseResultDocument({
    uid: 'u1',
    seasonKey: '2026-W36',
    finalScore: 0,
    finalRank: 2,
    participantCount: 3,
    snapshottedAt: 100,
    snapshotVersion: 1,
    scoreVersion: 2,
  });
  assert.ok(ok);
  assert.equal(ok!.finalScore, 0);
  assert.equal(ok!.finalRank, 2);
});

test('pagination cursor: no duplicate/skip across pages with tied scores', () => {
  const entries = [
    { uid: 'z', companyScore: 50 },
    { uid: 'a', companyScore: 100 },
    { uid: 'm', companyScore: 100 },
    { uid: 'b', companyScore: 100 },
    { uid: 'c', companyScore: 90 },
  ];
  const seen = new Set<string>();
  let cursor: { companyScore: number; uid: string } | null = null;
  const ranks: string[] = [];
  for (let safety = 0; safety < 20; safety += 1) {
    const { page, nextCursor } = paginateSeasonCloseEntries(entries, 2, cursor);
    if (page.length === 0) break;
    for (const row of page) {
      assert.equal(seen.has(row.uid), false, `duplicate ${row.uid}`);
      seen.add(row.uid);
      ranks.push(row.uid);
    }
    cursor = nextCursor;
    if (page.length < 2) break;
  }
  assert.deepEqual(ranks, ['a', 'b', 'm', 'c', 'z']);
  assert.equal(seen.size, entries.length);
});

test('pagination: empty, one, exact page size, page size + 1', () => {
  assert.deepEqual(paginateSeasonCloseEntries([], 3, null).page, []);

  const one = [{ uid: 'solo', companyScore: 1 }];
  const p1 = paginateSeasonCloseEntries(one, 10, null);
  assert.equal(p1.page.length, 1);
  assert.equal(p1.nextCursor?.uid, 'solo');

  const exact = Array.from({ length: 3 }, (_, i) => ({
    uid: `u${i}`,
    companyScore: 10 - i,
  }));
  const pe = paginateSeasonCloseEntries(exact, 3, null);
  assert.equal(pe.page.length, 3);
  const pe2 = paginateSeasonCloseEntries(exact, 3, pe.nextCursor);
  assert.equal(pe2.page.length, 0);

  const plus = [...exact, { uid: 'u3', companyScore: 0 }];
  const pp = paginateSeasonCloseEntries(plus, 3, null);
  assert.equal(pp.page.length, 3);
  const pp2 = paginateSeasonCloseEntries(plus, 3, pp.nextCursor);
  assert.equal(pp2.page.length, 1);
  assert.equal(pp2.page[0]?.uid, 'u3');
});
