/**
 * Phase 6 Step 7 — Final verification smoke (no product changes).
 * Run: npx tsx scripts/contextual-guide-phase6-final-verification-test.ts
 */

import './test-globals';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CONTEXTUAL_GUIDE_CARD_IDS } from '../src/contextualGuide/contextualGuideState';
import {
  canShowContextualGuideCard,
  getCurrentContextualGuideCardId,
} from '../src/contextualGuide/contextualGuideSequence';
import {
  completeContextualGuideState,
  createEligibleContextualGuideState,
  createSkippedAutoContextualGuideState,
  dismissContextualGuideState,
  markContextualGuideCardCompletedState,
  resetContextualGuideForReplayState,
  resolveContextualGuideFromSave,
} from '../src/contextualGuide/contextualGuideState';
import { HELP_GUIDE_SECTIONS } from '../src/contextualGuide/helpGuideSections';
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
const missing = (rel: string) => !existsSync(resolve(root, rel));

console.log('\n=== Phase 6 Final Verification ===\n');

console.log('Product architecture');
check(
  CONTEXTUAL_GUIDE_CARD_IDS.join(',') ===
    'welcome,choose_contract,manage_fleet,follow_route,need_help',
  'guide card order final',
);
check(HELP_GUIDE_SECTIONS.length === 11, 'Help has 11 sections');
check(missing('src/tutorial'), 'legacy tutorial tree removed');
check(missing('src/hooks/useAppTutorial.ts'), 'AppTutorial hook removed');
check(missing('src/hooks/useMarketTutorial.ts'), 'MarketTutorial hook removed');
check(missing('src/hooks/useScreenAppTutorial.ts'), 'screen AppTutorial hook removed');
check(
  read('src/contextualGuide/openHelpGuide.ts').includes("pendingMoreSubRoute: 'help'"),
  'Help deep-link uses more/help',
);

console.log('\nMounts');
check(read('src/screens/DashboardScreen.tsx').includes('cardId="welcome"'), 'Dashboard welcome');
check(read('src/screens/ContractsScreen.tsx').includes('cardId="choose_contract"'), 'Contracts card');
check(read('src/screens/FleetScreen.tsx').includes('cardId="manage_fleet"'), 'Fleet card');
check(read('src/screens/MapScreen.tsx').includes('cardId="follow_route"'), 'Map follow_route');
check(read('src/screens/MoreScreen.tsx').includes('cardId="need_help"'), 'More need_help');
check(
  read('src/contextualGuide/hooks/useContextualGuideHost.ts').includes('requestNavigationAfterGuideCard'),
  'CTA drives guided navigation',
);
check(
  !read('src/contextualGuide/contextualGuideSequence.ts').includes('hasActiveDelivery'),
  'follow_route not delivery-gated',
);

console.log('\nNew / existing / replay');
{
  const fresh = createEligibleContextualGuideState();
  check(fresh.status === 'eligible', 'new player eligible');
  check(canShowContextualGuideCard(fresh, 'welcome'), 'welcome may show');

  const existing = resolveContextualGuideFromSave(undefined, {
    completedContracts: 3,
    activeDeliveryCount: 0,
    deliveryStarted: true,
    tradePurchased: false,
    playerLevel: 4,
    tutorialCompleted: false,
    onboardingCompleted: true,
    legacyTutorialActivity: true,
  });
  check(existing.status === 'dismissed', 'existing without field → dismissed');
  check(!canShowContextualGuideCard(existing, 'welcome'), 'existing not forced');

  const replay = resetContextualGuideForReplayState(createSkippedAutoContextualGuideState());
  check(replay.status === 'active', 'replay reactivates');
  check(canShowContextualGuideCard(replay, 'welcome'), 'replay allows welcome');
}

console.log('\nSequence + dismiss');
{
  let guide = createEligibleContextualGuideState();
  for (const id of CONTEXTUAL_GUIDE_CARD_IDS) {
    check(getCurrentContextualGuideCardId(guide) === id, `current ${id}`);
    if (id === 'follow_route') {
      check(canShowContextualGuideCard(guide, id), 'follow_route educational without delivery');
    }
    guide = markContextualGuideCardCompletedState(guide, id);
  }
  guide = completeContextualGuideState(guide);
  check(guide.status === 'completed', 'sequence ends completed');
  check(!canShowContextualGuideCard(guide, 'welcome'), 'completed silent');

  const dismissed = dismissContextualGuideState(createEligibleContextualGuideState());
  check(dismissed.status === 'dismissed', 'dismiss helper still works');
  check(!canShowContextualGuideCard(dismissed, 'choose_contract'), 'dismissed stays silent');
}

console.log('\nAds / onboarding isolation');
{
  const onboarding = createDefaultOnboardingState();
  const afterComplete = completeContextualGuideState(createEligibleContextualGuideState());
  check(onboarding.completed === false, 'default onboarding incomplete');
  check(afterComplete.status === 'completed', 'guide can complete independently');
  const blocked = canGrantAdReward(createDefaultMonetizationState(), 'daily_ops_bonus', {
    currentGameTime: 50,
    playerLevel: 5,
    hasCompletedOnboarding: false,
  });
  check(!blocked.ok, 'ads still require onboarding.completed');
  const store = read('src/store/gameStore.ts');
  const guideBlock = store.slice(
    store.indexOf('markContextualGuideCardCompleted:'),
    store.indexOf('createMarketPriceAlert:'),
  );
  check(!guideBlock.includes('onboarding'), 'guide store actions do not touch onboarding');
  check(!guideBlock.includes('applyAdReward'), 'guide store actions do not touch ads');
}

console.log('\nNo Phase 6 timers / giant controller');
{
  const seq = read('src/contextualGuide/contextualGuideSequence.ts');
  const host = read('src/contextualGuide/hooks/useContextualGuideHost.ts');
  check(!seq.includes('setInterval'), 'sequence has no polling');
  check(!host.includes('setInterval'), 'host has no polling');
  check(!host.includes('setTimeout'), 'host has no timers');
  check(host.includes('state.contextualGuide'), 'host uses contextualGuide selector');
  check(host.includes('requestNavigationAfterGuideCard'), 'host hook navigates via CTA helper');
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ PHASE 6 FINAL VERIFICATION PASS\n');
