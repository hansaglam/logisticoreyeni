/**
 * Phase 7 Step 2 — immutable season close emulator tests.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { LEADERBOARD_SCORE_VERSION } from '../src/leaderboardScore';
import {
  getLeaderboardSeasonBoundsFromKey,
  getLeaderboardSeasonKey,
  getPreviousLeaderboardSeasonKey,
} from '../src/leaderboardSeason';
import {
  classifySeasonCloseTiming,
  finalizeSeason,
  getSeasonResultForUid,
  seasonCloseMetaRef,
  seasonCloseResultRef,
} from '../src/seasonClose';
import { SEASON_CLOSE_SNAPSHOT_VERSION } from '../src/seasonCloseTypes';

const PROJECT_ID = 'logisticore-season-close-emulator';
delete process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

let rulesEnvironment: RulesTestEnvironment;
let rulesTesting: typeof import('@firebase/rules-unit-testing');
const adminApp = initializeApp({ projectId: PROJECT_ID }, 'season-close-tests');
const adminFirestore = getFirestore(adminApp);
adminFirestore.settings({ host: '127.0.0.1:8080', ssl: false });

async function clearFirestore(): Promise<void> {
  await rulesEnvironment.clearFirestore();
}

async function seedEntry(
  seasonKey: string,
  uid: string,
  companyScore: number,
): Promise<void> {
  await adminFirestore.doc(`leaderboards/${seasonKey}/entries/${uid}`).set({
    uid,
    username: `user_${uid}`,
    companyName: 'Test Co',
    companyScore,
    level: 5,
    reputation: 50,
    completedContracts: 10,
    seasonKey,
    scoreVersion: LEADERBOARD_SCORE_VERSION,
    updatedAt: Timestamp.now(),
  });
}

before(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  rulesTesting = await import('@firebase/rules-unit-testing');
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  rulesEnvironment = await rulesTesting.initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  });
});

beforeEach(async () => {
  await clearFirestore();
});

after(async () => {
  await rulesEnvironment.cleanup();
  await deleteApp(adminApp);
});

const closedNowMs = Date.UTC(2026, 8, 9, 12, 0, 0, 0); // mid 2026-W37
const closedSeasonKey = getPreviousLeaderboardSeasonKey(closedNowMs);

test('active season close rejected', async () => {
  const active = getLeaderboardSeasonKey(closedNowMs);
  const result = await finalizeSeason(adminFirestore, active, {
    nowMs: closedNowMs,
    forceEnabled: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'season-active');
});

test('future season close rejected', async () => {
  const result = await finalizeSeason(adminFirestore, '2026-W40', {
    nowMs: closedNowMs,
    forceEnabled: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'season-future');
});

test('feature disabled rejects finalize', async () => {
  const previous = process.env.SEASON_CLOSE_SNAPSHOT_ENABLED;
  delete process.env.SEASON_CLOSE_SNAPSHOT_ENABLED;
  const result = await finalizeSeason(adminFirestore, closedSeasonKey, {
    nowMs: closedNowMs,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'feature-disabled');
  if (previous === undefined) delete process.env.SEASON_CLOSE_SNAPSHOT_ENABLED;
  else process.env.SEASON_CLOSE_SNAPSHOT_ENABLED = previous;
});

test('finalize writes immutable ranked results', async () => {
  assert.equal(closedSeasonKey, '2026-W36');
  await seedEntry(closedSeasonKey, 'uid_c', 200);
  await seedEntry(closedSeasonKey, 'uid_a', 100);
  await seedEntry(closedSeasonKey, 'uid_b', 100);

  const first = await finalizeSeason(adminFirestore, closedSeasonKey, {
    nowMs: closedNowMs,
    forceEnabled: true,
  });
  assert.equal(first.ok, true);
  assert.equal(first.reason, 'success');
  assert.equal(first.status, 'closed');
  assert.equal(first.participantCount, 3);
  assert.equal(first.processedCount, 3);

  const c = await seasonCloseResultRef(adminFirestore, closedSeasonKey, 'uid_c').get();
  const a = await seasonCloseResultRef(adminFirestore, closedSeasonKey, 'uid_a').get();
  const b = await seasonCloseResultRef(adminFirestore, closedSeasonKey, 'uid_b').get();
  assert.equal(c.data()?.finalRank, 1);
  assert.equal(c.data()?.finalScore, 200);
  assert.equal(a.data()?.finalRank, 2);
  assert.equal(b.data()?.finalRank, 3);
  assert.equal(a.data()?.snapshotVersion, SEASON_CLOSE_SNAPSHOT_VERSION);

  const bounds = getLeaderboardSeasonBoundsFromKey(closedSeasonKey)!;
  const meta = await seasonCloseMetaRef(adminFirestore, closedSeasonKey).get();
  assert.equal(meta.data()?.status, 'closed');
  assert.equal(meta.data()?.startsAt, bounds.startsAt);
  assert.equal(meta.data()?.endsAt, bounds.endsAt);

  const second = await finalizeSeason(adminFirestore, closedSeasonKey, {
    nowMs: closedNowMs,
    forceEnabled: true,
  });
  assert.equal(second.ok, true);
  assert.equal(second.reason, 'already-closed');
  assert.equal((await seasonCloseResultRef(adminFirestore, closedSeasonKey, 'uid_c').get()).data()?.finalRank, 1);
});

test('existing result not overwritten; conflict detected', async () => {
  await seedEntry(closedSeasonKey, 'uid_x', 50);
  const ok = await finalizeSeason(adminFirestore, closedSeasonKey, {
    nowMs: closedNowMs,
    forceEnabled: true,
  });
  assert.equal(ok.ok, true);

  await seasonCloseMetaRef(adminFirestore, closedSeasonKey).set(
    { status: 'closing', closedAt: null, processedCount: 0, closeCursor: null },
    { merge: true },
  );
  await seedEntry(closedSeasonKey, 'uid_x', 999);
  const conflict = await finalizeSeason(adminFirestore, closedSeasonKey, {
    nowMs: closedNowMs,
    forceEnabled: true,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, 'integrity-conflict');
  const kept = await seasonCloseResultRef(adminFirestore, closedSeasonKey, 'uid_x').get();
  assert.equal(kept.data()?.finalScore, 50);
});

test('partial close resumes with pageSize 1', async () => {
  await seedEntry(closedSeasonKey, 'uid_1', 300);
  await seedEntry(closedSeasonKey, 'uid_2', 200);
  await seedEntry(closedSeasonKey, 'uid_3', 100);

  const partial = await finalizeSeason(adminFirestore, closedSeasonKey, {
    nowMs: closedNowMs,
    forceEnabled: true,
    pageSize: 1,
    maxDurationMs: 1,
  });
  assert.equal(partial.ok, true);
  // With maxDurationMs=1 may be timeout-partial or success if fast enough.
  if (partial.reason === 'timeout-partial') {
    assert.equal(partial.status, 'closing');
    assert.ok((partial.processedCount ?? 0) < 3);
    const resumed = await finalizeSeason(adminFirestore, closedSeasonKey, {
      nowMs: closedNowMs,
      forceEnabled: true,
      pageSize: 1,
    });
    assert.equal(resumed.ok, true);
    assert.ok(resumed.reason === 'success' || resumed.reason === 'already-closed');
    assert.equal(resumed.status, 'closed');
    assert.equal(resumed.processedCount, 3);
  } else {
    assert.equal(partial.status, 'closed');
    assert.equal(partial.processedCount, 3);
  }
});

test('getSeasonResult uses auth uid and ensures finalize', async () => {
  await seedEntry(closedSeasonKey, 'player_1', 77);
  const result = await getSeasonResultForUid(adminFirestore, 'player_1', closedSeasonKey, {
    nowMs: closedNowMs,
    forceEnabled: true,
    ensure: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'success');
  assert.equal(result.result?.uid, 'player_1');
  assert.equal(result.result?.finalScore, 77);
  assert.equal(result.result?.finalRank, 1);

  const other = await getSeasonResultForUid(adminFirestore, 'other', closedSeasonKey, {
    nowMs: closedNowMs,
    forceEnabled: true,
    ensure: false,
  });
  assert.equal(other.ok, true);
  assert.equal(other.reason, 'not-participated');
  assert.equal(other.result, null);

  const active = await getSeasonResultForUid(
    adminFirestore,
    'player_1',
    getLeaderboardSeasonKey(closedNowMs),
    { nowMs: closedNowMs, forceEnabled: true },
  );
  assert.equal(active.ok, false);
  assert.equal(active.reason, 'season-active');
});

test('clients cannot write season close docs', async () => {
  const alice = rulesEnvironment.authenticatedContext('alice');
  const db = alice.firestore();
  await rulesTesting.assertFails(
    db.doc(`seasons/${closedSeasonKey}`).set({ status: 'closed' }),
  );
  await rulesTesting.assertFails(
    db.doc(`seasons/${closedSeasonKey}/results/alice`).set({
      uid: 'alice',
      finalRank: 1,
      finalScore: 999999,
    }),
  );
  await rulesTesting.assertFails(
    db.doc(`seasons/${closedSeasonKey}`).get(),
  );
});

test('scheduler targets previous closed season key', () => {
  const monday = Date.UTC(2026, 8, 7, 0, 10, 0, 0);
  assert.equal(getLeaderboardSeasonKey(monday), '2026-W37');
  assert.equal(getPreviousLeaderboardSeasonKey(monday), '2026-W36');
  assert.equal(classifySeasonCloseTiming('2026-W36', monday), 'ended');
});

test('refuses empty close when only other scoreVersion entries exist', async () => {
  await adminFirestore.doc(`leaderboards/${closedSeasonKey}/entries/legacy`).set({
    uid: 'legacy',
    username: 'legacy',
    companyName: 'Legacy',
    companyScore: 999,
    level: 1,
    reputation: 50,
    completedContracts: 0,
    seasonKey: closedSeasonKey,
    scoreVersion: LEADERBOARD_SCORE_VERSION - 1,
    updatedAt: Timestamp.now(),
  });
  const result = await finalizeSeason(adminFirestore, closedSeasonKey, {
    nowMs: closedNowMs,
    forceEnabled: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'integrity-conflict');
  const meta = await seasonCloseMetaRef(adminFirestore, closedSeasonKey).get();
  assert.equal(meta.exists, false);
});
