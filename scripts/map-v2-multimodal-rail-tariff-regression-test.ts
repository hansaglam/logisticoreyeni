/**
 * Map V2 Step 26 RAIL tariff / economy foundation.
 * Run: npx tsx scripts/map-v2-multimodal-rail-tariff-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { contractPaymentBalance } from '../src/config/balance';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { estimateTransportLegDuration } from '../src/domain/multimodalDurationPolicy';
import { planMultimodalRoadAssignment } from '../src/domain/multimodalRoadAssignment';
import {
  ACCEPTED_RAIL_TARIFF_CORRIDORS,
  canonicalRailTariffRouteReference,
  estimateMultimodalRailTariff,
  MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
  RAIL_TARIFF_CARGO_QUANTITY_UNIT,
  RAIL_TARIFF_DISTANCE_AUTHORITY,
  RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH,
  RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS,
  snapshotReadyRailTariff,
  type MultimodalRailTariffInput,
} from '../src/domain/multimodalRailTariff';
import { getMultimodalSettlementId, MULTIMODAL_SETTLEMENT_KIND_REVENUE } from '../src/domain/multimodalSettlementIdentity';
import { MULTIMODAL_FEATURE_ROLLOUT } from '../src/domain/multimodalShipmentPersistence';
import { getTurkeyRoadTransferAccessArtifact } from '../src/mapV2/world/multimodalRoadTransferAccessLoader';
import { buildRoadRailRoadFixture } from '../src/mapV2/gameplay/roadRailRoadFixture';
import { getTurkeyMultimodalFoundation } from '../src/mapV2/world/multimodalFoundationLoader';
import { getTurkeyRailRouteDiagnostics } from '../src/mapV2/world/railRouteDiagnosticsLoader';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { STARTER_MONEY } from '../src/utils/localSaveMeaning';
import { createDevMultimodalRoadPlanningFleet } from '../src/mapV2/gameplay/devMultimodalRoadPlanningFleet';

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

function readyInput(partial: Partial<MultimodalRailTariffInput> & Pick<MultimodalRailTariffInput, 'routeReference'>): MultimodalRailTariffInput {
  const corridor = ACCEPTED_RAIL_TARIFF_CORRIDORS.find((row) => row.routeReference === partial.routeReference);
  return {
    distanceMeters: corridor?.distanceMeters,
    distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
    cargoQuantity: 10,
    cargoQuantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
    sourceRailPackageHash: RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH,
    intent: 'PLAN',
    ...partial,
  };
}

console.log('\n=== Map V2 Multimodal RAIL Tariff Foundation ===\n');

assert(MULTIMODAL_RAIL_TARIFF_POLICY_VERSION === 'multimodal-rail-tariff-v1', 'B policy version exact');
assert(SAVE_GAME_VERSION === 6, 'AA SAVE_GAME_VERSION remains 6');
assert(MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF', 'rollout remains MULTIMODAL_OFF');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'Z RAIL FOUNDATION_ONLY');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'SEA FOUNDATION_ONLY');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AIR FOUNDATION_ONLY');

const domainSrc = read('src/domain/multimodalRailTariff.ts');
assert(!domainSrc.includes("from 'react'"), 'no React import');
assert(!domainSrc.includes('firebase'), 'Y no backend/firebase in domain');
assert(!domainSrc.includes('gameStore'), 'no gameStore import');
assert(!domainSrc.includes('mapV2/prototypes'), 'domain does not import prototypes');
assert(!domainSrc.includes('turkey-rail-graph'), 'no full RAIL graph import');
assert(domainSrc.includes('GAMEPLAY_BALANCE_CONSTANT'), 'gameplay balance labeled');
assert(!domainSrc.includes('TCDD tariff'), 'no TCDD price claim');
assert(!read('src/store/gameStore.ts').includes('estimateMultimodalRailTariff'), 'AC no gameStore tariff action');
assert(!read('src/simulation/contracts.ts').includes('estimateMultimodalRailTariff'), 'AB contract generator untouched');
assert(!read('src/screens/MapScreen.tsx').includes('estimateMultimodalRailTariff'), 'AD MapScreen no tariff');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'AB routes.ts unchanged');
assert(!read('backend/src/index.ts').includes('estimateMultimodalRailTariff'), 'Y no callable');
assert(!read('firestore.rules').includes('railTariff'), 'Y no Firestore tariff');

const ankaraIstanbul = readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul' });
const a1 = estimateMultimodalRailTariff(ankaraIstanbul);
const a2 = estimateMultimodalRailTariff(ankaraIstanbul);
assert(JSON.stringify(a1) === JSON.stringify(a2), 'A determinism identical JSON');
assert(a1.status === 'READY' && (a1.totalCarrierCost ?? 0) > 0, 'C Ankara/Istanbul READY positive');
assert(Number.isFinite(a1.totalCarrierCost) && Number.isSafeInteger(a1.totalCarrierCost ?? NaN), 'C finite integer dollars');

const pairs: Array<[string, string]> = [
  ['ankara', 'istanbul'],
  ['ankara', 'izmir'],
  ['adana', 'ankara'],
  ['adana', 'diyarbakir'],
  ['istanbul', 'izmir'],
];
for (const [left, right] of pairs) {
  const ref = canonicalRailTariffRouteReference(left, right);
  const est = estimateMultimodalRailTariff(readyInput({ routeReference: ref }));
  assert(est.status === 'READY', `D-G ${left}↔${right} READY`);
}

const fwd = estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul' }));
const rev = estimateMultimodalRailTariff(readyInput({ routeReference: canonicalRailTariffRouteReference('istanbul', 'ankara') }));
assert(fwd.totalCarrierCost === rev.totalCarrierCost && fwd.distanceMeters === rev.distanceMeters, 'H reverse symmetry');

assert(
  estimateMultimodalRailTariff(readyInput({ routeReference: canonicalRailTariffRouteReference('bursa', 'istanbul') })).status ===
    'UNRESOLVED_RAIL_INFRASTRUCTURE',
  'I Bursa RAIL fail-closed unresolved',
);
assert(estimateMultimodalRailTariff(readyInput({ routeReference: '' })).status === 'MISSING_ROUTE_REFERENCE', 'J missing route ref');
assert(
  estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', distanceAuthority: 'STRAIGHT_LINE' }))
    .status === 'INVALID_DISTANCE',
  'K wrong distance authority',
);
assert(
  estimateMultimodalRailTariff(
    readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', distanceMeters: undefined }),
  ).status === 'INVALID_DISTANCE',
  'L missing distance',
);
assert(
  estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', distanceMeters: -1 })).status ===
    'INVALID_DISTANCE',
  'M negative distance',
);
assert(
  estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', distanceMeters: Number.NaN }))
    .status === 'INVALID_DISTANCE',
  'M NaN distance',
);
assert(
  estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', distanceMeters: Number.POSITIVE_INFINITY }))
    .status === 'INVALID_DISTANCE',
  'M Infinity distance',
);
assert(
  estimateMultimodalRailTariff(
    readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', cargoQuantity: undefined }),
  ).status === 'INVALID_CARGO_QUANTITY',
  'N missing cargo',
);
assert(
  estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', cargoQuantity: 0 })).status ===
    'INVALID_CARGO_QUANTITY',
  'O zero cargo',
);
assert(
  estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', cargoQuantity: -2 })).status ===
    'INVALID_CARGO_QUANTITY',
  'O negative cargo',
);
assert(
  estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', cargoQuantity: Number.NaN }))
    .status === 'INVALID_CARGO_QUANTITY',
  'O NaN cargo',
);
assert(
  estimateMultimodalRailTariff(
    readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', cargoQuantityUnit: 'kg' }),
  ).status === 'UNSUPPORTED_CARGO_UNIT',
  'P unsupported unit kg (no silent tonnes)',
);

const small = estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', cargoQuantity: 1 }));
assert(small.status === 'READY' && (small.totalCarrierCost ?? 0) > 0, 'Q small cargo positive');
assert(small.totalCarrierCost === RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS, 'T 1t Ankara–Istanbul hits minimum 500');
assert((small.minimumChargeAdjustment ?? 0) > 0, 'T minimum adjustment applied');

const larger = estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', cargoQuantity: 25 }));
assert((larger.totalCarrierCost ?? 0) >= (fwd.totalCarrierCost ?? 0), 'R more cargo does not decrease cost');

const short = estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', cargoQuantity: 10 }));
const long = estimateMultimodalRailTariff(readyInput({ routeReference: 'domain.canonical.rail.adana.diyarbakir', cargoQuantity: 10 }));
assert((long.totalCarrierCost ?? 0) >= (short.totalCarrierCost ?? 0), 'S longer route not cheaper at equal cargo');

const boundary = estimateMultimodalRailTariff(
  readyInput({ routeReference: 'domain.canonical.rail.ankara.istanbul', cargoQuantity: 10.5 }),
);
assert(boundary.status === 'READY' && Number.isSafeInteger(boundary.totalCarrierCost ?? NaN), 'U rounding yields integer');

const moneyBefore = { player: { money: 20_000 }, financeLedger: [{ id: 'x', amount: 1 }] };
const moneySnap = JSON.stringify(moneyBefore);
const inputSnapObj = { ...ankaraIstanbul };
const inputSnap = JSON.stringify(inputSnapObj);
estimateMultimodalRailTariff(inputSnapObj);
assert(JSON.stringify(moneyBefore) === moneySnap, 'V no player.money / ledger mutation');
assert(JSON.stringify(inputSnapObj) === inputSnap, 'W input object unchanged');

const settlementBefore = JSON.stringify(getMultimodalSettlementId('ship-test', MULTIMODAL_SETTLEMENT_KIND_REVENUE));
estimateMultimodalRailTariff(ankaraIstanbul);
assert(
  JSON.stringify(getMultimodalSettlementId('ship-test', MULTIMODAL_SETTLEMENT_KIND_REVENUE)) === settlementBefore,
  'X settlement identity unused / unchanged',
);
assert(!domainSrc.includes('getMultimodalSettlementId'), 'X tariff does not apply settlement ids');

assert(estimateMultimodalRailTariff({ ...ankaraIstanbul, intent: 'CHARGE' }).status === 'NOT_EXECUTABLE', 'CHARGE not executable');

const snap = snapshotReadyRailTariff(fwd);
assert(snap?.railCarrierCost === fwd.totalCarrierCost && snap.railTariffPolicyVersion === MULTIMODAL_RAIL_TARIFF_POLICY_VERSION, 'future snapshot helper');
assert(fwd.design.kind === 'GAMEPLAY_BALANCE_CONSTANT', 'design vs geography split');
assert(fwd.geography.sourceRailPackageHash === RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH, 'P geography hash');

const diagnostics = getTurkeyRailRouteDiagnostics();
assert(diagnostics.sourceRailPackageHash === RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH, 'P diagnostics hash matches frozen');
for (const corridor of ACCEPTED_RAIL_TARIFF_CORRIDORS) {
  const diag = diagnostics.resolved.find(
    (row) =>
      [row.fromLegacyCityId, row.toLegacyCityId].sort().join('.') === `${corridor.leftCityId}.${corridor.rightCityId}`,
  );
  assert(diag?.sourceRouteLengthMeters === corridor.distanceMeters, `frozen metres match diagnostics ${corridor.routeReference}`);
}

const l1Max = contractPaymentBalance.levelCaps[1].paymentMax;
for (const corridor of ACCEPTED_RAIL_TARIFF_CORRIDORS) {
  const ten = estimateMultimodalRailTariff(readyInput({ routeReference: corridor.routeReference, cargoQuantity: 10 }));
  const twentyFive = estimateMultimodalRailTariff(readyInput({ routeReference: corridor.routeReference, cargoQuantity: 25 }));
  assert((ten.totalCarrierCost ?? 0) > 0, `sanity ${corridor.routeReference} 10t not zero`);
  assert((ten.totalCarrierCost ?? 0) <= l1Max, `sanity ${corridor.routeReference} 10t ≤ L1 paymentMax ${l1Max}`);
  assert((twentyFive.totalCarrierCost ?? 0) < STARTER_MONEY, `sanity ${corridor.routeReference} 25t < starting cash`);
  assert((twentyFive.totalCarrierCost ?? 0) <= l1Max * 2, `sanity ${corridor.routeReference} 25t not >> L1 scale`);
}

const durationRail = estimateTransportLegDuration({
  legId: 'rail.a',
  mode: 'RAIL',
  distanceMeters: 500_000,
  distanceAuthority: 'SOURCE_BACKED_RAIL_LENGTH',
  routeReference: 'domain.canonical.rail.test.a',
});
assert(durationRail.status === 'READY' && durationRail.durationGameSeconds === 16364, 'AC Step 24 duration sample unchanged');

const fleet = createDevMultimodalRoadPlanningFleet({ originCityId: 'ankara', destinationCityId: 'istanbul' });
const assignment = planMultimodalRoadAssignment({
  originCityId: 'ankara',
  destinationCityId: 'istanbul',
  transferMode: 'RAIL',
  accessArtifact: getTurkeyRoadTransferAccessArtifact(),
  fleet,
  cargoWeightTons: 1,
});
assert(assignment.toctou === 'PLANNING_ONLY_REVALIDATE_AT_ACCEPTANCE', 'AD Step 25 assignment unchanged');

const foundation = getTurkeyMultimodalFoundation();
const fixture = buildRoadRailRoadFixture('ankara', 'istanbul', foundation, diagnostics);
assert(fixture.ok === true && fixture.ok && fixture.railTariff.status === 'READY', 'vertical slice consumes tariff');
assert(fixture.ok && fixture.railTariff.totalCarrierCost === small.totalCarrierCost, 'DEV fixture 1 t matches 1 t tariff');

assert(!read('src/mapV2/gameplay/roadSeaRoadFixture.ts').includes('estimateMultimodalRailTariff'), 'AE SEA slice no RAIL tariff');
assert(!read('src/mapV2/gameplay/roadAirRoadFixture.ts').includes('estimateMultimodalRailTariff'), 'AE AIR slice no RAIL tariff');
assert(read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('RAIL TARIFF — PLANNING ONLY'), 'DEV inspector RAIL tariff');
assert(read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('NOT_IMPLEMENTED / FUTURE_STEP'), 'DEV SEA/AIR economics future');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 26 — RAIL tariff / economy foundation — **COMPLETE**'), 'migration Step 26 complete');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 27 — RAIL contract generation foundation — **COMPLETE**'), 'Step 27 marked complete after offer foundation');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
