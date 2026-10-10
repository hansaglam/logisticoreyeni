/**
 * Map V2 Step 15 airport cargo QA + logistics eligibility.
 * Run: npx tsx scripts/map-v2-airport-cargo-qa-regression-test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  applyOfficialCargoQaToDraft,
  resolveCargoCapabilityFromEvidence,
  resolveLogisticsEligibilityFromCargo,
  selectPassengerAndLogisticsPrimaries,
  FUTURE_AIR_CORRIDOR_ELIGIBILITY_RULE,
} from '../src/mapV2/geo/airportCargoPolicy';
import type { AirportCargoEvidenceRecord } from '../src/mapV2/data/qa/turkey-airport-cargo-qa';
import type { TurkeyAirportPackageV1 } from '../src/mapV2/geo/geoAirport';
import { validateTurkeyAirportPackage } from '../src/mapV2/geo/validateGeoAirports';

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

console.log('\n=== Map V2 Airport Cargo QA ===\n');

const official: AirportCargoEvidenceRecord = {
  iata: 'IST',
  sourceType: 'OFFICIAL_STATISTICS',
  sourceAuthority: 'DHMİ',
  sourceReference: 'test',
  evidenceType: 'OFFICIAL_CARGO_STATISTICS',
  observedFact: '1000 t',
  evidenceDate: '2026-09-19',
  status: 'ACCEPTED',
  cargoTonnesYtd: 1000,
};
const terminal: AirportCargoEvidenceRecord = {
  ...official,
  evidenceType: 'OFFICIAL_CARGO_TERMINAL',
  cargoTonnesYtd: undefined,
};
const weak: AirportCargoEvidenceRecord = {
  ...official,
  iata: 'YEI',
  status: 'WEAK',
  cargoTonnesYtd: 0.1,
  observedFact: '0.1 t',
};
const unavailable: AirportCargoEvidenceRecord = {
  ...official,
  evidenceType: 'OTHER_OFFICIAL',
  observedFact: 'Official statement: no cargo handling',
  cargoTonnesYtd: undefined,
};

assert(resolveCargoCapabilityFromEvidence([official]) === 'VERIFIED_SUPPORTED', 'explicit stats ≥100t VERIFIED');
assert(resolveCargoCapabilityFromEvidence([terminal]) === 'VERIFIED_SUPPORTED', 'official cargo terminal VERIFIED');
assert(resolveCargoCapabilityFromEvidence([weak]) === 'PROVISIONAL_SUPPORTED', 'weak positive tonnes PROVISIONAL');
assert(resolveCargoCapabilityFromEvidence([]) === 'UNKNOWN', 'no evidence UNKNOWN');
assert(resolveCargoCapabilityFromEvidence([unavailable]) === 'KNOWN_UNAVAILABLE', 'explicit unavailable');

assert(
  resolveLogisticsEligibilityFromCargo({
    cargoCapability: 'VERIFIED_SUPPORTED',
    operationalStatus: 'OPERATIONAL',
    civilUse: 'CIVIL',
    classification: 'INTERNATIONAL_AIRPORT',
  }) === 'LOGISTICS_ELIGIBLE',
  'verified civil cargo → LOGISTICS_ELIGIBLE',
);
assert(
  resolveLogisticsEligibilityFromCargo({
    cargoCapability: 'UNKNOWN',
    operationalStatus: 'OPERATIONAL',
    civilUse: 'CIVIL',
    classification: 'INTERNATIONAL_AIRPORT',
  }) === 'UNRESOLVED',
  'UNKNOWN not silently eligible',
);
assert(
  resolveLogisticsEligibilityFromCargo({
    cargoCapability: 'VERIFIED_SUPPORTED',
    operationalStatus: 'OPERATIONAL',
    civilUse: 'MILITARY',
    classification: 'MILITARY_AIRFIELD',
  }) === 'MILITARY_RESTRICTED',
  'military-only stays restricted',
);
assert(
  resolveLogisticsEligibilityFromCargo({
    cargoCapability: 'VERIFIED_SUPPORTED',
    operationalStatus: 'CLOSED_OR_INACTIVE',
    civilUse: 'CIVIL',
    classification: 'CLOSED_OR_INACTIVE',
  }) === 'NON_LOGISTICS',
  'closed → NON_LOGISTICS',
);

const city = { gameplayCityId: 'test', longitude: 29.0, latitude: 41.0 };
const closerPax = {
  airportId: 'near-pax',
  iataCode: 'SAW',
  eligibility: 'UNRESOLVED' as const,
  classification: 'INTERNATIONAL_AIRPORT' as const,
  position: { longitude: 29.31, latitude: 40.9 },
  operationalStatus: 'OPERATIONAL' as const,
  cargoCapability: 'UNKNOWN' as const,
  civilUse: 'CIVIL' as const,
  airLogisticsReadiness: 'NOT_READY' as const,
};
const fartherCargo = {
  airportId: 'far-cargo',
  iataCode: 'IST',
  eligibility: 'LOGISTICS_ELIGIBLE' as const,
  classification: 'INTERNATIONAL_AIRPORT' as const,
  position: { longitude: 28.75, latitude: 41.26 },
  operationalStatus: 'OPERATIONAL' as const,
  cargoCapability: 'VERIFIED_SUPPORTED' as const,
  civilUse: 'CIVIL' as const,
  airLogisticsReadiness: 'READY' as const,
  cargoTonnesYtd: 1_341_298,
};
const dual = selectPassengerAndLogisticsPrimaries(city, [closerPax, fartherCargo]);
assert(dual.primaryPassengerAirportCandidateId === 'near-pax', 'passenger primary nearer');
assert(dual.primaryLogisticsAirportCandidateId === 'far-cargo', 'logistics primary follows cargo not distance');

const closedOld = {
  airportId: 'ada',
  iataCode: 'ADA',
  eligibility: 'NON_LOGISTICS' as const,
  classification: 'CLOSED_OR_INACTIVE' as const,
  position: { longitude: 35.28, latitude: 36.98 },
  operationalStatus: 'CLOSED_OR_INACTIVE' as const,
  cargoCapability: 'UNKNOWN' as const,
  civilUse: 'CIVIL' as const,
  airLogisticsReadiness: 'NOT_READY' as const,
};
const replacement = {
  airportId: 'cov',
  iataCode: 'COV',
  eligibility: 'LOGISTICS_ELIGIBLE' as const,
  classification: 'INTERNATIONAL_AIRPORT' as const,
  position: { longitude: 35.1, latitude: 36.92 },
  operationalStatus: 'OPERATIONAL' as const,
  cargoCapability: 'VERIFIED_SUPPORTED' as const,
  civilUse: 'CIVIL' as const,
  airLogisticsReadiness: 'READY' as const,
};
const adanaCity = { gameplayCityId: 'adana', longitude: 35.32, latitude: 37.0 };
const replaced = selectPassengerAndLogisticsPrimaries(adanaCity, [closedOld, replacement]);
assert(replaced.primaryPassengerAirportCandidateId === 'cov', 'closed not passenger primary');
assert(replaced.primaryLogisticsAirportCandidateId === 'cov', 'replacement is logistics primary');

const regionalReady = {
  airportId: 'saw-regional',
  iataCode: 'SAW',
  eligibility: 'LOGISTICS_ELIGIBLE' as const,
  classification: 'INTERNATIONAL_AIRPORT' as const,
  position: { longitude: 29.31, latitude: 40.9 },
  operationalStatus: 'OPERATIONAL' as const,
  cargoCapability: 'VERIFIED_SUPPORTED' as const,
  civilUse: 'CIVIL' as const,
  airLogisticsReadiness: 'READY' as const,
};
const yei = {
  airportId: 'yei',
  iataCode: 'YEI',
  eligibility: 'LOGISTICS_ELIGIBLE_PREVIEW' as const,
  classification: 'DOMESTIC_AIRPORT' as const,
  position: { longitude: 29.56, latitude: 40.255 },
  operationalStatus: 'OPERATIONAL' as const,
  cargoCapability: 'PROVISIONAL_SUPPORTED' as const,
  civilUse: 'DUAL_USE' as const,
  airLogisticsReadiness: 'PREVIEW_ONLY' as const,
};
const bursa = selectPassengerAndLogisticsPrimaries({ gameplayCityId: 'bursa', longitude: 29.06, latitude: 40.19 }, [yei, regionalReady]);
assert(bursa.primaryPassengerAirportCandidateId === 'yei', 'bursa passenger YEI');
assert(bursa.primaryLogisticsAirportCandidateId === null, 'bursa does not silently take regional SAW');

const applied = applyOfficialCargoQaToDraft({
  iataCode: 'IST',
  osmMilitary: false,
  classification: 'INTERNATIONAL_AIRPORT',
  operationalStatus: 'OPERATIONAL',
  eligibility: 'UNRESOLVED',
  cargoCapability: 'UNKNOWN',
  hasDhmiCivilIdentity: true,
});
assert(applied.cargoCapability === 'VERIFIED_SUPPORTED', 'IST cargo QA VERIFIED');
assert(applied.logisticsEligibility === 'LOGISTICS_ELIGIBLE', 'IST logistics eligible');
assert(applied.airLogisticsReadiness === 'READY', 'IST READY');

assert(FUTURE_AIR_CORRIDOR_ELIGIBILITY_RULE.includes('READY'), 'future corridor gate documented');

const pkgPath = resolve(root, 'src/mapV2/generated/infrastructure/turkey-airports.json');
assert(existsSync(pkgPath), 'artifact exists');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as TurkeyAirportPackageV1;
assert(validateTurkeyAirportPackage(pkg).length === 0, 'package validates after cargo QA');
assert(pkg.airports.every((row) => row.verificationStatus === 'PROVISIONAL'), 'airport verification not mass-promoted');
assert((pkg.stats.cargoVerifiedCount ?? 0) > 0, 'some VERIFIED cargo');
assert((pkg.stats.cargoUnknownCount ?? 0) > 0, 'UNKNOWN remains for airports without evidence');
assert((pkg.stats.logisticsEligibleCount ?? 0) > 0, 'some logistics eligible');
assert(pkg.airports.every((row) => row.logisticsEligibility !== 'LOGISTICS_ELIGIBLE' || row.cargoCapability === 'VERIFIED_SUPPORTED'), 'eligible implies verified cargo');

const assoc = Object.fromEntries(pkg.cityAssociations.map((row) => [row.gameplayCityId, row]));
const byId = new Map(pkg.airports.map((row) => [row.id, row]));
assert(byId.get(assoc.istanbul.primaryPassengerAirportCandidateId ?? '')?.iataCode === 'SAW', 'istanbul passenger SAW');
assert(byId.get(assoc.istanbul.primaryLogisticsAirportCandidateId ?? '')?.iataCode === 'IST', 'istanbul logistics IST');
assert(byId.get(assoc.adana.primaryPassengerAirportCandidateId ?? '')?.iataCode === 'COV', 'adana passenger COV');
assert(byId.get(assoc.adana.primaryLogisticsAirportCandidateId ?? '')?.iataCode === 'COV', 'adana logistics COV');
assert(pkg.airports.find((row) => row.iataCode === 'ADA')?.operationalStatus === 'CLOSED_OR_INACTIVE', 'ADA closed');
assert(assoc.bursa.primaryLogisticsAirportCandidateId == null, 'bursa logistics null');
assert(assoc.izmir.airLogisticsReadiness === 'READY', 'izmir READY');
assert(assoc.ankara.airLogisticsReadiness === 'READY', 'ankara READY');
assert(assoc.antalya.airLogisticsReadiness === 'READY', 'antalya READY');
assert(assoc.trabzon.airLogisticsReadiness === 'READY', 'trabzon READY');
assert(assoc.diyarbakir.airLogisticsReadiness === 'READY', 'diyarbakir READY');
assert(assoc.bursa.airLogisticsReadiness === 'NOT_READY', 'bursa NOT_READY');

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(!world.includes('turkey-airport-cargo-qa'), 'dashboard does not load cargo QA dataset');
assert(!world.includes('countryAirportLoader'), 'dashboard does not import airport loader');
assert(!world.includes('devAirportLayer'), 'no dashboard airport markers');
assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes("key: 'AIR'") && read('src/mapV2/screens/MapV2TransportLegend.tsx').includes('active: false'), 'Havayolu Yakında');
assert(read('src/mapV2/generated/transport/turkey-air-network.json').includes('SOURCE_PENDING'), 'AIR graph pending');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('City AIR logistics readiness'), 'DEV city readiness panel');
assert(read('src/mapV2/screens/MapV2AirportPrototypeScreen.tsx').includes('CARGO_READY'), 'DEV cargo filter');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
