/**
 * Phase 7 Step 5 — Reward entitlement + claim backend regression (static).
 * Run: npx tsx scripts/season-reward-claim-regression-test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

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

console.log('\n=== Season Reward Entitlement + Claim Regression ===\n');

const rewards = read('backend/src/seasonRewards.ts');
const index = read('backend/src/index.ts');
const rules = read('firestore.rules');
const deletion = read('backend/src/accountDeletion.ts');
const client = read('src/services/seasonRewardService.ts');
const roadmap = read('src/config/backendRoadmap.ts');
const policy = read('src/config/storeProductionPolicy.ts');
const close = read('backend/src/seasonClose.ts');
const types = read('backend/src/seasonCloseTypes.ts');

check(existsSync(resolve(root, 'backend/src/seasonRewards.ts')), 'seasonRewards module');
check(existsSync(resolve(root, 'src/services/seasonRewardService.ts')), 'client service');
check(rewards.includes('materializeSeasonRewardEntitlements'), 'materializer');
check(rewards.includes('claimSeasonRewardTransaction'), 'claim transaction');
check(rewards.includes('getSeasonRewardEntitlementForUid'), 'entitlement read');
check(rewards.includes('rewardEntitlements'), 'entitlement path');
check(rewards.includes('rewardClaims'), 'claim receipt path');
check(rewards.includes("collection(`seasons/${seasonKey}/results`)"), 'results-only authority');
check(!rewards.includes('leaderboards/'), 'never reads mutable leaderboard');
check(!rewards.includes('seasonProgress'), 'ignores seasonProgress');
check(!rewards.includes('challengeClaims'), 'ignores challengeClaims');
check(rewards.includes('insufficient_participants'), 'get API can return insufficient_participants');
check(rewards.includes("reason: 'pending'"), 'get API pending when materialization incomplete');
check(rewards.includes("meta.rewardsEnabled !== true"), 'season rewardsEnabled gate');
check(rewards.includes('canonicalCash'), 'updates canonical cash');
check(rewards.includes('cash: cashAfter'), 'mirrors serverState.cash');
check(rewards.includes('idempotencyKey'), 'claim idempotency');
check(rewards.includes('deleteSeasonRewardDataForUid'), 'deletion helper');

check(index.includes('export const claimSeasonReward'), 'claim callable exported');
check(index.includes('export const getSeasonRewardEntitlement'), 'get entitlement callable');
check(!index.includes('materializeSeasonRewardEntitlementsCallable'), 'no public materialize callable');
check(rewards.includes('export async function materializeSeasonRewardEntitlements'), 'shared materializer retained');
check(index.includes("hasOnlyKeys(record, ['seasonKey', 'idempotencyKey'])"), 'claim accepts only safe keys');
check(index.includes("hasOnlyKeys(record, ['seasonKey'])"), 'get accepts seasonKey only');

check(rules.includes('match /rewardEntitlements/{uid}'), 'entitlement rules');
check(rules.includes('match /rewardClaims/{uid}'), 'claim rules');
check(
  /match \/rewardEntitlements\/\{uid\} \{\s*allow read, write: if false;/.test(rules),
  'clients cannot R/W entitlements',
);
check(
  /match \/rewardClaims\/\{uid\} \{\s*allow read, write: if false;/.test(rules),
  'clients cannot R/W claims',
);

check(deletion.includes('deleteSeasonRewardDataForUid'), 'deletion hooked');
check(deletion.includes('seasonRewardEntitlementsDeleted'), 'entitlement delete count');
check(deletion.includes('seasonRewardClaimsDeleted'), 'claim delete count');

check(client.includes('getSeasonRewardEntitlement'), 'client get wrapper');
check(client.includes('claimSeasonReward'), 'client claim wrapper');
check(client.includes('SEASON_REWARDS_ENABLED'), 'client fail-closed');
check(client.includes('call({ seasonKey, idempotencyKey })'), 'claim payload seasonKey+idempotency only');
check(client.includes("call({ seasonKey })"), 'get payload seasonKey only');
check(!client.includes('rewardCatalogVersion'), 'client does not send catalog version');

check(roadmap.includes('EXPO_PUBLIC_ENABLE_SEASON_REWARDS'), 'client flag key');
check(policy.includes('EXPO_PUBLIC_ENABLE_SEASON_REWARDS must remain false'), 'store fail-closed');
check(close.includes('resolveSeasonRewardPolicy'), 'season close freezes via reward policy resolver');
check(close.includes('freezeSeasonRewardPolicyFields'), 'season close writes frozen reward fields');
check(close.includes('return existing'), 'existing closing/closed meta not overwritten');
check(types.includes('rewardsEnabled?: boolean'), 'meta rewardsEnabled typed');
check(!close.includes('rewardEntitlements'), 'seasonClose does not write entitlements');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exitCode = 1;
else console.log('✅ ALL PASS\n');
