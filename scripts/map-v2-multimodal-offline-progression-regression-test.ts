/**
 * Map V2 Step 29 multimodal INTERNAL_TEST offline progression.
 * Run: npx tsx scripts/map-v2-multimodal-offline-progression-regression-test.ts
 */
import './test-globals';
import { generateRailMultimodalOffers } from '../src/domain/multimodalRailOffer';
import {
  commitRailMultimodalAcceptance,
  prepareRailMultimodalAcceptance,
} from '../src/domain/multimodalRailAcceptance';
import { progressExecutableMultimodalShipments } from '../src/domain/multimodalRailExecution';
import { createDevMultimodalRoadPlanningFleet } from '../src/mapV2/gameplay/devMultimodalRoadPlanningFleet';
import { getTurkeyRoadTransferAccessArtifact } from '../src/mapV2/world/multimodalRoadTransferAccessLoader';

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

console.log('\n=== Map V2 Multimodal INTERNAL_TEST Offline Progression ===\n');

const access = getTurkeyRoadTransferAccessArtifact();
const generated = generateRailMultimodalOffers({
  generationSeed: 'offline-rail-v1',
  accessArtifact: access,
  playerLevel: 20,
});
const offer = generated.offers[0];
const fleet = createDevMultimodalRoadPlanningFleet({
  originCityId: offer.originCityId,
  destinationCityId: offer.destinationCityId,
});
const prepared = prepareRailMultimodalAcceptance({
  offer,
  accessArtifact: access,
  fleet,
  shipments: [],
  currentTimeGameHours: 5,
  nowMs: 1_000,
  allowAcceptance: true,
});
if (prepared.status !== 'READY_TO_COMMIT') {
  console.log('prepare failed', prepared);
  process.exit(1);
}
const money = 42_000;
const committed = commitRailMultimodalAcceptance({
  player: {
    trucks: fleet.trucks.map((row) => ({ ...row })),
    drivers: fleet.drivers.map((row) => ({ ...row })),
    trailers: [],
    money,
    reputation: 40,
    xp: 3,
  },
  activeDeliveries: [],
  availableContracts: [],
  financeLedger: [],
  multimodalShipments: [],
  prepared,
});
const snap = prepared.shipment.durationSnapshot!;
const stages = [
  ['0s', 0, 'FIRST_MILE_ROAD'],
  ['partial first-mile', Math.floor(snap.firstMileGameSeconds / 3), 'FIRST_MILE_ROAD'],
  ['exact first-mile', snap.firstMileGameSeconds, 'ORIGIN_TRANSFER'],
  ['overflow transfer', snap.firstMileGameSeconds + Math.floor(snap.originTransferGameSeconds / 2), 'ORIGIN_TRANSFER'],
  [
    'into rail',
    snap.firstMileGameSeconds + snap.originTransferGameSeconds + 1,
    'RAIL_LINEHAUL',
  ],
  [
    'into dest transfer',
    snap.firstMileGameSeconds +
      snap.originTransferGameSeconds +
      snap.railLinehaulGameSeconds +
      1,
    'DESTINATION_TRANSFER',
  ],
  [
    'partial last-mile',
    snap.firstMileGameSeconds +
      snap.originTransferGameSeconds +
      snap.railLinehaulGameSeconds +
      snap.destinationTransferGameSeconds +
      Math.floor(snap.lastMileGameSeconds / 2),
    'LAST_MILE_ROAD',
  ],
  ['exact completion', snap.totalDurationGameSeconds, 'COMPLETED_UNSETTLED'],
  ['massive', snap.totalDurationGameSeconds * 50, 'COMPLETED_UNSETTLED'],
] as const;

for (const [label, seconds, stage] of stages) {
  const result = progressExecutableMultimodalShipments({
    shipments: committed.multimodalShipments,
    player: committed.player,
    elapsedGameSeconds: seconds,
    nowMs: 2_000,
  });
  const row = result.shipments[0];
  const got = 'executionStage' in row ? row.executionStage : '';
  assert(got === stage, `${label} → ${stage} (got ${got})`);
  assert(result.player.money === money, `${label} money unchanged`);
}

const mid = progressExecutableMultimodalShipments({
  shipments: committed.multimodalShipments,
  player: committed.player,
  elapsedGameSeconds: Math.floor(snap.firstMileGameSeconds / 2),
  nowMs: 3_000,
});
const sameStamp = progressExecutableMultimodalShipments({
  shipments: mid.shipments,
  player: mid.player,
  elapsedGameSeconds: 0,
  nowMs: 3_000,
});
assert(sameStamp.status === 'NO_ELAPSED_TIME', 'repeat 0 seconds');
const reload = progressExecutableMultimodalShipments({
  shipments: mid.shipments,
  player: mid.player,
  elapsedGameSeconds: Math.floor(snap.firstMileGameSeconds / 4),
  nowMs: 4_000,
});
assert(
  'executionStage' in reload.shipments[0] && reload.shipments[0].executionStage === 'FIRST_MILE_ROAD',
  'reload mid-stage',
);

if (fail > 0) {
  console.log(`\nFAILED ${fail} passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
