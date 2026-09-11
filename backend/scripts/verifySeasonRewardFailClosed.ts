/**
 * Phase 7 Step 7 — READ-ONLY W34 reward baseline + optional live fail-closed callable test.
 *
 * Usage:
 *   npx tsx backend/scripts/verifySeasonRewardFailClosed.ts
 *   npx tsx backend/scripts/verifySeasonRewardFailClosed.ts --confirm-live-callables
 *
 * Never enables rewards. Never materializes. Never mutates W34 snapshot.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'logisticore-53ab4';
const REGION = 'us-central1';
const SEASON_KEY = '2026-W34';
const EXPECTED_FINGERPRINT = 'ea2310b854f11eb4';
const LIVE = process.argv.includes('--confirm-live-callables');
const CHECK_RUNTIME = process.argv.includes('--check-runtime-env');
const FUNCTIONS_SERVICE_ACCOUNT =
  '363783837598-compute@developer.gserviceaccount.com';

function uidHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
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
  const directory = mkdtempSync(resolve(tmpdir(), 'logisticore-reward-failclosed-adc-'));
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
  return value.replace(/^['"]|['"]$/g, '');
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getGoogleAccessToken(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cliAuth = require('firebase-tools/lib/auth') as {
    getGlobalDefaultAccount: () =>
      | { tokens?: { refresh_token?: string } }
      | undefined;
    getAccessToken: (
      refreshToken?: string,
      scopes?: string[],
    ) => Promise<{ access_token?: string }>;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const scopes = require('firebase-tools/lib/scopes') as { CLOUD_PLATFORM: string };
  const refreshToken = cliAuth.getGlobalDefaultAccount()?.tokens?.refresh_token;
  const access = await cliAuth.getAccessToken(refreshToken, [scopes.CLOUD_PLATFORM]);
  if (!access.access_token) throw new Error('OAUTH_TOKEN_UNAVAILABLE');
  return access.access_token;
}

async function inspectRuntimeRewardFlags(): Promise<void> {
  const accessToken = await getGoogleAccessToken();
  for (const name of [
    'getseasonrewardentitlement',
    'claimseasonreward',
    'preparevehiclemarketplaceaccountdeletion',
  ]) {
    const url = `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services/${name}`;
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json()) as {
      error?: { message?: string };
      template?: { containers?: Array<{ env?: Array<{ name?: string; value?: string }> }> };
      uri?: string;
    };
    if (!response.ok) {
      console.log(
        JSON.stringify({
          phase: 'runtime-env',
          service: name,
          ok: false,
          status: response.status,
          error: body.error?.message ?? 'unknown',
        }),
      );
      continue;
    }
    const env = body.template?.containers?.[0]?.env ?? [];
    const pick = (key: string) => env.find((row) => row.name === key)?.value ?? null;
    console.log(
      JSON.stringify({
        phase: 'runtime-env',
        service: name,
        ok: true,
        SEASON_REWARDS_ENABLED: pick('SEASON_REWARDS_ENABLED'),
        SEASON_CLOSE_SNAPSHOT_ENABLED: pick('SEASON_CLOSE_SNAPSHOT_ENABLED'),
      }),
    );
  }
}

/** Prefer operator/DEV ID token; else Google IdP exchange; else custom-token (may need signBlob). */
async function resolveFirebaseIdToken(apiKey: string): Promise<{
  idToken: string;
  source: 'env' | 'google-idp' | 'custom-token';
}> {
  const fromEnv =
    process.env.LOGISTICORE_ID_TOKEN?.trim() ||
    argValue('idToken')?.trim() ||
    '';
  if (fromEnv) {
    return { idToken: fromEnv, source: 'env' };
  }

  try {
    const googleAccess = await getGoogleAccessToken();
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postBody: `access_token=${encodeURIComponent(googleAccess)}&providerId=google.com`,
          requestUri: 'http://localhost',
          returnIdpCredential: true,
          returnSecureToken: true,
        }),
      },
    );
    const body = (await response.json()) as {
      idToken?: string;
      localId?: string;
      error?: { message?: string };
    };
    if (response.ok && body.idToken) {
      return { idToken: body.idToken, source: 'google-idp' };
    }
    console.log(
      JSON.stringify({
        phase: 'auth-fallback',
        googleIdp: body.error?.message ?? `http-${response.status}`,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        phase: 'auth-fallback',
        googleIdp: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const sampleUid = (
    await getFirestore().collection(`seasons/${SEASON_KEY}/results`).limit(1).get()
  ).docs[0]?.id;
  if (!sampleUid) throw new Error('W34_NO_RESULT_UID');
  const customToken = await createCustomToken(sampleUid);
  const idToken = await signInWithCustomToken(apiKey, customToken);
  return { idToken, source: 'custom-token' };
}

function uidFromIdToken(idToken: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { user_id?: string; sub?: string };
    return payload.user_id || payload.sub || null;
  } catch {
    return null;
  }
}

async function createCustomToken(uid: string): Promise<string> {
  const accessToken = await getGoogleAccessToken();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(
    JSON.stringify({
      iss: FUNCTIONS_SERVICE_ACCOUNT,
      sub: FUNCTIONS_SERVICE_ACCOUNT,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      uid,
      claims: { logisticoreRewardFailClosed: true },
    }),
  )}`;
  const response = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(FUNCTIONS_SERVICE_ACCOUNT)}:signBlob`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
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
    throw new Error(`SIGN_BLOB_FAILED:${body.error?.message ?? response.status}`);
  }
  return `${unsigned}.${base64Url(Buffer.from(body.signedBlob, 'base64'))}`;
}

