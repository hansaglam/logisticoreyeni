/**
 * Phase 6 Step 3 — Contextual Guide UI foundation regression.
 * Run: npx tsx scripts/contextual-guide-ui-foundation-regression-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CONTEXTUAL_GUIDE_CARD_ICONS,
  getContextualGuideCardIcon,
} from '../src/contextualGuide/contextualGuideIcons';
import { CONTEXTUAL_GUIDE_CARD_IDS } from '../src/contextualGuide/contextualGuideState';
import {
  HELP_GUIDE_SECTIONS,
  type HelpGuideSectionId,
} from '../src/contextualGuide/helpGuideSections';
import {
  resolveMoreScreenRoute,
  type PendingMoreSubRoute,
} from '../src/navigation/managementNavigation';

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

console.log('\n=== Contextual Guide UI Foundation Regression ===\n');

const card = read('src/contextualGuide/components/ContextualGuideCard.tsx');
const helpScreen = read('src/screens/HelpGuideScreen.tsx');
const more = read('src/screens/MoreScreen.tsx');
const icons = read('src/theme/icons.ts');
const foundation = read('src/contextualGuide/contextualGuideState.ts');
const saveGame = read('src/storage/saveGame.ts');
const adGrants = read('src/simulation/adRewardGrants.ts');

console.log('ContextualGuideCard API / behavior');
check(card.includes('export default memo(function ContextualGuideCard'), 'card component exported');
check(card.includes('title: string'), 'title prop');
check(card.includes('description: string'), 'description prop');
check(card.includes('onPrimaryPress'), 'primary CTA callback prop');
check(card.includes('onDismiss'), 'dismiss callback prop');
check(card.includes('currentStep'), 'currentStep prop');
check(card.includes('totalSteps'), 'totalSteps prop');
check(card.includes('icon?:'), 'optional icon prop');
check(card.includes('onPress={onPrimaryPress}'), 'primary CTA invokes callback');
check(card.includes('onPress={onDismiss}'), 'dismiss X invokes callback');
check(card.includes('styles.dotActive'), 'step indicators supported');
check(!card.includes('useGameStore'), 'card does not read Zustand');
check(!card.includes('markContextualGuide'), 'card does not mutate guide state');
check(!card.includes('Modal'), 'card is not a full-screen Modal');
check(!card.includes('Spotlight'), 'card has no spotlight hole');
check(card.includes("backgroundColor: LIGHT_SURFACE") || card.includes("LIGHT_SURFACE"), 'light card surface');
check(card.includes('bottomOffset'), 'tab-bar bottomOffset support');
check(card.includes('MIN_TOUCH_TARGET'), 'minimum touch targets');

console.log('\nIcon map');
check(icons.includes("help: 'help-circle-outline'"), 'help icon registered');
for (const id of CONTEXTUAL_GUIDE_CARD_IDS) {
  check(Boolean(CONTEXTUAL_GUIDE_CARD_ICONS[id]), `icon mapped for ${id}`);
}
check(getContextualGuideCardIcon('welcome') === 'map', 'welcome → map');
check(getContextualGuideCardIcon('choose_contract') === 'contract', 'contract icon');
check(getContextualGuideCardIcon('manage_fleet') === 'truck', 'fleet icon');
check(getContextualGuideCardIcon('follow_route') === 'route', 'route icon');
check(getContextualGuideCardIcon('need_help') === 'help', 'help icon');

console.log('\nHelp & Guide entry + shell');
check(more.includes('Yardım & Rehber'), 'MoreScreen menu entry label');
check(more.includes("setRoute('help')"), 'menu opens help route');
check(more.includes("| 'help'"), 'MoreRoute includes help');
check(more.includes('HelpGuideScreen'), 'HelpGuideScreen lazy import');
check(more.includes("route === 'help'"), 'help route branch');
check(helpScreen.includes('Yardım & Rehber'), 'Help screen title');
check(helpScreen.includes('onBack'), 'Help screen back navigation');
check(helpScreen.includes('HELP_GUIDE_SECTIONS'), 'data-driven sections');
check(helpScreen.includes('AppScreen'), 'Help uses AppScreen');
check(helpScreen.includes('ScreenHeader'), 'Help uses ScreenHeader');

console.log('\nHelp sections metadata');
const expectedSections: HelpGuideSectionId[] = [
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
check(HELP_GUIDE_SECTIONS.length === expectedSections.length, '11 help sections');
for (const id of expectedSections) {
  check(
    HELP_GUIDE_SECTIONS.some((section) => section.id === id),
    `section ${id} present`,
  );
}

console.log('\nNavigation');
const helpPending: PendingMoreSubRoute = 'help';
check(resolveMoreScreenRoute(helpPending) === 'help', 'pending help resolves to help');
check(resolveMoreScreenRoute('menu') === 'menu', 'menu still resolves');

console.log('\nPersistence / ads / legacy untouched');
check(
  foundation.includes("status: 'eligible' | 'active' | 'dismissed' | 'completed'") ||
    foundation.includes("CONTEXTUAL_GUIDE_VERSION = 1"),
  'Step 2 foundation module unchanged in role',
);
check(saveGame.includes('resolveContextualGuideFromSave'), 'save normalization still present');
check(adGrants.includes('hasCompletedOnboarding'), 'ads gate still uses onboarding');
check(!card.includes('hasCompletedOnboarding'), 'card does not touch ads gate');
check(
  !/AppTutorial|Spotlight|disableTutorialForSession/.test(more),
  'MoreScreen has no legacy tutorial tooling',
);

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
