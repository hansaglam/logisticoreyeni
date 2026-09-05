import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyCanonicalMarketAlert,
  buildCanonicalPurchaseAlert,
  buildCanonicalSaleAlert,
  normalizeNotificationPreferences,
  rememberAnalyticsReceipt,
  shouldEmitCanonicalMarketOsNotification,
} from '../src/domain/v11Notifications';
import {
  createDefaultProgressionFoundationState,
  markInboxRead,
  normalizeProgressionFoundationState,
} from '../src/domain/progressionFoundation';
import {
  setV11AnalyticsProvider,
  dispatchV11Analytics,
  trackV11Analytics,
  validateV11AnalyticsParameters,
} from '../src/services/analytics';
import { validateInternalProfileEnv, validateStoreProductionEnv } from '../src/config/storeProductionPolicy';

let passed = 0;
function check(condition: unknown, label: string): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function main(): Promise<void> {
  console.log('\n=== V1.1 Phase 4 Market Alerts / Notifications / Analytics ===');
  const now = 1_800_000_000_000;
  const base = createDefaultProgressionFoundationState();

  const purchase = buildCanonicalPurchaseAlert('txn-1', now);
  check(purchase?.dedupeKey === 'market-purchase:txn-1', 'canonical purchase identity used');
  const purchaseApplied = applyCanonicalMarketAlert(base, purchase, now);
  check(purchaseApplied.applied, 'canonical purchase alert applied');
  check(purchaseApplied.state.inbox[0]?.type === 'marketplace_alert', 'purchase mirrored to existing inbox');
  check(purchaseApplied.state.inbox[0]?.relatedRoute === 'marketplace', 'marketplace route retained');
  check(purchaseApplied.state.inbox.filter((item) => !item.readAt).length === 1, 'unread count increments once');

  const duplicate = applyCanonicalMarketAlert(purchaseApplied.state, purchase, now + 1);
  check(!duplicate.applied && duplicate.state.inbox.length === 1, 'duplicate reconciliation suppressed');
  const restarted = normalizeProgressionFoundationState(JSON.parse(JSON.stringify(duplicate.state)), now + 2);
  check(!applyCanonicalMarketAlert(restarted, purchase, now + 2).applied, 'restart preserves dedupe receipt');
  const restored = normalizeProgressionFoundationState(JSON.parse(JSON.stringify(restarted)), now + 3);
  check(!applyCanonicalMarketAlert(restored, purchase, now + 3).applied, 'cloud restore preserves dedupe receipt');

  const sale = buildCanonicalSaleAlert('sold-truck-1', now + 4);
  const saleApplied = applyCanonicalMarketAlert(restored, sale, now + 4);
  check(saleApplied.applied && saleApplied.state.inbox.length === 2, 'canonical sale alert applied once');
  check(saleApplied.state.marketActivityReceiptIds?.length === 2, 'market receipts are persisted');
  check(buildCanonicalPurchaseAlert('  ', now) === null, 'unsupported empty identity rejected');
  const expired = purchase ? { ...purchase, id: 'expired', dedupeKey: 'expired', expiresAt: now - 1 } : null;
  check(!applyCanonicalMarketAlert(base, expired, now).applied, 'expired alert rejected');

  const accountA = saleApplied.state;
  const accountB = createDefaultProgressionFoundationState();
  check(accountA.marketActivityReceiptIds?.length === 2 && accountB.marketActivityReceiptIds?.length === 0, 'account save states remain isolated');
  const read = markInboxRead(accountA, purchaseApplied.state.inbox[0].id, now + 5);
  check(Boolean(read.inbox.find((item) => item.id === purchaseApplied.state.inbox[0].id)?.readAt), 'inbox item can be marked read');

  check(shouldEmitCanonicalMarketOsNotification({ foreground: false, permission: 'granted', preferenceEnabled: true, receiptApplied: true }), 'background granted notification allowed');
  check(!shouldEmitCanonicalMarketOsNotification({ foreground: true, permission: 'granted', preferenceEnabled: true, receiptApplied: true }), 'foreground prefers inbox');
  check(!shouldEmitCanonicalMarketOsNotification({ foreground: false, permission: 'denied', preferenceEnabled: true, receiptApplied: true }), 'denied permission does not emit');
  check(!shouldEmitCanonicalMarketOsNotification({ foreground: false, permission: 'undetermined', preferenceEnabled: true, receiptApplied: true }), 'undetermined permission does not emit');
  check(!shouldEmitCanonicalMarketOsNotification({ foreground: false, permission: 'granted', preferenceEnabled: false, receiptApplied: true }), 'disabled preference does not emit');
  check(!shouldEmitCanonicalMarketOsNotification({ foreground: false, permission: 'granted', preferenceEnabled: true, receiptApplied: false }), 'duplicate receipt does not emit');

  const defaults = normalizeNotificationPreferences(undefined);
  check(Object.values(defaults).every((value) => value === false), 'old saves receive conservative notification defaults');
  const receipts = Array.from({ length: 300 }, (_, index) => `receipt-${index}`);
  const bounded = normalizeProgressionFoundationState({ ...base, marketActivityReceiptIds: receipts }, now);
  check(bounded.marketActivityReceiptIds?.length === 250, 'market receipt storage is bounded');

  check(validateV11AnalyticsParameters({ source: 'canonical_response', result: 'success' }), 'bounded analytics parameters accepted');
  check(!validateV11AnalyticsParameters({ email: 'player@example.com' }), 'email parameter rejected');
  check(!validateV11AnalyticsParameters({ uid: 'secret' }), 'UID parameter rejected');
  check(!validateV11AnalyticsParameters({ cash: 1000 }), 'exact cash parameter rejected');
  check(!validateV11AnalyticsParameters({ source: 'x'.repeat(49) }), 'unbounded string parameter rejected');
  const firstAnalytics = rememberAnalyticsReceipt(base, 'analytics:purchase:1');
  const secondAnalytics = rememberAnalyticsReceipt(firstAnalytics.state, 'analytics:purchase:1');
  check(firstAnalytics.applied && !secondAnalytics.applied, 'transactional analytics receipt is idempotent');

  const failingProvider = { track: async () => { throw new Error('provider-down'); } };
  setV11AnalyticsProvider(failingProvider);
  check(!await dispatchV11Analytics(failingProvider, 'session_start', { source: 'guest' }), 'analytics provider failure does not block gameplay');
  await trackV11Analytics('session_start', { source: 'guest' });
  setV11AnalyticsProvider(null);

  const storeSource = readFileSync('src/store/gameStore.ts', 'utf8');
  const notificationSource = readFileSync('src/services/notifications.ts', 'utf8');
  const packageSource = readFileSync('package.json', 'utf8');
  check(storeSource.includes('buildCanonicalPurchaseAlert(input.transactionId'), 'purchase alert wired after canonical result');
  check(storeSource.includes('result.cache.soldTruckIds'), 'sale alert wired to canonical tombstones');
  check(!notificationSource.includes('getExpoPushTokenAsync'), 'no remote push token registration');
  check(!packageSource.includes('@react-native-firebase/analytics'), 'no parallel analytics SDK added');

  const internalEnv = Object.fromEntries(
    readFileSync('.env.internal', 'utf8').split(/\r?\n/).filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
  );
  const productionEnv = Object.fromEntries(
    readFileSync('.env.production', 'utf8').split(/\r?\n/).filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
  );
  check(validateInternalProfileEnv(internalEnv).length === 0, 'internal Phase 1-4 flags accepted');
  check(validateStoreProductionEnv({ env: productionEnv }).length === 0, 'production Phase 4 flags remain disabled');
  check(validateStoreProductionEnv({ env: { ...productionEnv, EXPO_PUBLIC_ENABLE_MARKET_ALERTS: 'true' } }).some((item) => item.includes('MARKET_ALERTS')), 'production validator rejects market alerts');

  console.log(`\n${passed} PASS / 0 FAIL`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
