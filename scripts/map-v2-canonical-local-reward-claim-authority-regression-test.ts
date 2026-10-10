/**
 * Map V2 Step 29W canonical local reward claim authority.
 * Run: node --import tsx scripts/map-v2-canonical-local-reward-claim-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  AD_CALLBACK_AUTHORITY,
  AD_REWARD_AUTHORITY_STATUS,
  AD_SSV_STATUS,
  CANONICAL_LOCAL_REWARD_CLAIM_AUTHORITY_STATUS,
  CANONICAL_LOCAL_REWARD_POLICY_VERSION,
  DAILY_LOGIN_REWARD_STATUS,
  LOCAL_REWARD_READINESS_STATUS,
  LOCAL_WEEKLY_OBJECTIVE_STATUS,
  ONBOARDING_CASH_REWARD_STATUS,
  REWARD_CASH_AUDIT,
  findCanonicalLocalReward,
  hasOnlyCanonicalLocalRewardKeys,
  isCanonicalLocalRewardAllowed,
  missionCanonicalStatus,
  rewardAuditHasUnknown,
} from '../src/domain/canonicalLocalRewardClaim';
import {
  AD_REWARD_CASH_STATUS,
  MILESTONE_REWARD_CASH_STATUS,
  MISSION_REWARD_CASH_STATUS,
  WEEKLY_LOCAL_OBJECTIVE_CASH_STATUS,
} from '../src/domain/remainingRoadCashPathCanonicalization';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { DAILY_OPEX_READINESS_STATUS } from '../src/domain/canonicalDailyOpexStaffState';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  UNIFIED_CASH_BLOCK_REASON,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';

let pass = 0;
let fail = 0;
function assert(cond: unknown, label: string): void {
  if (cond) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL ${label}`);
}
function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}

console.log('\n=== Map V2 Canonical Local Reward Claims (Step 29W) ===\n');

assert(
  CANONICAL_LOCAL_REWARD_CLAIM_AUTHORITY_STATUS ===
    'CANONICAL_LOCAL_REWARD_CLAIM_AUTHORITY_PASS_PARTIAL',
  'status',
);
assert(read('src/store/gameStore.ts').includes('claimMissionReward:'), 'A public mission');
assert(read('src/store/gameStore.ts').includes('applyAdReward:'), 'A public ad');
assert(!read('src/screens/MissionsScreen.tsx').includes('claimCanonicalLocalReward'), 'A unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(isCanonicalLocalRewardAllowed({ envValue: null }) === false, 'C gate');
assert(rewardAuditHasUnknown() === false, 'D no unknown');
assert(REWARD_CASH_AUDIT.length >= 12, 'D rows');
assert(read('backend/src/index.ts').includes('export const claimWeeklyMissionReward'), 'E weekly');
assert(read('backend/src/index.ts').includes('export const claimSeasonReward'), 'F season');
assert(read('backend/src/index.ts').includes('export const claimChallengeReward'), 'G challenge');
assert(findCanonicalLocalReward('weekly_deliveries') == null, 'H no weekly dual pay');
assert(
  hasOnlyCanonicalLocalRewardKeys({
    rewardId: 'own_2_trucks',
    canonicalSchemaVersion: 1,
    rewardAmount: 1,
  }) === false,
  'I amount',
);
assert(
  hasOnlyCanonicalLocalRewardKeys({
    rewardId: 'own_2_trucks',
    canonicalSchemaVersion: 1,
    cashDelta: 1,
  }) === false,
  'J delta',
);
assert(
  hasOnlyCanonicalLocalRewardKeys({
    rewardId: 'own_2_trucks',
    canonicalSchemaVersion: 1,
    completed: true,
  }) === false,
  'K completed',
);
assert(
  hasOnlyCanonicalLocalRewardKeys({
    rewardId: 'own_2_trucks',
    canonicalSchemaVersion: 1,
    progress: 9,
  }) === false,
  'L progress',
);
assert(findCanonicalLocalReward('not-real') == null, 'M unknown');
const mission = findCanonicalLocalReward('own_2_trucks');
const milestone = findCanonicalLocalReward('ms_second_truck');
assert(mission?.amount === 3000 && mission.multiplicity === 'ONE_TIME', 'N amount');
assert(milestone?.amount === 2500, 'N milestone amount');
assert(read('backend/src/canonicalLocalReward.ts').includes('countCanonicalActiveRewardTrucks'), 'O eligibility');
assert(read('src/domain/canonicalLocalRewardClaim.ts').includes('REWARD_NOT_ELIGIBLE'), 'P ineligible');
assert(
  read('backend/src/canonicalLocalReward.ts').includes('amountDelta: amount') &&
    /applyCanonicalLocalRewardCashInTransaction\([^)]*eligibility\.amount,/s.test(read('backend/src/canonicalLocalReward.ts')),
  'Q credit',
);
assert(read('src/domain/canonicalLocalRewardClaim.ts').includes('canonicalRewardClaims'), 'R receipt');
assert(read('backend/src/canonicalLocalReward.ts').includes('alreadyApplied: true'), 'S retry');
assert(read('backend/src/canonicalLocalReward.ts').includes('CANONICAL_REWARD_CLAIM_CONFLICT'), 'U conflict');
assert(!read('backend/src/canonicalLocalReward.ts').includes('request.uid'), 'V no client uid');
assert(missionCanonicalStatus('first_delivery') === 'MISSION_CLIENT_PROGRESS_UNVERIFIED', 'AA');
assert(MILESTONE_REWARD_CASH_STATUS === 'MILESTONE_INTERNAL_CANONICAL_STATE_ONLY', 'AB');
assert(LOCAL_WEEKLY_OBJECTIVE_STATUS.includes('DO_NOT_DUAL_PAY'), 'AC');
assert(WEEKLY_LOCAL_OBJECTIVE_CASH_STATUS.includes('BLOCKED') || WEEKLY_LOCAL_OBJECTIVE_CASH_STATUS.includes('DUPLICATE'), 'AC cash');
assert(AD_REWARD_AUTHORITY_STATUS === 'AD_REWARD_AUTHORITY_BLOCKED_VERIFICATION', 'AD');
assert(AD_CALLBACK_AUTHORITY === 'AD_REWARD_CLIENT_CALLBACK_ONLY_UNVERIFIED', 'AD callback');
assert(AD_SSV_STATUS === 'AD_REWARD_PROVIDER_SSV_AVAILABLE_NOT_IMPLEMENTED', 'AD ssv');
assert(!read('backend/src/index.ts').includes('claimAdReward'), 'AE no ad credit');
assert(!read('src/services/adProvider.ts').includes('ssv'), 'AE no ssv');
assert(DAILY_LOGIN_REWARD_STATUS === 'NOT_PRESENT', 'login');
assert(ONBOARDING_CASH_REWARD_STATUS === 'NOT_A_SEPARATE_CASH_PATH', 'onboarding');
assert(CANONICAL_LOCAL_REWARD_POLICY_VERSION === 'canonical-local-reward-internal-v1', 'policy');
assert(MISSION_REWARD_CASH_STATUS === 'MISSION_INTERNAL_CANONICAL_STATE_ONLY', 'mission status');
assert(AD_REWARD_CASH_STATUS === AD_REWARD_AUTHORITY_STATUS, 'ad align');
assert(LOCAL_REWARD_READINESS_STATUS === 'LOCAL_REWARD_PARTIAL', 'BA');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AJ overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AK listener');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AL version');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(gate.ready === false && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AM');
assert(SAVE_GAME_VERSION === 6, 'AN');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AO RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AO SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AO AIR');
assert(resolveMultimodalFeatureRollout({ envValue: null }) === 'MULTIMODAL_OFF', 'AP');
assert(DAILY_OPEX_READINESS_STATUS === 'DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED', 'opex');
assert(!read('backend/src/index.ts').includes('export const settleCanonicalMultimodalShipment'), 'no multimodal');

const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'BB');
assert(coverage.criticalCanonicalizedCount === 0, 'BC');
assert(coverage.criticalBlockedCount === 24, 'BD');
assert(coverage.readiness === 'SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS', 'BE');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    CANONICAL_LOCAL_REWARD_CLAIM_AUTHORITY_STATUS,
    LOCAL_REWARD_READINESS_STATUS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
