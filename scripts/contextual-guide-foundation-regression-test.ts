/**
 * Phase 6 Step 2 — Contextual Guide foundation regression.
 * Run: npx tsx scripts/contextual-guide-foundation-regression-test.ts
 */

import './test-globals';

import assert from 'node:assert/strict';

import {
  buildContextualGuideProgressSignals,
  classifyContextualGuideCohort,
  completeContextualGuideState,
  CONTEXTUAL_GUIDE_CARD_IDS,
  CONTEXTUAL_GUIDE_VERSION,
  createEligibleContextualGuideState,
  createSkippedAutoContextualGuideState,
  dismissContextualGuideCardState,
  dismissContextualGuideState,
  hasExistingPlayerProgress,
  markContextualGuideCardCompletedState,
  normalizeContextualGuideState,
  resetContextualGuideForReplayState,
  resolveContextualGuideFromSave,
  shouldAutoPresentContextualGuide,
} from '../src/contextualGuide/contextualGuideState';
import { hasLegacyTutorialActivityFromRawSave } from '../src/contextualGuide/legacyTutorialSaveSignals';
import { createDefaultOnboardingState } from '../src/onboarding/onboardingProgress';
import {
  normalizeSavePayload,
  payloadToStoreState,
  serializeGameState,
  type SaveGamePayload,
} from '../src/storage/saveGame';
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

function baseSignals(
  overrides: Partial<ReturnType<typeof buildContextualGuideProgressSignals>> = {},
) {
  return {
    completedContracts: 0,
    activeDeliveryCount: 0,
    deliveryStarted: false,
    tradePurchased: false,
    playerLevel: 1,
    tutorialCompleted: false,
    onboardingCompleted: false,
    legacyTutorialActivity: false,
    ...overrides,
  };
}

function minimalPayload(
  overrides: Partial<SaveGamePayload> & Record<string, unknown> = {},
): Partial<SaveGamePayload> & Record<string, unknown> {
  return {
    version: 6,
    currentTime: 0,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'Test Co',
      money: 20_000,
      level: 1,
      companyLevel: 1,
      xp: 0,
      xpToNextLevel: 100,
      totalXp: 0,
      homeCityId: 'izmir',
      reputation: 50,
      completedContracts: 0,
      failedDeliveries: 0,
      lateDeliveries: 0,
      trucks: [],
      trailers: [],
      drivers: [],
      warehouses: [],
      ...(overrides.player as object),
    },
    ...overrides,
  };
}

console.log('\n=== Contextual Guide Foundation Regression ===\n');

console.log('Constants');
check(CONTEXTUAL_GUIDE_VERSION === 1, 'guide version is 1');
check(CONTEXTUAL_GUIDE_CARD_IDS.length === 5, 'five stable card IDs');
check(
  CONTEXTUAL_GUIDE_CARD_IDS.join(',') ===
    'welcome,choose_contract,manage_fleet,follow_route,need_help',
  'card ID order stable',
);

console.log('\n1. Fresh save → eligible');
{
  const guide = resolveContextualGuideFromSave(undefined, baseSignals());
  check(guide.status === 'eligible', 'fresh → eligible');
  check(shouldAutoPresentContextualGuide(guide), 'eligible may auto-present later');
  check(classifyContextualGuideCohort(undefined, baseSignals()) === 'new_player', 'cohort new');
}

console.log('\n2–7. Existing player signals → no auto guide');
{
  const cases: Array<[string, ReturnType<typeof baseSignals>]> = [
    ['level > 1', baseSignals({ playerLevel: 2 })],
    ['completed contract', baseSignals({ completedContracts: 1 })],
    ['active delivery', baseSignals({ activeDeliveryCount: 1 })],
    ['deliveryStarted', baseSignals({ deliveryStarted: true })],
    ['tradePurchased', baseSignals({ tradePurchased: true })],
    ['legacy tutorial completed', baseSignals({ tutorialCompleted: true })],
    ['onboarding.completed', baseSignals({ onboardingCompleted: true })],
    [
      'legacy tutorial activity',
      baseSignals({ legacyTutorialActivity: true }),
    ],
  ];
  for (const [label, signals] of cases) {
    const guide = resolveContextualGuideFromSave(undefined, signals);
    check(hasExistingPlayerProgress(signals), `${label}: detected as existing`);
    check(guide.status === 'dismissed', `${label}: status dismissed (no auto)`);
    check(!shouldAutoPresentContextualGuide(guide), `${label}: no auto-present`);
  }
}

