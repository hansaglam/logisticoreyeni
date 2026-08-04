/**
 * Canonical yakıt fiyatı selector regresyon testi.
 * Run: npx tsx scripts/fuel-price-quote-test.ts
 */

import assert from 'node:assert/strict';

import { buildGlobalEconomySnapshot } from '../src/simulation/globalMarketSnapshot';
import {
  isFuelPricePurchaseReady,
  resolveFuelPriceQuote,
} from '../src/simulation/fuelPriceQuote';
import { CITIES } from '../src/data/cities';

let pass = 0;
let fail = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.error(`  ✗ ${label}`);
}

console.log('\n=== Fuel Price Quote Test ===\n');

const snapshot = buildGlobalEconomySnapshot({ cities: CITIES, nowMs: Date.now() });

const live = resolveFuelPriceQuote({
  snapshot,
  trusted: true,
  syncStatus: 'online',
  development: false,
  lastSyncedAtMs: Date.now(),
});
check(live.source === 'live', 'live price success → source=live');
check(live.purchaseAllowed, 'live purchase allowed');
check(live.statusTone === 'none' && live.statusMessage == null, 'live has no error banner');
check(live.priceLabel.includes('Canlı'), 'live label');
check(isFuelPricePurchaseReady(live), 'live purchase ready');

const cached = resolveFuelPriceQuote({
  snapshot,
  trusted: true,
  syncStatus: 'offline-cache',
  development: false,
  lastSyncedAtMs: Date.now() - 60_000,
});
check(cached.source === 'cached', 'cached trusted snapshot → source=cached');
check(cached.purchaseAllowed, 'cached trusted purchase allowed');
check(cached.statusTone === 'amber', 'cached shows amber info (not red)');
check(!cached.statusMessage?.toLowerCase().includes('piyasa verilerine ulaşılamıyor'),
  'cached does not use generic market error copy');

const errorSyncCached = resolveFuelPriceQuote({
  snapshot,
  trusted: true,
  syncStatus: 'error',
  development: false,
});
check(errorSyncCached.source === 'cached', 'sync error with trusted snapshot → cached not unavailable');
check(errorSyncCached.statusTone === 'amber', 'sync error + trusted → amber not danger');

const fallbackDev = resolveFuelPriceQuote({
  snapshot,
  trusted: false,
  syncStatus: 'error',
  development: true,
});
check(fallbackDev.source === 'fallback', 'dev untrusted → fallback');
check(fallbackDev.purchaseAllowed, 'dev fallback purchase allowed');
check(fallbackDev.statusTone === 'amber', 'fallback amber warning');

const untrustedProd = resolveFuelPriceQuote({
  snapshot,
  trusted: false,
  syncStatus: 'online',
  development: false,
});
check(untrustedProd.source === 'unavailable', 'prod untrusted → unavailable');
check(!untrustedProd.purchaseAllowed, 'prod untrusted purchase blocked');
check(untrustedProd.pricePerLiter == null, 'prod untrusted hides price');
check(untrustedProd.statusTone === 'danger', 'prod untrusted danger');

const missing = resolveFuelPriceQuote({
  snapshot: null,
  trusted: false,
  syncStatus: 'error',
  development: false,
});
check(missing.source === 'unavailable', 'missing snapshot → unavailable');
check(missing.pricePerLiter == null, 'unavailable price is null');
check(!isFuelPricePurchaseReady(missing), 'unavailable not purchase ready');
check(
  missing.statusMessage?.includes('Yakıt fiyatına ulaşılamıyor') === true,
  'unavailable uses fuel-specific error copy',
);

const unsupported = resolveFuelPriceQuote({
  snapshot: { ...snapshot, configVersion: 999 },
  trusted: true,
  syncStatus: 'online',
  development: false,
});
check(unsupported.source === 'unavailable', 'unsupported config → unavailable');
check(unsupported.statusMessage?.includes('doğrulanamadı') === true, 'unsupported validation message');

const nonFinite = resolveFuelPriceQuote({
  snapshot: { ...snapshot, fuelPricePerLiter: Number.NaN },
  trusted: true,
  syncStatus: 'online',
  development: false,
});
check(
  nonFinite.pricePerLiter == null &&
    nonFinite.source === 'unavailable' &&
    nonFinite.errorCode === 'invalid-price',
  'non-finite snapshot price blocks purchase without fabricated fallback',
);

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS\n');