async function signInWithCustomToken(
  apiKey: string,
  customToken: string,
): Promise<string> {
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
    throw new Error(`SIGN_IN_FAILED:${body.error?.message ?? response.status}`);
  }
  return body.idToken;
}

async function callCallable(
  functionName: string,
  idToken: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${functionName}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ data }),
    },
  );
  const body = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { message?: string; status?: string };
  };
  if (!response.ok) {
    throw new Error(
      `CALLABLE_HTTP_${response.status}:${body.error?.message ?? body.error?.status ?? 'unknown'}`,
    );
  }
  return body.result ?? {};
}

async function countCollection(path: string): Promise<number> {
  const snap = await getFirestore().collection(path).count().get();
  return snap.data().count;
}

async function readCash(uid: string): Promise<{
  canonicalCash: number | null;
  serverCash: number | null;
}> {
  const firestore = getFirestore();
  const [market, server] = await Promise.all([
    firestore.doc(`users/${uid}/marketplaceState/current`).get(),
    firestore.doc(`users/${uid}/serverState/current`).get(),
  ]);
  return {
    canonicalCash: market.exists
      ? Number((market.data() as { canonicalCash?: unknown }).canonicalCash)
      : null,
    serverCash: server.exists
      ? Number((server.data() as { cash?: unknown }).cash)
      : null,
  };
}

