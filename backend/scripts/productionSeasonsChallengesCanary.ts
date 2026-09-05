import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { buildDefaultServerState } from '../src/serverState';
import { getDailyPeriod, getSeasonDefinition, getWeeklyPeriod } from '../src/seasonPeriods';
import type { MarketplacePlayerState } from '../src/vehicleMarketplaceTypes';

const CONFIRMED = process.argv.includes('--confirm-production');
const PROJECT_ID = 'logisticore-53ab4';
const REGION = 'us-central1';
const FUNCTIONS_SERVICE_ACCOUNT =
  '363783837598-compute@developer.gserviceaccount.com';

interface TestIdentity {
  uid: string;
  idToken: string;
}

interface ActionResult {
  ok: boolean;
  reason?: string;
  [key: string]: unknown;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function uidHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

function prepareFirebaseCliAdcIfNeeded(): void {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  const cliAuth = require('firebase-tools/lib/auth') as {
    getGlobalDefaultAccount: () =>
      | { tokens?: { refresh_token?: string } }
      | undefined;
  };
  const cliApi = require('firebase-tools/lib/api') as {
    clientId: () => string;
    clientSecret: () => string;
  };
  const refreshToken = cliAuth.getGlobalDefaultAccount()?.tokens?.refresh_token;
  if (!refreshToken) return;
  const directory = mkdtempSync(resolve(tmpdir(), 'logisticore-challenge-canary-adc-'));
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

function readFirebaseApiKey(): string {
  const direct = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  if (direct) return direct;
  const envPath = resolve(__dirname, '..', '..', '.env');
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => value.startsWith('EXPO_PUBLIC_FIREBASE_API_KEY='));
  const value = line?.slice(line.indexOf('=') + 1).trim();
  if (!value) throw new Error('FIREBASE_API_KEY_NOT_CONFIGURED');
  return value.replace(/^[\'\"]|[\'\"]$/g, '');
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function createCanaryCustomToken(uid: string): Promise<string> {
  const cliAuth = require('firebase-tools/lib/auth') as {
    getGlobalDefaultAccount: () =>
      | { tokens?: { refresh_token?: string } }
      | undefined;
    getAccessToken: (
      refreshToken?: string,
      scopes?: string[],
    ) => Promise<{ access_token?: string }>;
  };
  const scopes = require('firebase-tools/lib/scopes') as { CLOUD_PLATFORM: string };
  const refreshToken = cliAuth.getGlobalDefaultAccount()?.tokens?.refresh_token;
  const access = await cliAuth.getAccessToken(refreshToken, [scopes.CLOUD_PLATFORM]);
  if (!access.access_token) throw new Error('CANARY_OAUTH_TOKEN_UNAVAILABLE');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(
    JSON.stringify({
      iss: FUNCTIONS_SERVICE_ACCOUNT,
      sub: FUNCTIONS_SERVICE_ACCOUNT,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      uid,
      claims: { logisticoreChallengeCanary: true },
    }),
  )}`;
  const response = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(FUNCTIONS_SERVICE_ACCOUNT)}:signBlob`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ payload: Buffer.from(unsigned).toString('base64') }),
    },
  );
  const body = (await response.json()) as {
    signedBlob?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.signedBlob) {
    throw new Error(`CANARY_SIGN_BLOB_FAILED:${body.error?.message ?? response.status}`);
  }
  return `${unsigned}.${base64Url(Buffer.from(body.signedBlob, 'base64'))}`;
}

async function createTestIdentity(apiKey: string, label: string, suffix: string): Promise<TestIdentity> {
  const requestedUid = `challenge-canary-${label}-${suffix}`.slice(0, 120);
  let customToken: string;
  try {
    customToken = await createCanaryCustomToken(requestedUid);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!reason.startsWith('CANARY_SIGN_BLOB_FAILED:')) throw error;
    return createPasswordTestIdentity(apiKey, label, suffix);
  }
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as {
    idToken?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.idToken) {
    throw new Error(`AUTH_TEST_ACCOUNT_CREATE_FAILED:${body.error?.message ?? response.status}`);
  }
  return { uid: requestedUid, idToken: body.idToken };
}

async function createPasswordTestIdentity(
  apiKey: string,
  label: string,
  suffix: string,
): Promise<TestIdentity> {
  const email = `challenge-canary-${label}-${suffix}@example.invalid`;
  const password = `Lc!${randomBytes(18).toString('base64url')}`;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as {
    localId?: string;
    idToken?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.localId || !body.idToken) {
    throw new Error(
      `AUTH_PASSWORD_TEST_ACCOUNT_CREATE_FAILED:${body.error?.message ?? response.status}`,
    );
  }
  return { uid: body.localId, idToken: body.idToken };
}

