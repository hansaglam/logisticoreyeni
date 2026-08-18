/**
 * Achievement / mission reward claim idempotency + persistence.
 * Run: npx tsx scripts/achievement-reward-claim-regression-test.ts
 */
import './test-globals';

import { MILESTONE_DEFINITIONS } from '../src/data/milestones';
import {
  attemptRewardClaim,
  buildRewardReceiptKey,
  hydrateRewardClaimState,
  isRewardClaimed,
  mergeRewardReceiptsMonotonic,
  normalizeRewardReceipts,
} from '../src/domain/rewardClaimIntegrity';
import { createDefaultMissionsState } from '../src/config/missions';
import { createDefaultRetentionState } from '../src/simulation/retentionProgress';
import { normalizeSavePayload } from '../src/storage/saveGame';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\nAchievement reward claim regression\n');

console.log('TEST 1 — single claim accepted');
{
  const attempt = attemptRewardClaim({
    scope: 'achievement',
    rewardId: 'heavy_hauler',
    currentTime: 100,
    rewardReceipts: {},
    isComplete: true,
    isAlreadyMarkedClaimed: false,
  });
  assert(attempt.status === 'ACCEPTED', 'claim accepted');
  assert(Boolean(attempt.nextReceipts?.[buildRewardReceiptKey('achievement', 'heavy_hauler')]), 'receipt stamped');
}

console.log('\nTEST 2 — duplicate claim rejected');
{
  const receipts = normalizeRewardReceipts({
    [buildRewardReceiptKey('achievement', 'heavy_hauler')]: { claimedAt: 100 },
  });
  const attempt = attemptRewardClaim({
    scope: 'achievement',
    rewardId: 'heavy_hauler',
    currentTime: 120,
    rewardReceipts: receipts,
    isComplete: true,
    isAlreadyMarkedClaimed: false,
  });
  assert(attempt.status === 'ALREADY_CLAIMED', 'duplicate blocked');
}

console.log('\nTEST 3 — save normalize preserves retention claim state');
{
  const milestoneId = MILESTONE_DEFINITIONS[0]?.id ?? 'complete_5_deliveries';
  const retention = createDefaultRetentionState();
  retention.milestones[milestoneId] = {
    progress: 10,
    isClaimed: true,
    completedAt: 55,
  };
  const payload = normalizeSavePayload({
    version: 1,
    currentTime: 100,
    player: { money: 1000, companyName: 'Test', homeCityId: 'izmir', trucks: [], drivers: [], trailers: [], warehouses: [] },
    cities: [],
    products: [],
    routes: [],
    contracts: [],
    activeDeliveries: [],
    globalEconomy: { fuelPrice: 1 },
    marketNews: [],
    eventLog: [],
    gameSpeed: 1,
    isPaused: false,
    missions: createDefaultMissionsState(),
    retention,
    rewardReceipts: {},
  } as never);
  const savedEntry = payload.retention?.milestones[milestoneId];
  assert(savedEntry?.isClaimed === true, 'milestone remains claimed after normalize');
  assert(
    isRewardClaimed(payload.rewardReceipts, buildRewardReceiptKey('achievement', milestoneId)),
    'receipt backfilled from legacy isClaimed',
  );
}

console.log('\nTEST 4 — cloud merge keeps claimed receipts monotonic');
{
  const key = buildRewardReceiptKey('achievement', 'regional_operator');
  const merged = mergeRewardReceiptsMonotonic(
    {},
    { [key]: { claimedAt: 200 } },
  );
  assert(isRewardClaimed(merged, key), 'cloud claim preserved when local empty');
}

console.log('\nTEST 5 — incomplete claim blocked');
{
  const attempt = attemptRewardClaim({
    scope: 'achievement',
    rewardId: 'experienced_driver',
    currentTime: 10,
    rewardReceipts: {},
    isComplete: false,
    isAlreadyMarkedClaimed: false,
  });
  assert(attempt.status === 'NOT_COMPLETE', 'incomplete blocked');
}

console.log('\nTEST 6 — hydrate syncs missions + retention from receipts');
{
  const milestoneId = MILESTONE_DEFINITIONS[1]?.id ?? MILESTONE_DEFINITIONS[0]!.id;
  const receipts = normalizeRewardReceipts({
    [buildRewardReceiptKey('achievement', milestoneId)]: { claimedAt: 77 },
  });
  const hydrated = hydrateRewardClaimState({
    rewardReceipts: receipts,
    missions: createDefaultMissionsState(),
    retention: createDefaultRetentionState(),
    seasonKey: '2026-W01',
    fallbackClaimedAt: 0,
  });
  assert(hydrated.retention.milestones[milestoneId]?.isClaimed === true, 'retention marked claimed from receipt');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
