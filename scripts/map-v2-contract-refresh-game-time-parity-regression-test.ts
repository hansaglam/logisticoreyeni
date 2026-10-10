/**
 * Map V2 Step 29AE contract refresh game-time parity.
 * Run: node --import tsx scripts/map-v2-contract-refresh-game-time-parity-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { contractGenerationBalance, realMsToGameHours } from '../src/config/balance';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_MANUAL_REFRESH_COOLDOWN_GAME_HOURS,
  CANONICAL_MANUAL_REFRESH_MAX_CONTRACTS,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5,
  CANONICAL_ROAD_CONTRACT_REFRESH_POLICY_VERSION,
  CONTRACT_REFRESH_GAME_TIME_PARITY_STATUS,
  PRODUCTION_MANUAL_REFRESH_REPLACES_AVAILABLE_OFFERS,
  REFRESH_AD_OVERRIDE_CLASSIFICATION,
  canonicalRefreshSeed,
  hasOnlyCanonicalRoadRefreshKeys,
  isCanonicalRefreshEligible,
  isCanonicalRoadContractRefreshAllowed,
} from '../src/domain/canonicalContractRefresh';
import {
  CONTRACT_EXPIRY_BACKGROUND_CLASS,
  advanceCanonicalContractClock,
  createInitialCanonicalContractClock,
  setCanonicalContractClockPaused,
  setCanonicalContractClockSpeed,
} from '../src/domain/canonicalContractGameTimeExpiry';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4,
  PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
} from '../src/domain/canonicalProductionRoadContractIssuance';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
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

console.log('\n=== Map V2 Contract Refresh Game-Time Parity (Step 29AE) ===\n');

const screen = read('src/screens/ContractsScreen.tsx');
const store = read('src/store/gameStore.ts');
const contracts = read('src/simulation/contracts.ts');
const balance = read('src/config/balance.ts');
const rules = read('firestore.rules');
const index = read('backend/src/index.ts');
const backend = read('backend/src/canonicalProductionRoadContractIssuance.ts');
const accept = read('backend/src/canonicalRoadDelivery.ts');
const monetization = read('src/config/monetization.ts');

assert(!screen.includes('refreshCanonicalRoadContractBatchInternal'), 'A public UI local');
assert(screen.includes('refreshContractsFromMarket'), 'A button stays local');
assert(store.includes('guest') || store.includes('Guests'), 'B guest');
assert(isCanonicalRoadContractRefreshAllowed({ envValue: null }) === false, 'C gate off');
assert(isCanonicalRoadContractRefreshAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'C gate on');
assert(contractGenerationBalance.manualRefreshCooldownHours === 3, 'D duration');
assert(balance.includes('manualRefreshCooldownHours: 3'), 'D source');
assert(contracts.includes('hoursSinceManual < contractGenerationBalance.manualRefreshCooldownHours') || store.includes('hoursSinceManual <'), 'E comparison');
assert(store.includes('lastManualContractRefreshTime'), 'F clock field');
assert(CANONICAL_MANUAL_REFRESH_COOLDOWN_GAME_HOURS === 3, 'F canonical duration');
assert(isCanonicalRefreshEligible({ currentGameHours: 2.999, lastRefreshGameHours: 0 }) === false, 'N below');
assert(isCanonicalRefreshEligible({ currentGameHours: 3, lastRefreshGameHours: 0 }) === true, 'N exact');
assert(isCanonicalRefreshEligible({ currentGameHours: 3.001, lastRefreshGameHours: 0 }) === true, 'N above');
assert(store.includes('lastManualContractRefreshTime: 0') || store.includes('lastManualContractRefreshTime: 0,'), 'G initial zero');
assert(!store.includes('canonicalRoadContractRefresh'), 'A store unwired');
assert(contracts.includes('manualRefreshMaxContracts'), 'H append cap');
assert(CANONICAL_MANUAL_REFRESH_MAX_CONTRACTS === 3, 'H canonical cap');
assert(PRODUCTION_MANUAL_REFRESH_REPLACES_AVAILABLE_OFFERS === false, 'Z keep valid offers');
assert(contracts.includes('expireOldContracts'), 'Z expire due');
assert(!store.includes('serverState.cash') || store.includes('money'), 'F refresh free in store path');
assert(monetization.includes('contract_refresh'), 'M ad slot exists');
assert(REFRESH_AD_OVERRIDE_CLASSIFICATION === 'REFRESH_AD_OVERRIDE_BLOCKED_VERIFICATION', 'M ad blocked');
assert(!backend.includes('contract_refresh_bypass'), 'M no ad bypass');
for (const key of ['canRefresh', 'cooldown', 'elapsedGameHours', 'lastRefresh', 'refreshSequence', 'seed']) {
  assert(hasOnlyCanonicalRoadRefreshKeys({ canonicalSchemaVersion: 1, refreshIntentId: 'intent-0001', [key]: true }) === false, `client ${key}`);
}
assert(hasOnlyCanonicalRoadRefreshKeys({ canonicalSchemaVersion: 1, refreshIntentId: 'intent-0001' }), 'intent allowed');
assert(backend.includes('CANONICAL_CONTRACT_CLOCK_COLLECTION'), 'M shared clock');
assert(!backend.includes('canonicalContractRefreshClock'), 'M no second clock');
const now = 1_700_000_000_000;
const paused = setCanonicalContractClockPaused(createInitialCanonicalContractClock(now), true, now);
assert(paused.ok, 'O pause setup');
if (paused.ok) {
  const held = advanceCanonicalContractClock(paused.state, now + 10 * 60 * 60 * 1000);
  assert(held.ok && held.state.currentGameHours === 0, 'O pause stops');
  assert(isCanonicalRefreshEligible({ currentGameHours: held.ok ? held.state.currentGameHours : 99, lastRefreshGameHours: 0 }) === false, 'O still blocked');
}
const slow = advanceCanonicalContractClock(createInitialCanonicalContractClock(now), now + 15_000);
const fastBase = setCanonicalContractClockSpeed(createInitialCanonicalContractClock(now), 8, now);
const fast = fastBase.ok ? advanceCanonicalContractClock(fastBase.state, now + 3_000) : fastBase;
assert(slow.ok && fast.ok && fast.state.currentGameHours === 3 && slow.state.currentGameHours === 1, 'P speed');
assert(realMsToGameHours(15_000, 1) === 1 && realMsToGameHours(1_000, 8) === 1, 'P same hours');
const away = advanceCanonicalContractClock(createInitialCanonicalContractClock(now), now + 48 * 60 * 60 * 1000);
assert(away.ok && away.state.currentGameHours === 24, 'Q offline');
assert(isCanonicalRefreshEligible({ currentGameHours: away.ok ? away.state.currentGameHours : 0, lastRefreshGameHours: 0 }), 'Q unlocks');
assert(CONTRACT_EXPIRY_BACKGROUND_CLASS.includes('BACKGROUND'), 'R background');
const backward = advanceCanonicalContractClock(createInitialCanonicalContractClock(now + 86_400_000), now);
assert(backward.ok && backward.state.currentGameHours === 0, 'S device clock');
assert(backend.includes('refreshSequence + 1') || backend.includes('refreshState.refreshSequence + 1'), 'T sequence');
assert(canonicalRefreshSeed('uid', 2, 100) !== canonicalRefreshSeed('uid', 1, 100), 'U new seed');
assert(canonicalRefreshSeed('uid', 1, 100).startsWith(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5), 'AS v5 seed');
assert(backend.includes('alreadyApplied'), 'V retry');
assert(backend.includes('CONTRACT_REFRESH_COOLDOWN_ACTIVE'), 'Y cooldown');
assert(backend.includes("status: 'EXPIRED'"), 'Z expire');
assert(backend.includes("data.status !== 'AVAILABLE'"), 'AA skip accepted');
assert(accept.includes('CONTRACT_SUPERSEDED'), 'AB superseded guard');
assert(PRODUCTION_MANUAL_REFRESH_REPLACES_AVAILABLE_OFFERS === false, 'AB production keeps offers');
assert(!backend.includes('canonicalCashTransactions'), 'AT no cash tx');
assert(!backend.includes('serverState'), 'AT no server cash');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AV');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AW');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AX');
assert(canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 0,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
}).ready === false, 'AY');
assert(SAVE_GAME_VERSION === 6, 'AZ');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'BA rail');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'BA sea');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'BA air');
assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'BB');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION.includes('v1'), 'AO');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2.includes('v2'), 'AP');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3.includes('v3'), 'AQ');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4.includes('v4'), 'AR');
assert(CANONICAL_ROAD_CONTRACT_REFRESH_POLICY_VERSION.includes('refresh-game-time'), 'policy');
assert(ROAD_CONTRACT_ISSUANCE_READINESS === 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION', 'readiness');
assert(!PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('CONTRACT_REFRESH_GAME_TIME_PARITY_BLOCKED' as never), 'refresh blocker removed');
assert(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('PUBLIC_CONTRACTS_UI_UNWIRED'), 'public ui blocker');
assert(rules.includes('canonicalRoadContractRefresh') && rules.includes('allow write: if false'), 'rules');
assert(index.includes('refreshCanonicalRoadContractBatchInternal'), 'callable');
assert(CONTRACT_REFRESH_GAME_TIME_PARITY_STATUS === 'CONTRACT_REFRESH_GAME_TIME_PARITY_PASS_INTERNAL_ONLY', 'status');
const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'coverage');
assert(coverage.criticalCanonicalizedCount === 0, 'canonical');
assert(coverage.criticalBlockedCount === 24, 'blocked');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(JSON.stringify({
  CONTRACT_REFRESH_GAME_TIME_PARITY_STATUS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
  REFRESH_AD_OVERRIDE_CLASSIFICATION,
  CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
  CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
  CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
}));
