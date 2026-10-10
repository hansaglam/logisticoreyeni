/**
 * Map V2 Step 29AD contract game-time expiry.
 * Run: node --import tsx scripts/map-v2-contract-game-time-expiry-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { contractExpiryBalance, realMsToGameHours } from '../src/config/balance';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_CONTRACT_EXPIRY_POLICY_VERSION,
  CONTRACT_EXPIRY_BACKGROUND_CLASS,
  CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_STATUS,
  CONTRACT_REFRESH_GAME_TIME_PARITY,
  GLOBAL_GAME_CLOCK_RECOMMENDATION,
  advanceCanonicalContractClock,
  createInitialCanonicalContractClock,
  isCanonicalContractExpiryAllowed,
  isCanonicalOfferExpiredAtGameHours,
  setCanonicalContractClockPaused,
  setCanonicalContractClockSpeed,
} from '../src/domain/canonicalContractGameTimeExpiry';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4,
  ROAD_CONTRACT_ISSUANCE_READINESS,
  hasOnlyCanonicalProductionRoadIssuanceKeys,
} from '../src/domain/canonicalProductionRoadContractIssuance';
import { hasOnlyCanonicalRoadAcceptKeys } from '../src/domain/canonicalRoadDelivery';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { calculateContractExpiresAt } from '../src/simulation/contracts';

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

console.log('\n=== Map V2 Contract Game-Time Expiry (Step 29AD) ===\n');

const store = read('src/store/gameStore.ts');
const contracts = read('src/simulation/contracts.ts');
const issuance = read('src/domain/canonicalProductionRoadContractIssuance.ts');
const accept = read('backend/src/canonicalRoadDelivery.ts');
const rules = read('firestore.rules');
const index = read('backend/src/index.ts');

assert(store.includes('generateContracts') || contracts.includes('export function generateContracts'), 'A public contracts');
assert(!store.includes('canonicalContractClock'), 'A store unwired');
assert(store.includes('Guests') || store.includes('guest'), 'B guest');
assert(isCanonicalContractExpiryAllowed({ envValue: null }) === false, 'C gate off');
assert(contracts.includes('calculateContractExpiresAt'), 'D production expiry');
assert(contracts.includes('deadlineHours') && contracts.includes('expiresAt'), 'E separate fields');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ expiresAt: 1 }) === false, 'F expiresAt');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ gameTime: 1 }) === false, 'G gameTime');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ elapsedGameHours: 1 }) === false, 'H elapsed');
assert(hasOnlyCanonicalRoadAcceptKeys({ contractId: 'a', canonicalSchemaVersion: 1, currentGameTime: 4 }) === false, 'H accept');
assert(issuance.includes('contractGameTime'), 'I server clock');
const issuedAt = 100;
const lifetime = calculateContractExpiresAt(issuedAt, 8, 0.2) - issuedAt;
assert(lifetime >= contractExpiryBalance.normalMinHours && lifetime <= contractExpiryBalance.normalMaxHours, 'L ttl');
assert(isCanonicalOfferExpiredAtGameHours(issuedAt + lifetime, issuedAt + lifetime), 'M boundary');
assert(isCanonicalOfferExpiredAtGameHours(issuedAt + lifetime - 0.001, issuedAt + lifetime) === false, 'M before');
const now = 1_700_000_000_000;
let clock = createInitialCanonicalContractClock(now);
clock = advanceCanonicalContractClock(clock, now + 15_000).ok
  ? advanceCanonicalContractClock(clock, now + 15_000).state ?? clock
  : clock;
const paused = setCanonicalContractClockPaused(clock, true, now + 15_000);
assert(paused.ok, 'N pause');
if (paused.ok) {
  const held = advanceCanonicalContractClock(paused.state, now + 15_000 + 5 * 60 * 60 * 1000);
  assert(held.ok && held.state.currentGameHours === paused.state.currentGameHours, 'N held');
}
const slow = advanceCanonicalContractClock(createInitialCanonicalContractClock(now), now + 15_000);
const fastBase = setCanonicalContractClockSpeed(createInitialCanonicalContractClock(now), 8, now);
const fast = fastBase.ok ? advanceCanonicalContractClock(fastBase.state, now + 15_000) : fastBase;
assert(slow.ok && fast.ok && fast.state.currentGameHours > slow.state.currentGameHours, 'O speed');
assert(realMsToGameHours(15_000, 1) === 1 && realMsToGameHours(1_000, 8) === 1, 'O same game hour');
const stepped = setCanonicalContractClockSpeed(
  slow.ok ? slow.state : createInitialCanonicalContractClock(now),
  8,
  now + 15_000,
);
assert(stepped.ok, 'P transition');
const away = advanceCanonicalContractClock(createInitialCanonicalContractClock(now), now + 48 * 60 * 60 * 1000);
assert(away.ok && away.state.currentGameHours === 24, 'Q offline cap');
assert(CONTRACT_EXPIRY_BACKGROUND_CLASS.includes('BACKGROUND'), 'R background class');
const restarted = advanceCanonicalContractClock(away.ok ? away.state : clock, away.ok ? away.state.lastAdvancedAtServerMs : now);
assert(restarted.ok && away.ok && restarted.state.currentGameHours === away.state.currentGameHours, 'S restart');
const backward = advanceCanonicalContractClock(away.ok ? away.state : clock, now - 86_400_000);
assert(backward.ok && away.ok && backward.state.currentGameHours === away.state.currentGameHours, 'J K device clock');
assert(accept.includes('isCanonicalOfferExpiredAtGameHours'), 'AB AC accept');
assert(accept.includes('CONTRACT_EXPIRED'), 'AB error');
assert(issuance.includes('CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4') || read('src/domain/canonicalProductionRoadContractIssuance.ts').includes('v4'), 'AH');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION.includes('v1'), 'AE');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2.includes('v2'), 'AF');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3.includes('v3'), 'AG');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4.includes('v4'), 'AH v4');
assert(CANONICAL_CONTRACT_EXPIRY_POLICY_VERSION.includes('game-clock'), 'policy');
assert(!read('src/domain/canonicalContractGameTimeExpiry.ts').includes('applyCanonicalCashMutations'), 'AI cash');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AJ');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AK');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AL');
assert(canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 0,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
}).ready === false, 'AM');
assert(CONTRACT_REFRESH_GAME_TIME_PARITY === 'CONTRACT_REFRESH_GAME_TIME_PARITY_PASS_INTERNAL_ONLY', 'AN');
assert(ROAD_CONTRACT_ISSUANCE_READINESS === 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION', 'readiness');
assert(SAVE_GAME_VERSION === 6, 'AO');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AP');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AP sea');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AP air');
assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'AQ');
assert(rules.includes('canonicalContractClock') && rules.includes('allow write: if false'), 'rules');
assert(!index.includes('setTruckLocation'), 'no location setter');
assert(GLOBAL_GAME_CLOCK_RECOMMENDATION === 'YES', 'global clock');
assert(CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_STATUS === 'CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_PASS_INTERNAL_ONLY', 'status');
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
  CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_STATUS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
  GLOBAL_GAME_CLOCK_RECOMMENDATION,
  CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
  CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
  CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
}));
