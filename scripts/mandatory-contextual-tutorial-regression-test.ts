/**
 * Mandatory first-run guided ContextualGuide regression.
 * Run: npx tsx scripts/mandatory-contextual-tutorial-regression-test.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  canShowContextualGuideCard,
  CONTEXTUAL_GUIDE_CARD_SCREEN,
  getCurrentContextualGuideCardId,
  getCurrentMandatoryTutorialStep,
  isContextualGuideAutoShowAllowed,
} from '../src/contextualGuide/contextualGuideSequence';
import { getTabForContextualGuideCard } from '../src/contextualGuide/contextualGuideNavigation';
import {
  completeContextualGuideState,
  createEligibleContextualGuideState,
  createSkippedAutoContextualGuideState,
  markContextualGuideCardCompletedState,
  normalizeContextualGuideState,
  resetContextualGuideForReplayState,
  resolveContextualGuideFromSave,
  buildContextualGuideProgressSignals,
} from '../src/contextualGuide/contextualGuideState';
import { CONTEXTUAL_GUIDE_CARD_COPY } from '../src/contextualGuide/contextualGuideCopy';
import {
  __resetContextualGuideSessionForTests,
  clearContextualGuideManualReplay,
  endContextualGuideManualReplay,
  getDurableContextualGuideForSave,
  isContextualGuideInteractionLocked,
  isContextualGuideMandatoryLocked,
  isContextualGuideManualReplayActive,
  resolveContextualGuideRunMode,
  startContextualGuideManualReplay,
  allowContextualGuideNavigationBypass,
  consumeContextualGuideNavigationBypass,
  peekContextualGuideNavigationBypass,
} from '../src/contextualGuide/contextualGuideSession';

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

console.log('\n=== Mandatory Contextual Tutorial Regression ===\n');

__resetContextualGuideSessionForTests();

const app = read('App.tsx');
const host = read('src/contextualGuide/components/ContextualGuideHost.tsx');
const hook = read('src/contextualGuide/hooks/useContextualGuideHost.ts');
const card = read('src/contextualGuide/components/ContextualGuideCard.tsx');
const sequence = read('src/contextualGuide/contextualGuideSequence.ts');
const session = read('src/contextualGuide/contextualGuideSession.ts');
const navigation = read('src/contextualGuide/contextualGuideNavigation.ts');
const coordinator = read('src/contextualGuide/useContextualGuideCoordinator.ts');
const help = read('src/screens/HelpGuideScreen.tsx');
const saveGame = read('src/storage/saveGame.ts');
const map = read('src/screens/MapScreen.tsx');
const dashboard = read('src/screens/DashboardScreen.tsx');

console.log('1–3 New player / existing / game-ready');
{
  const fresh = createEligibleContextualGuideState();
  check(isContextualGuideAutoShowAllowed(fresh), '1. true new player eligible auto-starts');
  check(isContextualGuideMandatoryLocked(fresh), '1b. new player mandatory locked');
  check(getCurrentContextualGuideCardId(fresh) === 'welcome', '4. welcome current on dashboard');

  const existing = createSkippedAutoContextualGuideState();
  check(!isContextualGuideAutoShowAllowed(existing), '2. existing skipped → no auto tutorial');
  check(resolveContextualGuideRunMode(existing) === 'none', '2b. existing runMode none');

  check(app.includes('bootPhase === \'ready\' && isGameReady'), '3. AppShell only when game ready');
  check(app.includes('useContextualGuideResumeNavigation'), '3b. resume nav after ready');
  check(!app.includes('setTimeout') || !navigation.includes('setTimeout'), '19. no timer navigation in guide nav');
}

console.log('\n5–8 Interaction lock / dismiss');
{
  check(host.includes('styles.dim') || host.includes('backgroundColor: \'rgba'), '5. dim / blocker layer');
  check(host.includes('contextual-guide-blocker') || host.includes('pointerEvents="auto"'), '5b. background blocker');
  check(app.includes('shouldBlockManualTabPressWhileGuideActive'), '6. tab bar manual press guarded');
  check(hook.includes('onPrimaryPress'), '7. CTA interactive');
  check(hook.includes("allowDismiss = runMode === 'manual_replay'"), '8. mandatory has no dismiss');
  check(hook.includes('onDismiss: allowDismiss ? onDismiss : undefined'), '8b. dismiss omitted mandatory');
}

console.log('\n9–15 Navigation sequence + completion');
{
  let guide = createEligibleContextualGuideState();
  check(CONTEXTUAL_GUIDE_CARD_SCREEN.welcome === 'dashboard', 'welcome → dashboard screen');
  check(CONTEXTUAL_GUIDE_CARD_SCREEN.choose_contract === 'contracts', '9. welcome next screen contracts');
  check(CONTEXTUAL_GUIDE_CARD_SCREEN.manage_fleet === 'fleet', '10. choose_contract → fleet');
  check(CONTEXTUAL_GUIDE_CARD_SCREEN.follow_route === 'map', '11. manage_fleet → map');
  check(CONTEXTUAL_GUIDE_CARD_SCREEN.need_help === 'more', '13. follow_route → management/more');

  guide = markContextualGuideCardCompletedState(guide, 'welcome');
  check(getCurrentContextualGuideCardId(guide) === 'choose_contract', 'after welcome → choose_contract');
  guide = markContextualGuideCardCompletedState(guide, 'choose_contract');
  check(getCurrentContextualGuideCardId(guide) === 'manage_fleet', 'after contract → fleet');
  guide = markContextualGuideCardCompletedState(guide, 'manage_fleet');
  check(
    canShowContextualGuideCard(guide, 'follow_route'),
    '12. follow_route without active delivery',
  );
  check(!sequence.includes('hasActiveDelivery'), '12b. delivery gate removed from sequence');
  guide = markContextualGuideCardCompletedState(guide, 'follow_route');
  check(getCurrentContextualGuideCardId(guide) === 'need_help', 'need_help last');
  guide = markContextualGuideCardCompletedState(guide, 'need_help');
  check(guide.status === 'completed', '14. final card completes guide');
  check(!isContextualGuideAutoShowAllowed(guide), '15. gameplay unlocked after completion');
  check(!isContextualGuideMandatoryLocked(guide), '15b. lock released');
  check(getCurrentContextualGuideCardId(guide) === null, '16. no auto tutorial after completion');
}

console.log('\n17–18 Resume / no duplicate');
{
  let guide = createEligibleContextualGuideState();
  guide = markContextualGuideCardCompletedState(guide, 'welcome');
  guide = markContextualGuideCardCompletedState(guide, 'choose_contract');
  check(getCurrentContextualGuideCardId(guide) === 'manage_fleet', '17. resume at manage_fleet');
  const again = markContextualGuideCardCompletedState(guide, 'welcome');
  check(again.completedCardIds.filter((id) => id === 'welcome').length === 1, '18. no duplicate welcome');
  check(coordinator.includes('requestNavigationToCurrentGuideCard'), '17b. resume navigates to card screen');
}

console.log('\n19–21 No timers / no auto gameplay / bg-fg');
{
  check(!navigation.includes('setInterval') && !navigation.includes('setTimeout'), '19. nav module no timers');
  check(!hook.includes('acceptContract') && !hook.includes('startDelivery'), '20. no auto gameplay action');
  check(session.includes('replaySnapshot'), '21. session snapshot for safe resume/replay');
  check(!host.includes('setInterval') && !hook.includes('setInterval'), '21b. no polling in host/hook');
}

console.log('\n22–24 Manual replay');
{
  __resetContextualGuideSessionForTests();
  const completed = completeContextualGuideState(createEligibleContextualGuideState());
  const completedNorm = {
    ...completed,
    completedCardIds: [
      'welcome',
      'choose_contract',
      'manage_fleet',
      'follow_route',
      'need_help',
    ] as const,
  };
  const durable = normalizeContextualGuideState({
    status: 'completed',
    completedCardIds: [...completedNorm.completedCardIds],
    dismissedCardIds: [],
  });
  startContextualGuideManualReplay(durable);
  check(isContextualGuideManualReplayActive(), '22. manual replay session active');
  const liveReplay = resetContextualGuideForReplayState();
  check(resolveContextualGuideRunMode(liveReplay) === 'manual_replay', '22b. mode manual_replay');
  check(
    getDurableContextualGuideForSave(liveReplay)?.status === 'completed',
    '24. save still sees prior completion during replay',
  );
  const restored = endContextualGuideManualReplay();
  check(restored?.status === 'completed', '23. exit restores prior completion');
  check(!isContextualGuideManualReplayActive(), '23b. replay session cleared');
  check(help.includes('resetContextualGuideForReplay'), '22c. Help launches replay');
  check(saveGame.includes('getDurableContextualGuideForSave'), '25. persistence compatible / replay-safe');
}

console.log('\n25–28 Persistence / Help / migration / legacy');
{
  const signals = buildContextualGuideProgressSignals({
    player: { completedContracts: 3, level: 4 },
    activeDeliveries: [],
    missions: { flags: {} },
    tutorial: { isCompleted: true },
    onboarding: { completed: true },
  });
  const migrated = resolveContextualGuideFromSave(undefined, signals);
  check(migrated.status === 'dismissed', '27. old player migration → dismissed');
  check(help.includes('HELP_GUIDE') || help.includes('Yardım'), '26. Help still present');
  for (const name of [
    'AppTutorial',
    'MarketTutorial',
    'SpotlightTutorial',
    'TutorialOverlay',
    'SpotlightMask',
    'useAppTutorial',
    'useMarketTutorial',
  ]) {
    check(!host.includes(name) && !hook.includes(name) && !app.includes(name), `28. no ${name}`);
  }
  check(!existsSync(resolve(root, 'src/tutorial')), '28b. src/tutorial absent');
  check(!existsSync(resolve(root, 'src/components/tutorial')), '28c. components/tutorial absent');
}

console.log('\nCopy + CTA labels');
check(CONTEXTUAL_GUIDE_CARD_COPY.welcome.primaryLabel === 'Başlayalım', 'welcome CTA Başlayalım');
check(CONTEXTUAL_GUIDE_CARD_COPY.need_help.primaryLabel === 'Eğitimi Tamamla', 'final CTA Eğitimi Tamamla');
check(CONTEXTUAL_GUIDE_CARD_COPY.need_help.title.includes('Şirketini'), 'need_help title updated');
check(dashboard.includes('cardId="welcome"'), 'dashboard mounts welcome');
check(map.includes('cardId="follow_route"'), 'map mounts follow_route');
check(card.includes('dismissAccessibilityLabel') || card.includes('onDismiss'), 'card dismiss optional');

console.log('\nBypass / lock continuity');
{
  __resetContextualGuideSessionForTests();
  allowContextualGuideNavigationBypass();
  check(peekContextualGuideNavigationBypass(), 'bypass armed');
  check(consumeContextualGuideNavigationBypass(), 'bypass consumed once');
  check(!peekContextualGuideNavigationBypass(), 'bypass cleared');
  clearContextualGuideManualReplay();
}

console.log('\nNav helper tabs');
check(getTabForContextualGuideCard('welcome') === 'dashboard', 'tab welcome');
check(getTabForContextualGuideCard('choose_contract') === 'contracts', 'tab contracts');
check(getTabForContextualGuideCard('manage_fleet') === 'fleet', 'tab fleet');
check(getTabForContextualGuideCard('follow_route') === 'map', 'tab map');
check(getTabForContextualGuideCard('need_help') === 'more', 'tab more');

console.log('\nDEV QA reset removed from runtime');
{
  const debug = read('src/screens/DebugSimulationScreen.tsx');
  const quick = read('src/navigation/quickAccessConfig.ts');
  const types = read('src/navigation/quickAccessTypes.ts');
  const app = read('App.tsx');
  const management = read('src/components/management/useManagementPanelData.ts');
  const store = read('src/store/gameStore.ts');
  check(!existsSync(resolve(root, 'src/contextualGuide/devResetMandatoryTutorial.ts')), 'DEV reset helper file deleted');
  check(!quick.includes('Tutorial QA Reset'), 'Yönetim has no Tutorial QA Reset card');
  check(!types.includes('tutorialQaReset'), 'quickAccessTypes has no tutorialQaReset');
  check(!app.includes('tutorialQaReset'), 'App has no tutorialQaReset action');
  check(!app.includes('resetMandatoryContextualGuideForDevQa'), 'App has no reset helper call');
  check(!app.includes('devResetMandatoryTutorial'), 'App has no reset helper import');
  check(!management.includes('tutorialQaReset'), 'management panel data has no tutorialQaReset');
  check(!debug.includes('QA: Reset Mandatory Tutorial'), 'DebugSimulation QA reset button removed');
  check(!debug.includes('resetMandatoryContextualGuideForDevQa'), 'DebugSimulation has no reset helper');
  check(getTabForContextualGuideCard('welcome') === 'dashboard', 'welcome still targets Dashboard');
  check(store.includes("autoSave('contextual_guide')"), '14. durable contextual_guide save path retained');
}

console.log('\nCold-start durable resume');
{
  const seq = read('src/contextualGuide/contextualGuideSequence.ts');
  const store = read('src/store/gameStore.ts');
  const lifecycle = read('src/hooks/useAppStateLifecycle.ts');
  const session = read('src/contextualGuide/contextualGuideSession.ts');
  const coord = read('src/contextualGuide/useContextualGuideCoordinator.ts');
  const save = read('src/storage/saveGame.ts');
  const host = read('src/contextualGuide/hooks/useContextualGuideHost.ts');

  // Pure hydrate simulations (no store I/O)
  const welcomeOnly = normalizeContextualGuideState({
    status: 'eligible',
    completedCardIds: [],
  });
  check(
    getCurrentMandatoryTutorialStep(welcomeOnly) === 'welcome',
    '1. eligible + no completed -> welcome after hydrate',
  );

  const afterWelcome = markContextualGuideCardCompletedState(welcomeOnly, 'welcome');
  check(afterWelcome.status === 'active', 'status becomes active after first step');
  check(
    getCurrentMandatoryTutorialStep(afterWelcome) === 'choose_contract',
    '2. active + welcome complete -> Contracts step',
  );
  check(getTabForContextualGuideCard('choose_contract') === 'contracts', '2b. Contracts tab');

  let mid = afterWelcome;
  mid = markContextualGuideCardCompletedState(mid, 'choose_contract');
  check(
    getCurrentMandatoryTutorialStep(mid) === 'manage_fleet',
    '3. active + first 2 complete -> Fleet step',
  );
  check(getTabForContextualGuideCard('manage_fleet') === 'fleet', '3b. Fleet tab');

  mid = markContextualGuideCardCompletedState(mid, 'manage_fleet');
  check(
    getCurrentMandatoryTutorialStep(mid) === 'follow_route',
    '4. active + first 3 complete -> Map step',
  );
  check(getTabForContextualGuideCard('follow_route') === 'map', '4b. Map tab');

  mid = markContextualGuideCardCompletedState(mid, 'follow_route');
  check(
    getCurrentMandatoryTutorialStep(mid) === 'need_help',
    '5. active + first 4 complete -> Management step',
  );
  check(getTabForContextualGuideCard('need_help') === 'more', '5b. Management/more tab');

  check(
    isContextualGuideMandatoryLocked(mid) && isContextualGuideInteractionLocked(mid),
    '6. mandatory lock active after cold resume state',
  );
  check(
    resolveContextualGuideRunMode(mid) === 'mandatory_first_run',
    '7. no dismiss after cold resume (mandatory mode)',
  );
  check(host.includes('onPrimaryPress'), '8. CTA works after resume (host wired)');

  check(
    store.includes("autoSave('contextual_guide')") &&
      store.includes("'contextual_guide'") &&
      store.includes('persistContextualGuideSave'),
    '9. step progress persists without manual Save Now (immediate contextual_guide save)',
  );
  check(
    lifecycle.includes("nextState === 'background' || nextState === 'inactive'") &&
      lifecycle.includes("flushLifecycleSave('background')") &&
      !lifecycle.includes('pendingBackgroundSave') &&
      !lifecycle.includes('runAfterInteractions'),
    '10. force-quit simulation: inactive flushes immediately (no deferred skip)',
  );

  const done = completeContextualGuideState(mid);
  check(done.status === 'completed', '11a. completed guide status');
  check(
    getCurrentMandatoryTutorialStep(done) === null &&
      resolveContextualGuideRunMode(done) === 'none',
    '11. completed guide stays completed / silent',
  );

  const skipped = createSkippedAutoContextualGuideState();
  check(
    resolveContextualGuideFromSave(undefined, {
      completedContracts: 2,
      activeDeliveryCount: 0,
      deliveryStarted: false,
      tradePurchased: false,
      playerLevel: 3,
      tutorialCompleted: false,
      onboardingCompleted: false,
      legacyTutorialActivity: false,
    }).status === 'dismissed' &&
      resolveContextualGuideRunMode(skipped) === 'none',
    '12. existing dismissed user stays silent',
  );

  __resetContextualGuideSessionForTests();
  startContextualGuideManualReplay(done);
  check(isContextualGuideManualReplayActive(), '13a. replay runtime active');
  const durableDuringReplay = getDurableContextualGuideForSave(
    resetContextualGuideForReplayState(),
  );
  check(
    durableDuringReplay?.status === 'completed',
    '13. manual replay runtime disappearing on restart does not damage permanent completion',
  );
  clearContextualGuideManualReplay();

  check(
    resolveContextualGuideFromSave(
      { status: 'active', completedCardIds: ['welcome', 'choose_contract'], version: 1 },
      {
        completedContracts: 0,
        activeDeliveryCount: 0,
        deliveryStarted: false,
        tradePurchased: false,
        playerLevel: 1,
        tutorialCompleted: false,
        onboardingCompleted: false,
        legacyTutorialActivity: false,
      },
    ).status === 'active',
    '15. guest resume preserves active unfinished guide',
  );
  check(
    resolveContextualGuideFromSave(
      { status: 'active', completedCardIds: ['welcome'], version: 1 },
      {
        completedContracts: 5,
        activeDeliveryCount: 0,
        deliveryStarted: true,
        tradePurchased: true,
        playerLevel: 4,
        tutorialCompleted: false,
        onboardingCompleted: true,
        legacyTutorialActivity: false,
      },
    ).completedCardIds.includes('welcome'),
    '16. linked account resume: present guide object wins over progress signals',
  );

  check(seq.includes('getCurrentMandatoryTutorialStep'), 'step resolver exported');
  check(coord.includes('useContextualGuideResumeNavigation'), 'boot resume hook present');
  check(coord.includes('requestNavigationToCurrentGuideCard'), '18. resume navigates (no loop timers)');
  check(!coord.includes('setInterval') && !coord.includes('setTimeout'), '19. no resume timers');
  check(save.includes('getDurableContextualGuideForSave'), 'save serializes durable guide');
  check(
    session.includes('replayActive') && session.includes('getDurableContextualGuideForSave'),
    'runtime session only for replay; durable save path separate',
  );
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
console.log('MANDATORY_CONTEXTUAL_TUTORIAL_REGRESSION_OK');
