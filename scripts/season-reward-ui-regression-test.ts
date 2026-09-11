/**
 * Phase 7 Step 6 — Reward authority hardening + internal UI regression.
 * Run: npx tsx scripts/season-reward-ui-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  mapSeasonRewardEntitlementToUi,
  sanitizeEntitlementForUi,
  shouldFetchSeasonRewards,
} from '../src/features/progression/seasonRewardUi';
import {
  createSeasonRewardClaimAttempt,
  shouldRetainSeasonRewardClaimAttempt,
} from '../src/features/progression/seasonRewardClaimFlow';
import { buildSeasonRewardUiMockResponse } from '../src/dev/seasonRewardUiMocks';
import { SEASON_REWARD_CALLABLES } from '../src/services/seasonRewardService';

let pass = 0;
let fail = 0;
function check(cond: boolean, label: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
  }
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

console.log('\n=== Season Reward UI + Authority Hardening Regression ===\n');

const index = read('backend/src/index.ts');
const rewards = read('backend/src/seasonRewards.ts');
const screen = read('src/features/progression/ProgressHistoryScreen.tsx');
const block = read('src/features/progression/SeasonRewardBlock.tsx');
const service = read('src/services/seasonRewardService.ts');
const claimFlow = read('src/features/progression/seasonRewardClaimFlow.ts');
const roadmap = read('src/config/backendRoadmap.ts');
const policy = read('src/config/storeProductionPolicy.ts');
const rules = read('firestore.rules');
const opsScript = read('backend/scripts/materializeSeasonRewards.ts');

console.log('Authority hardening');
check(!index.includes('materializeSeasonRewardEntitlementsCallable'), 'no public materialize callable');
check(!index.includes('seasonRewardMaterialize'), 'no materialize rate-limit bucket');
check(rewards.includes('export async function materializeSeasonRewardEntitlements'), 'shared materializer remains');
check(opsScript.includes('materializeSeasonRewardEntitlements'), 'ops Admin script uses shared service');
check(!service.includes('materializeSeasonRewardEntitlementsCallable'), 'client has no materialize callable');
check(!('materializeSeasonRewardEntitlements' in SEASON_REWARD_CALLABLES), 'callable map has no materialize');
check(!screen.includes('materialize'), 'player UI has no materialize');
check(!screen.includes('Generate reward') && !screen.includes('Ödül Oluştur'), 'no generate-reward CTA');

console.log('\nFeature flags');
check(roadmap.includes('SEASON_REWARDS_ENABLED'), 'client reward flag');
check(policy.includes('EXPO_PUBLIC_ENABLE_SEASON_REWARDS must remain false'), 'prod fail-closed');
check(screen.includes('SEASON_REWARDS_ENABLED'), 'UI gated by reward flag');
check(screen.includes('SEASON_CLOSE_SNAPSHOT_ENABLED'), 'snapshot flag independent');
check(shouldFetchSeasonRewards(false) === false, 'flag off → no fetch');
check(shouldFetchSeasonRewards(true) === true, 'flag on → fetch allowed');

console.log('\nUI states');
{
  const eligible = mapSeasonRewardEntitlementToUi(
    buildSeasonRewardUiMockResponse('eligible_unclaimed'),
  );
  check(eligible.state === 'eligible_unclaimed', 'eligible_unclaimed state');
  check(eligible.cashAmount === 40_000, 'eligible shows server amount');
  check(eligible.showClaimCta === true, 'eligible shows claim CTA');

  const claimed = mapSeasonRewardEntitlementToUi(buildSeasonRewardUiMockResponse('claimed'));
  check(claimed.state === 'claimed', 'claimed state');
  check(claimed.showClaimCta === false, 'claimed hides CTA');

  const none = mapSeasonRewardEntitlementToUi(buildSeasonRewardUiMockResponse('no_reward'));
  check(none.state === 'no_reward', 'no_reward state');
  check(none.showClaimCta === false, 'no_reward no CTA');

  const under = mapSeasonRewardEntitlementToUi(
    buildSeasonRewardUiMockResponse('insufficient_participants'),
  );
  check(under.state === 'insufficient_participants', 'insufficient participants');
  check(
    under.primaryText?.includes('yeterli katılımcı') === true,
    'insufficient copy',
  );

  const pending = mapSeasonRewardEntitlementToUi(buildSeasonRewardUiMockResponse('pending'));
  check(pending.state === 'pending', 'pending state');

  const unavailable = mapSeasonRewardEntitlementToUi(
    buildSeasonRewardUiMockResponse('unavailable'),
  );
  check(unavailable.state === 'unavailable', 'unavailable state');
  check(unavailable.showClaimCta === false, 'unavailable no CTA');

  const disabled = mapSeasonRewardEntitlementToUi(
    buildSeasonRewardUiMockResponse('rewards_disabled'),
  );
  check(disabled.state === 'hidden', 'rewards_disabled hides UI');
  check(disabled.showClaimCta === false, 'W34-style not claimable');

  const malformed = mapSeasonRewardEntitlementToUi({
    ok: true,
    reason: 'eligible_unclaimed',
    seasonKey: 'x',
    entitlement: null,
  });
  check(malformed.state === 'unavailable', 'malformed eligible fails safe');

  const coerced = sanitizeEntitlementForUi({
    ok: true,
    reason: 'eligible_unclaimed',
    seasonKey: 'x',
    entitlement: {
      tierId: 'rank_1',
      cashAmount: 0,
      finalRank: 1,
      status: 'unclaimed',
      claimedAt: null,
    },
  });
  check(coerced === null, 'zero amount not claimable');
}

console.log('\nClaim wiring');
check(screen.includes('Ödülü Al'), 'claim CTA label');
check(screen.includes('Sezon ödülün hesabına eklenecek'), 'confirmation copy');
check(screen.includes('showDialog'), 'explicit confirmation dialog');
check(screen.includes('claimSeasonReward('), 'calls claimSeasonReward');
check(service.includes('call({ seasonKey, idempotencyKey })'), 'claim payload safe');
check(service.includes('never uid/rank/amount/tier'), 'authority fields documented banned');
check(!/httpsCallable<[^>]*finalRank/.test(service), 'no finalRank in callable generics payload');
check(!screen.includes('player.money +=') && !screen.includes('money +'), 'no local cash double-add');
check(screen.includes('reconcileChallengeClaimCash'), 'cash via marketplace reconcile');
check(!screen.includes('claimSeasonReward(') || !/useEffect\([^\)]*claimSeasonReward/.test(screen), 'no auto-claim in effect');
check(!screen.includes('setInterval') && !screen.includes('setTimeout('), 'no reward polling timers');
check(claimFlow.includes('season-reward-'), 'opaque idempotency prefix');
{
  const attempt = createSeasonRewardClaimAttempt('2026-W36', () => 'abc');
  check(attempt.idempotencyKey === 'season-reward-abc', 'idempotency key format');
  check(!attempt.idempotencyKey.includes('40000'), 'key has no amount');
  check(shouldRetainSeasonRewardClaimAttempt('timeout') === true, 'retain on timeout');
  check(shouldRetainSeasonRewardClaimAttempt('already-claimed') === false, 'drop on already-claimed');
}

console.log('\nAccount / guest / performance');
check(screen.includes('rewardOwnerUid'), 'reward state keyed by auth uid');
check(screen.includes('clearRewardUiState'), 'logout/guest clears reward UI');
check(screen.includes('user.isAnonymous'), 'guest path clears rewards');
check(screen.includes('fetchSeasonRewardEntitlementsForHistory'), 'bounded history fetch');
check(service.includes('SEASON_HISTORY_REWARD_ENRICH_LIMIT = 6'), 'enrich limit 6');
check(!block.includes('useGameStore'), 'reward block no store subscription');
check(screen.includes('__DEV__') && screen.includes('DEV Sezon Ödülü Önizleme'), 'DEV mock surface');
check(screen.includes('Firestore yazılmaz'), 'DEV mock does not write Firestore');

console.log('\nSecurity rules');
check(rules.includes('match /rewardEntitlements/{uid}'), 'entitlement rules');
check(rules.includes('match /rewardClaims/{uid}'), 'claim rules');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exitCode = 1;
else console.log('✅ ALL PASS\n');
