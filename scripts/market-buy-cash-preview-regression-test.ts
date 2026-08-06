/**
 * Market buy popup cash preview regression.
 * Run: npx tsx scripts/market-buy-cash-preview-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { tradingBalance } from '../src/config/balance';
import {
  calculateTradeBuyCost,
  getTradeBuyCashPreview,
} from '../src/simulation/trading';

const ROOT = process.cwd();

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

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function run(): void {
  console.log('\nmarket-buy-cash-preview-regression-test\n');

  const currentCash = 23_379;
  const unitPrice = 100;
  const quantity = 50;
  const preview = getTradeBuyCashPreview({ currentCash, unitPrice, quantity });
  const expectedCost = calculateTradeBuyCost(unitPrice, quantity);

  assert(preview.currentCash === currentCash, 'currentCash comes from player money');
  assert(preview.totalCost === expectedCost, 'totalCost uses calculateTradeBuyCost (fee included)');
  assert(
    preview.totalCost !== unitPrice * quantity || tradingBalance.warehouseBuyFeeRate === 0,
    'totalCost is not a raw unit*qty bypass of fee when fee > 0',
  );
  assert(preview.remainingCash === currentCash - expectedCost, 'remainingCash = cash - totalCost');
  assert(preview.canAfford === preview.remainingCash >= 0, 'canAfford matches remainingCash >= 0');
  assert(preview.canAfford, 'affordable purchase canAfford true');

  const broke = getTradeBuyCashPreview({
    currentCash: 10,
    unitPrice: 100,
    quantity: 5,
  });
  assert(!broke.canAfford, 'insufficient cash → canAfford false');
  assert(broke.remainingCash < 0, 'insufficient cash → negative remaining');

  const bad = getTradeBuyCashPreview({
    currentCash: Number.NaN,
    unitPrice: Number.NaN,
    quantity: Number.NaN,
  });
  assert(bad.currentCash === 0, 'NaN cash falls back to 0');
  assert(bad.totalCost === 0, 'NaN price/qty falls back to 0 cost');
  assert(bad.canAfford, 'zero-cost NaN fallback is affordable');

  const modalSrc = readSrc('src/components/TradeProductModal.tsx');
  assert(modalSrc.includes('getTradeBuyCashPreview'), 'TradeProductModal uses canonical preview');
  assert(modalSrc.includes('buyCashPreview'), 'TradeProductModal binds buyCashPreview');
  assert(modalSrc.includes('Satın alma sonrası'), 'buy popup shows remaining cash label');
  assert(modalSrc.includes("name=\"cash\""), 'buy popup shows cash icon');
  assert(modalSrc.includes('cashRow'), 'buy popup has compact cash row');
  assert(
    modalSrc.indexOf('cashRow') < modalSrc.indexOf('infoCard'),
    'cash row appears before city/price info card',
  );
  assert(
    !/Platform\.OS/.test(modalSrc),
    'TradeProductModal has no Platform.OS cash UI branch',
  );
  assert(
    modalSrc.includes('mode === \'buy\' ? (') && modalSrc.includes('styles.cashRow'),
    'cash row is buy-mode only',
  );

  const tradingSrc = readSrc('src/simulation/trading.ts');
  assert(tradingSrc.includes('export function getTradeBuyCashPreview'), 'helper exported from trading');
  assert(tradingSrc.includes('export interface TradeBuyCashPreview'), 'TradeBuyCashPreview type exported');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
