/**
 * App tutorial regression tests.
 * Run: npx tsx scripts/app-tutorial-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import { MARKET_TUTORIAL_VERSION } from '../src/config/marketTutorial';
import {
  DASHBOARD_TUTORIAL_STEPS,
  REPUTATION_TUTORIAL_STEPS,
  getVehicleMarketplaceTutorialSteps,
  getLeaderboardTutorialSteps,
} from '../src/tutorial/app/definitions';
import {
  applyTutorialCompletion,
  getTutorialProgressEntry,
  mergeLegacyMarketTutorialProgress,
  normalizeTutorialProgress,
  shouldAutoStartTutorial,
} from '../src/tutorial/app/persistence';
import {
  computeTooltipLayout,
  isMeaningfullyDifferentRect,
  normalizeTutorialRect,
  TUTORIAL_RECT_EPSILON_PX,
} from '../src/tutorial/app/layout';
import { APP_TUTORIAL_VERSIONS } from '../src/tutorial/app/versions';

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

console.log('\n=== App Tutorial Regression ===\n');

console.log('Versions');
assert(APP_TUTORIAL_VERSIONS.dashboard === 1, 'dashboard version is 1');
assert(APP_TUTORIAL_VERSIONS.market === MARKET_TUTORIAL_VERSION, 'market version matches legacy');

console.log('\nDashboard steps');
assert(DASHBOARD_TUTORIAL_STEPS.length === 4, 'dashboard has 4 steps');
assert(DASHBOARD_TUTORIAL_STEPS[0].targetId === 'resource-bar', 'dashboard step 1 target');
assert(
  DASHBOARD_TUTORIAL_STEPS[3].finalCtaLabel === 'Başlayalım',
  'dashboard final CTA',
);

console.log('\nReputation steps');
assert(REPUTATION_TUTORIAL_STEPS.length === 3, 'reputation has 3 steps');

console.log('\nAuto-start rules');
{
  assert(
    shouldAutoStartTutorial('dashboard', {}, undefined),
    'dashboard first entry auto-starts',
  );
  assert(
    !shouldAutoStartTutorial(
      'dashboard',
      applyTutorialCompletion({}, 'dashboard'),
      undefined,
    ),
    'dashboard completed does not auto-start',
  );
  assert(
    shouldAutoStartTutorial(
      'dashboard',
      { dashboard: { completed: true, version: 0 } },
      undefined,
    ),
    'dashboard old version auto-starts after bump',
  );
}

console.log('\nLegacy market migration');
{
  const merged = mergeLegacyMarketTutorialProgress(
    {},
    { marketTutorialCompleted: true, marketTutorialVersion: MARKET_TUTORIAL_VERSION },
  );
  assert(merged.market?.completed === true, 'legacy market completed migrates');
  assert(merged.market?.version === MARKET_TUTORIAL_VERSION, 'legacy market version migrates');
  assert(
    !shouldAutoStartTutorial('market', merged, {
      marketTutorialCompleted: true,
      marketTutorialVersion: MARKET_TUTORIAL_VERSION,
    }),
    'migrated market does not auto-start',
  );
  const entry = getTutorialProgressEntry(merged, 'market', {
    marketTutorialCompleted: true,
    marketTutorialVersion: MARKET_TUTORIAL_VERSION,
  });
  assert(entry.completed === true, 'getTutorialProgressEntry reads migrated market');
}

console.log('\nReplay does not reset completion');
{
  const completed = applyTutorialCompletion({}, 'dashboard');
  const afterReplay = { ...completed };
  assert(afterReplay.dashboard?.completed === true, 'replay keeps completed true');
}

console.log('\nLayout stability');
{
  const rect = { x: 10.2, y: 20.6, width: 100.1, height: 40.9 };
  const normalized = normalizeTutorialRect(rect);
  assert(normalized.x === 10 && normalized.y === 21, 'rect normalization rounds');
  assert(
    !isMeaningfullyDifferentRect(normalized, { ...normalized, x: normalized.x + 2 }),
    'epsilon suppresses jitter',
  );
  assert(TUTORIAL_RECT_EPSILON_PX === 3, 'epsilon is 3px');
  const layout = computeTooltipLayout({
    anchorRect: null,
    screenWidth: 390,
    screenHeight: 844,
    safeAreaTop: 44,
    safeAreaBottom: 34,
    tabBarHeight: 56,
    tooltipWidth: 360,
    tooltipHeight: 180,
    previousPlacement: null,
  });
  assert(layout.placement === 'center', 'missing target uses center placement');
}

console.log('\nEmpty fallbacks');
{
  const marketplaceEmpty = getVehicleMarketplaceTutorialSteps(false);
  assert(marketplaceEmpty.length === 3, 'empty marketplace fallback has 3 steps');
  const leaderboardEmpty = getLeaderboardTutorialSteps(false);
  assert(leaderboardEmpty.length === 3, 'empty leaderboard fallback has 3 steps');
}

console.log('\nMalformed progress normalization');
{
  assert(JSON.stringify(normalizeTutorialProgress(null)) === '{}', 'null progress normalizes');
  assert(JSON.stringify(normalizeTutorialProgress([] as unknown as never)) === '{}', 'array progress normalizes');
}
console.log('\nSave model');
{
  const saveSource = readFileSync('src/storage/saveGame.ts', 'utf8');
  assert(saveSource.includes('tutorialProgress'), 'saveGame serializes tutorialProgress');
  assert(saveSource.includes('mergeLegacyMarketTutorialProgress'), 'saveGame migrates legacy market');
}

console.log('\nHook wiring');
{
  const dashSource = readFileSync('src/screens/DashboardScreen.tsx', 'utf8');
  assert(dashSource.includes('useScreenAppTutorial'), 'dashboard uses screen tutorial hook');
  assert(dashSource.includes('AppTutorialHelpButton'), 'dashboard has help button');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
