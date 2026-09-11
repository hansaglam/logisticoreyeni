/**
 * Update-loop and selector stability regression tests.
 * Run: npx tsx scripts/update-loop-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  EMPTY_ACTIVE_DELIVERIES,
  EMPTY_REPUTATION_HISTORY,
  selectActiveDeliveries,
  selectReputationHistory,
} from '../src/store/selectors/stableCollections';
import { commitLayoutReady, commitLayoutSize } from '../src/utils/layoutState';

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

/** Legacy AppTutorial overlays are gone — these screens must not resurrect them. */
const GAMEPLAY_SCREENS = [
  'DashboardScreen.tsx',
  'MapScreen.tsx',
  'ContractsScreen.tsx',
  'FleetScreen.tsx',
  'FinanceScreen.tsx',
  'VehicleMarketplaceScreen.tsx',
  'LeaderboardScreen.tsx',
  'AccountCenterScreen.tsx',
  'WarehouseScreen.tsx',
];

console.log('\n=== Update Loop Regression ===\n');

console.log('Stable collection selectors');
{
  const missingDeliveries = selectActiveDeliveries({});
  const missingAgain = selectActiveDeliveries({});
  assert(missingDeliveries === missingAgain, 'missing activeDeliveries uses stable empty array');
  assert(missingDeliveries === EMPTY_ACTIVE_DELIVERIES, 'empty deliveries constant reused');

  const missingHistory = selectReputationHistory({});
  const missingHistoryAgain = selectReputationHistory({});
  assert(missingHistory === missingHistoryAgain, 'missing reputationHistory uses stable empty array');
  assert(missingHistory === EMPTY_REPUTATION_HISTORY, 'empty reputation history constant reused');
}

console.log('\nLayout guards');
{
  let ready = false;
  let calls = 0;
  const setReady = (value: boolean) => {
    calls += 1;
    ready = value;
  };
  commitLayoutReady(setReady, ready);
  commitLayoutReady(setReady, ready);
  assert(calls === 1 && ready === true, 'layoutReady set only once');

  let size = { width: 100, height: 200 };
  let sizeCalls = 0;
  const setSize = (value: { width: number; height: number } | ((p: typeof size) => typeof size)) => {
    const next = typeof value === 'function' ? value(size) : value;
    if (next.width === size.width && next.height === size.height) {
      return;
    }
    sizeCalls += 1;
    size = next;
  };
  commitLayoutSize(setSize, 100.5, 200.2);
  commitLayoutSize(setSize, 101, 201);
  commitLayoutSize(setSize, 104, 204);
  assert(sizeCalls === 1, 'layout size ignores sub-epsilon jitter');
  assert(size.width === 104 && size.height === 204, 'layout size updates on meaningful change');
}

console.log('\nRender instrumentation');
{
  assert(
    readFileSync('src/utils/renderRateInstrumentation.ts', 'utf8').includes('RENDER_THRESHOLD'),
    'render instrumentation uses rolling window threshold',
  );
}

console.log('\nLegacy tutorial removal');
{
  for (const screenFile of GAMEPLAY_SCREENS) {
    const source = readFileSync(`src/screens/${screenFile}`, 'utf8');
    assert(
      !/AppTutorial|MarketTutorial|SpotlightTutorial|useTutorialLayoutReady/.test(source),
      `${screenFile} has no legacy tutorial wiring`,
    );
  }

  const reputationSheet = readFileSync('src/components/dashboard/ReputationDetailSheet.tsx', 'utf8');
  assert(
    !/AppTutorial|useTutorialLayoutReady/.test(reputationSheet),
    'reputation sheet has no legacy tutorial wiring',
  );

  const dashboard = readFileSync('src/screens/DashboardScreen.tsx', 'utf8');
  assert(
    dashboard.includes('reputationSheetVisible ?'),
    'reputation sheet mounts only when open',
  );

  const mapScreen = readFileSync('src/screens/MapScreen.tsx', 'utf8');
  assert(mapScreen.includes('selectActiveDeliveries'), 'map uses stable delivery selector');
  assert(mapScreen.includes('runningDeliveriesKey'), 'map delivery selection uses stable key dep');

  const cloudSync = readFileSync('src/storage/cloudSaveSync.ts', 'utf8');
  assert(cloudSync.includes('resolvedOwnerUid'), 'cloud sync resolves legacy owner uid');
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
