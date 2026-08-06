/**
 * Market status label regression — oyuncuya görünen stok riski terminolojisi.
 * Run: npx tsx scripts/market-status-labels-test.ts
 */

import {
  formatMarketStockRiskCounter,
  getMarketStatusDescription,
  getMarketStatusLabel,
  getMarketStatusShortLabel,
} from '../src/utils/marketStatusLabels';

let failed = 0;

function check(actual: string, expected: string, label: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label} — got "${actual}", expected "${expected}"`);
  }
}

function checkNotIncludes(actual: string, forbidden: string, label: string): void {
  if (!actual.toLocaleLowerCase('tr-TR').includes(forbidden.toLocaleLowerCase('tr-TR'))) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label} — contains forbidden "${forbidden}": "${actual}"`);
  }
}

console.log('\n=== market-status-labels-test ===\n');

check(formatMarketStockRiskCounter(0), '0 stok riski', 'world status counter zero');
check(formatMarketStockRiskCounter(7), '7 stok riski', 'world status counter seven');
checkNotIncludes(formatMarketStockRiskCounter(3), 'talep', 'counter does not say talep');
checkNotIncludes(formatMarketStockRiskCounter(3), 'kıtlık', 'counter does not say kıtlık');

check(getMarketStatusLabel('Kıtlık'), 'Düşük stok', 'product card shortage label');
check(getMarketStatusLabel('Kritik Kıtlık'), 'Kritik stok', 'product card critical label');
check(getMarketStatusShortLabel('Kıtlık'), 'Düşük stok', 'city summary shortage label');
check(getMarketStatusShortLabel('Kritik Kıtlık'), 'Kritik stok', 'city summary critical label');

check(
  getMarketStatusDescription('Kritik Kıtlık'),
  'Stok seviyesi kritik düzeyde.',
  'critical description',
);
if (getMarketStatusDescription('Kıtlık').startsWith('Arz yetersiz')) {
  console.log('  ✓ shortage supply description');
} else {
  failed += 1;
  console.error('  ✗ shortage supply description');
}

for (const fn of [
  () => getMarketStatusLabel('Kıtlık'),
  () => getMarketStatusLabel('Kritik Kıtlık'),
  () => getMarketStatusShortLabel('Kıtlık'),
  () => formatMarketStockRiskCounter(2),
]) {
  const text = fn();
  checkNotIncludes(text, 'kıtlık', `no kıtlık in "${text}"`);
}

console.log(`\nResult: ${failed === 0 ? 'passed' : `${failed} failed`}\n`);
process.exit(failed > 0 ? 1 : 0);
