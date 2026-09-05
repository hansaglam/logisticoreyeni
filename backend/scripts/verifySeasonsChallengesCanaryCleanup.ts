import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'logisticore-53ab4';
const UID_PREFIX = 'challenge-canary-';
const CONFIRM_CLEANUP = process.argv.includes('--confirm-production-cleanup');

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
  if (!refreshToken) throw new Error('FIREBASE_CLI_CREDENTIAL_UNAVAILABLE');
  const directory = mkdtempSync(resolve(tmpdir(), 'logisticore-canary-audit-adc-'));
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

function hasCanaryUid(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(UID_PREFIX);
}

async function listCanaryAuthUsers() {
  const users = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    users.push(...page.users.filter((user) => user.uid.startsWith(UID_PREFIX)));
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function countCollectionGroup(
  collectionId: string,
  fields: string[],
): Promise<number> {
  const snapshot = await getFirestore().collectionGroup(collectionId).get();
  return snapshot.docs.filter((document) => {
    const data = document.data();
    return fields.some((field) => hasCanaryUid(data[field]));
  }).length;
}

async function main(): Promise<void> {
  prepareFirebaseCliAdcIfNeeded();
  getApps()[0] ?? initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const firestore = getFirestore();
  const canaryAuthUsers = await listCanaryAuthUsers();
  if (CONFIRM_CLEANUP) {
    for (const user of canaryAuthUsers) await getAuth().deleteUser(user.uid);
  }
  const remainingAuthUsers = await listCanaryAuthUsers();
  const [
    authUsers,
    userRoots,
    marketplaceStates,
    serverStates,
    challengeClaims,
    seasonProgress,
    marketplaceHistory,
  ] = await Promise.all([
    Promise.resolve(remainingAuthUsers.length),
    firestore
      .collection('users')
      .where('challengeCanary', '==', true)
      .get()
      .then((snapshot) => snapshot.size),
    countCollectionGroup('marketplaceState', ['ownerUid']),
    countCollectionGroup('serverState', ['ownerUid']),
    countCollectionGroup('challengeClaims', ['ownerUid']),
    countCollectionGroup('seasonProgress', ['ownerUid']),
    countCollectionGroup('marketplaceHistory', ['buyerUid', 'sellerUid']),
  ]);
  const result = {
    authUsers,
    userRoots,
    marketplaceStates,
    serverStates,
    challengeClaims,
    seasonProgress,
    marketplaceHistory,
  };
  const orphanCount = Object.values(result).reduce((sum, value) => sum + value, 0);
  console.info('[seasons-challenges-canary-cleanup-audit]', {
    ...result,
    deletedAuthUsers: CONFIRM_CLEANUP ? canaryAuthUsers.length : 0,
    orphanCount,
  });
  if (orphanCount !== 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[seasons-challenges-canary-cleanup-audit]', {
    result: 'failed',
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
