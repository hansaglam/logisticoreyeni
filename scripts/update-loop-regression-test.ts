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
import { APP_TUTORIALS_ENABLED } from '../src/tutorial/app/featureFlags';
import { normalizeTutorialProgress } from '../src/tutorial/app/persistence';
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

const TUTORIAL_SCREENS = [
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

console.log('\nTutorial progress normalization');
{
  const first = normalizeTutorialProgress(undefined);
  const second = normalizeTutorialProgress(undefined);
  assert(JSON.stringify(first) === JSON.stringify(second), 'normalize output is stable for undefined');
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

console.log('\nKill switch');
{
  assert(typeof APP_TUTORIALS_ENABLED === 'boolean', 'APP_TUTORIALS_ENABLED is boolean');
}

console.log('\nTutorial hook stabilization');
{
  const useAppTutorialSource = readFileSync('src/hooks/useAppTutorial.ts', 'utf8');
  assert(useAppTutorialSource.includes('return useMemo('), 'useAppTutorial return value is memoized');
  assert(useAppTutorialSource.includes('const onSkip = useCallback'), 'onSkip callback is stable');
  assert(useAppTutorialSource.includes('const onComplete = useCallback'), 'onComplete callback is stable');
  assert(
    useAppTutorialSource.includes('setTransitionState((previous)'),
    'transition state updates are no-op guarded',
  );
  assert(
    useAppTutorialSource.includes('autoAttemptedRef.current = false'),
    'auto-start retries after blockers clear',
  );

  const hook = readFileSync('src/hooks/useScreenAppTutorial.ts', 'utf8');
  assert(
    !hook.includes('normalizeTutorialProgress(state.tutorialProgress)'),
    'tutorial progress not normalized inside zustand selector',
  );
  assert(hook.includes('useMemo'), 'tutorial progress normalized via useMemo');
  assert(hook.includes('onCompletePersistence = useCallback'), 'persistence callback is stable');
  assert(hook.includes('warnRenderLoopSuspected'), 'render-loop dev instrumentation exists');
  assert(
    readFileSync('src/utils/renderRateInstrumentation.ts', 'utf8').includes('RENDER_THRESHOLD'),
    'render instrumentation uses rolling window threshold',
  );

  const layoutHook = readFileSync('src/hooks/useTutorialLayoutReady.ts', 'utf8');
  assert(layoutHook.includes('readyRef'), 'layout hook uses ref guard');
  assert(layoutHook.includes('markLayoutReady'), 'layout hook exports markLayoutReady');
}

console.log('\nTarget registry');
{
  const targetSource = readFileSync('src/components/tutorial/AppTutorialTarget.tsx', 'utf8');
  assert(targetSource.includes('scrollIntoViewRef'), 'target scroll callback stored in ref');
  assert(targetSource.includes('layoutMode'), 'target supports layoutMode contract');
  assert(
    !targetSource.includes("alignSelf: 'flex-start'"),
    'target has no global alignSelf flex-start',
  );

  const registrySource = readFileSync('src/tutorial/app/targetRegistry.ts', 'utf8');
  assert(registrySource.includes('existing === entry'), 'registry skips identical entry re-register');
}

console.log('\nScreen layout wiring');
{
  for (const screenFile of TUTORIAL_SCREENS) {
    const source = readFileSync(`src/screens/${screenFile}`, 'utf8');
    assert(
      source.includes('useTutorialLayoutReady'),
      `${screenFile} uses useTutorialLayoutReady`,
    );
    assert(
      !source.includes('setLayoutReady(true)'),
      `${screenFile} does not call setLayoutReady(true) inline`,
    );
  }

  const reputationSheet = readFileSync('src/components/dashboard/ReputationDetailSheet.tsx', 'utf8');
  assert(reputationSheet.includes('autoStart: false'), 'reputation tutorial does not auto-start');
  assert(reputationSheet.includes('useTutorialLayoutReady'), 'reputation sheet uses layout hook');

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
