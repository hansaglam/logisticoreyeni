/**
 * Canonical local reward claims — in-memory tests (Step 29W).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { claimCanonicalLocalRewardTransaction } from '../src/canonicalLocalReward';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import {
  CANONICAL_LOCAL_REWARD_POLICY_VERSION,
  hasOnlyCanonicalLocalRewardKeys,
  isCanonicalLocalRewardAllowed,
  missionCanonicalStatus,
  rewardAuditHasUnknown,
} from '../../src/domain/canonicalLocalRewardClaim';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false };
    },
    collection(path: string) {
      return { path, _col: true };
    },
    async runTransaction<T>(
      operation: (transaction: {
        get: (ref: { path: string; _col?: boolean }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
          docs: Array<{ data: () => Record<string, unknown> | undefined }>;
        }>;
        create: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) {
      return operation({
        async get(ref) {
          if (ref._col) {
            const prefix = `${ref.path.replace(/\/$/, '')}/`;
            const docs = [...dump.entries()]
              .filter(([key]) => {
                if (!key.startsWith(prefix)) return false;
                const rest = key.slice(prefix.length);
                return rest.length > 0 && !rest.includes('/');
              })
              .map(([, data]) => ({ data: () => data }));
            return { exists: docs.length > 0, data: () => undefined, docs };
          }
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data, docs: [] };
        },
        create(ref, data) {
          if (dump.has(ref.path)) throw new Error('already-exists');
          dump.set(ref.path, { ...data });
        },
        update(ref, data) {
          const current = dump.get(ref.path);
          if (!current) throw new Error('missing');
          dump.set(ref.path, { ...current, ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

const GATE = { envValue: 'INTERNAL_TEST' as const };
const NOW = 1_700_000_000_000;

function seed(db: ReturnType<typeof createMemoryFirestore>, uid: string, cash: number, trucks: number) {
  db.dump.set(serverStateCurrentRef(uid), { cash, ownerUid: uid, sourceVersion: 1 });
  db.dump.set(`users/${uid}`, { money: 22_000 });
  for (let i = 0; i < trucks; i += 1) {
    db.dump.set(`users/${uid}/canonicalFleetAssets/truck-${i}`, {
      assetType: 'TRUCK',
      ownershipType: 'owned',
      lifecycleStatus: 'ACTIVE',
    });
  }
}

test('gate, keys, audit, mission classes', () => {
  assert.equal(isCanonicalLocalRewardAllowed({ envValue: null }), false);
  assert.equal(isCanonicalLocalRewardAllowed(GATE), true);
  assert.equal(rewardAuditHasUnknown(), false);
  assert.equal(
    hasOnlyCanonicalLocalRewardKeys({
      rewardId: 'own_2_trucks',
      canonicalSchemaVersion: 1,
      completed: true,
      rewardAmount: 9,
    }),
    false,
  );
  assert.equal(missionCanonicalStatus('own_2_trucks'), 'MISSION_INTERNAL_CANONICAL_STATE_ONLY');
  assert.equal(missionCanonicalStatus('first_delivery'), 'MISSION_CLIENT_PROGRESS_UNVERIFIED');
  assert.equal(missionCanonicalStatus('not-a-mission'), 'UNKNOWN_REWARD');
});

test('eligible claim, retry, ineligible, negative cash, conflict', async () => {
  const poor = createMemoryFirestore();
  seed(poor, 'uid-a', 50_000, 1);
  const denied = await claimCanonicalLocalRewardTransaction(poor, 'uid-a', 'own_2_trucks', NOW, GATE);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, 'REWARD_NOT_ELIGIBLE');
  assert.equal(poor.dump.get(serverStateCurrentRef('uid-a'))?.cash, 50_000);

  const db = createMemoryFirestore();
  seed(db, 'uid-a', -5000, 2);
  const claim = await claimCanonicalLocalRewardTransaction(db, 'uid-a', 'own_2_trucks', NOW, GATE);
  assert.equal(claim.ok, true);
  if (!claim.ok) return;
  assert.equal(claim.receipt.rewardAmount, 3000);
  assert.equal(claim.receipt.cashBefore, -5000);
  assert.equal(claim.receipt.cashAfter, -2000);
  assert.equal(claim.receipt.eligibilityPolicyVersion, CANONICAL_LOCAL_REWARD_POLICY_VERSION);
  const retry = await claimCanonicalLocalRewardTransaction(db, 'uid-a', 'own_2_trucks', NOW + 1, GATE);
  assert.equal(retry.ok, true);
  if (retry.ok) assert.equal(retry.alreadyApplied, true);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, -2000);
  assert.equal(db.dump.get('users/uid-a')?.money, 22_000);

  const milestone = await claimCanonicalLocalRewardTransaction(db, 'uid-a', 'ms_second_truck', NOW, GATE);
  assert.equal(milestone.ok, true);
  if (milestone.ok) assert.equal(milestone.receipt.rewardAmount, 2500);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 500);

  const unknown = await claimCanonicalLocalRewardTransaction(db, 'uid-a', 'first_delivery', NOW, GATE);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, 'UNKNOWN_REWARD');

  db.dump.set('users/uid-a/canonicalRewardClaims/reward:mission:own_2_trucks', {
    ...(db.dump.get('users/uid-a/canonicalRewardClaims/reward:mission:own_2_trucks') ?? {}),
    rewardAmount: 1,
  });
  const conflict = await claimCanonicalLocalRewardTransaction(db, 'uid-a', 'own_2_trucks', NOW, GATE);
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'CANONICAL_REWARD_CLAIM_CONFLICT');
});

test('other user fleet is not visible', async () => {
  const db = createMemoryFirestore();
  seed(db, 'uid-a', 10_000, 2);
  seed(db, 'uid-b', 10_000, 0);
  const other = await claimCanonicalLocalRewardTransaction(db, 'uid-b', 'own_2_trucks', NOW, GATE);
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.reason, 'REWARD_NOT_ELIGIBLE');
});

test('rules deny client reward writes and ads stay unwired', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.match(rules, /match \/canonicalRewardClaims\/\{claimId\}[\s\S]*?allow write: if false/);
  assert.equal(index.includes('claimAdReward'), false);
  assert.match(index, /export const claimWeeklyMissionReward/);
});
