/**
 * Tutorial coordinate-space regression tests.
 * Run: npx tsx scripts/tutorial-coordinate-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  buildMarketProductTargetId,
} from '../src/components/market/marketTutorialTargetRegistry';
import {
  getMarketTutorialSteps,
  resolveMarketTutorialStepTargetId,
} from '../src/components/market/marketTutorialSteps';
import {
  applySpotlightPadding,
  convertTargetRectToOverlaySpace,
  finalizeTutorialOverlayRect,
  isValidTutorialScreenRect,
} from '../src/tutorial/app/coordinates';

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

console.log('\n=== Tutorial Coordinate Regression ===\n');

console.log('Window → overlay conversion');
{
  const target = { x: 40, y: 320, width: 120, height: 36 };
  const origin = { x: 0, y: 0 };
  const local = convertTargetRectToOverlaySpace(target, origin);
  assert(local.x === 40 && local.y === 320, 'origin 0,0 keeps rect unchanged');

  const shifted = convertTargetRectToOverlaySpace(target, { x: 0, y: 24 });
  assert(shifted.y === 296, 'overlay origin subtracts from target y');
}

console.log('\nPadding');
{
  const rect = { x: 10, y: 20, width: 100, height: 40 };
  const padded = applySpotlightPadding(rect, 4);
  assert(padded.x === 6 && padded.y === 16, 'padding expands outward');
  assert(padded.width === 108 && padded.height === 48, 'padding increases size');
}

console.log('\nRect validation');
{
  const window = { width: 360, height: 800 };
  assert(
    isValidTutorialScreenRect({ x: 10, y: 20, width: 40, height: 30 }, window.width, window.height),
    'valid rect passes',
  );
  assert(
    !isValidTutorialScreenRect({ x: 10, y: 20, width: 0, height: 30 }, window.width, window.height),
    'zero width fails',
  );
}

console.log('\nMarket target mapping');
{
  assert(
    resolveMarketTutorialStepTargetId('stock-status', 'fruit') === 'market-product-price:fruit',
    'stock step maps to price target',
  );
  assert(
    resolveMarketTutorialStepTargetId('price-trend', 'steel') === 'market-product-chart:steel',
    'chart step maps to sparkline target',
  );
  assert(
    resolveMarketTutorialStepTargetId('buy', 'fruit') === 'market-product-buy:fruit',
    'buy step maps to CTA target',
  );
  const steps = getMarketTutorialSteps('live', 'fruit');
  assert(
    steps[1].targetId === buildMarketProductTargetId('price', 'fruit'),
    'resolved steps use snapshot product id',
  );
}

console.log('\nSource guards');
{
  const useAppTutorialSource = readFileSync('src/hooks/useAppTutorial.ts', 'utf8');
  assert(useAppTutorialSource.includes('measureTutorialTargetInOverlaySpace'), 'hook uses overlay measure');
  assert(useAppTutorialSource.includes('measureScrollViewportInWindow'), 'hook uses scroll viewport measure');
  assert(!useAppTutorialSource.includes('rect.y - screenHeight * 0.22'), 'removed window-y scroll hack');

  const targetSource = readFileSync('src/components/tutorial/AppTutorialTarget.tsx', 'utf8');
  assert(targetSource.includes('collapsable={false}'), 'AppTutorialTarget keeps collapsable false');

  const marketTargetSource = readFileSync('src/components/market/MarketTutorialTarget.tsx', 'utf8');
  assert(marketTargetSource.includes('collapsable={false}'), 'MarketTutorialTarget keeps collapsable false');
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
