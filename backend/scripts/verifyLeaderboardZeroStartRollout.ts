/**
 * One-shot post-rollout verification for leaderboard v3 + W34 integrity.
 * READ-ONLY.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

import { LEADERBOARD_SCORE_VERSION } from '../src/leaderboardScore';
import { getLeaderboardSeasonKey } from '../src/leaderboardSeason';

const PROJECT_ID = 'logisticore-53ab4';

function prepareAdc(): void {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cliAuth = require('firebase-tools/lib/auth') as {
    getGlobalDefaultAccount: () => { tokens?: { refresh_token?: string } } | undefined;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cliApi = require('firebase-tools/lib/api') as {
    clientId: () => string;
    clientSecret: () => string;
  };
  const refreshToken = cliAuth.getGlobalDefaultAccount()?.tokens?.refresh_token;
  if (!refreshToken) throw new Error('ADC missing');
  const directory = mkdtempSync(resolve(tmpdir(), 'lc-postverify-'));
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
    { mode: 0o600 },
  );
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
}

async function listAll(path: string) {
  const db = getFirestore();
  const out: Array<{ id: string; data: Record<string, unknown> }> = [];
  let q = db.collection(path).orderBy(FieldPath.documentId()).limit(200);
  for (;;) {
    const page = await q.get();
    if (page.empty) break;
    for (const d of page.docs) out.push({ id: d.id, data: d.data() as Record<string, unknown> });
    if (page.docs.length < 200) break;
    q = db
      .collection(path)
      .orderBy(FieldPath.documentId())
      .startAfter(page.docs[page.docs.length - 1]!)
      .limit(200);
  }
  return out;
}

async function main(): Promise<void> {
  prepareAdc();
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }
  const db = getFirestore();
  const seasonKey = getLeaderboardSeasonKey();
  const entries = await listAll(`leaderboards/${seasonKey}/entries`);
  const ranked = entries
    .map((e) => ({
      uidPrefix: (typeof e.data.uid === 'string' ? e.data.uid : e.id).slice(0, 6),
      score: Math.max(0, Math.floor(Number(e.data.companyScore) || 0)),
      scoreVersion: Number(e.data.scoreVersion) || 0,
      uid: typeof e.data.uid === 'string' ? e.data.uid : e.id,
    }))
    .sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0,
    );

  let orderOk = true;
  for (let i = 1; i < ranked.length; i += 1) {
    if (ranked[i - 1]!.score < ranked[i]!.score) orderOk = false;
    if (ranked[i - 1]!.score === ranked[i]!.score && ranked[i - 1]!.uid > ranked[i]!.uid) {
      orderOk = false;
    }
  }

  const zeroRows = ranked.filter((r) => r.score === 0);
  const progressed = ranked.find((r) => r.score > 0);
  let progressedMatch: Record<string, unknown> | null = null;
  if (progressed) {
    const ss = await db.doc(`users/${progressed.uid}/serverState/current`).get();
    progressedMatch = {
      uidPrefix: progressed.uidPrefix,
      boardScore: progressed.score,
      serverStateLeaderboardScore: ss.exists ? Number(ss.data()?.leaderboardScore) : null,
      boardVersion: progressed.scoreVersion,
      match: ss.exists
        ? Number(ss.data()?.leaderboardScore) === progressed.score
        : false,
    };
  }

  const zeroUid = zeroRows[0]?.uid;
  let freshCheck: Record<string, unknown> | null = null;
  if (zeroUid) {
    const ss = await db.doc(`users/${zeroUid}/serverState/current`).get();
    freshCheck = {
      uidPrefix: zeroUid.slice(0, 6),
      boardScore: 0,
      boardVersion: zeroRows[0]?.scoreVersion,
      completedDeliveries: ss.exists ? Number(ss.data()?.completedDeliveries) : null,
      companyLevel: ss.exists ? Number(ss.data()?.companyLevel) : null,
      cash: ss.exists ? Number(ss.data()?.cash) : null,
      serverLeaderboardScore: ss.exists ? Number(ss.data()?.leaderboardScore) : null,
    };
  }

  const w34Meta = await db.doc('seasons/2026-W34').get();
  const w34Results = await listAll('seasons/2026-W34/results');
  const w34Sorted = w34Results
    .map((r) => ({
      uid: typeof r.data.uid === 'string' ? r.data.uid : r.id,
      finalRank: Number(r.data.finalRank),
      finalScore: Number(r.data.finalScore),
      scoreVersion: Number(r.data.scoreVersion),
    }))
    .sort((a, b) => a.finalRank - b.finalRank);
  const fingerprintFromResults = createHash('sha256')
    .update(w34Sorted.map((r) => `${r.uid}:${r.finalRank}:${r.finalScore}`).join('|'))
    .digest('hex')
    .slice(0, 16);

  const w34Entries = await listAll('leaderboards/2026-W34/entries');
  const w34SourceV2 = w34Entries
    .filter((e) => Number(e.data.scoreVersion) === 2)
    .map((e) => ({
      uid: typeof e.data.uid === 'string' ? e.data.uid : e.id,
      companyScore: Math.max(0, Math.floor(Number(e.data.companyScore) || 0)),
    }))
    .sort((a, b) =>
      b.companyScore !== a.companyScore
        ? b.companyScore - a.companyScore
        : a.uid < b.uid
          ? -1
          : a.uid > b.uid
            ? 1
            : 0,
    )
    .map((row, i) => ({ uid: row.uid, finalRank: i + 1, finalScore: row.companyScore }));
  const fingerprintFromV2Source = createHash('sha256')
    .update(w34SourceV2.map((r) => `${r.uid}:${r.finalRank}:${r.finalScore}`).join('|'))
    .digest('hex')
    .slice(0, 16);

  const activeMeta = await db.doc(`seasons/${seasonKey}`).get();

  console.log(
    JSON.stringify(
      {
        LEADERBOARD_SCORE_VERSION,
        seasonKey,
        activeMetaExists: activeMeta.exists,
        entryCount: ranked.length,
        versions: [...new Set(ranked.map((r) => r.scoreVersion))],
        orderOk,
        negatives: ranked.filter((r) => r.score < 0).length,
        top: ranked.slice(0, 3).map((r, i) => ({
          rank: i + 1,
          uidPrefix: r.uidPrefix,
          score: r.score,
          v: r.scoreVersion,
        })),
        bottom: ranked.slice(-3).map((r, i) => ({
          fromEnd: 3 - i,
          uidPrefix: r.uidPrefix,
          score: r.score,
          v: r.scoreVersion,
        })),
        zeroScoreCount: zeroRows.length,
        freshCheck,
        progressedMatch,
        w34: {
          metaExists: w34Meta.exists,
          status: w34Meta.data()?.status ?? null,
          metaScoreVersion: w34Meta.data()?.scoreVersion ?? null,
          resultCount: w34Results.length,
          resultScoreVersions: [...new Set(w34Sorted.map((r) => r.scoreVersion))],
          fingerprintFromResults,
          fingerprintFromV2Source,
          expected: 'ea2310b854f11eb4',
          resultsMatchExpected: fingerprintFromResults === 'ea2310b854f11eb4',
          v2SourceMatchExpected: fingerprintFromV2Source === 'ea2310b854f11eb4',
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
