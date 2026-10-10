/**
 * Map V2 Step 29AB contract world-event authority.
 * Run: node --import tsx scripts/map-v2-contract-world-event-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { contractBalance, contractPaymentBalance } from '../src/config/balance';
import { WORLD_EVENT_TEMPLATES } from '../src/data/worldEvents';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_CONTRACT_EVENT_CATALOG,
  CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION,
  CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY,
  CONTRACT_EVENT_CLOCK,
  CONTRACT_EVENT_OWNERSHIP,
  CONTRACT_EVENT_RNG_PARITY,
  CONTRACT_EVENT_STACKING,
  CONTRACT_REFRESH_GAME_TIME_PARITY,
  CONTRACT_WORLD_EVENT_AUTHORITY_STATUS,
  CONTRACT_WORLD_EVENT_DIAGNOSTIC,
  activeContractEventSnapshot,
  contractEventAdjustmentForOffer,
  isCanonicalContractWorldEventAllowed,
  planCanonicalContractEventAdvance,
  validateCanonicalContractEvents,
} from '../src/domain/canonicalContractWorldEvents';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2,
  PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
  generateCanonicalProductionRoadOffers,
  hasOnlyCanonicalProductionRoadIssuanceKeys,
} from '../src/domain/canonicalProductionRoadContractIssuance';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { buildGlobalEventsForEpoch } from '../src/simulation/globalMarketSnapshot';
import { applyWorldEventImpactToContract, isWorldEventActiveAt } from '../src/simulation/worldEvents';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import type { Contract, WorldEvent } from '../src/types/game';

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

const DAY = 86_400_000;
const NOW = 4 * DAY + 3_600_000;

function sampleEvent(overrides: Partial<WorldEvent> & Pick<WorldEvent, 'id' | 'type'>): WorldEvent {
  return {
    title: 't',
    description: 'd',
    startsAtDay: 1,
    endsAtDay: 3,
    durationDays: 2,
    startsAt: 0,
    endsAt: 10 * DAY,
    impact: {},
    severity: 'medium',
    isActive: true,
    ...overrides,
  };
}

console.log('\n=== Map V2 Contract World Event Authority (Step 29AB) ===\n');

const worldEvents = read('src/data/worldEvents.ts');
const worldEventSim = read('src/simulation/worldEvents.ts');
const store = read('src/store/gameStore.ts');
const issuance = read('src/domain/canonicalProductionRoadContractIssuance.ts');
const eventDomain = read('src/domain/canonicalContractWorldEvents.ts');
const backendIssuance = read('backend/src/canonicalProductionRoadContractIssuance.ts');
const delivery = read('backend/src/canonicalRoadDelivery.ts');
const incidents = read('src/domain/canonicalRoadIncidentFragileFailure.ts');
const rules = read('firestore.rules');
const marketTick = read('src/domain/canonicalProductionMarketTick.ts');

assert(worldEvents.includes("type: 'port_congestion'"), 'A templates unchanged');
assert(worldEvents.includes("type: 'road_work'"), 'A road work');
assert(worldEvents.includes("type: 'cold_chain_demand'"), 'A cold chain');
assert(store.includes('replenishContractsIfNeeded'), 'B contracts UI local');
assert(!store.includes('canonicalContractWorldEvents'), 'B store unwired');
assert(store.includes('Guests'), 'C guest');
assert(isCanonicalContractWorldEventAllowed({ envValue: null }) === false, 'D gate off');
assert(isCanonicalContractWorldEventAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'D gate on');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ eventId: 'x' }) === false, 'E event id');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ eventIds: ['x'] }) === false, 'E event ids');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ activeEvents: [] }) === false, 'E active');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ paymentMultiplier: 1.1 }) === false, 'F payment');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ durationMultiplier: 1.1 }) === false, 'G duration');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ deadlineMultiplier: 1.1 }) === false, 'G deadline');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ eventSeed: 'no' }) === false, 'H seed');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ eventStart: 1 }) === false, 'H start');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ eventApplies: true }) === false, 'H applies');
assert(CANONICAL_CONTRACT_EVENT_CATALOG.length === WORLD_EVENT_TEMPLATES.length, 'I catalog');
assert(CANONICAL_CONTRACT_EVENT_CATALOG.length === 10, 'I ten');
assert(!eventDomain.includes('buildGlobalEventsForEpoch'), 'J market events separate');
assert(
  buildGlobalEventsForEpoch(100).every((row) => row.impact.contractPaymentMultiplier == null),
  'J epoch events have no contract payment multiplier',
);
assert(marketTick.includes('canonical-production-market-tick-internal-v1'), 'J market policy');
assert(!incidents.includes('canonicalContractWorldEvents'), 'K incidents separate');
assert(CONTRACT_EVENT_OWNERSHIP === 'GLOBAL_CONTRACT_EVENT', 'L ownership');
assert(CONTRACT_EVENT_CLOCK === 'CONTRACT_EVENT_CLOCK_INTERNAL_REAL_DAY', 'M clock');
const first = planCanonicalContractEventAdvance(null, NOW);
const second = planCanonicalContractEventAdvance(null, NOW);
assert(first.ok && second.ok, 'N plan');
if (first.ok && second.ok) {
  assert(first.state.activeEventIds.join() === second.state.activeEventIds.join(), 'N same ids');
  assert(first.state.seedKey === CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY, 'N seed');
  const restarted = planCanonicalContractEventAdvance(first.state, NOW + 1_000);
  assert(restarted.ok && restarted.advanced === false, 'O restart');
  if (restarted.ok) {
    assert(restarted.state.activeEventIds.join() === first.state.activeEventIds.join(), 'P same window');
  }
  assert(first.state.activeEventIds.length <= 4, 'L max active');
}
assert(CONTRACT_EVENT_RNG_PARITY.includes('DIFFERENT_SEQUENCE'), 'N rng class');
assert(worldEventSim.includes('hashSeed(`global-market:${seedKey}:${currentDay}:spawn`)'), 'N production seed');

const port = sampleEvent({
  id: 'port',
  type: 'port_congestion',
  cityId: 'izmir',
  impact: { contractPaymentMultiplier: 1.1, deliveryDurationMultiplier: 1.1 },
});
const hit = contractEventAdjustmentForOffer(
  { originCityId: 'antalya', destinationCityId: 'izmir', productId: 'beverage' },
  [port],
);
const miss = contractEventAdjustmentForOffer(
  { originCityId: 'ankara', destinationCityId: 'bursa', productId: 'steel' },
  [port],
);
assert(hit.paymentMultiplier === 1.1, 'Q payment');
assert(
  Math.min(contractPaymentBalance.absolutePaymentMax, Math.round(1600 * hit.paymentMultiplier)) === 1760,
  'R rounding',
);
assert(hit.durationMultiplier === 1.1, 'S duration');
assert(
  Math.min(
    contractBalance.maxDeadlineHours,
    Math.max(contractBalance.minDeadlineHours, 10 * hit.durationMultiplier),
  ) === 11,
  'T clamp',
);
assert(hit.eventIds.includes('port'), 'U match');
assert(miss.paymentMultiplier === 1 && miss.durationMultiplier === 1, 'V non-match');
const stacked = applyWorldEventImpactToContract(
  { originCityId: 'izmir', destinationCityId: 'ankara', productId: 'steel' } as Contract,
  [
    sampleEvent({ id: 'a', type: 'port_congestion', impact: { contractPaymentMultiplier: 1.2 } }),
    sampleEvent({ id: 'b', type: 'cold_chain_demand', impact: { contractPaymentMultiplier: 1.2 } }),
  ],
  1000,
  8,
);
assert(stacked.paymentMultiplier === 1.25, 'W stacking');
assert(CONTRACT_EVENT_STACKING === 'MULTIPLY_THEN_CLAMP_1_TO_1_25', 'W policy');
const edge = sampleEvent({ id: 'edge', type: 'road_work', startsAt: 1000, endsAt: 2000, durationDays: 1 });
assert(isWorldEventActiveAt(edge, 999) === false, 'X before');
assert(isWorldEventActiveAt(edge, 1000) === true, 'X start');
assert(isWorldEventActiveAt(edge, 1500) === true, 'X during');
assert(isWorldEventActiveAt(edge, 2000) === true, 'Y end');
assert(isWorldEventActiveAt(edge, 2001) === false, 'Y after');
assert(backendIssuance.includes("status: 'PARTIAL'"), 'Z snapshot before complete');
assert(backendIssuance.indexOf("status: 'PARTIAL'") < backendIssuance.indexOf('TEST_PARTIAL_ROAD_ISSUANCE'), 'AA freeze before crash');
assert(issuance.includes('contractEventSnapshot'), 'Z offer snapshot');
assert(!delivery.includes('canonicalRoadContractEvents'), 'AC acceptance does not read event schedule');
assert(delivery.includes('deadlineHours: contract.deadlineHours'), 'AC stored deadline');
assert(validateCanonicalContractEvents([{ id: 'x', type: 'nope' }]).ok === false, 'AD unknown');
assert(
  validateCanonicalContractEvents([
    sampleEvent({ id: 'bad', type: 'port_congestion', impact: { contractPaymentMultiplier: Number.NaN } }),
  ]).ok === false,
  'AE malformed',
);
assert(!eventDomain.includes('applyCanonicalCashMutations'), 'AF no cash');
assert(!eventDomain.includes('canonicalCashTransactions'), 'AG no cash tx');
assert(!backendIssuance.includes('applyCanonicalCashMutations'), 'AG backend cash');
assert(ROAD_CONTRACT_ISSUANCE_READINESS === 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION', 'AH readiness');
assert(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('PUBLIC_CONTRACTS_UI_UNWIRED'), 'AH expiry');
assert(CONTRACT_REFRESH_GAME_TIME_PARITY === 'CONTRACT_REFRESH_GAME_TIME_PARITY_PASS_INTERNAL_ONLY', 'AH refresh');
assert(
  canUseServerAuthoritativeSettlement({
    signedInLinked: true,
    cashAuthorityVersion: 0,
    serverStateCashPresent: true,
    reconciliationActive: true,
    staleSaveProtectionActive: true,
  }).ready === false,
  'AI settlement',
);
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AJ overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AK listener');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AL version');
assert(SAVE_GAME_VERSION === 6, 'AM save');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AN rail');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AN sea');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AN air');
assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'AO multimodal');
assert(
  CONTRACT_WORLD_EVENT_AUTHORITY_STATUS === 'CONTRACT_WORLD_EVENT_AUTHORITY_PASS_INTERNAL_ONLY',
  'status',
);
assert(CONTRACT_WORLD_EVENT_DIAGNOSTIC === 'CONTRACT_WORLD_EVENT_INTERNAL_ONLY', 'diagnostic');
assert(
  CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION === 'canonical-road-contract-world-event-internal-v1',
  'policy',
);
assert(
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION ===
    'canonical-road-contract-issuance-internal-production-parity-v1',
  'v1',
);
assert(
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2 ===
    'canonical-road-contract-issuance-internal-production-parity-v2',
  'v2',
);
assert(rules.includes('canonicalRoadContractEvents') && rules.includes('allow write: if false'), 'rules');
assert(store.includes('worldEvents: snapshot.activeEvents'), 'public still assigns epoch events');
const legacy = generateCanonicalProductionRoadOffers({
  uid: 'u',
  serverNowMs: 1,
  playerLevel: 0,
  playerReputation: 0,
  ownedMaxTruckCapacity: 25,
  marketRows: [],
  fuelPricePerLiter: 1.72,
});
assert(legacy.ok === false, 'v1 empty still fails closed');
if (first.ok) {
  const snap = activeContractEventSnapshot(first.state);
  assert(snap.policyVersion === CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION, 'snapshot policy');
}
const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'coverage total');
assert(coverage.criticalCanonicalizedCount === 0, 'coverage canonical');
assert(coverage.criticalBlockedCount === 24, 'coverage blocked');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    CONTRACT_WORLD_EVENT_AUTHORITY_STATUS,
    CONTRACT_WORLD_EVENT_DIAGNOSTIC,
    ROAD_CONTRACT_ISSUANCE_READINESS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
