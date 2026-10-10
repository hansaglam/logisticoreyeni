/**
 * Map V2 Step 27 RAIL multimodal offer generation foundation.
 * Run: npx tsx scripts/map-v2-multimodal-rail-offer-generation-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { estimateTransportLegDuration, estimateMultimodalShipmentDuration } from '../src/domain/multimodalDurationPolicy';
import {
  buildRailMultimodalOfferId,
  enumerateRailMultimodalOfferCandidates,
  evaluateRailMultimodalOfferAcceptance,
  generateRailMultimodalOffers,
  isRailMultimodalOfferGenerationAvailable,
  MAX_RAIL_MULTIMODAL_OFFERS,
  RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION,
  RAIL_MULTIMODAL_TRANSPORT_PATTERN,
  railOfferSettlementCollision,
} from '../src/domain/multimodalRailOffer';
import {
  estimateMultimodalRailTariff,
  RAIL_TARIFF_CARGO_QUANTITY_UNIT,
  RAIL_TARIFF_DISTANCE_AUTHORITY,
} from '../src/domain/multimodalRailTariff';
import { getMultimodalSettlementId, MULTIMODAL_SETTLEMENT_KIND_REVENUE } from '../src/domain/multimodalSettlementIdentity';
import { MULTIMODAL_FEATURE_ROLLOUT } from '../src/domain/multimodalShipmentPersistence';
import { createDevMultimodalRoadPlanningFleet } from '../src/mapV2/gameplay/devMultimodalRoadPlanningFleet';
import { getTurkeyRoadTransferAccessArtifact } from '../src/mapV2/world/multimodalRoadTransferAccessLoader';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';

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
const access = getTurkeyRoadTransferAccessArtifact();

console.log('\n=== Map V2 Multimodal RAIL Offer Generation ===\n');

assert(SAVE_GAME_VERSION === 6, 'AL SAVE_GAME_VERSION 6');
assert(MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF', 'AN MULTIMODAL_OFF');
assert(!isRailMultimodalOfferGenerationAvailable(), 'production generation gate false');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AM RAIL FOUNDATION_ONLY');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'SEA FOUNDATION_ONLY');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AIR FOUNDATION_ONLY');
assert(RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION === 1, 'C schema 1');
assert(MAX_RAIL_MULTIMODAL_OFFERS === 8, 'max 8');

const domain = read('src/domain/multimodalRailOffer.ts');
assert(!domain.includes('Math.random'), 'no Math.random');
assert(!domain.includes('Date.now'), 'no Date.now');
assert(!domain.includes('gameStore'), 'no gameStore');
assert(!read('src/simulation/contracts.ts').includes('generateRailMultimodalOffers'), 'not live pool');
assert(!read('src/simulation/contracts.ts').includes('generateRailMultimodalOffers'), 'AO contracts.ts unchanged import');
assert(!read('src/store/gameStore.ts').includes('generateRailMultimodalOffers'), 'no store generator');
assert(!read('src/screens/MapScreen.tsx').includes('generateRailMultimodalOffers'), 'AP MapScreen');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'AQ routes.ts');
assert(!read('backend/src/index.ts').includes('generateRailMultimodalOffers'), 'AR no backend');
assert(!read('firestore.rules').includes('railOffer'), 'AR no firestore');

const a = generateRailMultimodalOffers({ generationSeed: 'seed-a', accessArtifact: access, playerLevel: 1 });
const a2 = generateRailMultimodalOffers({ generationSeed: 'seed-a', accessArtifact: access, playerLevel: 1 });
assert(a.status === 'READY' && a.offers.length > 0, 'READY offers');
assert(JSON.stringify(a.offers) === JSON.stringify(a2.offers), 'A determinism');
assert(a.offers.map((row) => row.offerId).join('|') === a2.offers.map((row) => row.offerId).join('|'), 'A same IDs');

const b = generateRailMultimodalOffers({ generationSeed: 'seed-b', accessArtifact: access, playerLevel: 1 });
assert(b.status === 'READY', 'B other seed READY');
assert(
  JSON.stringify(b.offers.map((row) => row.offerId)) !== JSON.stringify(a.offers.map((row) => row.offerId)) ||
    b.offers.length === a.offers.length,
  'B seed may change selection',
);

assert(a.offers.every((row) => row.offerSchemaVersion === 1), 'C schema on offers');
assert(a.offers.every((row) => row.transportPattern === RAIL_MULTIMODAL_TRANSPORT_PATTERN), 'D ROAD_RAIL_ROAD');
assert(
  a.offers.every((row) => row.railRouteReference.startsWith('domain.canonical.rail.')),
  'E accepted route refs',
);
assert(
  !a.offers.some((row) => ['bursa', 'antalya', 'trabzon'].includes(row.originCityId) || ['bursa', 'antalya', 'trabzon'].includes(row.destinationCityId)),
  'F no unresolved RAIL cities',
);
assert(a.offers.every((row) => row.cargo.quantityUnit === 'tonnes'), 'G tonnes');
assert(a.offers.every((row) => Number.isInteger(row.playerPayment) && row.playerPayment > 0), 'M Q integer payment > 0');
assert(a.offers.every((row) => row.playerPayment !== row.economics.railCarrierCost), 'N payment != carrier');
assert(a.offers.every((row) => row.economics.expectedGrossMargin > 0), 'O positive margin');
assert(a.offers.every((row) => Number.isFinite(row.playerPayment) && Number.isFinite(row.economics.railCarrierCost)), 'R finite');
assert(a.offers.every((row) => row.deadlineSnapshot.deadlineGameSeconds > row.durationSnapshot.totalDurationGameSeconds), 'U deadline > planned');
assert(
  a.offers.every(
    (row) =>
      row.durationSnapshot.policyVersion === 'multimodal-duration-policy-v1' &&
      row.railTariffSnapshot.railTariffPolicyVersion === 'multimodal-rail-tariff-v1' &&
      row.economics.policyVersion === 'multimodal-rail-offer-economics-v1' &&
      row.deadlineSnapshot.policyVersion === 'multimodal-deadline-policy-v1',
  ),
  'V policy versions',
);
assert(a.offers.every((row) => row.offerId === buildRailMultimodalOfferId({
  generationSeed: 'seed-a',
  originCityId: row.originCityId,
  destinationCityId: row.destinationCityId,
  productId: row.cargo.productId,
  cargoQuantity: row.cargo.quantity,
})), 'W stable IDs');
assert(a.offers.every((row) => !railOfferSettlementCollision(row.offerId)), 'X offerId != settlement');
assert(
  a.offers.every((row) => {
    const sid = getMultimodalSettlementId('demo', MULTIMODAL_SETTLEMENT_KIND_REVENUE);
    return !sid.ok || sid.id !== row.offerId;
  }),
  'X settlement namespace distinct',
);
assert(a.offers.every((row) => row.firstMileAccess.distanceMeters !== 5000 && row.lastMileAccess.distanceMeters !== 5000), 'K no 5 km stub');
assert(a.offers.every((row) => row.firstMileAccess.distanceAuthority === 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS'), 'K Step 25 access');
assert(a.offers.length <= MAX_RAIL_MULTIMODAL_OFFERS, 'cap');

const sample = a.offers[0];
const tariff = estimateMultimodalRailTariff({
  routeReference: sample.railRouteReference,
  distanceMeters: sample.railDistanceMeters,
  distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
  cargoQuantity: sample.cargo.quantity,
  cargoQuantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
});
assert(tariff.status === 'READY' && tariff.totalCarrierCost === sample.economics.railCarrierCost, 'I tariff match');

const duration = estimateMultimodalShipmentDuration({
  shipmentSchemaVersion: 1,
  legs: [
    {
      legId: 'first-mile',
      mode: 'ROAD',
      distanceMeters: sample.firstMileAccess.distanceMeters,
      distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS',
      routeReference: sample.firstMileAccess.routeReference,
      roadPlanning: {
        cargoTons: sample.cargo.quantity,
        routeDifficulty: 0.3,
        truckSpeedKmh: STARTER_TRUCK.speed,
        truckCapacityTons: STARTER_TRUCK.capacity,
        truckCondition: STARTER_TRUCK.condition,
        truckVehicleClass: STARTER_TRUCK.vehicleClass,
        truckCatalogId: STARTER_TRUCK.catalogId,
        driverSpeed: STARTER_DRIVER.speed,
        driverTier: STARTER_DRIVER.tier,
      },
    },
    {
      legId: 'rail-line-haul',
      mode: 'RAIL',
      distanceMeters: sample.railDistanceMeters,
      distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
      routeReference: sample.railRouteReference,
    },
    {
      legId: 'last-mile',
      mode: 'ROAD',
      distanceMeters: sample.lastMileAccess.distanceMeters,
      distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS',
      routeReference: sample.lastMileAccess.routeReference,
      roadPlanning: {
        cargoTons: sample.cargo.quantity,
        routeDifficulty: 0.3,
        truckSpeedKmh: STARTER_TRUCK.speed,
        truckCapacityTons: STARTER_TRUCK.capacity,
        truckCondition: STARTER_TRUCK.condition,
        truckVehicleClass: STARTER_TRUCK.vehicleClass,
        truckCatalogId: STARTER_TRUCK.catalogId,
        driverSpeed: STARTER_DRIVER.speed,
        driverTier: STARTER_DRIVER.tier,
      },
    },
  ],
  transfers: [
    { transferId: 'origin-transfer', fromMode: 'ROAD', toMode: 'RAIL' },
    { transferId: 'destination-transfer', fromMode: 'RAIL', toMode: 'ROAD' },
  ],
});
assert(duration.status === 'READY' && duration.totalDurationGameSeconds === sample.durationSnapshot.totalDurationGameSeconds, 'J duration match');

const ordered = a.offers.every((row, index, list) => {
  if (index === 0) return true;
  const prev = list[index - 1];
  const left = `${prev.originCityId}|${prev.destinationCityId}|${prev.cargo.productId}|${prev.cargo.quantity}|${prev.offerId}`;
  const right = `${row.originCityId}|${row.destinationCityId}|${row.cargo.productId}|${row.cargo.quantity}|${row.offerId}`;
  return left <= right;
});
assert(ordered, 'sort origin dest cargo quantity id');

const { valid: allSteel } = enumerateRailMultimodalOfferCandidates({
  generationSeed: 'cal-v1',
  accessArtifact: access,
  playerLevel: 1,
  productIds: ['steel'],
  cargoTonnesBands: [1, 5, 10, 25],
});
assert(allSteel.length > 0, 'calibration pool nonempty');
assert(allSteel.every((row) => row.economics.expectedGrossMargin > 0), 'S no silent negative margin');
assert(allSteel.filter((row) => row.cargo.quantity === 1).length > 0, 'T 1t present');
assert(allSteel.filter((row) => row.cargo.quantity === 25).every((row) => row.economics.expectedGrossMargin > 0), 'S 25t READY has positive margin');

const raisedCarrier = sample.economics.expectedGrossMargin;
assert(raisedCarrier > 0, 'P baseline margin');
// Increasing carrier cost without increasing payment cannot increase margin:
assert(sample.playerPayment - (sample.economics.railCarrierCost + 1) - sample.economics.estimatedRoadOperatingCost === sample.economics.expectedGrossMargin - 1, 'P margin identity');

const unknown = evaluateRailMultimodalOfferAcceptance({
  offer: { ...sample, offerSchemaVersion: 99 },
  accessArtifact: access,
});
assert(unknown.reasons.includes('UNSUPPORTED_SCHEMA'), 'Y unknown schema fail closed');

const fleetOk = createDevMultimodalRoadPlanningFleet({
  originCityId: sample.originCityId,
  destinationCityId: sample.destinationCityId,
});
const previewBlocked = evaluateRailMultimodalOfferAcceptance({
  offer: sample,
  accessArtifact: access,
  fleet: fleetOk,
  productionCheck: true,
});
assert(previewBlocked.canAcceptNow === false, 'Z canAcceptNow always false Step 27');
assert(previewBlocked.structurallyValid === true, 'Z structural valid under OFF');
assert(previewBlocked.reasons.includes('MULTIMODAL_OFF'), 'productionCheck MULTIMODAL_OFF');
assert(previewBlocked.fleetFeasibility === 'NOT_EVALUATED', 'OFF does not bind fleet');

const previewDev = evaluateRailMultimodalOfferAcceptance({
  offer: sample,
  accessArtifact: access,
  fleet: fleetOk,
  productionCheck: false,
});
assert(previewDev.fleetFeasibility === 'READY_NOW', 'DEV fleet READY_NOW');
assert(previewDev.canAcceptNow === false, 'still no accept implementation');

const busy = createDevMultimodalRoadPlanningFleet({
  originCityId: sample.originCityId,
  destinationCityId: sample.destinationCityId,
});
const busyFleet = {
  ...busy,
  trucks: busy.trucks.map((truck) =>
    truck.currentCityId === sample.originCityId ? { ...truck, status: 'on_route' as const } : truck,
  ),
};
const genAfterBusy = generateRailMultimodalOffers({ generationSeed: 'seed-a', accessArtifact: access, playerLevel: 1 });
assert(JSON.stringify(genAfterBusy.offers) === JSON.stringify(a.offers), 'AA busy truck does not change generation');
const busyPreview = evaluateRailMultimodalOfferAcceptance({
  offer: sample,
  accessArtifact: access,
  fleet: busyFleet,
});
assert(busyPreview.fleetFeasibility === 'ORIGIN_FLEET_UNAVAILABLE' || busyPreview.fleetFeasibility === 'REQUIRES_FLEET_CHANGE', 'AA busy origin not ready');

const noOrigin = {
  ...fleetOk,
  trucks: fleetOk.trucks.filter((truck) => truck.currentCityId !== sample.originCityId),
};
assert(
  evaluateRailMultimodalOfferAcceptance({ offer: sample, accessArtifact: access, fleet: noOrigin }).fleetFeasibility ===
    'ORIGIN_FLEET_UNAVAILABLE',
  'AB no origin fleet',
);
const noDest = {
  ...fleetOk,
  trucks: fleetOk.trucks.filter((truck) => truck.currentCityId !== sample.destinationCityId),
};
assert(
  evaluateRailMultimodalOfferAcceptance({ offer: sample, accessArtifact: access, fleet: noDest }).fleetFeasibility ===
    'DESTINATION_FLEET_UNAVAILABLE',
  'AC no dest fleet',
);

const wrongCity = {
  ...fleetOk,
  trucks: fleetOk.trucks.map((truck) => ({ ...truck, currentCityId: 'bursa', homeCityId: 'bursa' })),
};
assert(
  evaluateRailMultimodalOfferAcceptance({ offer: sample, accessArtifact: access, fleet: wrongCity }).fleetFeasibility !==
    'READY_NOW',
  'AD wrong city not ready',
);

const teleportPreview = evaluateRailMultimodalOfferAcceptance({
  offer: sample,
  accessArtifact: access,
  fleet: {
    ...fleetOk,
    trucks: [
      fleetOk.trucks[0],
      {
        ...fleetOk.trucks[0],
        currentCityId: sample.destinationCityId,
        homeCityId: sample.destinationCityId,
      },
    ],
  },
});
assert(teleportPreview.fleetFeasibility !== 'READY_NOW', 'AE same truck id cannot teleport');

const money = { player: { money: 20000 }, financeLedger: [], contracts: [], trucks: [] };
const snap = JSON.stringify(money);
generateRailMultimodalOffers({ generationSeed: 'seed-a', accessArtifact: access });
assert(JSON.stringify(money) === snap, 'AG no mutation');

assert(generateRailMultimodalOffers({ generationSeed: '!!!', accessArtifact: access }).status === 'INVALID_INPUT', 'invalid seed');
assert(domain.includes('NET_AT_FINAL_SETTLEMENT'), 'carrier net at settlement documented');
assert(read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('RAIL MULTIMODAL OFFER — FOUNDATION ONLY'), 'DEV inspector');
assert(!read('src/mapV2/gameplay/roadSeaRoadFixture.ts').includes('generateRailMultimodalOffers'), 'AR SEA no offers');
assert(!read('src/mapV2/gameplay/roadAirRoadFixture.ts').includes('generateRailMultimodalOffers'), 'AR AIR no offers');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 27 — RAIL contract generation foundation — **COMPLETE**'), 'migration Step 27 complete');
assert(!read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 28 — Player UI: contract card + active timeline — **COMPLETE**'), 'Step 28 not marked complete');
assert(estimateTransportLegDuration({
  legId: 'rail.a',
  mode: 'RAIL',
  distanceMeters: 500_000,
  distanceAuthority: 'SOURCE_BACKED_RAIL_LENGTH',
  routeReference: 'domain.canonical.rail.test.a',
}).durationGameSeconds === 16364, 'Step 24 unchanged');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
