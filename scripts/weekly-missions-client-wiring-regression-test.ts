/**
 * Weekly Missions client wiring regression (static + pure helpers).
 * Run: npx tsx scripts/weekly-missions-client-wiring-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  mergeCanonicalDeliveryReceipt,
  shouldRetryCanonicalDeliveryReason,
} from '../src/domain/canonicalDeliveryCompletionQueueLogic';
import {
  canClaimBackendWeeklyMission,
  createWeeklyMissionClaimAttempt,
  getWeeklyMissionDifficultyLabel,
  isLocalWeeklyCashMintAllowed,
  weeklyMissionClaimAttemptKey,
} from '../src/features/weeklyMissions/claimFlow';
import {
  clearBackendWeeklyMissionsCache,
  getBackendWeeklyDashboardSlice,
  setBackendWeeklyMissionsCache,
} from '../src/features/weeklyMissions/weeklyMissionCache';

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

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

console.log('\n=== Weekly Missions Client Wiring Regression ===\n');

const store = read('src/store/gameStore.ts');
const missionsScreen = read('src/screens/MissionsScreen.tsx');
const dashboard = read('src/screens/DashboardScreen.tsx');
const roadmap = read('src/config/backendRoadmap.ts');
const service = read('src/services/weeklyMissionService.ts');
const queue = read('src/domain/canonicalDeliveryCompletionQueue.ts');
const lifecycle = read('src/hooks/useAppStateLifecycle.ts');
const postStartup = read('src/hooks/usePostStartupLifecycle.ts');
const presentation = read('src/components/missions/MissionPresentation.tsx');
const productionPolicy = read('src/config/storeProductionPolicy.ts');
const appConfig = read('app.config.js');
const envExample = read('.env.example');
const envProduction = read('.env.production');
const envInternal = read('.env.internal');
const missionsConfig = read('src/config/missions.ts');
const milestones = read('src/data/milestones.ts');
const challenges = read('backend/src/challenges.ts');
const seasonRewards = read('backend/src/seasonRewards.ts');
const marketplace = read('src/services/vehicleMarketplaceService.ts');

console.log('Delivery event wiring');
assert(store.includes('notifyCanonicalDeliveryCompleted(deliveryId)'), 'completeDeliveryById notifies canonical completion');
assert(store.includes('failDeliveryById:'), 'fail path still separate');
assert(queue.includes('isLinkedAccountForCanonicalDelivery'), 'guest gate on queue');
assert(queue.includes('historic guest deliveries are NOT'), 'guest no-retroactive docs');
assert(lifecycle.includes('flushCanonicalDeliveryCompletionQueue'), 'foreground flush');
assert(postStartup.includes('flushCanonicalDeliveryCompletionQueue'), 'auth/startup flush');

console.log('\nQueue helpers');
const merged = mergeCanonicalDeliveryReceipt([], 'delivery-1', 1000);
assert(merged.length === 1 && merged[0]!.deliveryId === 'delivery-1', 'enqueue creates receipt');
const deduped = mergeCanonicalDeliveryReceipt(merged, 'delivery-1', 2000);
assert(deduped.length === 1, 'duplicate deliveryId not re-queued');
assert(shouldRetryCanonicalDeliveryReason('service-unavailable'), 'retry on service-unavailable');
assert(!shouldRetryCanonicalDeliveryReason('invalid-request'), 'no retry on invalid-request');

console.log('\nFeature flag');
assert(roadmap.includes('BACKEND_WEEKLY_MISSIONS_ENABLED'), 'client flag exported');
assert(roadmap.includes('EXPO_PUBLIC_ENABLE_BACKEND_WEEKLY_MISSIONS'), 'env key');
assert(appConfig.includes('backendWeeklyMissionsEnabled'), 'app.config features map');
assert(envExample.includes('EXPO_PUBLIC_ENABLE_BACKEND_WEEKLY_MISSIONS=false'), 'example fail-closed');
assert(envProduction.includes('EXPO_PUBLIC_ENABLE_BACKEND_WEEKLY_MISSIONS=false'), 'production fail-closed');
assert(
  /EXPO_PUBLIC_ENABLE_BACKEND_WEEKLY_MISSIONS=true\b/.test(envInternal),
  'internal canary flag true',
);
assert(
  /EXPO_PUBLIC_ENABLE_BACKEND_WEEKLY_MISSIONS=false\b/.test(envProduction),
  'production store flag false',
);
assert(
  productionPolicy.includes('EXPO_PUBLIC_ENABLE_BACKEND_WEEKLY_MISSIONS'),
  'store production forbids enabling',
);

console.log('\nWeekly data source');
assert(missionsScreen.includes('BACKEND_WEEKLY_MISSIONS_ENABLED'), 'Weekly tab gated');
assert(missionsScreen.includes('getWeeklyMissions()'), 'backend get used when ON');
assert(missionsScreen.includes('claimWeeklyMissionReward'), 'backend claim used when ON');
assert(
  missionsScreen.includes('getWeeklyObjectiveDefinitions(legacySeasonKey)'),
  'legacy generation only when OFF path builds defs',
);
assert(
  missionsScreen.includes('BACKEND_WEEKLY_MISSIONS_ENABLED\n        ? []') ||
    missionsScreen.includes('BACKEND_WEEKLY_MISSIONS_ENABLED\n        ? []') ||
    /BACKEND_WEEKLY_MISSIONS_ENABLED[\s\S]{0,80}\? \[\]/.test(missionsScreen),
  'backend mode skips local weekly generation',
);
assert(missionsScreen.includes('endsAt'), 'countdown uses backend endsAt');
assert(missionsScreen.includes('formatWeeklyRemainingLabel'), 'countdown label helper');
assert(!/useMemo\(\(\) => getWeeklySeasonKey\(\), \[\]\)/.test(missionsScreen), 'stale week useMemo([]) removed');

console.log('\nClaim safety');
assert(store.includes('isLocalWeeklyCashMintAllowed(BACKEND_WEEKLY_MISSIONS_ENABLED)'), 'store blocks local mint when backend ON');
assert(service.includes('weekKey: input.weekKey'), 'claim payload weekKey');
assert(service.includes('missionId: input.missionId'), 'claim payload missionId');
assert(service.includes('idempotencyKey: input.idempotencyKey'), 'claim payload idempotencyKey');
assert(
  /claimWeeklyMissionReward[\s\S]{0,1200}call\(\{[\s\S]*?weekKey: input\.weekKey[\s\S]*?missionId: input\.missionId[\s\S]*?idempotencyKey: input\.idempotencyKey[\s\S]*?\}\)/.test(
    service,
  ),
  'claim callable sends only weekKey/missionId/idempotencyKey',
);
assert(!/call\(\{[\s\S]*reward[\s\S]*\}\)/.test(service.split('claimWeeklyMissionReward')[2] ?? ''), 'claim request omits reward');
assert(missionsScreen.includes('createWeeklyMissionClaimAttempt'), 'stable attempt helper');
assert(missionsScreen.includes('reconcileChallengeClaimCash'), 'success reconciles canonical cash');
assert(presentation.includes('difficultyLabel'), 'difficulty chip supported');

console.log('\nDual mode helpers');
assert(isLocalWeeklyCashMintAllowed(false) === true, 'flag OFF allows local mint');
assert(isLocalWeeklyCashMintAllowed(true) === false, 'flag ON blocks local mint');
assert(getWeeklyMissionDifficultyLabel('easy') === 'Kolay', 'Kolay label');
assert(getWeeklyMissionDifficultyLabel('medium') === 'Orta', 'Orta label');
assert(getWeeklyMissionDifficultyLabel('hard') === 'Zor', 'Zor label');
const attempt = createWeeklyMissionClaimAttempt('2026-W38', 'wm_deliveries_5', (w, m) => `idem-${w}-${m}`);
assert(attempt.idempotencyKey === 'idem-2026-W38-wm_deliveries_5', 'idempotency key stable from factory');
assert(
  weeklyMissionClaimAttemptKey('2026-W38', 'wm_deliveries_5') === '2026-W38:wm_deliveries_5',
  'attempt key period scoped',
);
assert(
  canClaimBackendWeeklyMission({
    completed: true,
    claimed: false,
    claimAvailable: true,
    linkedAccount: true,
    featuresEnabled: true,
    requestPending: false,
  }),
  'linked completed claimable',
);
assert(
  !canClaimBackendWeeklyMission({
    completed: true,
    claimed: false,
    claimAvailable: true,
    linkedAccount: false,
    featuresEnabled: true,
    requestPending: false,
  }),
  'guest claim disabled',
);

console.log('\nDashboard readyWeekly');
clearBackendWeeklyMissionsCache();
const emptySlice = getBackendWeeklyDashboardSlice({
  readyWeekly: 9,
  weeklyInProgress: 9,
  weeklyTotal: 5,
});
assert(emptySlice.readyWeekly === 0 && emptySlice.weeklyTotal === 5, 'cache miss defaults safe');
setBackendWeeklyMissionsCache({
  ok: true,
  weekKey: '2026-W38',
  startsAt: 1,
  endsAt: 2,
  remainingMs: 1000,
  claimAvailableForAccount: true,
  missions: [
    {
      id: 'a',
      type: 'weekly_completed_deliveries',
      target: 5,
      difficulty: 'easy',
      reward: { cash: 2000 },
      title: 't',
      description: 'd',
      progress: 5,
      completed: true,
      claimed: false,
      claimedAt: null,
      claimAvailable: true,
    },
    {
      id: 'b',
      type: 'weekly_completed_deliveries',
      target: 10,
      difficulty: 'medium',
      reward: { cash: 4000 },
      title: 't',
      description: 'd',
      progress: 3,
      completed: false,
      claimed: false,
      claimedAt: null,
      claimAvailable: false,
    },
  ],
});
const readySlice = getBackendWeeklyDashboardSlice({
  readyWeekly: 0,
  weeklyInProgress: 0,
  weeklyTotal: 3,
});
assert(readySlice.readyWeekly === 1 && readySlice.weeklyInProgress === 1, 'cache drives ready/in-progress');
assert(dashboard.includes('BACKEND_WEEKLY_MISSIONS_ENABLED'), 'dashboard gated');
assert(dashboard.includes('getBackendWeeklyDashboardSlice'), 'dashboard uses backend slice when ON');

console.log('\nRegression surfaces untouched');
assert(missionsConfig.includes('STARTER_MISSIONS'), 'missions catalog intact');
assert(milestones.includes('MILESTONE_DEFINITIONS'), 'achievements intact');
assert(challenges.includes('claimChallengeRewardTransaction'), 'challenges intact');
assert(seasonRewards.includes('claimSeasonRewardTransaction'), 'season rewards intact');
assert(marketplace.includes('createVehicleListing'), 'marketplace intact');
assert(
  missionsScreen.includes("activeTab === 'achievements'") &&
    missionsScreen.includes('claimMilestoneReward'),
  'achievements tab still claims milestones',
);
assert(
  missionsScreen.includes("activeTab === 'missions'") &&
    missionsScreen.includes('claimMissionReward'),
  'missions tab still claims missions',
);

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS');
