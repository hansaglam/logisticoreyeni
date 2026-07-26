/**
 * Onboarding V1 — smoke test harness.
 * Run: npx tsx scripts/onboarding-smoke-test.ts
 */

import './test-globals';

import { createDefaultMissionsState, STARTER_MISSION_IDS } from '../src/config/missions';
import {
  buildOnboardingEvaluationState,
  createDefaultOnboardingState,
  inferLegacyOnboardingFromSave,
  isOnboardingActive,
  markOnboardingAssignmentOpened,
  markOnboardingMissionRewardClaimed,
  markOnboardingScreenVisited,
  normalizeOnboardingState,
  resetOnboardingForTesting,
  resolveOnboardingDashboardAction,
  resolveOnboardingStep,
  syncOnboardingProgress,
} from '../src/onboarding/onboardingProgress';
import { migrateOnboardingStepId } from '../src/onboarding/onboardingConfig';
import type { Delivery, Player } from '../src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function createStarterPlayer(overrides: Partial<Player> = {}): Player {
  return {
    companyName: 'Test Co',
    money: 10_000,
    companyLevel: 1,
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    totalXp: 0,
    homeCityId: 'istanbul',
    reputation: 50,
    completedContracts: 0,
    trucks: [],
    drivers: [],
    warehouses: [],
    ...overrides,
  } as Player;
}

function evalState(
  onboarding: ReturnType<typeof createDefaultOnboardingState>,
  overrides: {
    activeDeliveries?: Delivery[];
    missions?: ReturnType<typeof createDefaultMissionsState>;
    player?: Player;
    currentTime?: number;
  } = {},
) {
  return buildOnboardingEvaluationState({
    onboarding,
    activeDeliveries: overrides.activeDeliveries ?? [],
    missions: overrides.missions ?? createDefaultMissionsState(),
    player: overrides.player ?? createStarterPlayer(),
    currentTime: overrides.currentTime ?? 0,
  });
}

console.log('\nOnboarding V1 smoke tests\n');

console.log('1. New save defaults');
{
  const onboarding = createDefaultOnboardingState();
  assert(onboarding.completed === false, 'new save not completed');
  assert(onboarding.currentStepId === 'choose_first_contract', 'starts at choose_first_contract');
  assert(isOnboardingActive(onboarding), 'onboarding active on new save');
  const action = resolveOnboardingDashboardAction(evalState(onboarding));
  assert(action?.title === 'İlk İşini Seç', 'dashboard action for step 1');
}

console.log('\n2. Contract assignment opened');
{
  let onboarding = createDefaultOnboardingState();
  onboarding = markOnboardingAssignmentOpened(onboarding);
  onboarding = syncOnboardingProgress(evalState(onboarding));
  assert(onboarding.currentStepId === 'assign_team', 'moves to assign_team');
}

console.log('\n3. Delivery started');
{
  let onboarding = markOnboardingAssignmentOpened(createDefaultOnboardingState());
  const missions = createDefaultMissionsState();
  missions.flags.deliveryStarted = true;
  onboarding = syncOnboardingProgress(
    evalState(onboarding, {
      missions,
      activeDeliveries: [{ id: 'd1' } as Delivery],
    }),
  );
  assert(onboarding.currentStepId === 'track_delivery', 'moves to track_delivery');
}

console.log('\n4. Map visited');
{
  let onboarding = markOnboardingAssignmentOpened(createDefaultOnboardingState());
  onboarding = markOnboardingScreenVisited(onboarding, 'Map');
  const missions = createDefaultMissionsState();
  missions.flags.deliveryStarted = true;
  onboarding = syncOnboardingProgress(
    evalState(onboarding, {
      missions,
      activeDeliveries: [{ id: 'd1' } as Delivery],
    }),
  );
  assert(onboarding.currentStepId === 'complete_first_delivery', 'moves to complete_first_delivery');
}

