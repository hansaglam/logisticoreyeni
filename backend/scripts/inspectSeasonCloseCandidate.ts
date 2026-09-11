/**
 * Phase 7 Step 3.6 — READ-ONLY season-close canary candidate inspection.
 *
 * Usage:
 *   npx tsx backend/scripts/inspectSeasonCloseCandidate.ts
 *   npx tsx backend/scripts/inspectSeasonCloseCandidate.ts --seasonKey=2026-W35
 *   npx tsx backend/scripts/inspectSeasonCloseCandidate.ts --seasonKey=2026-W35 --uid=<TEST_UID>
 *
 * NEVER writes. NEVER finalizes. NEVER mutates Firestore.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { LEADERBOARD_SCORE_VERSION } from '../src/leaderboardScore';
import {
  getLeaderboardSeasonKey,
  getPreviousLeaderboardSeasonKey,
  isValidLeaderboardSeasonKey,
} from '../src/leaderboardSeason';
import { classifySeasonCloseTiming } from '../src/seasonClose';

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
  const directory = mkdtempSync(resolve(tmpdir(), 'logisticore-season-close-inspect-adc-'));
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

async function inspectSeason(
  seasonKey: string,
  testUid: string | undefined,
  nowMs: number,
) {
  const firestore = getFirestore();
  const activeKey = getLeaderboardSeasonKey(nowMs);
  const timing = classifySeasonCloseTiming(seasonKey, nowMs);

  const entries = await listAllDocs(`leaderboards/${seasonKey}/entries`);
  const byVersion = new Map<number, number>();
  for (const entry of entries) {
    const version = Number(entry.data.scoreVersion);
    const key = Number.isFinite(version) ? version : -1;
    byVersion.set(key, (byVersion.get(key) ?? 0) + 1);
  }
  const currentVersionCount = byVersion.get(LEADERBOARD_SCORE_VERSION) ?? 0;
  const otherVersions = [...byVersion.entries()].filter(
    ([version]) => version !== LEADERBOARD_SCORE_VERSION,
  );

  const ranked = entries
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

  const metaSnap = await firestore.doc(`seasons/${seasonKey}`).get();
  const meta = metaSnap.exists ? (metaSnap.data() as Record<string, unknown>) : null;
  let resultCount = 0;
  if (meta) {
    resultCount = (await listAllDocs(`seasons/${seasonKey}/results`)).length;
  }
  const testResult = testUid
    ? await firestore.doc(`seasons/${seasonKey}/results/${testUid}`).get()
    : null;

  const sample = ranked.slice(0, 5).map((row, index) => ({
    rank: index + 1,
    uidPrefix: row.uid.slice(0, 6),
    companyScore: row.companyScore,
  }));

  const canaryHints: string[] = [];
  if (timing !== 'ended') {
    canaryHints.push(`REJECT: timing=${timing} (need ended)`);
  }
  if (meta) {
    canaryHints.push('REJECT: canonical seasons/{seasonKey} already exists');
  }
  if (currentVersionCount === 0 && entries.length > 0) {
    canaryHints.push('REJECT: no current scoreVersion entries (mixed/legacy only)');
  }
  if (otherVersions.length > 0 && currentVersionCount > 0) {
    canaryHints.push('WARN: mixed scoreVersions present — finalize uses current version only');
  }
  if (currentVersionCount === 0 && entries.length === 0) {
    canaryHints.push('WARN: empty board — finalize would create empty closed snapshot');
  }
  if (currentVersionCount > 500) {
    canaryHints.push('WARN: large participant set — prefer smaller canary if available');
  }
  if (testUid) {
    const inRanked = ranked.some((row) => row.uid === testUid);
    if (!inRanked) canaryHints.push('WARN: test uid not in current-version ranked entries');
    else canaryHints.push('OK: test uid present in ranked source');
  }
  if (canaryHints.length === 0) {
    canaryHints.push('OK: appears eligible for controlled canary finalize');
  }

  return {
    seasonKey,
    activeSeasonKey: activeKey,
    previousSeasonKey: getPreviousLeaderboardSeasonKey(nowMs),
    timing,
    leaderboardEntryCount: entries.length,
    currentScoreVersion: LEADERBOARD_SCORE_VERSION,
    currentVersionParticipantCount: currentVersionCount,
    scoreVersionCounts: Object.fromEntries(byVersion),
    canonicalMetaExists: Boolean(meta),
    canonicalMetaStatus: meta?.status ?? null,
    canonicalResultCount: resultCount,
    testUidPresentInSource: testUid
      ? ranked.some((row) => row.uid === testUid)
      : undefined,
    testUidCanonicalResultExists: testUid ? Boolean(testResult?.exists) : undefined,
    topSample: sample,
    canaryHints,
  };
}

async function main(): Promise<void> {
  if (PROJECT_ID !== 'logisticore-53ab4') {
    throw new Error(`UNEXPECTED_FIREBASE_PROJECT:${PROJECT_ID}`);
  }
  prepareFirebaseCliAdcIfNeeded();
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }

  const nowMs = Date.now();
  const explicit = argValue('seasonKey');
  const testUid = argValue('uid');
  if (explicit && !isValidLeaderboardSeasonKey(explicit)) {
    throw new Error(`INVALID_SEASON_KEY:${explicit}`);
  }

  const active = getLeaderboardSeasonKey(nowMs);
  const previous = getPreviousLeaderboardSeasonKey(nowMs);
  const recentKeys = explicit
    ? [explicit]
    : Array.from({ length: 8 }, (_, index) =>
        getLeaderboardSeasonKey(nowMs - (index + 1) * 7 * 86_400_000),
      );

  console.log('[season-close-candidate-inspect] READ-ONLY', {
    projectId: PROJECT_ID,
    nowIso: new Date(nowMs).toISOString(),
    activeSeasonKey: active,
    previousSeasonKey: previous,
    note: 'This script never writes or finalizes.',
  });

  const reports = [];
  for (const seasonKey of recentKeys) {
    reports.push(await inspectSeason(seasonKey, testUid, nowMs));
  }
  console.log(JSON.stringify({ candidates: reports }, null, 2));
}

void main().catch((error) => {
  console.error(
    '[season-close-candidate-inspect] failed',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
