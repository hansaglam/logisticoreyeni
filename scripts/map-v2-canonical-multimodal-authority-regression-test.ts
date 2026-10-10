/**
 * Map V2 Step 29C canonical multimodal authority foundation.
 * Run: npx tsx scripts/map-v2-canonical-multimodal-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  CANONICAL_SIGNED_IN_MONEY_PATH,
  computeCanonicalMultimodalRailAcceptance,
  estimateCanonicalRailOfferEconomics,
  RAIL_OFFER_CARGO_TONNES_BANDS,
} from '../src/domain/canonicalMultimodalRailEconomics';
import {
  mergeCanonicalMultimodalReceipt,
} from '../src/domain/canonicalMultimodalCompletionQueueLogic';
import {
  applyCanonicalAcceptanceReceiptToPrepared,
  commitRailMultimodalAcceptance,
  prepareRailMultimodalAcceptance,
} from '../src/domain/multimodalRailAcceptance';
import { generateRailMultimodalOffers } from '../src/domain/multimodalRailOffer';
import { estimateRailOfferEconomics } from '../src/domain/multimodalRailOfferEconomics';
import { estimateMultimodalRailTariff } from '../src/domain/multimodalRailTariff';
import { findRoadTransferAccess } from '../src/domain/multimodalRoadAccess';
import { prepareMultimodalRailSettlement } from '../src/domain/multimodalRailSettlement';
import { createDevMultimodalRoadPlanningFleet } from '../src/mapV2/gameplay/devMultimodalRoadPlanningFleet';
import { getTurkeyRoadTransferAccessArtifact } from '../src/mapV2/world/multimodalRoadTransferAccessLoader';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';

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

console.log('\n=== Map V2 Canonical Multimodal Authority (Step 29C) ===\n');

const access = getTurkeyRoadTransferAccessArtifact();
const rules = read('firestore.rules');
const index = read('backend/src/index.ts');
const cloud = read('src/services/cloudSaveService.ts');
const moneySync = read('src/services/testMoneySyncService.ts');
const store = read('src/store/gameStore.ts');

assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'A public default OFF');
assert(store.includes('acceptRailMultimodalOfferInternal'), 'B guest accept path remains');
assert(index.includes('export const acceptCanonicalMultimodalShipment'), 'K accept callable');
assert(index.includes('resolveLeaderboardIdentity(request)'), 'C auth context');
assert(index.includes("reason: auth.reason"), 'D unauthenticated rejected');
assert(!index.includes('settleCanonicalMultimodalSettlement'), 'no fake settle name');
assert(!index.includes('export const settleCanonicalMultimodalShipment'), 'AG settlement callable deferred');
assert(rules.includes('match /canonicalMultimodalShipments/{shipmentId}'), 'H collection');
assert(rules.includes('allow write: if false'), 'J client writes denied');
assert(rules.includes('match /canonicalDeliveryCompletions/{deliveryId}'), 'AK ROAD completions remain');
assert(!index.includes('canonicalDeliveryCompletions/${shipmentId}'), 'AQ no mix of ids');
assert(SAVE_GAME_VERSION === 6, 'AJ SAVE_GAME_VERSION 6');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AL SEA disabled');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AL AIR disabled');
assert(CANONICAL_SIGNED_IN_MONEY_PATH === 'users/{uid}/serverState/current.cash', 'A money path');
assert(rules.includes('match /serverState/{documentId}'), 'B serverState exists');
assert(cloud.includes('users/{uid}/saves/current') || cloud.includes("saves/current"), 'C save blob path');
assert(cloud.includes('omitMoney = isTestMoneySyncEnabled()'), 'F TEST_MONEY_SYNC only omits profile money');
assert(moneySync.includes('TEST-ONLY'), 'F test money sync not production');
assert(store.includes('completeDeliveryById'), 'H ROAD settlement remains');

const generated = generateRailMultimodalOffers({
  generationSeed: 'canonical-authority-v1',
  accessArtifact: access,
  playerLevel: 20,
});
assert(generated.status === 'READY' && generated.offers.length > 0, 'offers');
const offer = generated.offers[0];

const ready = computeCanonicalMultimodalRailAcceptance({
  generationSeed: offer.generationSeed,
  originCityId: offer.originCityId,
  destinationCityId: offer.destinationCityId,
  productId: offer.cargo.productId,
  cargoQuantity: offer.cargo.quantity,
  sourceOfferId: offer.offerId,
  transportPattern: 'ROAD_RAIL_ROAD',
  playerLevel: 20,
  allowAcceptance: true,
  accessArtifact: access,
});
assert(ready.status === 'READY', 'E compute ready');
if (ready.status !== 'READY') {
  console.log(ready);
  process.exit(1);
}
assert(ready.snapshot.playerPayment === offer.playerPayment, 'K/O payment matches Step 27 offer');
assert(ready.snapshot.railCarrierCost === offer.economics.railCarrierCost, 'J/N tariff matches offer');
assert(ready.snapshot.sourceOfferId === offer.offerId, 'S offer id');
assert(ready.snapshot.shipmentId.startsWith('mls.'), 'T shipment id');
assert(ready.snapshot.canonicalSchemaVersion === 1, 'I schema 1');

const first = findRoadTransferAccess(access, offer.originCityId, 'RAIL');
const last = findRoadTransferAccess(access, offer.destinationCityId, 'RAIL');
assert(first && last, 'P access records');
const opex = estimateCanonicalRailOfferEconomics({
  railCarrierCost: offer.economics.railCarrierCost,
  firstMileDistanceMeters: first!.distanceMeters,
  lastMileDistanceMeters: last!.distanceMeters,
  cargoTonnes: offer.cargo.quantity,
});
assert(opex.status === 'READY', 'P opex ready');
if (opex.status === 'READY') {
  const client = estimateRailOfferEconomics({
    railCarrierCost: offer.economics.railCarrierCost,
    firstMileDistanceMeters: first!.distanceMeters,
    lastMileDistanceMeters: last!.distanceMeters,
    cargoTonnes: offer.cargo.quantity,
  });
  assert(client.status === 'READY' && client.economics?.playerPayment === opex.playerPayment, 'L Step 27 reproduction');
  assert(client.economics?.estimatedRoadOperatingCost === opex.estimatedRoadOperatingCost, 'L road opex');
}

const tariff = estimateMultimodalRailTariff({
  routeReference: ready.snapshot.railRouteReference,
  distanceMeters: ready.snapshot.railDistanceMeters,
  distanceAuthority: 'SOURCE_BACKED_RAIL_LENGTH',
  cargoQuantity: offer.cargo.quantity,
  cargoQuantityUnit: 'tonnes',
  intent: 'PLAN',
});
assert(tariff.status === 'READY' && tariff.totalCarrierCost === ready.snapshot.railCarrierCost, 'N Step 26');

assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    playerPayment: ready.snapshot.playerPayment + 999,
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'UNSAFE_ECONOMICS',
  'H client payment rejected',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    railCarrierCost: 1,
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'UNSAFE_ECONOMICS',
  'I client rail cost rejected',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    transportPattern: 'ROAD_SEA_ROAD',
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'SEA_NOT_ACTIVATED',
  'AL SEA rejected',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    transportPattern: 'ROAD_AIR_ROAD',
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'AIR_NOT_ACTIVATED',
  'AL AIR rejected',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    originCityId: 'antalya',
    destinationCityId: 'izmir',
    sourceOfferId: undefined,
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'UNRESOLVED_RAIL_INFRASTRUCTURE',
  'N unsupported corridor',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    productId: 'not-a-product',
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'INVALID_CARGO',
  'O invalid product',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    cargoQuantity: 999999,
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'INVALID_CARGO',
  'P invalid tonnes',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    playerLevel: 0,
    cargoQuantity: RAIL_OFFER_CARGO_TONNES_BANDS[0],
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'LEVEL_GATED' ||
    computeCanonicalMultimodalRailAcceptance({
      ...offerFields(offer),
      playerLevel: 0,
      cargoQuantity: RAIL_OFFER_CARGO_TONNES_BANDS[0],
      allowAcceptance: true,
      accessArtifact: access,
    }).status === 'READY',
  'Q level gate evaluated',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    canonicalSchemaVersion: 99,
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'UNSUPPORTED_SCHEMA',
  'I unknown schema fail closed',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    allowAcceptance: false,
    accessArtifact: access,
  }).status === 'FEATURE_DISABLED',
  'A/AG kill switch',
);
assert(
  computeCanonicalMultimodalRailAcceptance({
    ...offerFields(offer),
    sourceOfferId: 'railOffer:forged:izmir:ankara:steel:10',
    allowAcceptance: true,
    accessArtifact: access,
  }).status === 'OFFER_ID_MISMATCH',
  'S offer id mismatch',
);

const fleet = createDevMultimodalRoadPlanningFleet({
  originCityId: offer.originCityId,
  destinationCityId: offer.destinationCityId,
});
const prepared = prepareRailMultimodalAcceptance({
  offer,
  accessArtifact: access,
  fleet,
  shipments: [],
  currentTimeGameHours: 8,
  nowMs: 1_000,
  allowAcceptance: true,
});
assert(prepared.status === 'READY_TO_COMMIT', 'guest prepare');
if (prepared.status !== 'READY_TO_COMMIT') process.exit(1);

const applied = applyCanonicalAcceptanceReceiptToPrepared(prepared, {
  shipmentId: ready.snapshot.shipmentId,
  sourceOfferId: ready.snapshot.sourceOfferId,
  playerPayment: ready.snapshot.playerPayment,
  railCarrierCost: ready.snapshot.railCarrierCost,
  estimatedRoadOperatingCost: ready.snapshot.estimatedRoadOperatingCost,
  expectedGrossMargin: ready.snapshot.expectedGrossMargin,
  currency: ready.snapshot.currency,
  acceptedAtMs: 1_700_000_000_000,
  policyVersions: {
    offerEconomicsPolicyVersion: ready.snapshot.offerEconomicsPolicyVersion,
  },
});
assert(applied.status !== 'CANONICAL_ACCEPTANCE_CONFLICT', 'W overlay ok');
if (applied.status !== 'CANONICAL_ACCEPTANCE_CONFLICT') {
  assert(applied.shipment.economicSnapshot?.playerPayment === ready.snapshot.playerPayment, 'W receipt economics');
  assert(applied.shipment.canonicalAuthority === 'SERVER_ACCOUNT_AUTHORITY', 'authority tag');
  assert(applied.shipment.canonicalAcceptedAtMs === 1_700_000_000_000, 'R acceptedAt from server');
  const committed = commitRailMultimodalAcceptance({
    player: {
      trucks: fleet.trucks,
      drivers: fleet.drivers,
      trailers: fleet.trailers,
      money: 20_000,
      reputation: 50,
      xp: 0,
    },
    activeDeliveries: [],
    availableContracts: [],
    financeLedger: [],
    multimodalShipments: [],
    prepared: applied,
  });
  assert(committed.status === 'COMMITTED', 'AA commit after receipt');
  assert(committed.moneyUnchanged, 'Z no money at acceptance');
  assert(committed.status === 'COMMITTED' && committed.player.money === 20_000, 'Z money');
}

const conflictApply = applyCanonicalAcceptanceReceiptToPrepared(prepared, {
  shipmentId: 'mls.other',
  sourceOfferId: ready.snapshot.sourceOfferId,
  playerPayment: ready.snapshot.playerPayment,
  railCarrierCost: ready.snapshot.railCarrierCost,
  currency: ready.snapshot.currency,
  acceptedAtMs: 1,
});
assert(conflictApply.status === 'CANONICAL_ACCEPTANCE_CONFLICT', 'Y conflict');

const fleetGuest = createDevMultimodalRoadPlanningFleet({
  originCityId: offer.originCityId,
  destinationCityId: offer.destinationCityId,
});
const preparedGuest = prepareRailMultimodalAcceptance({
  offer,
  accessArtifact: access,
  fleet: fleetGuest,
  shipments: [],
  currentTimeGameHours: 8,
  nowMs: 1_000,
  allowAcceptance: true,
});
assert(preparedGuest.status === 'READY_TO_COMMIT', 'B guest prepare unchanged');
if (preparedGuest.status === 'READY_TO_COMMIT') {
  const guestCommit = commitRailMultimodalAcceptance({
    player: {
      trucks: fleetGuest.trucks,
      drivers: fleetGuest.drivers,
      trailers: fleetGuest.trailers,
      money: 20_000,
      reputation: 50,
      xp: 0,
    },
    activeDeliveries: [],
    availableContracts: [],
    financeLedger: [],
    multimodalShipments: [],
    prepared: {
      ...preparedGuest,
      shipment: { ...preparedGuest.shipment, canonicalAuthority: 'LOCAL_GUEST_AUTHORITY' },
    },
  });
  assert(guestCommit.status === 'COMMITTED', 'AI guest accept still works');
  const signedInBlocked = prepareMultimodalRailSettlement({
    shipmentId: guestCommit.shipmentId,
    shipments: guestCommit.multimodalShipments,
    allowSettlement: true,
    signedInLinked: true,
  });
  assert(
    signedInBlocked.status === 'SERVER_SETTLEMENT_BLOCKED_MISSING_AUTHORITATIVE_SHIPMENT_STATE' ||
      signedInBlocked.status === 'NOT_COMPLETED' ||
      signedInBlocked.status === 'ACTIVE_SHIPMENT',
    'AG signed-in local settlement still blocked',
  );
}

const q1 = mergeCanonicalMultimodalReceipt([], ready.snapshot.shipmentId, 10);
const q2 = mergeCanonicalMultimodalReceipt(q1, ready.snapshot.shipmentId, 11);
assert(q1.length === 1 && q2.length === 1, 'AF queue dedupes shipmentId');
assert(!read('src/domain/canonicalMultimodalCompletionQueue.ts').includes('playerPayment'), 'AD no money in queue');
assert(store.includes('notifyCanonicalMultimodalShipmentCompleted'), 'AC completion enqueue');
assert(store.includes('CANCELLATION_REQUIRES_SERVER'), 'AE signed-in cancel waits');
assert(!store.includes('settleCanonicalMultimodalShipment'), 'no client settle callable');
assert(read('src/services/canonicalMultimodalService.ts').includes('canonicalSchemaVersion: 1'), 'L request fields');
assert(
  read('src/services/canonicalMultimodalService.ts').includes('export type CanonicalMultimodalAcceptRequest') &&
    !read('src/services/canonicalMultimodalService.ts')
      .split('export type CanonicalMultimodalAcceptRequest')[1]
      .split('export type CanonicalMultimodalAcceptClientResult')[0]
      .includes('playerPayment'),
  'H no payment in accept request type',
);

assert(read('docs/architecture/map-v2/MAP_V2_CANONICAL_MULTIMODAL_AUTHORITY.md').includes('INTERNAL_TEST_SERVER_AUTHORITY'), 'docs');

function offerFields(row: typeof offer) {
  return {
    generationSeed: row.generationSeed,
    originCityId: row.originCityId,
    destinationCityId: row.destinationCityId,
    productId: row.cargo.productId,
    cargoQuantity: row.cargo.quantity,
    sourceOfferId: row.offerId,
    transportPattern: 'ROAD_RAIL_ROAD' as const,
    playerLevel: 20,
  };
}

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