async function callable<T>(
  functionName: string,
  identity: TestIdentity,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${functionName}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${identity.idToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ data }),
    },
  );
  const body = (await response.json()) as {
    result?: T;
    error?: { message?: string; status?: string };
  };
  if (!response.ok || body.result == null) {
    throw new Error(
      `CALLABLE_FAILED:${functionName}:${body.error?.status ?? response.status}:${body.error?.message ?? ''}`,
    );
  }
  return body.result;
}

async function clientPatch(identity: TestIdentity, path: string): Promise<Response> {
  return fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${identity.idToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ fields: { fabricated: { booleanValue: true } } }),
    },
  );
}

async function deleteKnownUserTree(uid: string): Promise<void> {
  const firestore = getFirestore();
  for (const collectionName of [
    'marketplaceHistory',
    'marketplaceState',
    'serverState',
    'challengeClaims',
    'seasonProgress',
  ]) {
    const snapshot = await firestore.collection(`users/${uid}/${collectionName}`).get();
    if (!snapshot.empty) {
      const batch = firestore.batch();
      for (const document of snapshot.docs) batch.delete(document.ref);
      await batch.commit();
    }
  }
  await firestore.doc(`users/${uid}`).delete().catch(() => undefined);
  await getAuth().deleteUser(uid);
}

async function verifyIdentityCleanup(uid: string): Promise<void> {
  const firestore = getFirestore();
  const [user, marketplaceState, serverState, history, claims, seasonProgress] =
    await Promise.all([
      firestore.doc(`users/${uid}`).get(),
      firestore.doc(`users/${uid}/marketplaceState/current`).get(),
      firestore.doc(`users/${uid}/serverState/current`).get(),
      firestore.collection(`users/${uid}/marketplaceHistory`).get(),
      firestore.collection(`users/${uid}/challengeClaims`).get(),
      firestore.collection(`users/${uid}/seasonProgress`).get(),
    ]);
  assert(!user.exists, 'CANARY_USER_ROOT_NOT_CLEANED');
  assert(!marketplaceState.exists, 'CANARY_MARKETPLACE_STATE_NOT_CLEANED');
  assert(!serverState.exists, 'CANARY_SERVER_STATE_NOT_CLEANED');
  assert(history.empty, 'CANARY_MARKETPLACE_HISTORY_NOT_CLEANED');
  assert(claims.empty, 'CANARY_CHALLENGE_CLAIMS_NOT_CLEANED');
  assert(seasonProgress.empty, 'CANARY_SEASON_PROGRESS_NOT_CLEANED');
  try {
    await getAuth().getUser(uid);
    throw new Error('CANARY_AUTH_USER_NOT_CLEANED');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'auth/user-not-found') throw error;
  }
}

