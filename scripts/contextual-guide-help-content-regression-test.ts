/**
 * Phase 6 Step 4 — Help content + Getting Started replay regression.
 * Run: npx tsx scripts/contextual-guide-help-content-regression-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  HELP_GUIDE_REPLAY_CTA_LABEL,
  HELP_GUIDE_SECTIONS,
  type HelpGuideSectionId,
} from '../src/contextualGuide/helpGuideSections';
import {
  createEligibleContextualGuideState,
  resetContextualGuideForReplayState,
} from '../src/contextualGuide/contextualGuideState';
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

const expectedIds: HelpGuideSectionId[] = [
  'getting_started',
  'deliveries',
  'vehicles_fleet',
  'fuel',
  'warehouses',
  'marketplace',
  'reputation',
  'driver_xp',
  'seasons_challenges',
  'achievements_progress',
  'account_cloud',
];

console.log('\n=== Contextual Guide Help Content Regression ===\n');

const helpScreen = read('src/screens/HelpGuideScreen.tsx');
const sectionsSrc = read('src/contextualGuide/helpGuideSections.ts');
const more = read('src/screens/MoreScreen.tsx');
const store = read('src/store/gameStore.ts');
const adGrants = read('src/simulation/adRewardGrants.ts');

console.log('All 11 sections present with real content');
check(HELP_GUIDE_SECTIONS.length === 11, '11 sections');
for (const id of expectedIds) {
  const section = HELP_GUIDE_SECTIONS.find((entry) => entry.id === id);
  check(Boolean(section), `section ${id} exists`);
  check(Boolean(section?.summary && !section.summary.startsWith('Yakında')), `${id} summary filled`);
  check((section?.paragraphs.length ?? 0) >= 1, `${id} has paragraphs`);
  check((section?.bullets?.length ?? 0) >= 1, `${id} has bullets`);
  check(Boolean(section?.icon), `${id} has icon`);
}

console.log('\nGetting Started + replay CTA');
const gettingStarted = HELP_GUIDE_SECTIONS.find((s) => s.id === 'getting_started');
check(gettingStarted?.showReplayCta === true, 'Getting Started marks replay CTA');
check(helpScreen.includes('HELP_GUIDE_REPLAY_CTA_LABEL'), 'replay CTA label wired from content module');
check(sectionsSrc.includes(HELP_GUIDE_REPLAY_CTA_LABEL), 'replay CTA copy defined in sections');
check(helpScreen.includes('resetContextualGuideForReplay'), 'Help calls replay store action');
check(helpScreen.includes("navigationRequest: { tab: 'dashboard' }"), 'replay offers dashboard return');
check(
  !helpScreen.includes('resetOnboardingForDev') &&
    !helpScreen.includes('resetTutorial') &&
    !helpScreen.includes('resetSpotlight') &&
    !helpScreen.includes('completeMarketTutorial') &&
    !helpScreen.includes('recordTutorialOutcome'),
  'replay path does not touch legacy tutorial APIs',
);

console.log('\nReplay safety (state helpers)');
{
  const onboarding = createDefaultOnboardingState();
  const beforeCompleted = onboarding.completed;
  const guide = resetContextualGuideForReplayState(createEligibleContextualGuideState());
  check(guide.status === 'active', 'replay sets contextualGuide active');
  check(guide.completedCardIds.length === 0, 'replay clears completed cards');
  check(guide.dismissedCardIds.length === 0, 'replay clears dismissed cards');
  check(beforeCompleted === onboarding.completed, 'onboarding.completed unchanged by replay helper');

  const blocked = canGrantAdReward(createDefaultMonetizationState(), 'daily_ops_bonus', {
    currentGameTime: 100,
    playerLevel: 5,
    hasCompletedOnboarding: false,
  });
  check(!blocked.ok, 'ads still blocked when onboarding incomplete');
  check(adGrants.includes('hasCompletedOnboarding'), 'ads gate still onboarding-based');
  check(
    store.includes('resetContextualGuideForReplay') &&
      store.includes('resetContextualGuideForReplayState'),
    'store replay only resets contextualGuide',
  );
}

console.log('\nRestricted claims avoided');
const joined = `${sectionsSrc}\n${helpScreen}`.toLowerCase();
check(sectionsSrc.includes('Final sıralama ödülü şu an yok'), 'season final rank deferred stated');
check(sectionsSrc.includes('Nakit ödül vaat etmez'), 'achievements informational / no cash');
check(sectionsSrc.includes('Gerçek para ile araç ticareti yoktur'), 'no real-money vehicle trading');
check(sectionsSrc.includes('Teslimat sayısına dayalı görevler henüz aktif değildir'), 'delivery challenges deferred');
check(!joined.includes('zustand'), 'no Zustand jargon');
check(!joined.includes('firestore'), 'no Firestore jargon');
check(!joined.includes('server-authoritative'), 'no server-authoritative jargon');
check(!joined.includes('buy coins'), 'no coin purchase claim');

console.log('\nHelp UX wiring');
check(helpScreen.includes('expandedId'), 'accordion local state');
check(helpScreen.includes('HelpSectionCard'), 'section cards');
check(more.includes('Yardım & Rehber'), 'MoreScreen entry retained');
check(more.includes("route === 'help'"), 'help route retained');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
