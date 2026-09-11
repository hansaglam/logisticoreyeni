/**
 * Phase 6 Step 6 — Legacy tutorial removal regression.
 * Run: npx tsx scripts/contextual-guide-legacy-retirement-regression-test.ts
 */

import './test-globals';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  __setPendingHelpGuideSectionForTests,
  consumePendingHelpGuideSection,
} from '../src/contextualGuide/openHelpGuide';
import {
  createEligibleContextualGuideState,
  createSkippedAutoContextualGuideState,
  resetContextualGuideForReplayState,
  resolveContextualGuideFromSave,
} from '../src/contextualGuide/contextualGuideState';
import { canShowContextualGuideCard } from '../src/contextualGuide/contextualGuideSequence';
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

console.log('\n=== Contextual Guide Legacy Removal Regression ===\n');

const helpScreen = read('src/screens/HelpGuideScreen.tsx');
const moreScreen = read('src/screens/MoreScreen.tsx');
const marketScreen = read('src/screens/MarketScreen.tsx');
const mapHelp = read('src/components/map/MapHelpMenu.tsx');
const openHelpSrc = read('src/contextualGuide/openHelpGuide.ts');
const reputation = read('src/components/dashboard/ReputationDetailSheet.tsx');

console.log('Legacy modules deleted');
for (const rel of [
  'src/tutorial',
  'src/components/tutorial',
  'src/store/spotlightTutorialStore.ts',
  'src/hooks/useAppTutorial.ts',
  'src/hooks/useScreenAppTutorial.ts',
  'src/hooks/useMarketTutorial.ts',
  'src/hooks/useTutorialLayoutReady.ts',
  'src/hooks/useSpotlightTutorialTriggers.ts',
  'src/config/marketTutorial.ts',
]) {
  check(missing(rel), `${rel} removed`);
}

console.log('\nHelp button routing (single Help & Guide path)');
check(marketScreen.includes("openHelpGuide('marketplace')"), 'market ? opens marketplace Help');
check(reputation.includes("openHelpGuide('reputation')"), 'reputation sheet ? opens reputation Help');
check(mapHelp.includes('Yardım & Rehber'), 'map help action labels Help & Guide');
check(helpScreen.includes('consumePendingHelpGuideSection'), 'Help consumes pending section');
check(
  moreScreen.includes("pendingMoreSubRoute === 'help'") || moreScreen.includes("nextRoute === 'help'"),
  'More deep-links help',
);
check(moreScreen.includes('Yardım & Rehber'), 'Help entry remains on More');
check(helpScreen.includes('resetContextualGuideForReplay'), 'Getting Started replay remains');
check(
  !/AppTutorial|MarketTutorial|Spotlight|markTutorialPresented|recordTutorialOutcome/.test(helpScreen),
  'Help screen has no legacy tutorial APIs',
);

console.log('\nopenHelpGuide helpers');
{
  __setPendingHelpGuideSectionForTests('warehouses');
  check(consumePendingHelpGuideSection() === 'warehouses', 'consume returns pending section');
  check(consumePendingHelpGuideSection() === null, 'consume clears pending');
  check(!openHelpSrc.includes('openHelpGuideForTutorial'), 'no legacy tutorial→help bridge');
  check(openHelpSrc.includes("pendingMoreSubRoute: 'help'"), 'openHelp sets pending help route');
}

console.log('\nContextual guide + persistence safety');
{
  const eligible = createEligibleContextualGuideState();
  check(canShowContextualGuideCard(eligible, 'welcome'), 'new player guide still works');
  const dismissed = createSkippedAutoContextualGuideState();
  check(!canShowContextualGuideCard(dismissed, 'welcome'), 'existing player inference silent');
  const replay = resetContextualGuideForReplayState(dismissed);
  check(canShowContextualGuideCard(replay, 'welcome'), 'replay starts ContextualGuide');
  const onboarding = createDefaultOnboardingState();
  check(onboarding.completed === false, 'onboarding.completed unchanged by guide helpers');
  const ads = canGrantAdReward(createDefaultMonetizationState(), 'daily_ops_bonus', {
    currentGameTime: 100,
    playerLevel: 5,
    hasCompletedOnboarding: false,
  });
  check(!ads.ok, 'ads still gated by onboarding.completed');
}

console.log('\nNo forced tab / blocking auto Modal from help path');
check(openHelpSrc.includes("pendingMoreSubRoute: 'help'"), 'help nav uses pending more subroute');
check(openHelpSrc.includes("tab: 'more'"), 'help nav uses more tab');
check(!openHelpSrc.includes("tab: 'contracts'"), 'help path does not force contracts');

console.log('\nLegacy tutorial fields dropped from store/save wiring');
{
  const save = read('src/storage/saveGame.ts');
  const store = read('src/store/gameStore.ts');
  const legacyFields = /spotlightTutorial|marketTutorialCompleted|marketTutorialVersion|tutorialProgress/;
  check(!legacyFields.test(save), 'save no longer persists legacy tutorial fields');
  check(!legacyFields.test(store), 'store no longer holds legacy tutorial fields');
  check(
    save.includes('hasLegacyTutorialActivityFromRawSave'),
    'save reads legacy activity from raw payload only',
  );
  check(save.includes('onboarding'), 'onboarding field kept');
  check(save.includes('tutorial,'), 'mission tutorial state kept');
}

console.log('\nNormalize / cloud existing player still dismissed');
{
  const normalized = resolveContextualGuideFromSave(undefined, {
    completedContracts: 2,
    activeDeliveryCount: 0,
    deliveryStarted: true,
    tradePurchased: false,
    playerLevel: 5,
    tutorialCompleted: false,
    onboardingCompleted: true,
    legacyTutorialActivity: true,
  });
  check(normalized.status === 'dismissed', 'existing player cloud normalize → dismissed');
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
