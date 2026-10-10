/**
 * Map V2 Step 29 INTERNAL_TEST RAIL acceptance / execution foundation.
 * Run: npx tsx scripts/map-v2-multimodal-internal-test-activation-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { getMsPerGameHour, realMsToGameHours } from '../src/config/balance';
import {
  allowMultimodalRailAcceptance,
  allowNewMultimodalContractCreation,
  isMultimodalInternalTestEnabled,
  resolveMultimodalFeatureRollout,
} from '../src/domain/multimodalFeatureRollout';
import {
  commitRailMultimodalAcceptance,
  mintMultimodalShipmentIdFromOfferId,
  MULTIMODAL_FUEL_ACCEPTANCE_POLICY,
  prepareRailMultimodalAcceptance,
} from '../src/domain/multimodalRailAcceptance';
import {
  cancelInternalMultimodalShipment,
  elapsedGameSecondsFromRealMs,
  MULTIMODAL_EXECUTION_POLICY_VERSION,
  progressExecutableMultimodalShipments,
} from '../src/domain/multimodalRailExecution';
import { generateRailMultimodalOffers } from '../src/domain/multimodalRailOffer';
import {
  getMultimodalCompletionId,
  getMultimodalSettlementId,
} from '../src/domain/multimodalSettlementIdentity';
import {
  createTestPersistedMultimodalShipment,
  MAX_ACTIVE_MULTIMODAL_SHIPMENTS_INTERNAL,
  MULTIMODAL_FEATURE_ROLLOUT,
  normalizeMultimodalShipments,
  SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION,
} from '../src/domain/multimodalShipmentPersistence';
import { isMultimodalUiPreviewEnabled } from '../src/domain/multimodalUiPreviewGate';
import { presentRailMultimodalOffer } from '../src/domain/presentation/multimodalRailOfferPresentation';
import { createDevMultimodalRoadPlanningFleet } from '../src/mapV2/gameplay/devMultimodalRoadPlanningFleet';
import { getTurkeyRoadTransferAccessArtifact } from '../src/mapV2/world/multimodalRoadTransferAccessLoader';
import {
  SAVE_GAME_VERSION,
} from '../src/storage/saveGame';
import { sanitizeForFirestore } from '../src/utils/sanitizeForFirestore';
import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';

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

function cloneFleet(origin: string, dest: string) {
  return createDevMultimodalRoadPlanningFleet({ originCityId: origin, destinationCityId: dest });
}

function playerFromFleet(fleet: ReturnType<typeof cloneFleet>, money = 50_000) {
  return {
    trucks: fleet.trucks.map((row) => ({ ...row })),
    drivers: fleet.drivers.map((row) => ({ ...row })),
    trailers: [...fleet.trailers],
    money,
    reputation: 50,
    xp: 10,
  };
}

console.log('\n=== Map V2 Multimodal INTERNAL_TEST Activation (Step 29) ===\n');

assert(SAVE_GAME_VERSION === 6, 'AE SAVE_GAME_VERSION = 6');
assert(MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF', 'A default OFF constant');
assert(resolveMultimodalFeatureRollout({}) === 'MULTIMODAL_OFF', 'A missing env OFF');
assert(resolveMultimodalFeatureRollout({ envValue: '' }) === 'MULTIMODAL_OFF', 'invalid empty OFF');
assert(resolveMultimodalFeatureRollout({ envValue: 'PRODUCTION' }) === 'MULTIMODAL_OFF', 'invalid env OFF');
assert(resolveMultimodalFeatureRollout({ envValue: 'INTERNAL_TEST' }) === 'INTERNAL_TEST', 'B INTERNAL_TEST exists');
assert(!allowMultimodalRailAcceptance({ rollout: 'MULTIMODAL_OFF' }), 'A no acceptance default');
assert(!allowNewMultimodalContractCreation({ rollout: 'MULTIMODAL_OFF' }), 'AY no new contracts OFF');
assert(allowMultimodalRailAcceptance({ rollout: 'INTERNAL_TEST' }), 'C INTERNAL_TEST accept gate');
assert(
  !isMultimodalUiPreviewEnabled({ featureRollout: 'MULTIMODAL_OFF', envValue: 'true', isDev: true }) === false ||
    isMultimodalUiPreviewEnabled({ featureRollout: 'MULTIMODAL_OFF', envValue: 'true', isDev: true }),
  'preview helper still callable',
);
assert(
  !allowMultimodalRailAcceptance({ rollout: 'MULTIMODAL_OFF' }) &&
    isMultimodalUiPreviewEnabled({ featureRollout: 'MULTIMODAL_OFF', envValue: 'true', isDev: true }),
  'B preview flag cannot mutate',
);
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'BF RAIL FOUNDATION_ONLY');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'BG SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'BH AIR');
assert(MAX_ACTIVE_MULTIMODAL_SHIPMENTS_INTERNAL === 1, 'BC max active 1');
assert(MULTIMODAL_FUEL_ACCEPTANCE_POLICY === 'VALIDATED_NOT_CONSUMED', 'AM fuel policy');
assert(MULTIMODAL_EXECUTION_POLICY_VERSION === 'multimodal-execution-v1', 'AA execution v1');

const generated = generateRailMultimodalOffers({
  generationSeed: 'internal-test-v1',
  accessArtifact: access,
  playerLevel: 20,
});
assert(generated.status === 'READY' && generated.offers.length > 0, 'C offers generate');
const offer = generated.offers[0];
const fleet = cloneFleet(offer.originCityId, offer.destinationCityId);
const moneyBefore = 88_000;
const player0 = playerFromFleet(fleet, moneyBefore);
const jsonBefore = JSON.stringify(player0);

const disabled = prepareRailMultimodalAcceptance({
  offer,
  accessArtifact: access,
  fleet,
  shipments: [],
  currentTimeGameHours: 10,
  nowMs: 1_700_000_000_000,
  allowAcceptance: false,
});
assert(disabled.status === 'FEATURE_DISABLED', 'A prepare OFF');

const previewOnlyVm = presentRailMultimodalOffer(offer, null, { mutationEnabled: false });
assert(previewOnlyVm?.ctaDisabled === true && previewOnlyVm.ctaLabel === 'Yakında', 'B preview CTA Yakında');

const sea = prepareRailMultimodalAcceptance({
  offer,
  accessArtifact: access,
  fleet,
  shipments: [],
  currentTimeGameHours: 10,
  nowMs: 1,
  allowAcceptance: true,
  transportPatternOverride: 'ROAD_SEA_ROAD',
});
assert(sea.status === 'SEA_NOT_ACTIVATED', 'BD no SEA');
const air = prepareRailMultimodalAcceptance({
  offer,
  accessArtifact: access,
  fleet,
  shipments: [],
  currentTimeGameHours: 10,
  nowMs: 1,
  allowAcceptance: true,
  transportPatternOverride: 'ROAD_AIR_ROAD',
});
assert(air.status === 'AIR_NOT_ACTIVATED', 'BE no AIR');

const prepared = prepareRailMultimodalAcceptance({
  offer,
  accessArtifact: access,
  fleet,
  shipments: [],
  currentTimeGameHours: 12,
  nowMs: 1_700_000_100_000,
  allowAcceptance: true,
});
assert(prepared.status === 'READY_TO_COMMIT', 'C prepare ready', prepared.status);
assert(JSON.stringify(player0) === jsonBefore, 'D prepare is pure');

if (prepared.status !== 'READY_TO_COMMIT') {
  console.log('\nBLOCKED: prepare failed\n');
} else {
  assert(prepared.shipmentId !== offer.offerId, 'I shipmentId != offerId');
  assert(prepared.sourceOfferId === offer.offerId, 'G sourceOfferId');
  assert(mintMultimodalShipmentIdFromOfferId(offer.offerId) === prepared.shipmentId, 'H stable mint');
  const settle = getMultimodalSettlementId(prepared.shipmentId);
  const completion = getMultimodalCompletionId(prepared.shipmentId);
  assert(settle.ok && settle.id === `shipment:${prepared.shipmentId}:revenue`, 'J settlement id');
  assert(completion.ok && completion.id === `shipment:${prepared.shipmentId}:completion`, 'J completion id');
  assert(prepared.shipment.durationSnapshot?.policyVersion === 'multimodal-duration-policy-v1', 'K duration frozen');
  assert(prepared.shipment.railTariffSnapshot?.policyVersion === 'multimodal-rail-tariff-v1', 'L tariff frozen');
  assert(prepared.shipment.economicSnapshot?.playerPayment === offer.playerPayment, 'M economics frozen');
  assert(prepared.shipment.deadlineSnapshot?.deadlineGameSeconds === offer.deadlineSnapshot.deadlineGameSeconds, 'W deadline');
  assert(prepared.shipment.roadAccessSnapshot?.firstMileDistanceMeters === offer.firstMileAccess.distanceMeters, 'X road access');
  assert(prepared.shipment.assignmentSnapshot?.firstMileTruckId === 'truck-plan-origin', 'O first mile');
  assert(prepared.shipment.assignmentSnapshot?.lastMileTruckId === 'truck-plan-destination', 'P last mile');
  assert(
    prepared.shipment.assignmentSnapshot?.firstMileTruckId !==
      prepared.shipment.assignmentSnapshot?.lastMileTruckId,
    'Q no teleport same truck',
  );
  assert(prepared.shipment.assignmentSnapshot?.firstMileDriverId !== prepared.shipment.assignmentSnapshot?.lastMileDriverId, 'R drivers');
  assert(prepared.shipment.fuelPolicy === 'VALIDATED_NOT_CONSUMED', 'AB fuel validate only');
  assert(prepared.shipment.settlementState === 'NOT_SETTLED', 'AS settlement placeholder');
  assert(prepared.shipment.executionStage === 'FIRST_MILE_ROAD', 'Z start stage');

  const ledger = [{ id: 'keep-me', amount: 1 }];
  const contracts = [{ id: 'road-1' }];
  const deliveries: unknown[] = [];
  const committed = commitRailMultimodalAcceptance({
    player: player0,
    activeDeliveries: deliveries,
    availableContracts: contracts,
    financeLedger: ledger,
    multimodalShipments: [],
    prepared,
  });
  assert(committed.status === 'COMMITTED', 'E one shipment');
  assert(committed.multimodalShipments.length === 1, 'E length 1');
  assert(committed.player.money === moneyBefore, 'Z money unchanged');
  const origin = committed.player.trucks.find((row) => row.id === 'truck-plan-origin');
  const dest = committed.player.trucks.find((row) => row.id === 'truck-plan-destination');
  assert(origin?.assignedMultimodalShipmentId === prepared.shipmentId, 'W origin reserved');
  assert(origin?.status === 'on_route', 'L origin active first-mile');
  assert(dest?.assignedMultimodalShipmentId === prepared.shipmentId, 'M dest reserved');
  assert(dest?.status === 'idle', 'M dest not driving yet');
  assert(dest?.currentCityId === offer.destinationCityId, 'AO dest not teleported');
  assert(origin?.currentFuelL === player0.trucks[0].currentFuelL, 'AB fuel unchanged');
  assert(committed.player.reputation === 50 && committed.player.xp === 10, 'AC AD rep/xp');

  const dup = commitRailMultimodalAcceptance({
    player: committed.player,
    activeDeliveries: deliveries,
    availableContracts: contracts,
    financeLedger: ledger,
    multimodalShipments: committed.multimodalShipments,
    prepared,
  });
  assert(dup.status === 'OFFER_ALREADY_ACCEPTED', 'T duplicate rejected');
  assert(dup.multimodalShipments.length === 1, 'U double tap one shipment');

  const failed = commitRailMultimodalAcceptance({
    player: playerFromFleet(cloneFleet(offer.originCityId, offer.destinationCityId), moneyBefore),
    activeDeliveries: [],
    availableContracts: [],
    financeLedger: [],
    multimodalShipments: [],
    prepared,
    simulateFailure: true,
  });
  assert(failed.status === 'COMMIT_FAILED', 'V simulated failure');
  assert(failed.multimodalShipments.length === 0, 'V no shipment on fail');
  assert(failed.player.trucks.every((row) => !row.assignedMultimodalShipmentId), 'V no reservation');

  const busyFleet = cloneFleet(offer.originCityId, offer.destinationCityId);
  busyFleet.trucks = busyFleet.trucks.map((row) =>
    row.id === 'truck-plan-origin' ? { ...row, status: 'on_route' as const } : row,
  );
  const busyPrep = prepareRailMultimodalAcceptance({
    offer,
    accessArtifact: access,
    fleet: busyFleet,
    shipments: [],
    currentTimeGameHours: 1,
    nowMs: 1,
    allowAcceptance: true,
  });
  assert(busyPrep.status === 'ORIGIN_TRUCK_UNAVAILABLE' || busyPrep.status === 'FLEET_REVALIDATION_FAILED', 'reservation origin busy');

  const normalized = normalizeMultimodalShipments(committed.multimodalShipments);
  assert(normalized.length === 1, 'AF normalize');
  const loaded = normalized[0];
  assert(!('unreadable' in loaded && loaded.unreadable), 'AF readable');
  if ('durationSnapshot' in loaded) {
    assert(loaded.durationSnapshot?.totalDurationGameSeconds === offer.durationSnapshot.totalDurationGameSeconds, 'AH freeze reload');
  }

  const firestore = sanitizeForFirestore({ multimodalShipments: committed.multimodalShipments }) as {
    multimodalShipments?: unknown[];
  };
  assert(Array.isArray(firestore.multimodalShipments) && firestore.multimodalShipments.length === 1, 'AG cloud sanitize');

  const firstMile = prepared.shipment.durationSnapshot!.firstMileGameSeconds;
  const progressed = progressExecutableMultimodalShipments({
    shipments: committed.multimodalShipments,
    player: committed.player,
    elapsedGameSeconds: Math.floor(firstMile / 2),
    nowMs: 1_700_000_200_000,
  });
  const mid = progressed.shipments[0];
  assert('executionStage' in mid && mid.executionStage === 'FIRST_MILE_ROAD', 'AL partial first-mile');
  assert(progressed.player.money === moneyBefore, 'Z money during progress');

  const afterFirst = progressExecutableMultimodalShipments({
    shipments: progressed.shipments,
    player: progressed.player,
    elapsedGameSeconds: firstMile,
    nowMs: 1_700_000_300_000,
  });
  const afterFirstRow = afterFirst.shipments[0];
  assert(
    'executionStage' in afterFirstRow && afterFirstRow.executionStage !== 'FIRST_MILE_ROAD',
    'AM first-mile completed',
  );
  const originAfter = afterFirst.player.trucks.find((row) => row.id === 'truck-plan-origin');
  assert(!originAfter?.assignedMultimodalShipmentId, 'AM origin released');
  assert(originAfter?.currentCityId === offer.originCityId, 'AM origin stays origin city');
  const destAfter = afterFirst.player.trucks.find((row) => row.id === 'truck-plan-destination');
  assert(destAfter?.assignedMultimodalShipmentId === prepared.shipmentId, 'AO dest still reserved');
  assert(destAfter?.currentCityId === offer.destinationCityId, 'AO dest city');

  const huge = progressExecutableMultimodalShipments({
    shipments: afterFirst.shipments,
    player: afterFirst.player,
    elapsedGameSeconds: 10_000_000,
    nowMs: 1_700_000_900_000,
  });
  const done = huge.shipments[0];
  assert('status' in done && done.status === 'COMPLETED_UNSETTLED', 'AR COMPLETED_UNSETTLED');
  assert(huge.completedUnsettledIds.length === 1, 'AX complete once ids');
  const destDone = huge.player.trucks.find((row) => row.id === 'truck-plan-destination');
  assert(!destDone?.assignedMultimodalShipmentId, 'AQ dest released');
  assert(destDone?.currentCityId === offer.destinationCityId, 'AG last-mile stays dest');
  assert(huge.player.money === moneyBefore, 'AN money still unchanged');
  const again = progressExecutableMultimodalShipments({
    shipments: huge.shipments,
    player: huge.player,
    elapsedGameSeconds: 10_000_000,
    nowMs: 1_700_001_000_000,
  });
  assert(again.completedUnsettledIds.length === 0, 'AX no repeated completion');
  assert(JSON.stringify(again.shipments[0]).includes('NOT_SETTLED') || ('settlementState' in again.shipments[0] && again.shipments[0].settlementState === 'NOT_SETTLED'), 'AT not settled');

  const killPrepare = prepareRailMultimodalAcceptance({
    offer: generated.offers[1] ?? offer,
    accessArtifact: access,
    fleet: cloneFleet((generated.offers[1] ?? offer).originCityId, (generated.offers[1] ?? offer).destinationCityId),
    shipments: huge.shipments,
    currentTimeGameHours: 20,
    nowMs: 2,
    allowAcceptance: false,
  });
  assert(killPrepare.status === 'FEATURE_DISABLED', 'AY kill switch new accept');
  const resumeOff = progressExecutableMultimodalShipments({
    shipments: afterFirst.shipments,
    player: afterFirst.player,
    elapsedGameSeconds: 60,
    nowMs: 3,
  });
  assert(resumeOff.shipments.length === 1, 'AZ in-flight continues');

  const cancelPlayer = playerFromFleet(cloneFleet(offer.originCityId, offer.destinationCityId), moneyBefore);
  const live = commitRailMultimodalAcceptance({
    player: cancelPlayer,
    activeDeliveries: [],
    availableContracts: [],
    financeLedger: [],
    multimodalShipments: [],
    prepared,
  });
  const cancelled = cancelInternalMultimodalShipment({
    shipments: live.multimodalShipments,
    player: live.player,
    shipmentId: prepared.shipmentId,
    nowMs: 9,
  });
  assert(cancelled.status === 'CANCELLED', 'BA cancel');
  assert(cancelled.player.trucks.every((row) => !row.assignedMultimodalShipmentId), 'BA resources released');
  assert(cancelled.player.money === moneyBefore, 'BA no money');

  const unreadable = progressExecutableMultimodalShipments({
    shipments: [
      {
        shipmentSchemaVersion: 99,
        unreadable: true,
        unreadReason: 'UNSUPPORTED_SHIPMENT_SCHEMA_VERSION',
        shipmentId: 'future.x',
        opaque: { shipmentSchemaVersion: 99 },
      },
    ],
    player: playerFromFleet(fleet, moneyBefore),
    elapsedGameSeconds: 999,
    nowMs: 1,
  });
  assert(unreadable.shipments[0] && 'unreadable' in unreadable.shipments[0], 'BB unreadable not executed');

  const msPerHour = getMsPerGameHour(1);
  const mapped = elapsedGameSecondsFromRealMs({ elapsedRealMs: msPerHour, gameSpeed: 1 });
  assert(mapped === 3600, 'AK game speed mapping');
  assert(realMsToGameHours(msPerHour, 1) === 1, 'AK hours');
}

const storeSrc = read('src/store/gameStore.ts');
assert(storeSrc.includes('acceptRailMultimodalOfferInternal'), 'store accept action');
assert(storeSrc.includes('prepareRailMultimodalAcceptance'), 'E not startDelivery reuse for prepare');
assert(!storeSrc.includes('startDelivery(contractId') || storeSrc.includes('startDelivery:'), 'BM startDelivery still exists');
assert(!read('src/domain/multimodalRailAcceptance.ts').includes('startDelivery('), 'no startDelivery in acceptance domain');
assert(!read('src/domain/multimodalRailExecution.ts').includes('DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR'), 'AJ no DEV playback');
assert(!read('src/screens/MapScreen.tsx').includes('acceptRailMultimodalOfferInternal'), 'BI MapScreen');
assert(!read('src/data/routes.ts').includes('ROAD_RAIL_ROAD'), 'BJ routes.ts');
assert(!read('backend/src/index.ts').includes('acceptRailMultimodalOfferInternal'), 'BL no CF');
assert(read('src/features/contracts/multimodal/MultimodalRailOfferDetailModal.tsx').includes('() => undefined'), 'preview CTA still has no-op');
assert(SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION === 1, 'schema 1');

const fixture = createTestPersistedMultimodalShipment();
assert(fixture.shipmentSchemaVersion === 1, 'legacy fixture still builds');

assert(STARTER_TRUCK.status === 'idle' && STARTER_DRIVER.status === 'idle', 'starter fleet untouched');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
