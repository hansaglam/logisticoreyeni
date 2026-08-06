/**
 * Tutorial target layout regression tests.
 * Run: npx tsx scripts/tutorial-target-layout-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  getTargetLayoutStyle,
  type TutorialTargetLayoutMode,
} from '../src/tutorial/app/targetLayout';

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

console.log('\n=== Tutorial Target Layout Regression ===\n');

console.log('Layout mode contract');
{
  const preserve = getTargetLayoutStyle('preserve');
  assert(preserve.alignSelf === undefined, 'preserve does not set alignSelf');
  assert(preserve.width === undefined, 'preserve does not set width');
  assert(preserve.minWidth === 0, 'preserve keeps minWidth guard');

  const stretch = getTargetLayoutStyle('stretch');
  assert(stretch.alignSelf === 'stretch', 'stretch uses alignSelf stretch');
  assert(stretch.width === '100%', 'stretch uses full width');
  assert(stretch.minWidth === 0, 'stretch keeps minWidth guard');

  const flex = getTargetLayoutStyle('flex');
  assert(flex.flex === 1, 'flex mode uses flex:1');
  assert(flex.width === undefined, 'flex mode does not force width');

  const content = getTargetLayoutStyle('content');
  assert(content.alignSelf === 'flex-start', 'content uses intrinsic alignSelf');
  assert(content.width === undefined, 'content does not force width');
}

console.log('\nDefault mode');
{
  const defaultStyle = getTargetLayoutStyle();
  assert(defaultStyle.alignSelf === undefined, 'default mode is preserve');
}

console.log('\nSource guards');
{
  const appTarget = readFileSync('src/components/tutorial/AppTutorialTarget.tsx', 'utf8');
  assert(!appTarget.includes("alignSelf: 'flex-start'"), 'AppTutorialTarget has no global flex-start');
  assert(appTarget.includes('layoutMode'), 'AppTutorialTarget supports layoutMode');
  assert(appTarget.includes('getTargetLayoutStyle'), 'AppTutorialTarget uses layout contract');
  assert(appTarget.includes('collapsable={false}'), 'collapsable false preserved');

  const marketTarget = readFileSync('src/components/market/MarketTutorialTarget.tsx', 'utf8');
  assert(!marketTarget.includes("alignSelf: 'flex-start'"), 'MarketTutorialTarget has no global flex-start');
  assert(marketTarget.includes('layoutMode'), 'MarketTutorialTarget supports layoutMode');

  const screens = [
    'DashboardScreen.tsx',
    'MapScreen.tsx',
    'ContractsScreen.tsx',
    'FleetScreen.tsx',
    'WarehouseScreen.tsx',
    'FinanceScreen.tsx',
    'AccountCenterScreen.tsx',
    'LeaderboardScreen.tsx',
    'VehicleMarketplaceScreen.tsx',
  ];

  for (const screen of screens) {
    const source = readFileSync(`src/screens/${screen}`, 'utf8');
    assert(
      source.includes('layoutMode="stretch"'),
      `${screen} uses stretch layoutMode for section targets`,
    );
  }

  const fleet = readFileSync('src/screens/FleetScreen.tsx', 'utf8');
  assert(fleet.includes('targetId="truck-status" layoutMode="stretch"'), 'fleet truck card stretches');

  const warehouse = readFileSync('src/components/warehouse/OwnedWarehousesSection.tsx', 'utf8');
  assert(
    warehouse.includes('targetId="city-warehouse-link"') &&
      warehouse.includes('layoutMode="stretch"'),
    'warehouse card target stretches',
  );

  const account = readFileSync('src/screens/AccountCenterScreen.tsx', 'utf8');
  assert(
    account.includes('targetId="preferences" layoutMode="stretch"'),
    'account preferences section stretches',
  );

  const market = readFileSync('src/screens/MarketScreen.tsx', 'utf8');
  assert(market.includes('layoutMode="content"'), 'market intrinsic targets use content mode');
  assert(!market.includes('tutorialStretchTarget'), 'market stretch workaround style removed');
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
