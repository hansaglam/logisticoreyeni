/**
 * Phase 7 Step 3.6 — READ-ONLY canonical snapshot vs source leaderboard verification.
 *
 * Usage:
 *   npx tsx backend/scripts/verifySeasonCloseSnapshot.ts --seasonKey=2026-W35
 *   npx tsx backend/scripts/verifySeasonCloseSnapshot.ts --seasonKey=2026-W35 --uid=<TEST_UID>
 *
 * NEVER writes. NEVER finalizes.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { LEADERBOARD_SCORE_VERSION } from '../src/leaderboardScore';
import {
  getLeaderboardSeasonKey,
  isValidLeaderboardSeasonKey,
} from '../src/leaderboardSeason';
import { SEASON_CLOSE_SNAPSHOT_VERSION } from '../src/seasonCloseTypes';

const ROOT = resolve(__dirname, '..', '..');
const PROJECT_ID = (
  JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf8')) as {
    projects?: { default?: string };
  }
).projects?.default;

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

function uidHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

function prepareFirebaseCliAdcIfNeeded(): void {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cliAuth = require('firebase-tools/lib/auth') as {
    getGlobalDefaultAccount: () =>
      | { tokens?: { refresh_token?: string } }
      | undefined;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cliApi = require('firebase-tools/lib/api') as {
    clientId: () => string;
    clientSecret: () => string;
  };
  const refreshToken = cliAuth.getGlobalDefaultAccount()?.tokens?.refresh_token;
  if (!refreshToken) return;
  const directory = mkdtempSync(resolve(tmpdir(), 'logisticore-season-close-verify-adc-'));
  const credentialPath = resolve(directory, 'authorized-user.json');
  writeFileSync(
    credentialPath,
    JSON.stringify({
      type: 'authorized_user',
      client_id: cliApi.clientId(),
      client_secret: cliApi.clientSecret(),
      refresh_token: refreshToken,
      quota_project_id: PROJECT_ID,
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
}

async function listAllDocs(collectionPath: string) {
  const firestore = getFirestore();
  const out: Array<{ id: string; data: Record<string, unknown> }> = [];
  let query = firestore.collection(collectionPath).orderBy('__name__').limit(200);
  for (;;) {
    const page = await query.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      out.push({ id: doc.id, data: doc.data() as Record<string, unknown> });
    }
    if (page.docs.length < 200) break;
    const last = page.docs[page.docs.length - 1]!;
    query = firestore
      .collection(collectionPath)
      .orderBy('__name__')
      .startAfter(last)
      .limit(200);
  }
  return out;
}

async function main(): Promise<void> {
  if (PROJECT_ID !== 'logisticore-53ab4') {
    throw new Error(`UNEXPECTED_FIREBASE_PROJECT:${PROJECT_ID}`);
  }
  const seasonKey = argValue('seasonKey');
  const testUid = argValue('uid');
  if (!seasonKey || !isValidLeaderboardSeasonKey(seasonKey)) {
    throw new Error('REQUIRED: --seasonKey=YYYY-Www');
  }
  const nowMs = Date.now();
  const active = getLeaderboardSeasonKey(nowMs);
  if (seasonKey === active) {
    throw new Error(`ABORT: seasonKey is active season (${active})`);
  }

  prepareFirebaseCliAdcIfNeeded();
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }
  const firestore = getFirestore();

  const metaSnap = await firestore.doc(`seasons/${seasonKey}`).get();
  const meta = metaSnap.exists ? (metaSnap.data() as Record<string, unknown>) : null;
  const sourceEntries = await listAllDocs(`leaderboards/${seasonKey}/entries`);
  const rankedSource = sourceEntries
    .filter((entry) => Number(entry.data.scoreVersion) === LEADERBOARD_SCORE_VERSION)
    .map((entry) => ({
      uid: typeof entry.data.uid === 'string' ? entry.data.uid : entry.id,
      companyScore: Math.max(0, Math.floor(Number(entry.data.companyScore) || 0)),
    }))
    .sort((left, right) => {
      if (right.companyScore !== left.companyScore) {
        return right.companyScore - left.companyScore;
      }
      return left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0;
    });

  const expected = rankedSource.map((row, index) => ({
    uid: row.uid,
    finalRank: index + 1,
    finalScore: row.companyScore,
  }));

  const results = meta ? await listAllDocs(`seasons/${seasonKey}/results`) : [];
  const actualByUid = new Map(
    results.map((doc) => {
      const uid = typeof doc.data.uid === 'string' ? doc.data.uid : doc.id;
      return [
        uid,
        {
          uid,
          finalRank: Number(doc.data.finalRank),
          finalScore: Number(doc.data.finalScore),
          participantCount: Number(doc.data.participantCount),
          snapshotVersion: Number(doc.data.snapshotVersion),
          rewardTier: doc.data.rewardTier ?? null,
          rewardAmount: doc.data.rewardAmount ?? null,
          rewardStatus: doc.data.rewardStatus ?? null,
        },
      ] as const;
    }),
  );

  const missing: string[] = [];
  const extra: string[] = [];
  const mismatches: Array<Record<string, unknown>> = [];
  for (const row of expected) {
    const actual = actualByUid.get(row.uid);
    if (!actual) {
      missing.push(uidHash(row.uid));
      continue;
    }
    if (
      actual.finalRank !== row.finalRank ||
      actual.finalScore !== row.finalScore ||
      actual.participantCount !== expected.length ||
      actual.snapshotVersion !== SEASON_CLOSE_SNAPSHOT_VERSION
    ) {
      mismatches.push({
        uidHash: uidHash(row.uid),
        expected: row,
        actual,
      });
    }
    if (
      actual.rewardTier != null ||
      actual.rewardAmount != null ||
      actual.rewardStatus != null
    ) {
      mismatches.push({
        uidHash: uidHash(row.uid),
        reason: 'reward-fields-not-null',
        actual,
      });
    }
  }
  for (const uid of actualByUid.keys()) {
    if (!expected.some((row) => row.uid === uid)) extra.push(uidHash(uid));
  }

  const fingerprint = createHash('sha256')
    .update(
      expected.map((row) => `${row.uid}:${row.finalRank}:${row.finalScore}`).join('|'),
    )
    .digest('hex')
    .slice(0, 16);

  const testResultSnap = testUid
    ? await firestore.doc(`seasons/${seasonKey}/results/${testUid}`).get()
    : null;
  const testResult = testResultSnap?.exists
    ? (testResultSnap.data() as Record<string, unknown>)
    : null;

  const ok =
    Boolean(meta) &&
    meta?.status === 'closed' &&
    results.length === expected.length &&
    missing.length === 0 &&
    extra.length === 0 &&
    mismatches.length === 0;

  console.log(
    JSON.stringify(
      {
        readOnly: true,
        projectId: PROJECT_ID,
        seasonKey,
        activeSeasonKey: active,
        meta: meta
          ? {
              status: meta.status,
              participantCount: meta.participantCount,
              processedCount: meta.processedCount,
              snapshotVersion: meta.snapshotVersion,
              scoreVersion: meta.scoreVersion,
              closedAt: meta.closedAt ?? null,
              rewardsEnabled: meta.rewardsEnabled ?? null,
            }
          : null,
        expectedParticipantCount: expected.length,
        actualResultCount: results.length,
        fingerprint,
        missingCount: missing.length,
        extraCount: extra.length,
        mismatchCount: mismatches.length,
        missingSample: missing.slice(0, 10),
        extraSample: extra.slice(0, 10),
        mismatchSample: mismatches.slice(0, 10),
        testUid: testUid
          ? {
              uidHash: uidHash(testUid),
              result: testResult
                ? {
                    finalRank: testResult.finalRank,
                    finalScore: testResult.finalScore,
                    participantCount: testResult.participantCount,
                  }
                : null,
            }
          : undefined,
        ok,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(
    '[season-close-snapshot-verify] failed',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
