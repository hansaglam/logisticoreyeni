/**
 * Phase 7 Step 4 — Season reward policy regression (catalog + flags).
 * Step 5 adds claim wiring; this script asserts policy modules stay pure.
 */
import { readFileSync, existsSync } from 'node:fs';
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

console.log('\n=== Season Reward Policy Regression ===\n');

const catalog = read('backend/src/seasonRewardCatalog.ts');
const resolveSrc = read('backend/src/seasonRewardResolve.ts');
const types = read('backend/src/seasonRewardTypes.ts');
const index = read('backend/src/index.ts');
const close = read('backend/src/seasonClose.ts');
const roadmap = read('src/config/backendRoadmap.ts');
const policy = read('src/config/storeProductionPolicy.ts');

check(existsSync(resolve(root, 'backend/src/seasonRewardCatalog.ts')), 'catalog module');
check(existsSync(resolve(root, 'backend/src/seasonRewardResolve.ts')), 'resolver module');
check(catalog.includes('SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT = 10'), 'min participants 10');
check(catalog.includes('60_000'), 'rank1 moderated amount');
check(catalog.includes('100_000') === false, 'does not use proposed 100k as catalog amount');
check(resolveSrc.includes('export function resolveSeasonReward'), 'resolver exported');
check(resolveSrc.includes('insufficient-participants'), 'participant gate reason');
check(types.includes('SeasonRewardEntitlementDocument'), 'entitlement type');
check(types.includes('ClaimSeasonRewardRequest'), 'claim request type');
check(index.includes('claimSeasonReward'), 'claim callable present (Step 5)');
check(!index.includes('materializeSeasonRewardEntitlementsCallable'), 'materialize not a public callable (Step 6)');
check(existsSync(resolve(root, 'backend/scripts/materializeSeasonRewards.ts')), 'ops materialize script');
check(!close.includes('rewardEntitlements'), 'seasonClose does not write entitlements');
check(roadmap.includes('SEASON_REWARDS_ENABLED'), 'client flag defined');
check(roadmap.includes('EXPO_PUBLIC_ENABLE_SEASON_REWARDS'), 'client env key');
check(policy.includes('EXPO_PUBLIC_ENABLE_SEASON_REWARDS must remain false'), 'store fail-closed');
check(types.includes("process.env.SEASON_REWARDS_ENABLED === 'true'"), 'backend rewards flag fail-closed');
check(!resolveSrc.includes('getFirestore'), 'resolver has no Firestore');
check(!resolveSrc.includes('canonicalCash'), 'resolver does not mutate cash');
check(!resolveSrc.includes('player.money'), 'resolver ignores client money');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exitCode = 1;
else console.log('✅ ALL PASS\n');
