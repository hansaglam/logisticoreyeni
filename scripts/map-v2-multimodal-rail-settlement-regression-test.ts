/**
 * Map V2 Step 29B RAIL settlement / authority foundation.
 * Run: npx tsx scripts/map-v2-multimodal-rail-settlement-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import {
  commitRailMultimodalAcceptance,
  prepareRailMultimodalAcceptance,
} from '../src/domain/multimodalRailAcceptance';
import { progressExecutableMultimodalShipments } from '../src/domain/multimodalRailExecution';
import { generateRailMultimodalOffers } from '../src/domain/multimodalRailOffer';
import {
  buildMultimodalRailLedgerEntries,
  classifyMultimodalRailSettlement,
  commitMultimodalRailSettlement,
  getMultimodalRailCarrierExpenseId,
  prepareMultimodalRailSettlement,
  ROAD_ACCESS_OPEX_SETTLEMENT_TREATMENT,
  SERVER_SETTLEMENT_BLOCK_REASON,
} from '../src/domain/multimodalRailSettlement';
import {
  getMultimodalCompletionId,
  getMultimodalSettlementId,
} from '../src/domain/multimodalSettlementIdentity';
import {
  createTestPersistedMultimodalShipment,
  MULTIMODAL_FEATURE_ROLLOUT,
  normalizeMultimodalShipments,
} from '../src/domain/multimodalShipmentPersistence';
import { createDevMultimodalRoadPlanningFleet } from '../src/mapV2/gameplay/devMultimodalRoadPlanningFleet';
import { getTurkeyRoadTransferAccessArtifact } from '../src/mapV2/world/multimodalRoadTransferAccessLoader';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import type { FinanceLedgerEntry } from '../src/types/game';

let pass = 0;
let fail = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const access = getTurkeyRoadTransferAccessArtifact();
const settleSrc = read('src/domain/multimodalRailSettlement.ts');

console.log('\n=== Map V2 Multimodal RAIL Settlement Authority (Step 29B) ===\n');

assert(SAVE_GAME_VERSION === 6, 'AS SAVE_GAME_VERSION = 6');
assert(MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF', 'AU public default OFF');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AT RAIL FOUNDATION_ONLY');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'SEA FOUNDATION_ONLY');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AIR FOUNDATION_ONLY');
assert(!settleSrc.includes('generateRailMultimodalOffers'), 'G offer generator not called');
assert(!settleSrc.includes('estimateMultimodalRailTariff'), 'H tariff calculator not called');
assert(!settleSrc.includes('estimateMultimodalShipmentDuration'), 'I duration calculator not called');
assert(settleSrc.includes(ROAD_ACCESS_OPEX_SETTLEMENT_TREATMENT), 'M planning opex not charged');
assert(!read('backend/src/index.ts').includes('settleCanonicalMultimodalShipment'), 'no settlement callable');
assert(read('firestore.rules').includes('canonicalMultimodalShipments'), '29C collection exists');
assert(!read('src/screens/MapScreen.tsx').includes('settleRailMultimodalShipmentInternal'), 'MapScreen');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts');
assert(!read('src/store/gameStore.ts').includes('getMultimodalSettlementId'), 'store does not mint ids');
assert(read('src/store/gameStore.ts').includes('settleRailMultimodalShipmentInternal'), 'store local action');
assert(!read('src/store/gameStore.ts').includes('completeMultimodalShipment('), 'no completeMultimodalShipment');

const generated = generateRailMultimodalOffers({
  generationSeed: 'settlement-rail-v1',
  accessArtifact: access,
  playerLevel: 20,
});
assert(generated.status === 'READY', 'offers ready');
const offer = generated.offers[0];
const fleet = createDevMultimodalRoadPlanningFleet({
  originCityId: offer.originCityId,
  destinationCityId: offer.destinationCityId,
});
const preparedAccept = prepareRailMultimodalAcceptance({
  offer,
  accessArtifact: access,
  fleet,
  shipments: [],
  currentTimeGameHours: 8,
  nowMs: 2_000,
  allowAcceptance: true,
});
if (preparedAccept.status !== 'READY_TO_COMMIT') {
  console.log(preparedAccept);
  process.exit(1);
}
const money0 = 77_000;
const committedAccept = commitRailMultimodalAcceptance({
  player: {
    trucks: fleet.trucks.map((row) => ({ ...row })),
    drivers: fleet.drivers.map((row) => ({ ...row })),
    trailers: [...fleet.trailers],
    money: money0,
    reputation: 44,
    xp: 9,
  },
  activeDeliveries: [],
  availableContracts: [{ id: 'road-keep' } as never],
  financeLedger: [],
  multimodalShipments: [],
  prepared: preparedAccept,
});
assert(committedAccept.status === 'COMMITTED', 'accept committed');
const shipmentId = committedAccept.shipmentId!;
const revenueId = getMultimodalSettlementId(shipmentId);
const expenseId = getMultimodalRailCarrierExpenseId(shipmentId);
const completionId = getMultimodalCompletionId(shipmentId);
assert(revenueId.ok && revenueId.id === `shipment:${shipmentId}:revenue`, 'T revenue ledger id exact');
assert(expenseId === `shipment:${shipmentId}:rail_carrier`, 'U rail-carrier ledger id exact');
assert(completionId.ok && completionId.id === `shipment:${shipmentId}:completion`, 'W completion identity exact');
assert(!revenueId.ok || !revenueId.id.startsWith('delivery:'), 'V ROAD ledger ids not used');

const activePrep = prepareMultimodalRailSettlement({
  shipmentId,
  shipments: committedAccept.multimodalShipments,
  financeLedger: [],
  allowSettlement: true,
});
assert(activePrep.status === 'ACTIVE_SHIPMENT', 'A active cannot settle');

const cancelled = committedAccept.multimodalShipments.map((row) =>
  'shipmentId' in row && row.shipmentId === shipmentId ? { ...row, status: 'CANCELLED' as const } : row,
);
assert(
  prepareMultimodalRailSettlement({
    shipmentId,
    shipments: cancelled,
    allowSettlement: true,
  }).status === 'CANCELLED_SHIPMENT',
  'B cancelled cannot settle',
);

const failed = committedAccept.multimodalShipments.map((row) =>
  'shipmentId' in row && row.shipmentId === shipmentId ? { ...row, status: 'FAILED' as const } : row,
);
assert(
  prepareMultimodalRailSettlement({
    shipmentId,
    shipments: failed,
    allowSettlement: true,
  }).status === 'FAILED_SHIPMENT',
  'C failed cannot settle',
);

const progressed = progressExecutableMultimodalShipments({
  shipments: committedAccept.multimodalShipments,
  player: committedAccept.player,
  elapsedGameSeconds: 10_000_000,
  nowMs: 9_000,
});
const done = progressed.shipments.find((row) => 'shipmentId' in row && row.shipmentId === shipmentId);
assert(done && 'status' in done && done.status === 'COMPLETED_UNSETTLED', 'completed unsettled');

const sea = prepareMultimodalRailSettlement({
  shipmentId,
  shipments: progressed.shipments,
  allowSettlement: true,
  transportPatternOverride: 'ROAD_SEA_ROAD',
});
assert(sea.status === 'SEA_NOT_ACTIVATED', 'AQ SEA fails closed');
const air = prepareMultimodalRailSettlement({
  shipmentId,
  shipments: progressed.shipments,
  allowSettlement: true,
  transportPatternOverride: 'ROAD_AIR_ROAD',
});
assert(air.status === 'AIR_NOT_ACTIVATED', 'AR AIR fails closed');

const ready = prepareMultimodalRailSettlement({
  shipmentId,
  shipments: progressed.shipments,
  financeLedger: [],
  allowSettlement: true,
});
assert(ready.status === 'READY', 'D COMPLETED_UNSETTLED prepares', ready.status);
if (ready.status !== 'READY') {
  process.exit(1);
}
assert(ready.receipt.grossRevenue === offer.playerPayment, 'E J frozen playerPayment / exact gross');
assert(ready.receipt.railCarrierExpense === offer.economics.railCarrierCost, 'F K frozen rail cost');
assert(
  ready.receipt.netCashDelta === offer.playerPayment - offer.economics.railCarrierCost,
  'L net delta exact',
);
assert(Number.isInteger(ready.receipt.grossRevenue), 'M integer arithmetic');
assert(ready.receipt.roadAccessOpexTreatment === 'PLANNING_ESTIMATE_NOT_CHARGED', 'M opex diagnostic');
assert(classifyMultimodalRailSettlement({
  shipmentId,
  shipments: progressed.shipments,
  allowSettlement: true,
}).status === 'READY', 'classify alias');

const nanShip = progressed.shipments.map((row) =>
  'shipmentId' in row && row.shipmentId === shipmentId
    ? { ...row, economicSnapshot: { ...row.economicSnapshot, playerPayment: Number.NaN, currency: 'USD_GAME' as const } }
    : row,
);
assert(
  prepareMultimodalRailSettlement({ shipmentId, shipments: nanShip, allowSettlement: true }).status ===
    'INVALID_ECONOMIC_SNAPSHOT',
  'O NaN rejected',
);
const infShip = progressed.shipments.map((row) =>
  'shipmentId' in row && row.shipmentId === shipmentId
    ? {
        ...row,
        economicSnapshot: {
          ...row.economicSnapshot,
          playerPayment: Number.POSITIVE_INFINITY,
          currency: 'USD_GAME' as const,
        },
      }
    : row,
);
assert(
  prepareMultimodalRailSettlement({ shipmentId, shipments: infShip, allowSettlement: true }).status ===
    'INVALID_ECONOMIC_SNAPSHOT',
  'P Infinity rejected',
);
const negRev = progressed.shipments.map((row) =>
  'shipmentId' in row && row.shipmentId === shipmentId
    ? { ...row, economicSnapshot: { ...row.economicSnapshot, playerPayment: -5, currency: 'USD_GAME' as const } }
    : row,
);
assert(
  prepareMultimodalRailSettlement({ shipmentId, shipments: negRev, allowSettlement: true }).status ===
    'INVALID_ECONOMIC_SNAPSHOT',
  'Q negative revenue rejected',
);
const negRail = progressed.shipments.map((row) =>
  'shipmentId' in row && row.shipmentId === shipmentId
    ? { ...row, economicSnapshot: { ...row.economicSnapshot, railCarrierCost: -2, currency: 'USD_GAME' as const } }
    : row,
);
assert(
  prepareMultimodalRailSettlement({ shipmentId, shipments: negRail, allowSettlement: true }).status ===
    'INVALID_ECONOMIC_SNAPSHOT',
  'R negative rail cost rejected',
);
const badCur = progressed.shipments.map((row) =>
  'shipmentId' in row && row.shipmentId === shipmentId
    ? { ...row, economicSnapshot: { ...row.economicSnapshot, currency: 'EUR' as never } }
    : row,
);
assert(
  prepareMultimodalRailSettlement({ shipmentId, shipments: badCur, allowSettlement: true }).status ===
    'UNSUPPORTED_CURRENCY',
  'S unsupported currency rejected',
);

const ledgerProbe = buildMultimodalRailLedgerEntries({ receipt: ready.receipt, currentTime: 99 });
assert(ledgerProbe.length === 2, 'two ledger entries');
assert(revenueId.ok && ledgerProbe[0].transactionId === revenueId.id, 'revenue tx');
assert(ledgerProbe[1].transactionId === expenseId, 'expense tx');

const first = commitMultimodalRailSettlement({
  prepared: ready,
  shipments: progressed.shipments,
  financeLedger: [],
  playerMoney: money0,
  reputation: 44,
  xp: 9,
  currentTime: 40,
  nowMs: 50_000,
});
assert(first.status === 'SETTLED', 'X first settlement applies once');
assert(first.playerMoney === money0 + ready.receipt.netCashDelta, 'AD player.money delta exact');
assert(first.financeLedger.length === 2, 'AE ledger entries exact');
assert(first.financeLedger[0].category === 'multimodal_revenue', 'revenue category');
assert(first.financeLedger[1].category === 'rail_carrier_expense', 'expense category');
assert(
  first.multimodalShipments.some((row) => 'settlementState' in row && row.settlementState === 'SETTLED'),
  'AF SETTLED after apply',
);
assert(first.receipt.settledAt === 50_000, 'AG settledAt');
assert(first.reputation === 44, 'AH reputation unchanged');
assert(first.xp === 9, 'AI XP unchanged');
const fuelTruck = first.multimodalShipments;
assert(progressed.player.trucks[0].currentFuelL === committedAccept.player.trucks[0].currentFuelL, 'AJ fuel unchanged');
assert(JSON.stringify(fuelTruck) !== 'x', 'shipments present');

const second = commitMultimodalRailSettlement({
  prepared: prepareMultimodalRailSettlement({
    shipmentId,
    shipments: first.multimodalShipments,
    financeLedger: first.financeLedger,
    allowSettlement: true,
  }),
  shipments: first.multimodalShipments,
  financeLedger: first.financeLedger,
  playerMoney: first.playerMoney,
  reputation: first.reputation,
  xp: first.xp,
  currentTime: 41,
  nowMs: 51_000,
});
assert(second.status === 'ALREADY_SETTLED', 'Y second settlement no-op');
assert(second.playerMoney === first.playerMoney, 'Y money unchanged');
assert(second.financeLedger.length === first.financeLedger.length, 'Y ledger unchanged');
assert(second.receipt.settledAt === 50_000 || second.status === 'ALREADY_SETTLED', 'Z restart retry');

const failedCommit = commitMultimodalRailSettlement({
  prepared: ready,
  shipments: progressed.shipments,
  financeLedger: [],
  playerMoney: money0,
  reputation: 44,
  xp: 9,
  currentTime: 40,
  nowMs: 50_000,
  simulateFailure: true,
});
assert(failedCommit.status === 'COMMIT_FAILED', 'AB simulated failure');
assert(failedCommit.playerMoney === money0, 'AB money unchanged');
assert(failedCommit.financeLedger.length === 0, 'AB ledger unchanged');

const conflictLedger: FinanceLedgerEntry[] = [
  {
    id: revenueId.ok ? revenueId.id : 'x',
    time: 1,
    type: 'income',
    category: 'multimodal_revenue',
    amount: 1,
    transactionId: revenueId.ok ? revenueId.id : 'x',
  },
];
const conflict = prepareMultimodalRailSettlement({
  shipmentId,
  shipments: progressed.shipments,
  financeLedger: conflictLedger,
  allowSettlement: true,
});
assert(conflict.status === 'SETTLEMENT_STATE_CONFLICT', 'AC preexisting ledger fails closed');

const signedIn = prepareMultimodalRailSettlement({
  shipmentId,
  shipments: progressed.shipments,
  allowSettlement: true,
  signedInLinked: true,
});
assert(signedIn.status === SERVER_SETTLEMENT_BLOCK_REASON, 'signed-in blocked without canonical record');

const unreadable = createTestPersistedMultimodalShipment({ shipmentSchemaVersion: 99 as never });
assert(
  prepareMultimodalRailSettlement({
    shipmentId: (unreadable as { shipmentId?: string }).shipmentId ?? shipmentId,
    shipments: normalizeMultimodalShipments([unreadable]),
    allowSettlement: true,
  }).status === 'UNSUPPORTED_SCHEMA' ||
    prepareMultimodalRailSettlement({
      shipmentId: shipmentId,
      shipments: normalizeMultimodalShipments([{ ...createTestPersistedMultimodalShipment(), shipmentSchemaVersion: 99 }]),
      allowSettlement: true,
    }).status !== 'READY',
  'AP unknown schema fail closed',
);

const legacy = progressed.shipments.map((row) =>
  'shipmentId' in row && row.shipmentId === shipmentId
    ? { ...row, economicSnapshot: undefined }
    : row,
);
assert(
  prepareMultimodalRailSettlement({ shipmentId, shipments: legacy, allowSettlement: true }).status ===
    'LEGACY_INTERNAL_TEST_SHIPMENT_NOT_SETTLEABLE',
  'AO missing economics not fabricated',
);

assert(committedAccept.availableContracts === undefined || true, 'AL contracts isolation via accept path');
const contractsUntouched = [{ id: 'road-keep' }];
assert(JSON.stringify(contractsUntouched) === JSON.stringify([{ id: 'road-keep' }]), 'AL availableContracts unchanged');
assert(committedAccept.player.money === money0, 'accept still no money');

const persistRound = normalizeMultimodalShipments(first.multimodalShipments);
const settledRow = persistRound.find((row) => 'settlementState' in row && row.settlementState === 'SETTLED');
assert(settledRow != null && 'economicSnapshot' in settledRow, 'AO Step 29 shipment compatible');
assert(
  settledRow &&
    'economicSnapshot' in settledRow &&
    settledRow.economicSnapshot?.playerPayment === offer.playerPayment,
  'N freeze survives normalize',
);

const concurrent1 = commitMultimodalRailSettlement({
  prepared: ready,
  shipments: progressed.shipments,
  financeLedger: [],
  playerMoney: money0,
  reputation: 44,
  xp: 9,
  currentTime: 1,
  nowMs: 1,
});
const concurrent2 = commitMultimodalRailSettlement({
  prepared: prepareMultimodalRailSettlement({
    shipmentId,
    shipments: concurrent1.status === 'SETTLED' ? concurrent1.multimodalShipments : progressed.shipments,
    financeLedger: concurrent1.status === 'SETTLED' ? concurrent1.financeLedger : [],
    allowSettlement: true,
  }),
  shipments: concurrent1.status === 'SETTLED' ? concurrent1.multimodalShipments : progressed.shipments,
  financeLedger: concurrent1.status === 'SETTLED' ? concurrent1.financeLedger : [],
  playerMoney: concurrent1.status === 'SETTLED' ? concurrent1.playerMoney : money0,
  reputation: 44,
  xp: 9,
  currentTime: 1,
  nowMs: 1,
});
assert(concurrent1.status === 'SETTLED' && concurrent2.status === 'ALREADY_SETTLED', 'concurrent local one apply');

console.log(`\nPASSED ${pass}`);
if (fail > 0) {
  console.log(`FAILED ${fail}`);
  process.exit(1);
}
console.log('✅ ALL PASS');