console.log('\n5. First delivery completed');
{
  let onboarding = markOnboardingAssignmentOpened(createDefaultOnboardingState());
  onboarding = markOnboardingScreenVisited(onboarding, 'Map');
  const missions = createDefaultMissionsState();
  missions.flags.deliveryStarted = true;
  onboarding = syncOnboardingProgress(
    evalState(onboarding, {
      missions,
      player: createStarterPlayer({ completedContracts: 1 }),
    }),
  );
  assert(onboarding.currentStepId === 'claim_first_reward', 'moves to claim_first_reward');
}

console.log('\n6. Reward claimed completes onboarding');
{
  let onboarding = markOnboardingAssignmentOpened(createDefaultOnboardingState());
  onboarding = markOnboardingMissionRewardClaimed(onboarding);
  onboarding = syncOnboardingProgress(
    evalState(onboarding, {
      player: createStarterPlayer({ completedContracts: 1 }),
    }),
  );
  assert(onboarding.completed === true, 'hasCompletedOnboarding after reward');
  assert(onboarding.currentStepId === null, 'currentStep null when completed');
  assert(!isOnboardingActive(onboarding), 'onboarding inactive after completion');
}

console.log('\n7. Completed onboarding survives normalize');
{
  let onboarding = markOnboardingMissionRewardClaimed(createDefaultOnboardingState());
  onboarding = syncOnboardingProgress(
    evalState(onboarding, {
      player: createStarterPlayer({ completedContracts: 1 }),
    }),
  );
  const loaded = normalizeOnboardingState(onboarding);
  assert(loaded.completed === true, 'completed preserved after normalize');
}

console.log('\n8. Dashboard action hidden when completed');
{
  let onboarding = markOnboardingMissionRewardClaimed(createDefaultOnboardingState());
  onboarding = syncOnboardingProgress(
    evalState(onboarding, {
      player: createStarterPlayer({ completedContracts: 2 }),
    }),
  );
  const action = resolveOnboardingDashboardAction(evalState(onboarding));
  assert(action === null, 'no dashboard card action when completed');
}

console.log('\n9. Legacy save with progress skips onboarding');
{
  const legacy = inferLegacyOnboardingFromSave({
    completedContracts: 1,
    activeDeliveryCount: 0,
    deliveryStarted: false,
    tradePurchased: false,
  });
  assert(legacy.completed === true, 'legacy save with delivery history completed');
}

console.log('\n10. Legacy save level > 1 skips onboarding');
{
  const legacy = inferLegacyOnboardingFromSave({
    completedContracts: 0,
    activeDeliveryCount: 0,
    deliveryStarted: false,
    tradePurchased: false,
    playerLevel: 2,
  });
  assert(legacy.completed === true, 'level > 1 treated as veteran');
}

console.log('\n11. resetOnboardingForTesting only resets onboarding');
{
  const reset = resetOnboardingForTesting();
  assert(reset.currentStepId === 'choose_first_contract', 'reset returns first step');
  assert(reset.completed === false, 'reset not completed');
}

console.log('\n12. Legacy step migration');
{
  assert(migrateOnboardingStepId('welcome') === 'choose_first_contract', 'welcome migrated');
  assert(migrateOnboardingStepId('claim_rewards') === 'claim_first_reward', 'claim_rewards migrated');
}

console.log('\n13. Missions visit completes when no claimable starter rewards');
{
  let onboarding = createDefaultOnboardingState();
  onboarding = markOnboardingScreenVisited(onboarding, 'Missions');
  const missions = createDefaultMissionsState();
  missions.claimedMissionRewardIds = [...STARTER_MISSION_IDS];
  onboarding = syncOnboardingProgress(
    evalState(onboarding, {
      missions,
      player: createStarterPlayer({ completedContracts: 1 }),
    }),
  );
  assert(onboarding.completed === true, 'missions visit completes onboarding without stuck state');
}

console.log('\n14. resolveOnboardingStep priority');
{
  const step = resolveOnboardingStep(
    evalState(createDefaultOnboardingState(), {
      player: createStarterPlayer({ completedContracts: 0 }),
    }),
  );
  assert(step === 'choose_first_contract', 'default step choose_first_contract');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
