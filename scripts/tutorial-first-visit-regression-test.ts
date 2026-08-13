/**
 * Tutorial first-visit persistence regression tests.
 * Run: npx tsx scripts/tutorial-first-visit-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import { MARKET_TUTORIAL_VERSION } from '../src/config/marketTutorial';
import {
  applyManualTutorialReplay,
  applyTutorialOutcome,
  applyTutorialPresented,
  getTutorialProgressEntry,
  hasTutorialBeenPresented,
  mergeLegacyMarketTutorialProgress,
  normalizeTutorialProgress,
  normalizeTutorialProgressEntry,
  shouldAutoPresentTutorial,
  shouldAutoStartTutorial,
} from '../src/tutorial/app/persistence';
import { shouldAutoStartMarketTutorial } from '../src/tutorial/marketTutorialState';

let pass = 0;
let fail = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

function baseEligible(input: Partial<Parameters<typeof shouldAutoPresentTutorial>[0]> = {}) {
  return {
    enabled: true,
    hydrated: true,
    layoutReady: true,
    definitionAvailable: true,
    hasBeenPresented: false,
    blockerActive: false,
    sessionDisabled: false,
    autoStart: true,
    ...input,
  };
}

console.log('\n=== Tutorial First-Visit Regression ===\n');

console.log('shouldAutoPresentTutorial');
{
  check(shouldAutoPresentTutorial(baseEligible()), 'first visit eligible');
  check(!shouldAutoPresentTutorial(baseEligible({ hasBeenPresented: true })), 'presented blocks auto');
  check(!shouldAutoPresentTutorial(baseEligible({ hydrated: false })), 'not hydrated blocks auto');
  check(!shouldAutoPresentTutorial(baseEligible({ blockerActive: true })), 'blocker blocks auto');
  check(shouldAutoPresentTutorial(baseEligible({ blockerActive: true, hasBeenPresented: false })) === false, 'blocker still blocks');
  check(!shouldAutoPresentTutorial(baseEligible({ sessionDisabled: true })), 'kill switch blocks auto');
}

console.log('\nFirst visit auto-start per screen');
{
  for (const id of ['dashboard', 'map', 'fleet', 'warehouses', 'finance', 'account'] as const) {
    check(shouldAutoStartTutorial(id, {}, undefined), `${id} first visit auto-starts`);
  }
}

console.log('\nSecond visit / outcomes block auto-start');
{
  let progress = applyTutorialPresented({}, 'dashboard');
  check(!shouldAutoStartTutorial('dashboard', progress), 'presented dashboard no auto');

  progress = applyTutorialOutcome({}, 'map', 'completed');
  check(!shouldAutoStartTutorial('map', progress), 'completed map no auto');

  progress = applyTutorialOutcome({}, 'contracts', 'skipped');
  check(!shouldAutoStartTutorial('contracts', progress), 'skipped contracts no auto');

  progress = applyTutorialOutcome({}, 'fleet', 'dismissed');
  check(!shouldAutoStartTutorial('fleet', progress), 'dismissed fleet no auto');
}

console.log('\nVersion bump does not re-trigger auto-start');
{
  const progress = {
    dashboard: {
      completed: true,
      version: 0,
      hasBeenPresented: true,
      status: 'completed' as const,
    },
  };
  check(!shouldAutoStartTutorial('dashboard', progress), 'old version completed no auto replay');
  check(
    !shouldAutoStartMarketTutorial(
      { marketTutorialCompleted: true, marketTutorialVersion: 0 },
      progress,
    ),
    'market legacy version bump no auto replay',
  );
}

console.log('\nLegacy migration');
{
  const legacyMarket = mergeLegacyMarketTutorialProgress(
    {},
    { marketTutorialCompleted: true, marketTutorialVersion: MARKET_TUTORIAL_VERSION },
  );
  check(legacyMarket.market?.hasBeenPresented === true, 'legacy market → hasBeenPresented');
  check(legacyMarket.market?.status === 'completed', 'legacy market → completed status');
  check(!shouldAutoStartTutorial('market', legacyMarket), 'migrated market no auto');

  const legacyCompleted = normalizeTutorialProgressEntry({ completed: true, version: 1 });
  check(legacyCompleted.hasBeenPresented === true, 'legacy completed flag migrates');
  check(legacyCompleted.status === 'completed', 'legacy completed status migrates');

  const fresh = normalizeTutorialProgressEntry({ completed: false, version: 0 });
  check(fresh.hasBeenPresented === false, 'fresh entry not presented');
  check(fresh.status === 'never-seen', 'fresh entry never-seen');
}

console.log('\nManual replay preserves hasBeenPresented');
{
  const before = applyTutorialOutcome({}, 'dashboard', 'completed');
  const after = applyManualTutorialReplay(before, 'dashboard');
  check(after.dashboard?.hasBeenPresented === true, 'manual replay keeps presented');
  check(after.dashboard?.status === 'completed', 'manual replay keeps completed status');
  check(
    typeof after.dashboard?.lastManualReplayAt === 'number',
    'manual replay timestamp recorded',
  );
  check(!shouldAutoStartTutorial('dashboard', after), 'after manual replay no auto');
}

console.log('\nIndependent screen progress');
{
  const progress = applyTutorialPresented({}, 'dashboard');
  check(hasTutorialBeenPresented('dashboard', progress), 'dashboard presented');
  check(!hasTutorialBeenPresented('map', progress), 'map still fresh');
  check(shouldAutoStartTutorial('map', progress), 'map first visit still eligible');
}

console.log('\nMalformed progress normalization');
{
  check(JSON.stringify(normalizeTutorialProgress(null)) === '{}', 'null → {}');
  check(JSON.stringify(normalizeTutorialProgress([] as never)) === '{}', 'array → {}');
  const entry = getTutorialProgressEntry(normalizeTutorialProgress('bad' as never), 'dashboard');
  check(entry.hasBeenPresented === false, 'missing entry defaults safe');
}

console.log('\nHook wiring');
{
  const useApp = readFileSync('src/hooks/useAppTutorial.ts', 'utf8');
  const useScreen = readFileSync('src/hooks/useScreenAppTutorial.ts', 'utf8');
  const reputation = readFileSync('src/components/dashboard/ReputationDetailSheet.tsx', 'utf8');

  check(useApp.includes('onPresentPersistence'), 'useAppTutorial marks presentation');
  check(useApp.includes('hasTutorialBeenPresented'), 'useAppTutorial reads hasBeenPresented');
  check(!useApp.includes('autoAttemptedRef.current = false'), 'autoAttemptedRef no remount reset');
  check(useScreen.includes('markTutorialPresented'), 'screen hook persists presentation');
  check(useScreen.includes('isGameReady'), 'screen hook waits for hydration');
  check(useScreen.includes('recordTutorialManualReplay'), 'screen hook manual replay metadata');
  check(reputation.includes('autoStart: true'), 'reputation sheet can auto-start when open');
  check(reputation.includes('blockingModals: !visible'), 'closed reputation sheet blocks tutorial');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
