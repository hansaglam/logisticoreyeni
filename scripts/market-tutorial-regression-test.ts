/**
 * Market tutorial regression tests.
 * Run: npx tsx scripts/market-tutorial-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import { MARKET_TUTORIAL_VERSION } from '../src/config/marketTutorial';
import {
  MARKET_TUTORIAL_FULL_STEPS,
  MARKET_TUTORIAL_SHORT_STEPS,
  getMarketTutorialSteps,
  resolveMarketTutorialStepTargetId,
} from '../src/components/market/marketTutorialSteps';
import {
  computeTooltipLayout,
  isMeaningfullyDifferentRect,
  normalizeTutorialRect,
  POSITION_EPSILON_PX,
} from '../src/components/market/marketTutorialLayout';
import {
  createCompletedMarketTutorialState,
  normalizeMarketTutorialState,
  resolveMarketTutorialMarketState,
  shouldAutoStartMarketTutorial,
} from '../src/tutorial/marketTutorialState';

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

console.log('\n=== Market Tutorial Regression ===\n');

console.log('Config');
assert(MARKET_TUTORIAL_VERSION === 1, 'tutorial version is 1');
assert(MARKET_TUTORIAL_FULL_STEPS.length === 7, 'full flow has 7 steps');
assert(MARKET_TUTORIAL_SHORT_STEPS.length === 3, 'unavailable flow has 3 steps');

console.log('\nStep order');
{
  const ids = MARKET_TUTORIAL_FULL_STEPS.map((step) => step.id);
  assert(ids[0] === 'city-select', 'step 1 city-select');
  assert(ids[1] === 'stock-status', 'step 2 stock-status');
  assert(ids[6] === 'finish', 'step 7 finish');
  assert(
    MARKET_TUTORIAL_FULL_STEPS[6].primaryLabel === 'Piyasayı Keşfet',
    'final CTA label',
  );
}

console.log('\nAuto-start rules');
{
  assert(
    shouldAutoStartMarketTutorial({ marketTutorialCompleted: false, marketTutorialVersion: 0 }),
    'first entry auto-starts',
  );
  assert(
    !shouldAutoStartMarketTutorial(createCompletedMarketTutorialState()),
    'completed current version does not auto-start',
  );
  assert(
    !shouldAutoStartMarketTutorial({
      marketTutorialCompleted: true,
      marketTutorialVersion: 0,
    }),
    'completed old version does not auto-start after bump',
  );
}

console.log('\nPersistence');
{
  const normalized = normalizeMarketTutorialState({
    marketTutorialCompleted: true,
    marketTutorialVersion: 99,
  });
  assert(normalized.marketTutorialCompleted === true, 'complete flag preserved');
  assert(normalized.marketTutorialVersion === 99, 'version preserved');

  const completed = createCompletedMarketTutorialState();
  assert(completed.marketTutorialCompleted === true, 'complete helper sets true');
  assert(completed.marketTutorialVersion === MARKET_TUTORIAL_VERSION, 'complete helper sets version');
}

console.log('\nMarket state routing');
{
  assert(
    resolveMarketTutorialMarketState({
      citiesAvailable: true,
      hasSnapshot: true,
      fetchUiStatus: 'success',
    }) === 'live',
    'live market uses full steps',
  );
  assert(
    resolveMarketTutorialMarketState({
      citiesAvailable: true,
      hasSnapshot: true,
      fetchUiStatus: 'stale',
    }) === 'cached',
    'cached market detected',
  );
  assert(
    resolveMarketTutorialMarketState({
      citiesAvailable: false,
      hasSnapshot: false,
      fetchUiStatus: 'error',
    }) === 'unavailable',
    'unavailable market detected',
  );
  assert(getMarketTutorialSteps('unavailable').length === 3, 'unavailable uses short flow');
  assert(
    resolveMarketTutorialStepTargetId('buy', 'fruit') === 'market-product-buy:fruit',
    'buy step resolves product-scoped target',
  );
  assert(
    getMarketTutorialSteps('live', 'fruit')[3].targetId === 'market-product-buy:fruit',
    'full flow buy step uses snapshot product target',
  );
}

console.log('\nTransition state machine');
{
  const hook = readFileSync('src/hooks/useAppTutorial.ts', 'utf8');
  const overlay = readFileSync('src/components/market/MarketTutorialOverlay.tsx', 'utf8');
  const screen = readFileSync('src/screens/MarketScreen.tsx', 'utf8');

  assert(hook.includes('TutorialTransitionState'), 'transition state type used');
  assert(hook.includes('requestStepChange'), 'requestStepChange action');
  assert(hook.includes('transitionLockRef'), 're-entry lock ref');
  assert(hook.includes('transitionSequenceRef'), 'async sequence token');
  assert(hook.includes('transitionId !== transitionSequenceRef.current'), 'stale async ignored');
  assert(hook.includes('setStepIndex(index)'), 'step committed after prepare');
  assert(hook.includes('measureTutorialTargetInOverlaySpace'), 'overlay-space measurement');
  assert(hook.includes('overlayRootRef'), 'overlay root ref wired');
  assert(hook.includes('waitForScrollSettle'), 'scroll completion waiter');
  assert(!hook.includes('setInterval'), 'no periodic timer in hook');
  assert(!overlay.includes('setInterval'), '600ms interval removed from overlay');
  assert(overlay.includes('onRequestStepChange'), 'overlay uses requestStepChange');
  assert(overlay.includes('controlsDisabled'), 'buttons disabled while transitioning');
  assert(overlay.includes('Hazırlanıyor'), 'preparing label on slow transitions');
  assert(overlay.includes('spotlightVisible'), 'spotlight hidden during transition');
  assert(overlay.includes('pressLockRef'), 'onPress re-entry guard');
  assert(screen.includes('buildMarketProductTargetId'), 'product-scoped market targets');
  assert(screen.includes('onMomentumScrollEnd'), 'iOS scroll end wired');
  assert(screen.includes('onScrollEndDrag'), 'Android scroll end wired');
}

console.log('\nTooltip stability');
{
  const rectA = normalizeTutorialRect({ x: 10.2, y: 20.4, width: 100.1, height: 40.8 });
  const rectB = normalizeTutorialRect({ x: 10, y: 20, width: 100, height: 41 });
  assert(rectA.x === 10 && rectA.y === 20, 'rect coordinates rounded');
  assert(
    !isMeaningfullyDifferentRect(rectA, rectB, POSITION_EPSILON_PX),
    'sub-epsilon rect change ignored',
  );
  assert(
    isMeaningfullyDifferentRect(rectA, { ...rectA, y: rectA.y + 10 }, POSITION_EPSILON_PX),
    'meaningful rect change detected',
  );

  const anchor = { x: 40, y: 300, width: 120, height: 44 };
  const below = computeTooltipLayout({
    anchorRect: anchor,
    screenWidth: 390,
    screenHeight: 844,
    safeAreaTop: 44,
    safeAreaBottom: 34,
    tabBarHeight: 72,
    tooltipWidth: 320,
    tooltipHeight: 180,
    previousPlacement: 'below',
  });
  const jitter = computeTooltipLayout({
    anchorRect: { ...anchor, y: anchor.y + 1 },
    screenWidth: 390,
    screenHeight: 844,
    safeAreaTop: 44,
    safeAreaBottom: 34,
    tabBarHeight: 72,
    tooltipWidth: 320,
    tooltipHeight: 180,
    previousPlacement: below.placement,
  });
  assert(below.placement === 'below', 'default placement below target');
  assert(jitter.placement === 'below', '1px jitter does not flip placement');
}

console.log('\nAccessibility copy');
{
  assert(
    MARKET_TUTORIAL_FULL_STEPS.every((step) => step.title.length > 0 && step.description.length > 0),
    'all steps have title and description',
  );
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS\n');
