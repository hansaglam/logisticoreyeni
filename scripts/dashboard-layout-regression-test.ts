/**
 * Dashboard layout regression tests.
 * Run: npx tsx scripts/dashboard-layout-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import { getTargetLayoutStyle } from '../src/tutorial/app/targetLayout';

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

console.log('\n=== Dashboard Layout Regression ===\n');

console.log('Metric flex target contract');
{
  const flex = getTargetLayoutStyle('flex');
  assert(flex.flex === 1, 'flex mode uses flex:1');
  assert(flex.width === undefined, 'flex mode does not force width:100%');
  assert(flex.minWidth === 0, 'flex mode keeps minWidth guard');

  const stretch = getTargetLayoutStyle('stretch');
  assert(stretch.width === '100%', 'stretch mode still full width for sections');
}

console.log('\nDashboard HUD');
{
  const resourceBar = readFileSync('src/components/dashboard/DashboardResourceBar.tsx', 'utf8');
  assert(!resourceBar.includes('pause'), 'resource bar has no pause control');
  assert(resourceBar.includes('AppTutorialHelpButton'), 'help button embedded in HUD');
  assert(resourceBar.includes('helpSlot'), 'help slot has fixed container');

  const screen = readFileSync('src/screens/DashboardScreen.tsx', 'utf8');
  assert(!screen.includes('AppTutorialHelpButton'), 'no duplicate standalone help button');
  assert(!screen.includes('headerRow'), 'separate header help row removed');
  assert(screen.includes('onHelpPress'), 'HUD wires tutorial help press');
  assert(screen.includes('GAME_CENTER_BUTTON_LIFT'), 'extra bottom padding for center tab');
}

console.log('\nCompany card metrics');
{
  const hero = readFileSync('src/components/dashboard/DashboardHeroCard.tsx', 'utf8');
  assert(hero.includes('layoutMode="preserve"'), 'reputation target uses preserve inside metric cell');
  assert(!hero.includes('layoutMode="flex"'), 'reputation target does not fight grid flex');
  assert(hero.includes('metricRow'), 'hero uses single-row metrics');
  assert(hero.includes('reputationBadgeChip'), 'reputation delta uses in-card chip');
  assert(hero.includes('METRIC_ROW_GAP'), 'hero uses row gap constant');
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
