/**
 * Dashboard metric responsive grid regression tests.
 * Run: npx tsx scripts/dashboard-metric-responsive-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  METRIC_ROW_GAP,
  resolveAvailableHeroContentWidth,
  resolveMetricGridLayout,
  resolveMetricRowLayout,
} from '../src/domain/dashboardMetricGridLayout';

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

console.log('\n=== Dashboard Metric Responsive Regression ===\n');

console.log('Width math — always single row');
{
  const width360 = resolveAvailableHeroContentWidth(360);
  const width390 = resolveAvailableHeroContentWidth(390);
  const width430 = resolveAvailableHeroContentWidth(430);

  assert(width360 > 0 && width360 < width390, 'content width grows with screen');
  assert(width390 < width430, '390 < 430 content width');

  for (const width of [360, 390, 430, 480]) {
    const layout = resolveMetricRowLayout(width);
    const cell = (layout.availableMetricsWidth - METRIC_ROW_GAP * 3) / 4;
    assert(layout.cellWidth === cell, `${width}px has four equal cells`);
    assert(layout.cellWidth > 0, `${width}px cell width positive`);
  }

  const legacy = resolveMetricGridLayout(360, 1.3);
  assert(!legacy.useTwoColumnMetrics, 'grid resolver no longer uses 2×2');
}

console.log('\nSource guards');
{
  const hero = readFileSync('src/components/dashboard/DashboardHeroCard.tsx', 'utf8');
  assert(hero.includes('metricRow'), 'hero uses single metric row');
  assert(hero.includes('metricCell'), 'hero uses equal flex cells');
  assert(hero.includes('metricTarget'), 'reputation target isolated from row flex');
  assert(hero.includes('layoutMode="preserve"'), 'reputation target uses preserve');
  assert(!hero.includes('metricCellTwoColumn'), '2-column cell style removed');
  assert(!hero.includes('metricGrid'), '2×2 metric grid removed');
  assert(hero.includes('reputationMetricWithBadge'), 'badge reserves top padding');
  assert(hero.includes('label="Araçlar"'), 'fleet label is Araçlar');
  assert(hero.includes('boşta ·'), 'fleet secondary line present');
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