console.log('\nLegacy tutorial save signal helper');
{
  check(!hasLegacyTutorialActivityFromRawSave({}), 'empty raw save inactive');
  check(
    hasLegacyTutorialActivityFromRawSave({
      tutorialProgress: {
        dashboard: { version: 1, hasBeenPresented: true, status: 'completed' },
      },
    }),
    'legacy tutorialProgress entry counts',
  );
  check(
    hasLegacyTutorialActivityFromRawSave({ marketTutorialCompleted: true }),
    'legacy marketTutorialCompleted counts',
  );
  check(
    hasLegacyTutorialActivityFromRawSave({
      spotlightTutorial: { completedIds: ['first_contract'], skippedIds: [] },
    }),
    'legacy spotlight completion counts',
  );
}

console.log('\nLegacy tutorial keys are dropped from save payloads');
{
  const legacy = normalizeSavePayload(
    minimalPayload({
      marketTutorialCompleted: true,
      marketTutorialVersion: 2,
      spotlightTutorial: { completedIds: ['first_contract'], skippedIds: [] },
      tutorialProgress: { dashboard: { version: 1, hasBeenPresented: true } },
    }),
  );
  const legacyRecord = legacy as unknown as Record<string, unknown>;
  check(
    legacy.contextualGuide?.status === 'dismissed',
    'legacy tutorial activity → no auto guide',
  );
  check(
    !('spotlightTutorial' in legacyRecord) &&
      !('marketTutorialCompleted' in legacyRecord) &&
      !('marketTutorialVersion' in legacyRecord) &&
      !('tutorialProgress' in legacyRecord),
    'legacy tutorial keys not re-persisted',
  );

  const serialized = serializeGameState(payloadToStoreState(legacy)) as unknown as Record<
    string,
    unknown
  >;
  check(
    !('spotlightTutorial' in serialized) &&
      !('marketTutorialCompleted' in serialized) &&
      !('tutorialProgress' in serialized),
    'serializeGameState omits legacy tutorial keys',
  );
}

console.log('\n8. Existing contextualGuide preserved');
{
  const raw = {
    version: 1,
    status: 'active' as const,
    completedCardIds: ['welcome' as const],
    dismissedCardIds: ['need_help' as const],
  };
  const guide = resolveContextualGuideFromSave(
    raw,
    baseSignals({ completedContracts: 5, playerLevel: 9 }),
  );
  check(guide.status === 'active', 'preserves active status');
  check(guide.completedCardIds.includes('welcome'), 'preserves completed cards');
  check(guide.dismissedCardIds.includes('need_help'), 'preserves dismissed cards');
  check(
    classifyContextualGuideCohort(raw, baseSignals()) === 'has_guide_state',
    'cohort has_guide_state',
  );
}

console.log('\n9–10. Idempotent card mutations');
{
  let guide = createEligibleContextualGuideState();
  guide = markContextualGuideCardCompletedState(guide, 'welcome');
  guide = markContextualGuideCardCompletedState(guide, 'welcome');
  check(guide.completedCardIds.length === 1, 'complete twice → one id');
  check(guide.status === 'active', 'first card moves eligible → active');

  guide = dismissContextualGuideCardState(guide, 'choose_contract');
  guide = dismissContextualGuideCardState(guide, 'choose_contract');
  check(guide.dismissedCardIds.length === 1, 'dismiss twice → one id');

  const completed = completeContextualGuideState(guide);
  check(completed.status === 'completed', 'completeContextualGuide');
  check(completeContextualGuideState(completed) === completed, 'complete idempotent');

  const dismissed = dismissContextualGuideState(guide);
  check(dismissed.status === 'dismissed', 'dismissContextualGuide');
  check(dismissContextualGuideState(dismissed) === dismissed, 'dismiss idempotent');
}

console.log('\nReplay helper');
{
  const replay = resetContextualGuideForReplayState(
    createSkippedAutoContextualGuideState(),
  );
  check(replay.status === 'active', 'replay → active');
  check(replay.completedCardIds.length === 0, 'replay clears completed');
  check(replay.dismissedCardIds.length === 0, 'replay clears dismissed');
}

