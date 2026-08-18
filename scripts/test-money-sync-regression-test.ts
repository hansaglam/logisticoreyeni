/**
 * Regression checks for TEST-ONLY Firestore money sync helpers.
 * Run: npx tsx scripts/test-money-sync-regression-test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseRemoteTestMoney, resolveCashAfterMarketplaceReconcile } from '../src/config/testMoneySyncPure';
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

assert.equal(
  resolveCashAfterMarketplaceReconcile({
    localCash: 500_000,
    authoritativeCash: 54_623,
    acceptedTestRemoteMoney: 500_000,
    testMoneySyncEnabled: true,
  }),
  500_000,
  'injected cash must not snap back to stale canonicalCash',
);
assert.equal(
  resolveCashAfterMarketplaceReconcile({
    localCash: 400_000,
    authoritativeCash: 400_000,
    acceptedTestRemoteMoney: 500_000,
    testMoneySyncEnabled: true,
  }),
  400_000,
  'real marketplace spend still uses authoritative cash',
);
assert.equal(
  resolveCashAfterMarketplaceReconcile({
    localCash: 500_000,
    authoritativeCash: 54_623,
    acceptedTestRemoteMoney: 500_000,
    testMoneySyncEnabled: false,
  }),
  54_623,
  'production builds keep authoritative cash',
);

const appConfig = readFileSync(resolve(ROOT, 'app.config.js'), 'utf8');
assert.match(
  appConfig,
  /enableTestMoneySync:\s*process\.env\.EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC/,
  'internal extra must bake test money sync flag',
);
const moneySync = readFileSync(resolve(ROOT, 'src/services/testMoneySyncService.ts'), 'utf8');
assert.match(moneySync, /reconcileAuthoritativeFleet\(\{\s*force:\s*true\s*\}\)/);
assert.match(moneySync, /syncLocalSaveToCloud\('manual'/);

console.log('test-money-sync-regression-test: PASS');
