/**
 * Phase 7 Step 8 — READ-ONLY payout canary readiness season audit.
 * Never mutates. Never enables flags.
 *
 * Usage:
 *   npx tsx backend/scripts/inspectSeasonRewardPayoutReadiness.ts
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'logisticore-53ab4';
const TARGET_UID_HASH = 'd59ef7e84edd';
const SEASON_KEYS = [
  '2026-W33',
  '2026-W34',
  '2026-W35',
  '2026-W36',
  '2026-W37',
  '2026-W38',
  '2026-W39',
  '2026-W40',
];

function uidHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

function prepareAdc(): void {
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
  if (!refreshToken) throw new Error('NO_FIREBASE_CLI_REFRESH');
  const directory = mkdtempSync(resolve(tmpdir(), 'lc-payout-ready-'));
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

async function countCollection(path: string): Promise<number> {
  const snap = await getFirestore().collection(path).count().get();
  return snap.data().count;
}

async function main(): Promise<void> {
  prepareAdc();
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }
  const db = getFirestore();

  const seasons: Record<string, unknown>[] = [];
  for (const seasonKey of SEASON_KEYS) {
    const metaSnap = await db.doc(`seasons/${seasonKey}`).get();
    const lbMeta = await db.doc(`leaderboards/${seasonKey}`).get();
    const entryCount = await countCollection(`leaderboards/${seasonKey}/entries`);
    if (!metaSnap.exists && !lbMeta.exists && entryCount === 0) {
      seasons.push({
        seasonKey,
        exists: false,
        note: 'no season meta / leaderboard meta / entries',
      });
      continue;
    }
    const meta = (metaSnap.data() ?? {}) as Record<string, unknown>;
    const resultsCount = metaSnap.exists
      ? await countCollection(`seasons/${seasonKey}/results`)
      : 0;
    const entitlements = metaSnap.exists
      ? await countCollection(`seasons/${seasonKey}/rewardEntitlements`)
      : 0;
    const claims = metaSnap.exists
      ? await countCollection(`seasons/${seasonKey}/rewardClaims`)
      : 0;

    let linkedResult: Record<string, unknown> | null = null;
    if (metaSnap.exists && resultsCount > 0) {
      const results = await db.collection(`seasons/${seasonKey}/results`).get();
      for (const doc of results.docs) {
        const data = doc.data() as Record<string, unknown>;
        const uid = typeof data.uid === 'string' ? data.uid : doc.id;
        if (uidHash(uid) !== TARGET_UID_HASH) continue;
        linkedResult = {
          uidHash: TARGET_UID_HASH,
          finalRank: data.finalRank ?? null,
          finalScore: data.finalScore ?? data.companyScore ?? null,
          rewardTier: data.rewardTier ?? null,
          rewardAmount: data.rewardAmount ?? null,
          rewardStatus: data.rewardStatus ?? null,
        };
        break;
      }
    }

    seasons.push({
      seasonKey,
      seasonMetaExists: metaSnap.exists,
      leaderboardMetaExists: lbMeta.exists,
      leaderboardEntryCount: entryCount,
      status: meta.status ?? null,
      snapshotVersion: meta.snapshotVersion ?? null,
      scoreVersion: meta.scoreVersion ?? null,
      participantCount: meta.participantCount ?? null,
      processedCount: meta.processedCount ?? null,
      rewardsEnabled: meta.rewardsEnabled ?? false,
      rewardCatalogVersion: meta.rewardCatalogVersion ?? null,
      resultsCount,
      entitlements,
      claims,
      startsAt: meta.startsAt ?? null,
      endsAt: meta.endsAt ?? null,
      closedAt: meta.closedAt ?? null,
      linkedTestUserResult: linkedResult,
    });
  }

  // Active season hint from leaderboard current if present
  const current = await db.doc('leaderboards/current').get();
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        projectId: PROJECT_ID,
        linkedTestUidHash: TARGET_UID_HASH,
        leaderboardCurrent: current.exists ? current.data() : null,
        seasons,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
