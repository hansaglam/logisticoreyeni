/**
 * Phase 6 Step 5 — Contextual guide gameplay mount regression.
 * Run: npx tsx scripts/contextual-guide-gameplay-mount-regression-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  canShowContextualGuideCard,
  getCurrentContextualGuideCardId,
  getNextContextualGuideCardId,
  isContextualGuideAutoShowAllowed,
} from '../src/contextualGuide/contextualGuideSequence';
import {
  completeContextualGuideState,
  createEligibleContextualGuideState,
  createSkippedAutoContextualGuideState,
  dismissContextualGuideState,
  markContextualGuideCardCompletedState,
  resetContextualGuideForReplayState,
} from '../src/contextualGuide/contextualGuideState';
import { CONTEXTUAL_GUIDE_CARD_COPY } from '../src/contextualGuide/contextualGuideCopy';
import { createDefaultOnboardingState } from '../src/onboarding/onboardingProgress';
import { canGrantAdReward, createDefaultMonetizationState } from '../src/simulation/adRewardGrants';

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

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

console.log('\n=== Contextual Guide Gameplay Mount Regression ===\n');

const dashboard = read('src/screens/DashboardScreen.tsx');
const contracts = read('src/screens/ContractsScreen.tsx');
const fleet = read('src/screens/FleetScreen.tsx');
const map = read('src/screens/MapScreen.tsx');
const more = read('src/screens/MoreScreen.tsx');
const host = read('src/contextualGuide/components/ContextualGuideHost.tsx');
const sequenceSrc = read('src/contextualGuide/contextualGuideSequence.ts');
const hookSrc = read('src/contextualGuide/hooks/useContextualGuideHost.ts');

console.log('Mount wiring');
check(dashboard.includes('cardId="welcome"'), 'Dashboard mounts welcome');
check(contracts.includes('cardId="choose_contract"'), 'Contracts mounts choose_contract');
check(fleet.includes('cardId="manage_fleet"'), 'Fleet mounts manage_fleet');
check(map.includes('cardId="follow_route"'), 'Map mounts follow_route');
check(more.includes('cardId="need_help"'), 'More mounts need_help');
check(host.includes('ContextualGuideCard'), 'Host uses ContextualGuideCard');
check(!host.includes('Modal'), 'Host is not Modal');
check(!dashboard.includes("navigate('contracts')"), 'Dashboard no forced contracts nav on mount');
check(!host.includes('navigationRequest'), 'Host file does not inline navigationRequest');
check(hookSrc.includes('requestNavigationAfterGuideCard'), 'hook CTA uses guide navigation');

console.log('\nVisibility / sequence');
{
  const eligible = createEligibleContextualGuideState();
  check(isContextualGuideAutoShowAllowed(eligible), 'eligible allows auto-show');
  check(getCurrentContextualGuideCardId(eligible) === 'welcome', 'eligible current = welcome');
  check(canShowContextualGuideCard(eligible, 'welcome'), 'welcome can render when eligible');
  check(!canShowContextualGuideCard(eligible, 'choose_contract'), 'contract not yet');

  const dismissed = createSkippedAutoContextualGuideState();
  check(!isContextualGuideAutoShowAllowed(dismissed), 'dismissed blocks auto-show');
  check(getCurrentContextualGuideCardId(dismissed) === null, 'dismissed current null');
  check(!canShowContextualGuideCard(dismissed, 'welcome'), 'dismissed → no welcome');

  const completed = completeContextualGuideState(eligible);
  check(completed.status === 'completed', 'completed status');
  check(!canShowContextualGuideCard(completed, 'welcome'), 'completed → no cards');
}

console.log('\nPrimary / dismiss semantics');
{
  let guide = createEligibleContextualGuideState();
  guide = markContextualGuideCardCompletedState(guide, 'welcome');
  check(guide.completedCardIds.includes('welcome'), 'welcome primary completes card');
  check(guide.status === 'active', 'welcome completion activates guide');
  check(getCurrentContextualGuideCardId(guide) === 'choose_contract', 'next is choose_contract');
  check(getNextContextualGuideCardId(guide) === 'manage_fleet', 'next after contract is fleet');

  const afterDismiss = dismissContextualGuideState(guide);
  check(afterDismiss.status === 'dismissed', 'dismiss helper still sets dismissed');
  check(!canShowContextualGuideCard(afterDismiss, 'choose_contract'), 'no later cards after dismiss');
}

console.log('\nSequence gates');
{
  let guide = createEligibleContextualGuideState();
  guide = markContextualGuideCardCompletedState(guide, 'welcome');
  check(canShowContextualGuideCard(guide, 'choose_contract'), 'contract after welcome');
  check(!canShowContextualGuideCard(guide, 'manage_fleet'), 'fleet not yet');

  guide = markContextualGuideCardCompletedState(guide, 'choose_contract');
  check(canShowContextualGuideCard(guide, 'manage_fleet'), 'fleet after contract');

  guide = markContextualGuideCardCompletedState(guide, 'manage_fleet');
  check(canShowContextualGuideCard(guide, 'follow_route'), 'follow_route without delivery');
  check(canShowContextualGuideCard(guide, 'follow_route'), 'follow_route educational step');

  guide = markContextualGuideCardCompletedState(guide, 'follow_route');
  check(canShowContextualGuideCard(guide, 'need_help'), 'need_help last in sequence');
  guide = markContextualGuideCardCompletedState(guide, 'need_help');
  check(guide.status === 'completed', 'final card completes guide');
}

console.log('\nBlocking UI + render purity');
{
  const guide = createEligibleContextualGuideState();
  check(
    !canShowContextualGuideCard(guide, 'welcome', { blockingUi: true }),
    'blockingUi suppresses card',
  );
  const before = JSON.stringify(guide);
  canShowContextualGuideCard(guide, 'welcome');
  check(JSON.stringify(guide) === before, 'visibility check does not mutate');
}

console.log('\nReplay');
{
  const replay = resetContextualGuideForReplayState(createSkippedAutoContextualGuideState());
  check(replay.status === 'active', 'replay → active');
  check(canShowContextualGuideCard(replay, 'welcome'), 'replay allows welcome again');
  const onboarding = createDefaultOnboardingState();
  check(onboarding.completed === false, 'onboarding.completed untouched by replay helper');
}

console.log('\nCopy + isolation helpers');
check(CONTEXTUAL_GUIDE_CARD_COPY.welcome.title.includes('Hoş'), 'welcome copy TR');
check(CONTEXTUAL_GUIDE_CARD_COPY.need_help.primaryLabel === 'Eğitimi Tamamla', 'final CTA Eğitimi Tamamla');

console.log('\nNo legacy tutorial collisions');
for (const [label, source] of [
  ['Dashboard', dashboard],
  ['Contracts', contracts],
  ['Fleet', fleet],
  ['Map', map],
  ['More', more],
] as const) {
  check(
    !/AppTutorial|MarketTutorial|SpotlightTutorial/.test(source),
    `${label} has no legacy tutorial overlay`,
  );
}

console.log('\nAds / onboarding safety');
{
  const blocked = canGrantAdReward(createDefaultMonetizationState(), 'daily_ops_bonus', {
    currentGameTime: 100,
    playerLevel: 5,
    hasCompletedOnboarding: false,
  });
  check(!blocked.ok, 'ads still gated by onboarding.completed');
}

console.log('\nActive delivery mount condition');
check(map.includes('cardId="follow_route"'), 'Map mounts follow_route host');
check(!map.includes('hasActiveDelivery='), 'Map does not pass delivery prop');
check(
  !hookSrc.includes('selectHasRunningDelivery') && !sequenceSrc.includes('hasActiveDelivery'),
  'follow_route no longer gated on active delivery',
);
check(contracts.includes('blockingUi={assignmentModalVisible || quickSheetVisible}'), 'Contracts blocks on sheets');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