console.log('\n11–13. Save normalize / account isolation / guest / cloud');
{
  const fresh = normalizeSavePayload(minimalPayload());
  check(fresh.contextualGuide?.status === 'eligible', 'normalize fresh → eligible');

  const leveled = normalizeSavePayload(
    minimalPayload({
      player: {
        companyName: 'Old Co',
        money: 50_000,
        level: 3,
        companyLevel: 3,
        xp: 10,
        xpToNextLevel: 100,
        totalXp: 10,
        homeCityId: 'izmir',
        reputation: 50,
        completedContracts: 0,
        failedDeliveries: 0,
        lateDeliveries: 0,
        trucks: [],
        trailers: [],
        drivers: [],
        warehouses: [],
      },
    }),
  );
  check(leveled.contextualGuide?.status === 'dismissed', 'level>1 old save → no auto');

  const contracted = normalizeSavePayload(
    minimalPayload({
      player: {
        companyName: 'Old Co',
        money: 50_000,
        level: 1,
        companyLevel: 1,
        xp: 0,
        xpToNextLevel: 100,
        totalXp: 0,
        homeCityId: 'izmir',
        reputation: 50,
        completedContracts: 2,
        failedDeliveries: 0,
        lateDeliveries: 0,
        trucks: [],
        trailers: [],
        drivers: [],
        warehouses: [],
      },
    }),
  );
  check(
    contracted.contextualGuide?.status === 'dismissed',
    'completed contracts → no auto',
  );

  const accountA = normalizeSavePayload(
    minimalPayload({
      contextualGuide: {
        version: 1,
        status: 'active',
        completedCardIds: ['welcome'],
        dismissedCardIds: [],
      },
    }),
  );
  const accountB = normalizeSavePayload(
    minimalPayload({
      contextualGuide: {
        version: 1,
        status: 'dismissed',
        completedCardIds: [],
        dismissedCardIds: [],
      },
    }),
  );
  check(
    accountA.contextualGuide?.status === 'active' &&
      accountA.contextualGuide.completedCardIds.includes('welcome'),
    'account A guide isolated',
  );
  check(
    accountB.contextualGuide?.status === 'dismissed' &&
      accountB.contextualGuide.completedCardIds.length === 0,
    'account B guide isolated',
  );

  const guestFresh = normalizeSavePayload(minimalPayload());
  check(guestFresh.contextualGuide?.status === 'eligible', 'guest fresh eligible');

  const cloudRestored = payloadToStoreState(
    normalizeSavePayload(
      minimalPayload({
        player: {
          companyName: 'Cloud Co',
          money: 80_000,
          level: 4,
          companyLevel: 4,
          xp: 20,
          xpToNextLevel: 100,
          totalXp: 20,
          homeCityId: 'izmir',
          reputation: 60,
          completedContracts: 3,
          failedDeliveries: 0,
          lateDeliveries: 0,
          trucks: [],
          trailers: [],
          drivers: [],
          warehouses: [],
        },
      }),
    ),
  );
  check(
    cloudRestored.contextualGuide.status === 'dismissed',
    'cloud progressed restore → no auto',
  );

  const roundTrip = serializeGameState(cloudRestored);
  check(
    roundTrip.contextualGuide?.status === 'dismissed',
    'serialize preserves contextualGuide',
  );
}

console.log('\n14–15. Ads / onboarding.completed unchanged');
{
  const onboarding = createDefaultOnboardingState();
  check(onboarding.completed === false, 'default onboarding incomplete');

  const blocked = canGrantAdReward(
    createDefaultMonetizationState(),
    'daily_ops_bonus',
    {
      currentGameTime: 100,
      playerLevel: 5,
      hasCompletedOnboarding: false,
    },
  );
  check(!blocked.ok, 'incomplete onboarding still blocks ads');

  const allowed = canGrantAdReward(
    createDefaultMonetizationState(),
    'daily_ops_bonus',
    {
      currentGameTime: 100,
      playerLevel: 5,
      hasCompletedOnboarding: true,
    },
  );
  check(allowed.ok, 'completed onboarding still allows ads');

  const guideComplete = completeContextualGuideState(createEligibleContextualGuideState());
  check(
    guideComplete.status === 'completed' && onboarding.completed === false,
    'contextual guide complete does not flip onboarding.completed',
  );
}

console.log('\nNormalize unknown card ids stripped');
{
  const normalized = normalizeContextualGuideState({
    version: 1,
    status: 'active',
    completedCardIds: ['welcome', 'not-a-card', 'welcome'] as never[],
    dismissedCardIds: ['manage_fleet'] as never[],
  });
  check(normalized.completedCardIds.length === 1, 'unknown/dupe cards stripped');
  check(normalized.dismissedCardIds[0] === 'manage_fleet', 'known dismiss kept');
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');

// Keep assert import used for intentional hard failures in future expansion.
assert.equal(CONTEXTUAL_GUIDE_VERSION, 1);
