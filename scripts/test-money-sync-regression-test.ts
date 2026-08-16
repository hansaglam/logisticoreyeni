/**
 * Regression checks for TEST-ONLY Firestore money sync helpers.
 * Run: npx tsx scripts/test-money-sync-regression-test.ts
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { parseRemoteTestMoney } from '../src/config/testMoneySyncPure';
import { validateStoreProductionEnv } from '../src/config/storeProductionPolicy';
import { loadBuildProfileEnv } from './build-env';

const ROOT = resolve(import.meta.dirname, '..');

assert.equal(parseRemoteTestMoney(1_000_000), 1_000_000);
assert.equal(parseRemoteTestMoney(0), 0);
assert.equal(parseRemoteTestMoney(16188.420000000002), 16188.420000000002);
assert.equal(parseRemoteTestMoney(-1), null);
assert.equal(parseRemoteTestMoney(Number.NaN), null);
assert.equal(parseRemoteTestMoney(Number.POSITIVE_INFINITY), null);
assert.equal(parseRemoteTestMoney('1000'), null);
assert.equal(parseRemoteTestMoney(undefined), null);
assert.equal(parseRemoteTestMoney(null), null);

const productionEnv = loadBuildProfileEnv(ROOT, 'production');
assert.equal(
  validateStoreProductionEnv({ env: productionEnv }).length,
  0,
  'production profile must keep test money sync off',
);
assert.ok(
  validateStoreProductionEnv({
    env: { ...productionEnv, EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC: 'true' },
  }).some((error) => error.includes('EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC')),
  'production must reject ENABLE_TEST_MONEY_SYNC=true',
);

const internalEnv = loadBuildProfileEnv(ROOT, 'internal');
assert.equal(
  internalEnv.EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC,
  'true',
  'internal profile enables test money sync',
);

console.log('test-money-sync-regression-test: PASS');
