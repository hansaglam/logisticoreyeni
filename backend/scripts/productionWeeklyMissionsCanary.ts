/**
 * Production Weekly Missions canary (Phase 3).
 *
 * Requires:
 *   --confirm-production
 *   backend/.env.logisticore-53ab4 with WEEKLY_MISSIONS_BACKEND_ENABLED=true
 *   Firebase CLI login with deploy/read access
 *
 * Does NOT:
 *   - lower mission targets
 *   - mint cash via local paths
 *   - enable client production flags
 *   - complete real in-game deliveries (mark WAITING / manual)
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { buildDefaultServerState } from '../src/serverState';
import { selectWeeklyMissionRotation } from '../src/weeklyMissions';
import { getWeeklyMissionPeriod } from '../src/weeklyMissionWeek';
import type { MarketplacePlayerState } from '../src/vehicleMarketplaceTypes';

const CONFIRMED = process.argv.includes('--confirm-production');
const PROJECT_ID = 'logisticore-53ab4';
const REGION = 'us-central1';
const FUNCTIONS_SERVICE_ACCOUNT =
  '363783837598-compute@developer.gserviceaccount.com';

interface TestIdentity {
  uid: string;
  idToken: string;
  kind: 'linked' | 'anonymous';
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

function fingerprintRotation(data: Record<string, unknown>): string {
  const payload = {
    weekKey: data.weekKey,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    locked: data.locked,
    catalogVersion: data.catalogVersion,
    missionIds: data.missionIds,
    missions: data.missions,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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
  const directory = mkdtempSync(resolve(tmpdir(), 'logisticore-weekly-canary-adc-'));
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
  const unsignedFixed = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(
    JSON.stringify({
      iss: FUNCTIONS_SERVICE_ACCOUNT,
      sub: FUNCTIONS_SERVICE_ACCOUNT,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      uid,
      claims: { logisticoreWeeklyCanary: true },
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
      body: JSON.stringify({ payload: Buffer.from(unsignedFixed).toString('base64') }),
    },
  );
  const body = (await response.json()) as {
    signedBlob?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.signedBlob) {
    throw new Error(`CANARY_SIGN_BLOB_FAILED:${body.error?.message ?? response.status}`);
  }
  return `${unsignedFixed}.${base64Url(Buffer.from(body.signedBlob, 'base64'))}`;
}

async function createPasswordTestIdentity(
  apiKey: string,
  label: string,
  suffix: string,
): Promise<TestIdentity> {
  const email = `weekly-canary-${label}-${suffix}@example.invalid`;
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
  return { uid: body.localId, idToken: body.idToken, kind: 'linked' };
}

async function createLinkedIdentity(apiKey: string, suffix: string): Promise<TestIdentity> {
  const requestedUid = `weekly-canary-linked-${suffix}`.slice(0, 120);
  try {
    const customToken = await createCanaryCustomToken(requestedUid);
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
      throw new Error(`AUTH_CUSTOM_TOKEN_FAILED:${body.error?.message ?? response.status}`);
    }
    return { uid: requestedUid, idToken: body.idToken, kind: 'linked' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Prefer password-linked identity when IAM signBlob / CLI ADC is unavailable.
    console.warn(`[weekly-canary] custom-token path unavailable (${reason}); trying password signup`);
    return createPasswordTestIdentity(apiKey, 'linked', suffix);
  }
}

async function createAnonymousIdentity(apiKey: string): Promise<TestIdentity> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as {
    localId?: string;
    idToken?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.localId || !body.idToken) {
    throw new Error(`AUTH_ANON_FAILED:${body.error?.message ?? response.status}`);
  }
  return { uid: body.localId, idToken: body.idToken, kind: 'anonymous' };
}

async function callable<T>(
  functionName: string,
  identity: TestIdentity | null,
  data: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (identity) headers.authorization = `Bearer ${identity.idToken}`;
  const response = await fetch(
    `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${functionName}`,
    {
      method: 'POST',
      headers,
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
    'weeklyMissionClaims',
    'weeklyMissionBaselines',
    'canonicalDeliveryCompletions',
  ]) {
    const snapshot = await firestore.collection(`users/${uid}/${collectionName}`).get();
    if (!snapshot.empty) {
      const batch = firestore.batch();
      for (const document of snapshot.docs) batch.delete(document.ref);
      await batch.commit();
    }
  }
  await firestore.doc(`users/${uid}`).delete().catch(() => undefined);
  await getAuth().deleteUser(uid).catch(() => undefined);
}

async function main(): Promise<void> {
  if (!CONFIRMED) throw new Error('PRODUCTION_CONFIRMATION_REQUIRED');
  prepareFirebaseCliAdcIfNeeded();
  const apiKey = readFirebaseApiKey();
  const app =
    getApps()[0] ??
    initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const firestore = getFirestore(app);
  const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const identities: TestIdentity[] = [];
  const report: Record<string, unknown> = {
    projectId: PROJECT_ID,
    startedAt: new Date().toISOString(),
  };

  try {
    const period = getWeeklyMissionPeriod(Date.now());
    const expected = selectWeeklyMissionRotation(period.weekKey);
    assert(expected.ok, 'EXPECTED_ROTATION_SELECT_FAILED');

    let linked: TestIdentity;
    try {
      linked = await createLinkedIdentity(apiKey, suffix);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      report.linkedAccount = { ok: false, reason };
      console.log(JSON.stringify({ ok: false, stage: 'linked-auth', report }, null, 2));
      process.exitCode = 2;
      return;
    }
    identities.push(linked);
    report.linkedUidHash = uidHash(linked.uid);

    const nowMs = Date.now();
    const now = Timestamp.fromMillis(nowMs);
    const initialCash = 100_000;
    const marketplaceState: MarketplacePlayerState = {
      ownerUid: linked.uid,
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
    const serverState = buildDefaultServerState(linked.uid, now);
    serverState.cash = initialCash;
    serverState.completedDeliveries = 42;

    await Promise.all([
      firestore.doc(`users/${linked.uid}`).set({ weeklyMissionCanary: true }),
      firestore.doc(`users/${linked.uid}/marketplaceState/current`).create(marketplaceState),
      firestore.doc(`users/${linked.uid}/serverState/current`).create(serverState),
    ]);

    const get1 = await callable<ActionResult>('getWeeklyMissions', linked, {});
    assert(get1.ok === true, `GET_FAILED:${get1.reason ?? 'unknown'}`);
    assert(get1.weekKey === period.weekKey, 'WEEK_KEY_MISMATCH');
    const missions = get1.missions as Array<Record<string, unknown>>;
    assert(Array.isArray(missions) && missions.length === 3, 'MISSION_COUNT');
    const difficulties = missions.map((m) => m.difficulty).sort().join(',');
    assert(difficulties === 'easy,hard,medium', `DIFFICULTIES:${difficulties}`);
    const rewardTotal = missions.reduce(
      (sum, m) => sum + Number((m.reward as { cash?: number })?.cash ?? 0),
      0,
    );
    assert(rewardTotal === 12_500, `REWARD_TOTAL:${rewardTotal}`);
    report.rotation = {
      weekKey: get1.weekKey,
      missionIds: missions.map((m) => m.id),
      rewardTotal,
    };

    const rotationSnap = await firestore.doc(`weeklyMissionRotations/${period.weekKey}`).get();
    assert(rotationSnap.exists, 'ROTATION_DOC_MISSING');
    const rotationData = rotationSnap.data() as Record<string, unknown>;
    assert(rotationData.locked === true, 'ROTATION_NOT_LOCKED');
    const fingerprint = fingerprintRotation(rotationData);
    report.rotationFingerprint = fingerprint;
    assert(
      JSON.stringify(rotationData.missionIds) === JSON.stringify(expected.missionIds),
      'ROTATION_MISSION_IDS_DRIFT',
    );

    const baselineSnap = await firestore
      .doc(`users/${linked.uid}/weeklyMissionBaselines/${period.weekKey}`)
      .get();
    assert(baselineSnap.exists, 'BASELINE_MISSING');
    const baseline = baselineSnap.data() as { completedDeliveriesBaseline?: number };
    assert(baseline.completedDeliveriesBaseline === 42, 'BASELINE_VALUE');
    report.baseline = {
      completedDeliveriesBaseline: baseline.completedDeliveriesBaseline,
      serverCompletedDeliveries: 42,
    };

    const progressBefore = Number(
      (missions.find((m) => m.difficulty === 'easy') as { progress?: number })?.progress ?? -1,
    );
    assert(progressBefore === 0, `PROGRESS_BEFORE:${progressBefore}`);

    const deliveryId = `canary-delivery-${suffix}`;
    const recorded = await callable<ActionResult>('recordCanonicalDeliveryCompletion', linked, {
      deliveryId,
    });
    assert(recorded.ok === true, `RECORD_FAILED:${recorded.reason ?? 'unknown'}`);
    const completionSnap = await firestore
      .doc(`users/${linked.uid}/canonicalDeliveryCompletions/${deliveryId}`)
      .get();
    assert(completionSnap.exists, 'COMPLETION_DOC_MISSING');
    const serverAfter = await firestore.doc(`users/${linked.uid}/serverState/current`).get();
    assert(
      (serverAfter.data() as { completedDeliveries?: number }).completedDeliveries === 43,
      'COMPLETED_DELIVERIES_NOT_PLUS_ONE',
    );

    const recordedAgain = await callable<ActionResult>('recordCanonicalDeliveryCompletion', linked, {
      deliveryId,
    });
    assert(recordedAgain.ok === true, 'DUPLICATE_RECORD_NOT_OK');
    assert(recordedAgain.alreadyRecorded === true, 'DUPLICATE_NOT_MARKED');
    const serverDup = await firestore.doc(`users/${linked.uid}/serverState/current`).get();
    assert(
      (serverDup.data() as { completedDeliveries?: number }).completedDeliveries === 43,
      'DUPLICATE_INCREMENTED',
    );

    const get2 = await callable<ActionResult>('getWeeklyMissions', linked, {});
    assert(get2.ok === true, 'GET2_FAILED');
    const missions2 = get2.missions as Array<Record<string, unknown>>;
    const progressAfter = Number(
      (missions2.find((m) => m.difficulty === 'easy') as { progress?: number })?.progress ?? -1,
    );
    assert(progressAfter === 1, `PROGRESS_AFTER:${progressAfter}`);
    report.deliveryProgress = {
      deliveryIdStable: true,
      progressBefore,
      progressAfter,
      duplicateSafe: true,
    };

    const claimProbe = await callable<ActionResult>('claimWeeklyMissionReward', linked, {
      weekKey: period.weekKey,
      missionId: String(missions[0]!.id),
      idempotencyKey: `canary-claim-${suffix}`,
    });
    assert(claimProbe.ok === false, 'UNEXPECTED_CLAIM_SUCCESS');
    assert(claimProbe.reason === 'not-complete', `CLAIM_REASON:${claimProbe.reason}`);
    report.claimCanary = 'WAITING_FOR_NATURAL_COMPLETION';

    const guest = await createAnonymousIdentity(apiKey);
    identities.push(guest);
    const guestGet = await callable<ActionResult>('getWeeklyMissions', guest, {});
    assert(guestGet.ok === true || guestGet.reason === 'anonymous-not-supported', 'GUEST_GET');
    if (guestGet.ok) {
      const guestMissions = guestGet.missions as Array<Record<string, unknown>>;
      for (const mission of guestMissions) {
        assert(Number(mission.progress ?? 0) === 0, 'GUEST_PROGRESS_NONZERO');
        assert(mission.claimAvailable !== true, 'GUEST_CLAIMABLE');
      }
    }
    const guestClaim = await callable<ActionResult>('claimWeeklyMissionReward', guest, {
      weekKey: period.weekKey,
      missionId: String(missions[0]!.id),
      idempotencyKey: `guest-claim-${suffix}`,
    });
    assert(guestClaim.ok === false, 'GUEST_CLAIM_OK');
    assert(
      guestClaim.reason === 'anonymous-not-supported' || guestClaim.reason === 'auth-required',
      `GUEST_CLAIM_REASON:${guestClaim.reason}`,
    );
    const guestBaseline = await firestore
      .doc(`users/${guest.uid}/weeklyMissionBaselines/${period.weekKey}`)
      .get();
    assert(!guestBaseline.exists, 'GUEST_BASELINE_CREATED');
    const guestRecord = await callable<ActionResult>('recordCanonicalDeliveryCompletion', guest, {
      deliveryId: `guest-${suffix}`,
    });
    assert(guestRecord.ok === false, 'GUEST_RECORD_OK');
    report.guest = {
      getOk: guestGet.ok === true,
      claimBlocked: true,
      noBaseline: true,
      noCanonicalRecord: true,
    };

    const deniedPaths = [
      `weeklyMissionRotations/${period.weekKey}`,
      `weeklyMissionTemplates/${String(missions[0]!.id)}`,
      `users/${linked.uid}/weeklyMissionClaims/${period.weekKey}:${String(missions[0]!.id)}`,
      `users/${linked.uid}/weeklyMissionBaselines/${period.weekKey}`,
      `users/${linked.uid}/canonicalDeliveryCompletions/${deliveryId}`,
    ];
    const denyResults: Record<string, number> = {};
    for (const path of deniedPaths) {
      const response = await clientPatch(linked, path);
      denyResults[path] = response.status;
      assert(response.status === 403, `RULES_ALLOW_WRITE:${path}:${response.status}`);
    }
    report.rulesDenied = denyResults;

    const rotationSnap2 = await firestore.doc(`weeklyMissionRotations/${period.weekKey}`).get();
    const fingerprint2 = fingerprintRotation(rotationSnap2.data() as Record<string, unknown>);
    assert(fingerprint === fingerprint2, 'ROTATION_MUTATED');
    report.rotationImmutable = true;

    const unauth = await callable<ActionResult>('getWeeklyMissions', null, {}).catch(
      (error: Error) => ({ ok: false, reason: error.message }),
    );
    report.unauthenticatedProbe = unauth;

    report.ok = true;
    report.gameplayDeliveryCanary = 'PENDING_INTERNAL_BUILD_MANUAL';
    console.log(JSON.stringify({ ok: true, report }, null, 2));
  } finally {
    for (const identity of identities) {
      await deleteKnownUserTree(identity.uid);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