async function main(): Promise<void> {
  if (!CONFIRMED) throw new Error('PRODUCTION_CONFIRMATION_REQUIRED');
  const startedAt = Date.now();
  prepareFirebaseCliAdcIfNeeded();
  const apiKey = readFirebaseApiKey();
  const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const firestore = getFirestore(app);
  const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const identities: TestIdentity[] = [];
  let completionSummary: Record<string, unknown> | undefined;

  try {
    const [account, attacker] = await Promise.all([
      createTestIdentity(apiKey, 'account', suffix),
      createTestIdentity(apiKey, 'attacker', suffix),
    ]);
    identities.push(account, attacker);
    const nowMs = Date.now();
    const now = Timestamp.fromMillis(nowMs);
    const initialCash = 100_000;
    const marketplaceState: MarketplacePlayerState = {
      ownerUid: account.uid,
      canonicalCash: initialCash,
      fleetLimit: 20,
      ownedTruckSnapshots: [],
      activeListingIds: [],
      soldTruckTombstones: [],
      stateVersion: 1,
      sourceSaveVersion: 7,
      migratedAt: now,
      updatedAt: now,
    };
    const serverState = buildDefaultServerState(account.uid, now);
    serverState.cash = initialCash;

    await Promise.all([
      firestore.doc(`users/${account.uid}`).set({ challengeCanary: true }),
      firestore.doc(`users/${attacker.uid}`).set({ challengeCanary: true }),
      firestore.doc(`users/${account.uid}/marketplaceState/current`).create(marketplaceState),
      firestore.doc(`users/${account.uid}/serverState/current`).create(serverState),
      firestore.doc(`users/${account.uid}/marketplaceHistory/purchase-${suffix}`).create({
        buyerUid: account.uid,
        sellerUid: 'challenge-canary-seller',
        createdAt: now,
        transactionId: `purchase-${suffix}`,
        type: 'purchase',
      }),
      firestore.doc(`users/${account.uid}/marketplaceHistory/sale-1-${suffix}`).create({
        buyerUid: 'challenge-canary-buyer-1',
        sellerUid: account.uid,
        createdAt: now,
        transactionId: `sale-1-${suffix}`,
        type: 'sale',
      }),
      firestore.doc(`users/${account.uid}/marketplaceHistory/sale-2-${suffix}`).create({
        buyerUid: 'challenge-canary-buyer-2',
        sellerUid: account.uid,
        createdAt: now,
        transactionId: `sale-2-${suffix}`,
        type: 'sale',
      }),
    ]);

    const currentSeason = await callable<{
      ok: boolean;
      season: { key: string; startsAt: number; endsAt: number; status: string };
    }>('getCurrentSeason', account, {});
    const expectedSeason = getSeasonDefinition(nowMs);
    assert(currentSeason.ok, 'CURRENT_SEASON_FAILED');
    assert(currentSeason.season.key === expectedSeason.key, 'SEASON_KEY_MISMATCH');
    assert(currentSeason.season.startsAt === expectedSeason.startsAt, 'SEASON_START_MISMATCH');
    assert(currentSeason.season.endsAt === expectedSeason.endsAt, 'SEASON_END_MISMATCH');

    const progress = await callable<{
      ok: boolean;
      challenges: Array<{
        definition: { id: string; cadence: string; enabled: boolean };
        progress: { current: number; completed: boolean; claimed: boolean; periodKey: string };
      }>;
    }>('getChallengeProgress', account, {});
    assert(progress.ok, 'CHALLENGE_PROGRESS_FAILED');
    const byId = new Map(progress.challenges.map((item) => [item.definition.id, item]));
    assert(!byId.has('daily_delivery_foundation_deferred'), 'DISABLED_CHALLENGE_EXPOSED');
    assert(byId.get('daily_marketplace_purchase')?.progress.current === 1, 'DAILY_PURCHASE_PROGRESS_MISMATCH');
    assert(byId.get('daily_marketplace_sale')?.progress.current === 1, 'DAILY_SALE_PROGRESS_MISMATCH');
    assert(byId.get('weekly_marketplace_purchases')?.progress.current === 1, 'WEEKLY_PURCHASE_PROGRESS_MISMATCH');
    assert(byId.get('weekly_marketplace_sales')?.progress.current === 2, 'WEEKLY_SALE_PROGRESS_MISMATCH');

    const daily = getDailyPeriod(nowMs);
    const transactionId = `challenge-claim-${suffix}`;
    const idempotencyKey = `challenge-claim-key-${suffix}`;
    const claimPayload = {
      challengeId: 'daily_marketplace_purchase',
      periodKey: daily.key,
      transactionId,
      idempotencyKey,
    };
    const firstClaim = await callable<ActionResult>('claimChallengeReward', account, claimPayload);
    assert(firstClaim.ok, `FIRST_CLAIM_FAILED:${firstClaim.reason ?? 'unknown'}`);
    const sameKeyReplay = await callable<ActionResult>('claimChallengeReward', account, claimPayload);
    assert(sameKeyReplay.ok, `SAME_KEY_REPLAY_FAILED:${sameKeyReplay.reason ?? 'unknown'}`);
    assert(JSON.stringify(sameKeyReplay) === JSON.stringify(firstClaim), 'SAME_KEY_REPLAY_RESULT_MISMATCH');
    const secondKey = await callable<ActionResult>('claimChallengeReward', account, {
      ...claimPayload,
      transactionId: `challenge-claim-second-${suffix}`,
      idempotencyKey: `challenge-claim-second-key-${suffix}`,
    });
    assert(!secondKey.ok && secondKey.reason === 'already-claimed', 'SECOND_KEY_NOT_REJECTED');

    const stale = await callable<ActionResult>('claimChallengeReward', account, {
      ...claimPayload,
      challengeId: 'daily_marketplace_sale',
      periodKey: getDailyPeriod(nowMs - 86_400_000).key,
      transactionId: `challenge-stale-${suffix}`,
      idempotencyKey: `challenge-stale-key-${suffix}`,
    });
    assert(!stale.ok && stale.reason === 'period-closed', 'STALE_PERIOD_NOT_REJECTED');
    const future = await callable<ActionResult>('claimChallengeReward', account, {
      ...claimPayload,
      challengeId: 'weekly_marketplace_sales',
      periodKey: getWeeklyPeriod(nowMs + 7 * 86_400_000).key,
      transactionId: `challenge-future-${suffix}`,
      idempotencyKey: `challenge-future-key-${suffix}`,
    });
    assert(!future.ok && future.reason === 'period-closed', 'FUTURE_PERIOD_NOT_REJECTED');
    const invalid = await callable<ActionResult>('claimChallengeReward', account, {
      ...claimPayload,
      challengeId: 'not-a-real-challenge',
      transactionId: `challenge-invalid-${suffix}`,
      idempotencyKey: `challenge-invalid-key-${suffix}`,
    });
    assert(!invalid.ok && invalid.reason === 'invalid-challenge-id', 'INVALID_CHALLENGE_NOT_REJECTED');
    const disabled = await callable<ActionResult>('claimChallengeReward', account, {
      ...claimPayload,
      challengeId: 'daily_delivery_foundation_deferred',
      transactionId: `challenge-disabled-${suffix}`,
      idempotencyKey: `challenge-disabled-key-${suffix}`,
    });
    assert(!disabled.ok && disabled.reason === 'challenge-disabled', 'DISABLED_CHALLENGE_NOT_REJECTED');

    for (const forbidden of [
      { progress: 999 },
      { reward: { cash: 999_999, seasonPoints: 999_999 } },
      { uid: attacker.uid },
    ]) {
      const malicious = await callable<ActionResult>('claimChallengeReward', account, {
        ...claimPayload,
        transactionId: `challenge-malicious-${Object.keys(forbidden)[0]}-${suffix}`,
        idempotencyKey: `challenge-malicious-${Object.keys(forbidden)[0]}-key-${suffix}`,
        ...forbidden,
      });
      assert(!malicious.ok && malicious.reason === 'invalid-request', 'MALICIOUS_FIELD_NOT_REJECTED');
    }
    const attackerClaim = await callable<ActionResult>('claimChallengeReward', attacker, {
      ...claimPayload,
      transactionId: `challenge-attacker-${suffix}`,
      idempotencyKey: `challenge-attacker-key-${suffix}`,
    });
    assert(!attackerClaim.ok, 'ANOTHER_USER_CLAIM_SUCCEEDED');

    const claimId = `${daily.key}:daily_marketplace_purchase`;
    const [marketplaceAfter, serverAfter, seasonAfter, claimAfter] = await Promise.all([
      firestore.doc(`users/${account.uid}/marketplaceState/current`).get(),
      firestore.doc(`users/${account.uid}/serverState/current`).get(),
      firestore.doc(`users/${account.uid}/seasonProgress/${expectedSeason.key}`).get(),
      firestore.doc(`users/${account.uid}/challengeClaims/${claimId}`).get(),
    ]);
    const cashAfter = marketplaceAfter.data()?.canonicalCash;
    assert(cashAfter === initialCash + 500, 'MARKETPLACE_CASH_RECONCILIATION_FAILED');
    assert(serverAfter.data()?.cash === cashAfter, 'SERVER_CASH_MIRROR_MISMATCH');
    assert(seasonAfter.data()?.points === 10, 'SEASON_POINTS_RECONCILIATION_FAILED');
    assert(claimAfter.exists && claimAfter.data()?.ownerUid === account.uid, 'CLAIM_DOCUMENT_MISSING');

    const [directClaim, directSeason, foreignClaim] = await Promise.all([
      clientPatch(account, `users/${account.uid}/challengeClaims/direct-${suffix}`),
      clientPatch(account, `users/${account.uid}/seasonProgress/direct-${suffix}`),
      clientPatch(attacker, `users/${account.uid}/challengeClaims/foreign-${suffix}`),
    ]);
    assert(directClaim.status === 403, 'DIRECT_CLAIM_WRITE_NOT_DENIED');
    assert(directSeason.status === 403, 'DIRECT_SEASON_WRITE_NOT_DENIED');
    assert(foreignClaim.status === 403, 'FOREIGN_CLAIM_WRITE_NOT_DENIED');

    completionSummary = {
      result: 'complete',
      accountUidHash: uidHash(account.uid),
      attackerUidHash: uidHash(attacker.uid),
      seasonKey: expectedSeason.key,
      dailyPeriodKey: daily.key,
      challengeCount: progress.challenges.length,
      firstClaim: firstClaim.ok,
      sameKeyReplay: sameKeyReplay.ok,
      secondKeyReason: secondKey.reason,
      cashBefore: initialCash,
      cashAfter,
      seasonPointsAfter: seasonAfter.data()?.points,
      directWritesDenied: true,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    for (const identity of identities) await deleteKnownUserTree(identity.uid);
    for (const identity of identities) await verifyIdentityCleanup(identity.uid);
  }
  assert(completionSummary, 'CANARY_COMPLETION_SUMMARY_MISSING');
  console.info('[seasons-challenges-production-canary]', {
    ...completionSummary,
    cleanupVerified: true,
  });
}

main().catch((error) => {
  console.error('[seasons-challenges-production-canary]', {
    result: 'failed',
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