async function main(): Promise<void> {
  prepareFirebaseCliAdcIfNeeded();
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }
  const firestore = getFirestore();

  const metaSnap = await firestore.doc(`seasons/${SEASON_KEY}`).get();
  if (!metaSnap.exists) throw new Error('W34_META_MISSING');
  const meta = metaSnap.data() as Record<string, unknown>;
  const resultsCount = await countCollection(`seasons/${SEASON_KEY}/results`);
  const entitlementsBefore = await countCollection(
    `seasons/${SEASON_KEY}/rewardEntitlements`,
  );
  const claimsBefore = await countCollection(`seasons/${SEASON_KEY}/rewardClaims`);

  const results = await firestore.collection(`seasons/${SEASON_KEY}/results`).get();
  // Match verifySeasonCloseSnapshot fingerprint (leaderboard-derived expected rows).
  const sourceEntries = await firestore.collection(`leaderboards/${SEASON_KEY}/entries`).get();
  const rankedSource = sourceEntries.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        uid: typeof data.uid === 'string' ? data.uid : doc.id,
        companyScore: Math.max(0, Math.floor(Number(data.companyScore) || 0)),
        scoreVersion: Number(data.scoreVersion) || 0,
      };
    })
    .filter((row) => row.scoreVersion === 2)
    .sort((left, right) => {
      if (right.companyScore !== left.companyScore) {
        return right.companyScore - left.companyScore;
      }
      return left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0;
    });
  const fingerprint = createHash('sha256')
    .update(
      rankedSource
        .map((row, index) => `${row.uid}:${index + 1}:${row.companyScore}`)
        .join('|'),
    )
    .digest('hex')
    .slice(0, 16);

  const baseline = {
    seasonKey: SEASON_KEY,
    status: meta.status ?? null,
    rewardsEnabled: meta.rewardsEnabled ?? false,
    rewardCatalogVersion: meta.rewardCatalogVersion ?? null,
    resultsCount,
    entitlementsBefore,
    claimsBefore,
    fingerprint,
    expectedFingerprint: EXPECTED_FINGERPRINT,
  };
  console.log(JSON.stringify({ phase: 'baseline', ...baseline }, null, 2));

  if (meta.status !== 'closed') throw new Error('W34_NOT_CLOSED');
  if (meta.rewardsEnabled === true) throw new Error('W34_REWARDS_UNEXPECTEDLY_ENABLED');
  if (entitlementsBefore !== 0) throw new Error('W34_HAS_ENTITLEMENTS');
  if (claimsBefore !== 0) throw new Error('W34_HAS_CLAIMS');
  if (resultsCount !== 3) throw new Error(`W34_RESULT_COUNT:${resultsCount}`);
  if (fingerprint !== EXPECTED_FINGERPRINT) {
    throw new Error(`FINGERPRINT_MISMATCH:${fingerprint}`);
  }

  if (!LIVE && !CHECK_RUNTIME) {
    console.log(JSON.stringify({ phase: 'done', liveCallables: false, ok: true }, null, 2));
    return;
  }

  if (CHECK_RUNTIME) {
    await inspectRuntimeRewardFlags();
    if (!LIVE) {
      console.log(JSON.stringify({ phase: 'done', runtimeChecked: true, ok: true }, null, 2));
      return;
    }
  }

  const apiKey = readFirebaseApiKey();
  const resolved = await resolveFirebaseIdToken(apiKey);
  const idToken = resolved.idToken;
  const authUid = uidFromIdToken(idToken);
  if (!authUid) throw new Error('ID_TOKEN_UID_MISSING');
  const cashBefore = await readCash(authUid);
  console.log(
    JSON.stringify(
      {
        phase: 'cash-before',
        authSource: resolved.source,
        uidHash: uidHash(authUid),
        ...cashBefore,
      },
      null,
      2,
    ),
  );

  const getResult = await callCallable('getSeasonRewardEntitlement', idToken, {
    seasonKey: SEASON_KEY,
  });
  console.log(
    JSON.stringify(
      {
        phase: 'getSeasonRewardEntitlement',
        ok: getResult.ok ?? null,
        reason: getResult.reason ?? null,
        seasonKey: getResult.seasonKey ?? null,
        hasEntitlement: Boolean(getResult.entitlement),
      },
      null,
      2,
    ),
  );

  const idempotencyKey = `reward-failclosed-${randomBytes(8).toString('hex')}`;
  const claimResult = await callCallable('claimSeasonReward', idToken, {
    seasonKey: SEASON_KEY,
    idempotencyKey,
  });
  console.log(
    JSON.stringify(
      {
        phase: 'claimSeasonReward',
        ok: claimResult.ok ?? null,
        reason: claimResult.reason ?? null,
        cashAmount: claimResult.cashAmount ?? null,
        cashAfter: claimResult.cashAfter ?? null,
      },
      null,
      2,
    ),
  );

  const cashAfter = await readCash(authUid);
  const entitlementsAfter = await countCollection(
    `seasons/${SEASON_KEY}/rewardEntitlements`,
  );
  const claimsAfter = await countCollection(`seasons/${SEASON_KEY}/rewardClaims`);
  const metaAfter = (await firestore.doc(`seasons/${SEASON_KEY}`).get()).data() as Record<
    string,
    unknown
  >;

  const getReason = String(getResult.reason ?? '');
  const claimReason = String(claimResult.reason ?? '');
  const failClosedReasons = new Set([
    'feature-disabled',
    'rewards_disabled',
    'no_reward',
  ]);
  if (getResult.ok === true && getReason === 'eligible_unclaimed') {
    throw new Error('GET_UNEXPECTEDLY_ELIGIBLE');
  }
  if (!failClosedReasons.has(getReason) && getReason !== 'rewards_disabled') {
    // Still accept feature-disabled as primary fail-closed with flag OFF.
    if (getReason !== 'feature-disabled') {
      throw new Error(`GET_UNEXPECTED_REASON:${getReason}`);
    }
  }
  if (claimResult.ok === true) throw new Error('CLAIM_UNEXPECTED_SUCCESS');
  if (claimResult.cashAmount != null && Number(claimResult.cashAmount) > 0) {
    throw new Error('CLAIM_REPORTED_PAYOUT');
  }
  if (!failClosedReasons.has(claimReason) && claimReason !== 'feature-disabled') {
    throw new Error(`CLAIM_UNEXPECTED_REASON:${claimReason}`);
  }
  if (cashBefore.canonicalCash !== cashAfter.canonicalCash) {
    throw new Error('CANONICAL_CASH_CHANGED');
  }
  if (cashBefore.serverCash !== cashAfter.serverCash) {
    throw new Error('SERVER_CASH_CHANGED');
  }
  if (entitlementsAfter !== entitlementsBefore) throw new Error('ENTITLEMENT_COUNT_CHANGED');
  if (claimsAfter !== claimsBefore) throw new Error('CLAIM_COUNT_CHANGED');
  if (metaAfter.rewardsEnabled === true) throw new Error('W34_REWARDS_ENABLED_AFTER');

  console.log(
    JSON.stringify(
      {
        phase: 'after',
        cashAfter,
        entitlementsAfter,
        claimsAfter,
        rewardsEnabled: metaAfter.rewardsEnabled ?? false,
        ok: true,
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
