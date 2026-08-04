/**
 * Username reservation emulator tests.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import {
  checkUsernameAvailabilityTransaction,
  releaseUsernameForUid,
  setUsernameTransaction,
} from '../src/username';

const PROJECT_ID = 'logisticore-username-emulator';
delete process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

let rulesEnvironment: RulesTestEnvironment;
let rulesTesting: typeof import('@firebase/rules-unit-testing');
const adminApp = initializeApp({ projectId: PROJECT_ID }, 'username-tests');
const adminFirestore = getFirestore(adminApp);
adminFirestore.settings({ host: '127.0.0.1:8080', ssl: false });

const identity = (uid: string) => ({
  uid,
  displayName: 'Ethem Sincar',
  signInProvider: 'google.com',
});

before(async () => {
  rulesTesting = await import('@firebase/rules-unit-testing');
  rulesEnvironment = await rulesTesting.initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await rulesEnvironment.clearFirestore();
});

after(async () => {
  await rulesEnvironment.cleanup();
  await deleteApp(adminApp);
});

test('client cannot write username reservation', async () => {
  const context = rulesEnvironment.authenticatedContext('u1');
  await rulesTesting.assertFails(
    context.firestore().doc('usernames/ethemsincar').set({ uid: 'u1' }),
  );
});

test('client cannot mutate username fields on users/{uid}', async () => {
  await adminFirestore.doc('users/u1').set({ uid: 'u1', provider: 'google' });
  const context = rulesEnvironment.authenticatedContext('u1');
  await rulesTesting.assertFails(
    context.firestore().doc('users/u1').set({ username: 'hacked' }, { merge: true }),
  );
});

test('setUsername reserves uniquely and is idempotent', async () => {
  const first = await setUsernameTransaction(adminFirestore, identity('u1'), 'Ethem_01');
  assert.equal(first.ok, true);
  const second = await setUsernameTransaction(adminFirestore, identity('u1'), 'ETHEM_01');
  assert.equal(second.ok, true);
  const taken = await setUsernameTransaction(adminFirestore, identity('u2'), 'ethem_01');
  assert.equal(taken.ok, false);
  if (!taken.ok) assert.equal(taken.reason, 'username-taken');

  const reservation = await adminFirestore.doc('usernames/ethem_01').get();
  assert.equal(reservation.exists, true);
  assert.equal(reservation.data()?.uid, 'u1');

  const publicProfile = await adminFirestore.doc('publicProfiles/u1').get();
  assert.equal(publicProfile.exists, true);
  assert.equal(publicProfile.data()?.username, 'Ethem_01');
});

test('availability check reflects ownership', async () => {
  await setUsernameTransaction(adminFirestore, identity('u1'), 'alpha_user');
  const own = await checkUsernameAvailabilityTransaction(
    adminFirestore,
    identity('u1'),
    'alpha_user',
  );
  assert.equal(own.ok, true);
  if (own.ok) assert.equal(own.available, true);
  const other = await checkUsernameAvailabilityTransaction(
    adminFirestore,
    identity('u2'),
    'alpha_user',
  );
  assert.equal(other.ok, true);
  if (other.ok) {
    assert.equal(other.available, false);
    assert.equal(other.reason, 'username-taken');
  }
});

test('account deletion releases reservation', async () => {
  await setUsernameTransaction(adminFirestore, identity('u9'), 'deleteme_user');
  const released = await releaseUsernameForUid(adminFirestore, 'u9');
  assert.equal(released.usernameReleased, true);
  const reservation = await adminFirestore.doc('usernames/deleteme_user').get();
  assert.equal(reservation.exists, false);
});

test('cooldown blocks rapid username change', async () => {
  const t0 = Date.UTC(2026, 0, 1);
  const first = await setUsernameTransaction(
    adminFirestore,
    identity('u3'),
    'first_name',
    t0,
  );
  assert.equal(first.ok, true);
  const blocked = await setUsernameTransaction(
    adminFirestore,
    identity('u3'),
    'second_name',
    t0 + 1000,
  );
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, 'username-change-cooldown');
  const later = await setUsernameTransaction(
    adminFirestore,
    identity('u3'),
    'second_name',
    t0 + 31 * 24 * 60 * 60 * 1000,
  );
  assert.equal(later.ok, true);
});
