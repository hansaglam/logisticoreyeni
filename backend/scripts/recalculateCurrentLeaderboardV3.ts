/**
 * Admin OPS — recalculate CURRENT active leaderboard entries to scoreVersion 3.
 *
 * READ-ONLY by default (dry-run). Writes only with --confirm-write.
 *
 * Usage:
 *   npx tsx backend/scripts/recalculateCurrentLeaderboardV3.ts
 *   npx tsx backend/scripts/recalculateCurrentLeaderboardV3.ts --confirm-write
 *   npx tsx backend/scripts/recalculateCurrentLeaderboardV3.ts --confirm-write --resumeFromUid=<uid>
 *
 * NEVER mutates closed seasons. NEVER touches seasons/{key}/results.
 * NEVER exposes as a public callable.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';

import {
  calculateLeaderboardScore,
  extractCanonicalPlayerStateFromServerState,
  LEADERBOARD_SCORE_VERSION,
  resolveWeeklySeasonActivity,
} from '../src/leaderboardScore';
import { getLeaderboardSeasonKey } from '../src/leaderboardSeason';
import {
  buildBoundedLegacyMigrationFromCloudSave,
  cloudSaveRef,
  pickLeaderboardServerStatePersistPatch,
  serverStateRef,
  validateServerState,
} from '../src/serverState';
import type { ServerStateDocument } from '../src/serverStateTypes';

const ROOT = resolve(__dirname, '..', '..');
const PROJECT_ID = (
  JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf8')) as {
    projects?: { default?: string };
  }
).projects?.default;

const USERS_PAGE_SIZE = 100;
const MAX_BATCH_WRITES = 400;

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

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
  const directory = mkdtempSync(resolve(tmpdir(), 'logisticore-lb-v3-recalc-adc-'));
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

async function listAllEntries(firestore: Firestore, seasonKey: string) {
  const out: Array<{ id: string; data: Record<string, unknown> }> = [];
  let query = firestore
    .collection(`leaderboards/${seasonKey}/entries`)
    .orderBy(FieldPath.documentId())
    .limit(200);
  for (;;) {
    const page = await query.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      out.push({ id: doc.id, data: doc.data() as Record<string, unknown> });
    }
    if (page.docs.length < 200) break;
    const last = page.docs[page.docs.length - 1]!;
    query = firestore
      .collection(`leaderboards/${seasonKey}/entries`)
      .orderBy(FieldPath.documentId())
      .startAfter(last)
      .limit(200);
  }
  return out;
}

type PlanRow = {
  uidHash: string;
  action: 'update' | 'create' | 'unchanged' | 'skip';
  reason?: string;
  oldScore: number | null;
  oldVersion: number | null;
  newScore: number;
  delta: number | null;
  completedDeliveries: number;
  zeroProgress: boolean;
};

async function resolveEligiblePlan(
  firestore: Firestore,
  seasonKey: string,
  nowMs: number,
  resumeFromUid: string | null,
): Promise<{
  plans: PlanRow[];
  scannedUsers: number;
  skippedUsers: number;
  lastUid: string | null;
}> {
  const existing = await listAllEntries(firestore, seasonKey);
  const existingByUid = new Map(existing.map((row) => [row.id, row.data]));

  const plans: PlanRow[] = [];
  let scannedUsers = 0;
  let skippedUsers = 0;
  let lastUid: string | null = resumeFromUid;
  let cursor: string | null = resumeFromUid;

  for (;;) {
    let query = firestore
      .collection('users')
      .where('usernameSetupCompleted', '==', true)
      .orderBy(FieldPath.documentId())
      .limit(USERS_PAGE_SIZE);
    if (cursor) {
      query = query.startAfter(cursor);
    }
    const usersSnap = await query.get();
    if (usersSnap.empty) break;

    for (const userDoc of usersSnap.docs) {
      lastUid = userDoc.id;
      scannedUsers += 1;
      const usernameRaw = userDoc.data()?.username;
      const username =
        typeof usernameRaw === 'string' ? usernameRaw.trim().slice(0, 20) : '';
      if (!username) {
        skippedUsers += 1;
        plans.push({
          uidHash: uidHash(userDoc.id),
          action: 'skip',
          reason: 'username-missing',
          oldScore: null,
          oldVersion: null,
          newScore: 0,
          delta: null,
          completedDeliveries: 0,
          zeroProgress: false,
        });
        continue;
      }

      const serverSnap = await serverStateRef(firestore, userDoc.id).get();
      const saveSnap = await cloudSaveRef(firestore, userDoc.id).get();
      let serverState: ServerStateDocument | null = null;
      if (serverSnap.exists) {
        serverState = serverSnap.data() as ServerStateDocument;
      } else if (saveSnap.exists) {
        serverState = buildBoundedLegacyMigrationFromCloudSave(
          userDoc.id,
          saveSnap.data() ?? {},
          Timestamp.fromMillis(nowMs),
        ).state;
      }

      if (!serverState) {
        skippedUsers += 1;
        plans.push({
          uidHash: uidHash(userDoc.id),
          action: 'skip',
          reason: 'server-state-missing',
          oldScore: null,
          oldVersion: null,
          newScore: 0,
          delta: null,
          completedDeliveries: 0,
          zeroProgress: false,
        });
        continue;
      }

      const stateReason = validateServerState(userDoc.id, serverState);
      if (stateReason) {
        skippedUsers += 1;
        plans.push({
          uidHash: uidHash(userDoc.id),
          action: 'skip',
          reason: stateReason,
          oldScore: null,
          oldVersion: null,
          newScore: 0,
          delta: null,
          completedDeliveries: 0,
          zeroProgress: false,
        });
        continue;
      }

      const seasonActivity = resolveWeeklySeasonActivity(serverState, seasonKey);
      const extracted = extractCanonicalPlayerStateFromServerState(serverState, {
        weeklyCompletedDeliveries: seasonActivity.weeklyCompletedDeliveries,
      });
      if (!extracted.ok) {
        skippedUsers += 1;
        plans.push({
          uidHash: uidHash(userDoc.id),
          action: 'skip',
          reason: extracted.reason,
          oldScore: null,
          oldVersion: null,
          newScore: 0,
          delta: null,
          completedDeliveries: 0,
          zeroProgress: false,
        });
        continue;
      }

      const breakdown = calculateLeaderboardScore(extracted.player, extracted.gameState);
      const completedDeliveries = Math.max(
        0,
        Math.floor(Number(serverState.completedDeliveries) || 0),
      );
      const zeroProgress =
        completedDeliveries === 0 &&
        Math.max(0, Math.floor(Number(serverState.companyLevel) || 1)) <= 1 &&
        breakdown.totalScore === 0;

      const prior = existingByUid.get(userDoc.id);
      const oldScore = prior
        ? Math.max(0, Math.floor(Number(prior.companyScore) || 0))
        : null;
      const oldVersion = prior
        ? Math.max(0, Math.floor(Number(prior.scoreVersion) || 0))
        : null;

      let action: PlanRow['action'] = 'create';
      if (prior) {
        if (
          oldScore === breakdown.totalScore &&
          oldVersion === LEADERBOARD_SCORE_VERSION
        ) {
          action = 'unchanged';
        } else {
          action = 'update';
        }
      }

      plans.push({
        uidHash: uidHash(userDoc.id),
        action,
        oldScore,
        oldVersion,
        newScore: breakdown.totalScore,
        delta: oldScore == null ? null : breakdown.totalScore - oldScore,
        completedDeliveries,
        zeroProgress,
        // stash uid for write path via side map
      });

      // Attach private uid for writes (not printed in summary samples by hash only)
      (plans[plans.length - 1] as PlanRow & { _uid?: string; _username?: string; _serverState?: ServerStateDocument; _entry?: Record<string, unknown>; _serverPatch?: Record<string, unknown>; _serverExists?: boolean })._uid =
        userDoc.id;
      (plans[plans.length - 1] as PlanRow & { _username?: string })._username = username;
      (plans[plans.length - 1] as PlanRow & { _serverState?: ServerStateDocument })._serverState =
        serverState;
      (plans[plans.length - 1] as PlanRow & { _serverExists?: boolean })._serverExists =
        serverSnap.exists;
      (plans[plans.length - 1] as PlanRow & { _entry?: Record<string, unknown> })._entry = {
        uid: userDoc.id,
        username,
        companyName: breakdown.companyName,
        companyScore: breakdown.totalScore,
        level: breakdown.level,
        reputation: breakdown.reputation,
        completedContracts: breakdown.completedContracts,
        weeklyCompletedDeliveries: breakdown.weeklyCompletedDeliveries,
        seasonKey,
        updatedAt: Timestamp.fromMillis(nowMs),
        sourceSaveVersion: Math.max(0, Math.floor(serverState.sourceVersion)),
        scoreVersion: LEADERBOARD_SCORE_VERSION,
      };
      (plans[plans.length - 1] as PlanRow & { _serverPatch?: Record<string, unknown> })._serverPatch =
        {
          leaderboardSeasonKey: seasonActivity.leaderboardSeasonKey,
          weeklySeasonBaselineCompleted: seasonActivity.weeklySeasonBaselineCompleted,
          leaderboardScore: breakdown.totalScore,
          updatedAt: Timestamp.fromMillis(nowMs),
        };
    }

    if (usersSnap.size < USERS_PAGE_SIZE) break;
    cursor = usersSnap.docs[usersSnap.docs.length - 1]!.id;
  }

  return { plans, scannedUsers, skippedUsers, lastUid };
}

async function applyWrites(
  firestore: Firestore,
  seasonKey: string,
  plans: Array<
    PlanRow & {
      _uid?: string;
      _serverState?: ServerStateDocument;
      _entry?: Record<string, unknown>;
      _serverPatch?: Record<string, unknown>;
      _serverExists?: boolean;
    }
  >,
): Promise<{ written: number; serverPatched: number }> {
  let batch = firestore.batch();
  let ops = 0;
  let written = 0;
  let serverPatched = 0;

  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = firestore.batch();
    ops = 0;
  };

  for (const plan of plans) {
    if (plan.action !== 'update' && plan.action !== 'create') continue;
    if (!plan._uid || !plan._entry || !plan._serverPatch || !plan._serverState) continue;

    const serverWrite = plan._serverExists
      ? {
          ...pickLeaderboardServerStatePersistPatch(plan._serverState),
          ...plan._serverPatch,
        }
      : {
          ...plan._serverState,
          ...plan._serverPatch,
        };

    batch.set(serverStateRef(firestore, plan._uid), serverWrite, { merge: true });
    ops += 1;
    serverPatched += 1;

    batch.set(
      firestore.doc(`leaderboards/${seasonKey}/entries/${plan._uid}`),
      plan._entry,
      { merge: true },
    );
    ops += 1;
    written += 1;

    if (ops >= MAX_BATCH_WRITES) {
      await flush();
    }
  }
  await flush();
  return { written, serverPatched };
}

function summarizeBoard(entries: Array<{ id: string; data: Record<string, unknown> }>) {
  const scores = entries.map((row) =>
    Math.max(0, Math.floor(Number(row.data.companyScore) || 0)),
  );
  const byVersion = new Map<number, number>();
  const uids = new Set<string>();
  let duplicateUid = 0;
  let zeroCount = 0;
  for (const row of entries) {
    const version = Number(row.data.scoreVersion);
    const key = Number.isFinite(version) ? version : -1;
    byVersion.set(key, (byVersion.get(key) ?? 0) + 1);
    const uid = typeof row.data.uid === 'string' ? row.data.uid : row.id;
    if (uids.has(uid)) duplicateUid += 1;
    uids.add(uid);
    const score = Math.max(0, Math.floor(Number(row.data.companyScore) || 0));
    if (score === 0) zeroCount += 1;
  }
  return {
    totalEntries: entries.length,
    scoreVersionCounts: Object.fromEntries(byVersion),
    minScore: scores.length ? Math.min(...scores) : null,
    maxScore: scores.length ? Math.max(...scores) : null,
    zeroScoreEntries: zeroCount,
    duplicateUidAnomalies: duplicateUid,
  };
}

async function main(): Promise<void> {
  if (PROJECT_ID !== 'logisticore-53ab4') {
    throw new Error(`UNEXPECTED_FIREBASE_PROJECT:${PROJECT_ID}`);
  }

  const confirmWrite = hasFlag('confirm-write');
  const resumeFromUid = argValue('resumeFromUid') ?? null;
  const nowMs = Date.now();
  const seasonKey = getLeaderboardSeasonKey(nowMs);

  prepareFirebaseCliAdcIfNeeded();
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }
  const firestore = getFirestore();

  const metaSnap = await firestore.doc(`seasons/${seasonKey}`).get();
  if (metaSnap.exists) {
    const status = metaSnap.data()?.status;
    throw new Error(
      `HARD_STOP: seasons/${seasonKey} meta exists (status=${String(status)}). Refusing refresh of closed/frozen season.`,
    );
  }

  const beforeEntries = await listAllEntries(firestore, seasonKey);
  const before = summarizeBoard(beforeEntries);

  const { plans, scannedUsers, skippedUsers, lastUid } = await resolveEligiblePlan(
    firestore,
    seasonKey,
    nowMs,
    resumeFromUid,
  );

  const toUpdate = plans.filter((row) => row.action === 'update');
  const toCreate = plans.filter((row) => row.action === 'create');
  const unchanged = plans.filter((row) => row.action === 'unchanged');
  const becomingZero = [...toUpdate, ...toCreate].filter((row) => row.newScore === 0);
  const newlyZeroProgressCreates = toCreate.filter((row) => row.zeroProgress);
  const deltas = toUpdate
    .filter((row) => row.delta != null)
    .map((row) => row.delta as number)
    .sort((a, b) => a - b);

  const report = {
    mode: confirmWrite ? 'CONFIRM_WRITE' : 'DRY_RUN',
    projectId: PROJECT_ID,
    scoreVersionTarget: LEADERBOARD_SCORE_VERSION,
    utcNow: new Date(nowMs).toISOString(),
    activeSeasonKey: seasonKey,
    closedMetaPresent: false,
    beforeBoard: before,
    scannedUsers,
    skippedUsers,
    eligiblePlans: plans.filter((row) => row.action !== 'skip').length,
    entriesToUpdate: toUpdate.length,
    entriesToCreate: toCreate.length,
    entriesUnchanged: unchanged.length,
    becomingScore0: becomingZero.length,
    newlyIncludedZeroProgressUsers: newlyZeroProgressCreates.length,
    deltaSample: toUpdate.slice(0, 20).map((row) => ({
      uidHash: row.uidHash,
      oldScore: row.oldScore,
      oldVersion: row.oldVersion,
      newScore: row.newScore,
      delta: row.delta,
    })),
    deltaStats:
      deltas.length > 0
        ? {
            min: deltas[0],
            max: deltas[deltas.length - 1],
            median: deltas[Math.floor(deltas.length / 2)],
          }
        : null,
    lastUidHash: lastUid ? uidHash(lastUid) : null,
  };

  console.log(JSON.stringify(report, null, 2));

  if (!confirmWrite) {
    console.log(
      '\n[recalculateCurrentLeaderboardV3] DRY-RUN complete. Re-run with --confirm-write to mutate active season only.',
    );
    return;
  }

  const writeResult = await applyWrites(
    firestore,
    seasonKey,
    plans as Array<
      PlanRow & {
        _uid?: string;
        _serverState?: ServerStateDocument;
        _entry?: Record<string, unknown>;
        _serverPatch?: Record<string, unknown>;
        _serverExists?: boolean;
      }
    >,
  );

  const afterEntries = await listAllEntries(firestore, seasonKey);
  const after = summarizeBoard(afterEntries);
  const v2Remaining = Number(after.scoreVersionCounts['2'] ?? 0);
  const v3Count = Number(after.scoreVersionCounts['3'] ?? 0);
  const otherVersions = Object.entries(after.scoreVersionCounts).filter(
    ([version]) => version !== '3',
  );

  console.log(
    JSON.stringify(
      {
        writeResult,
        afterBoard: after,
        mixedVersionsRemain: otherVersions.length > 0,
        v2Remaining,
        v3Count,
        ok: v2Remaining === 0 && v3Count === after.totalEntries && after.duplicateUidAnomalies === 0,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(
    '[recalculateCurrentLeaderboardV3] FAILED',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
