/**
 * Truck lease pricing + confirmation UX regression.
 * Run: npx tsx scripts/truck-lease-presentation-regression-test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  formatLeaseOfferCost,
  formatTruckLeaseFleetSummary,
  getLeaseDurationDays,
  getLeaseDurationHours,
  resolveLeaseOfferCost,
  resolveMonthlyLeaseCost,
} from '../src/utils/truckLeasePresentation';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

console.log('\n=== truck-lease-presentation-regression-test ===\n');

assert(resolveMonthlyLeaseCost(10_000) === 35_000, 'monthly cost uses discounted multiplier');
assert(resolveLeaseOfferCost(5_500, 'weekly') === 5_500, 'weekly offer equals catalog weekly');
assert(resolveLeaseOfferCost(5_500, 'monthly') === 19_250, 'monthly offer derived from weekly');
assert(getLeaseDurationDays('weekly') === 7, 'weekly duration is 7 days');
assert(getLeaseDurationDays('monthly') === 30, 'monthly duration is 30 days');
assert(getLeaseDurationHours('monthly') === 30 * 24, 'monthly duration hours');
assert(formatLeaseOfferCost(9_000, 'weekly').includes('/hafta'), 'weekly label in offer format');
assert(formatLeaseOfferCost(9_000, 'monthly').includes('/ay'), 'monthly label in offer format');
assert(
  formatTruckLeaseFleetSummary(
    {
      leasePeriod: 'weekly',
      leaseWeeklyCost: 9_000,
      leaseExpiresAt: 200,
    },
    100,
  ).includes('9'),
  'fleet summary includes prepaid cost',
);

const shop = read('src/screens/ShopScreen.tsx');
const card = read('src/components/shop/TruckMarketCard.tsx');
const store = read('src/store/gameStore.ts');
const fleet = read('src/components/fleet/OwnedTruckCard.tsx');

assert(shop.includes('kirala'), 'shop lease confirmation dialog');
assert(shop.includes("confirmLease('weekly')"), 'weekly confirm wired');
assert(shop.includes("confirmLease('monthly')"), 'monthly confirm wired');
assert(shop.includes('Kira bedeli peşin tahsil edilir'), 'prepaid copy in dialog');
assert(card.includes('formatLeaseOfferCost'), 'market card shows lease prices');
assert(card.includes('Kirala ·'), 'lease button shows cost hint');
assert(store.includes('resolveLeaseOfferCost'), 'store uses period pricing');
assert(store.includes("period === 'monthly'"), 'store supports monthly period');
assert(fleet.includes('formatTruckLeaseFleetSummary'), 'fleet card shows cost + remaining');

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
