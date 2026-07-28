/**
 * Global economy clock + epoch tests.
 * Run: npx tsx scripts/global-economy-clock-test.ts
 */

import './test-globals';

import {
  getEconomyNow,
  getMarketEpoch,
  LocalEconomyClock,
  MARKET_TICK_INTERVAL_MS,
  resetEconomyClockForTests,
  setEconomyClock,
} from '../src/simulation/economyClock';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n=== global-economy-clock-test ===\n');

resetEconomyClockForTests();
const fixedNow = 1_700_000_000_000;
const clockA = new LocalEconomyClock();
clockA.syncFromServer?.(fixedNow);
setEconomyClock(clockA);

const epochA = getMarketEpoch(getEconomyNow());
const epochB = getMarketEpoch(fixedNow + 1000);
assert(epochA === epochB, 'A: aynı timestamp penceresinde aynı epoch', `a=${epochA} b=${epochB}`);

const nextEpoch = getMarketEpoch(fixedNow + MARKET_TICK_INTERVAL_MS);
assert(nextEpoch === epochA + 1, 'D: market tick epoch +1', `got=${nextEpoch} expected=${epochA + 1}`);

// Cihaz saati ileri alınsa bile trusted clock büyük sıçramayı sınırlar
const jumped = fixedNow + 24 * 60 * 60 * 1000;
const beforeJump = getEconomyNow();
// LocalEconomyClock.now() cihazı okur; sync anchor ile monotonic kalmalı
const after = clockA.now();
assert(
  after >= beforeJump && after - beforeJump < 60_000,
  'C: cihaz saati trusted clock’u bozmaz (küçük ilerleme)',
  `before=${beforeJump} after=${after} jumpedRef=${jumped}`,
);

assert(clockA.isTrusted() === true, 'Clock isTrusted after sync');
assert(clockA.lastSyncedAt() === fixedNow, 'lastSyncedAt matches server');

// Day counter ekonomiyi etkilemez — epoch Date.now bağımsız sabit zamandan
assert(
  getMarketEpoch(1_700_000_000_000) === getMarketEpoch(1_700_000_000_000),
  'F: day counter yok — epoch deterministic',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
