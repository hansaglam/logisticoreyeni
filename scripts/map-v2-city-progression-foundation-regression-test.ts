/**
 * Map V2 city progression foundation.
 * Run: npx tsx scripts/map-v2-city-progression-foundation-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../src/mapV2/domain/ids';
import {
  canOpenCityOperations,
  evaluateCityProgression,
  evaluateRequirement,
  isCityAvailabilityOpen,
  MAP_V2_CITY_PROGRESSION_DEFAULT_MODE,
  resolveStarterGameplayCityId,
  type CityUnlockPolicy,
  type PlayerProgressionSnapshot,
} from '../src/mapV2/gameplay/cityProgression';
import {
  buildLegacyAllUnlockedPolicies,
  buildTurkeyCityProgressionPreviewPolicies,
  MAP_V2_CITY_PROGRESSION_PREVIEW_POLICY_ID,
} from '../src/mapV2/gameplay/cityProgression.preview.fixture';
import { canEnterCityDetail, mapV2BackAction } from '../src/mapV2/gameplay/mapV2ExperienceNavigation';
import { formatCityUnlockRequirementRow } from '../src/mapV2/presentation/mapV2ExperienceCopy';
import { geoCityIdForGameplayCity, mappedGeoCityIds } from '../src/mapV2/world/countryCityLoader';

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

console.log('\n=== Map V2 City Progression Foundation ===\n');

assert(MAP_V2_CITY_PROGRESSION_DEFAULT_MODE === 'LEGACY_ALL_UNLOCKED', 'default rollout is legacy all-open');
assert(MAP_V2_CITY_PROGRESSION_PREVIEW_POLICY_ID.includes('preview'), 'preview policy id is marked preview');
assert(resolveStarterGameplayCityId('ankara') === 'ankara', 'starter follows homeCityId');
assert(resolveStarterGameplayCityId(null) === 'izmir', 'missing home uses existing izmir fallback');
assert(resolveStarterGameplayCityId('paris') === 'izmir', 'unknown home uses existing izmir fallback');

const snapshot: PlayerProgressionSnapshot = {
  homeCityId: 'izmir',
  level: 5,
  reputation: 20,
  money: 18_200,
  warehouseCityIds: ['izmir'],
  truckCityIds: ['istanbul'],
  deliveryCityIds: ['adana', 'izmir'],
};

const legacy = evaluateCityProgression({
  mode: 'LEGACY_ALL_UNLOCKED',
  snapshot,
  policies: buildLegacyAllUnlockedPolicies(snapshot.homeCityId),
});
assert(legacy.country.unlockedCities === 8 && legacy.country.lockedCities === 0, 'legacy: 8/8 open');
assert(legacy.country.progressRatio === 1, 'legacy progress is truthful 8/8');
assert(legacy.byCityId.izmir.availability === 'STARTER', 'legacy home is STARTER');
assert(legacy.byCityId.trabzon.availability === 'UNLOCKED', 'legacy trabzon remains UNLOCKED');
assert(legacy.byCityId.istanbul.canOpenDetail && legacy.byCityId.adana.canOpenDetail, 'legacy assets stay playable');
assert(legacy.country.nextRecommendedCityId === null, 'legacy has no next locked city');

const previewPolicies = buildTurkeyCityProgressionPreviewPolicies('izmir');
assert(previewPolicies.every((row) => row.provisionalDevOnly), 'preview policies marked PROVISIONAL_DEV_ONLY');
const preview = evaluateCityProgression({
  mode: 'MAP_V2_PROGRESSION_PREVIEW',
  snapshot,
  policies: previewPolicies,
});
assert(preview.byCityId.izmir.availability === 'STARTER', 'preview starter is home');
assert(preview.country.unlockedCities === 3, 'preview: home + two catalog unlocks');
assert(preview.country.lockedCities === 5, 'preview remaining cities locked');
assert(preview.byCityId.istanbul.availability === 'UNLOCKED', 'preview first catalog city unlocked');
assert(preview.byCityId.bursa.availability === 'LOCKED', 'preview later city locked');
assert(!preview.byCityId.bursa.canOpenDetail, 'locked city cannot open detail');
assert(preview.byCityId.adana.availability === 'LOCKED', 'preview may lock a delivery city (DEV only)');
assert(preview.country.nextRecommendedCityId === previewPolicies.find((row) => row.availability === 'LOCKED')?.cityId, 'next city is policy order');

const mapped = new Set(mappedGeoCityIds());
const izmirGeo = geoCityIdForGameplayCity('izmir')!;
const bursaGeo = geoCityIdForGameplayCity('bursa')!;
assert(canEnterCityDetail(bursaGeo, mapped), 'mapping-only enter still true for locked city');
assert(!canOpenCityOperations(bursaGeo, mapped, 'LOCKED'), 'operations gate blocks locked city');
assert(canOpenCityOperations(izmirGeo, mapped, 'STARTER'), 'starter can open City Detail');
assert(!canOpenCityOperations(null, mapped, 'UNLOCKED'), 'null geo cannot open');

assert(evaluateRequirement({ type: 'PLAYER_LEVEL', level: 5 }, snapshot, new Set()), 'level met at equal');
assert(!evaluateRequirement({ type: 'PLAYER_LEVEL', level: 8 }, snapshot, new Set()), 'level unmet');
assert(!evaluateRequirement({ type: 'REPUTATION', value: 40 }, snapshot, new Set()), 'reputation unmet');
assert(!evaluateRequirement({ type: 'CASH', amount: 25_000 }, snapshot, new Set()), 'cash unmet');
assert(evaluateRequirement({ type: 'WAREHOUSE_IN_CITY', cityId: 'izmir' }, snapshot, new Set()), 'warehouse met');
assert(evaluateRequirement({ type: 'CITY_UNLOCKED', cityId: 'izmir' }, snapshot, new Set(['izmir'])), 'city unlocked met');
assert(!evaluateRequirement({ type: 'CITY_UNLOCKED', cityId: 'bursa' }, snapshot, new Set(['izmir'])), 'city unlocked unmet');

const andPolicy: CityUnlockPolicy[] = [
  { cityId: 'izmir', availability: 'STARTER', requirements: [], displayPriority: 0 },
  {
    cityId: 'bursa',
    availability: 'LOCKED',
    requirements: [
      { type: 'PLAYER_LEVEL', level: 8 },
      { type: 'REPUTATION', value: 40 },
    ],
    displayPriority: 1,
  },
];
const andPreview = evaluateCityProgression({
  mode: 'MAP_V2_PROGRESSION_PREVIEW',
  snapshot,
  policies: andPolicy.concat(
    LEGACY_STABLE_GAMEPLAY_CITY_IDS.filter((id) => id !== 'izmir' && id !== 'bursa').map((cityId, index) => ({
      cityId,
      availability: 'UNLOCKED' as const,
      requirements: [],
      displayPriority: index + 2,
    })),
  ),
});
assert(!andPreview.byCityId.bursa.allRequirementsMet, 'AND: both unmet → allRequirementsMet false');
const rich: PlayerProgressionSnapshot = { ...snapshot, level: 9, reputation: 50 };
const andMet = evaluateCityProgression({
  mode: 'MAP_V2_PROGRESSION_ACTIVE',
  snapshot: rich,
  policies: andPolicy.concat(
    LEGACY_STABLE_GAMEPLAY_CITY_IDS.filter((id) => id !== 'izmir' && id !== 'bursa').map((cityId, index) => ({
      cityId,
      availability: 'LOCKED' as const,
      requirements: [{ type: 'PLAYER_LEVEL', level: 99 }],
      displayPriority: index + 2,
    })),
  ),
});
assert(andMet.byCityId.bursa.availability === 'UNLOCKED', 'ACTIVE: AND met unlocks bursa');
assert(andMet.byCityId.istanbul.availability === 'UNLOCKED', 'ACTIVE: truck in istanbul force-opens');
assert(andMet.byCityId.adana.availability === 'UNLOCKED', 'ACTIVE: active delivery force-opens adana');

const labels = formatCityUnlockRequirementRow({ type: 'PLAYER_LEVEL', required: 8, current: 5, met: false } as never);
assert(labels.requiredLabel.includes('Seviye 8') && labels.currentLabel.includes('5'), 'requirement copy uses real metrics');

assert(mapV2BackAction('CITY_DETAIL', { selectedCityId: 'x', selectedCountryId: 'c' }) === 'EXIT_CITY_DETAIL', 'detail back preserved');
assert(isCityAvailabilityOpen('UNLOCKED') && !isCityAvailabilityOpen('LOCKED'), 'open helper');

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(world.includes('MapV2CityLockPanel'), 'lock panel wired');
assert(world.includes('canOpenCityOperations'), 'City Detail gated on availability');
assert(world.includes("setMode('CITY_DETAIL')"), 'unlocked path still enters detail');
assert(world.includes('LEGACY_ALL_UNLOCKED'), 'legacy mode present');
assert(world.includes('MAP_V2_PROGRESSION_PREVIEW'), 'preview toggle present');
assert(!world.includes('debugSetCash') && !world.includes('setMoney'), 'no cash mutation from world screen');
assert(!world.toLowerCase().includes('firestore'), 'no Firestore from world screen');
assert(read('src/mapV2/screens/MapV2CityLockPanel.tsx').includes('disabled'), 'unlock CTA disabled');
assert(read('src/mapV2/screens/MapV2CityLockPanel.tsx').includes('comingSoonTitle'), 'CTA is Yakında, not purchase');
assert(read('src/mapV2/screens/MapV2CountryCitiesPane.tsx').includes('availabilityByGeoCityId'), 'list uses availability');
assert(read('src/mapV2/screens/MapV2CountryOverviewShell.tsx').includes('openCityCount'), 'summary uses real open count');
assert(read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('CITY_NODE_LOCKED'), 'locked node visual');
assert(!read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('evaluateCityProgression'), 'canvas has no policy eval');
assert(!read('src/screens/MapScreen.tsx').includes('cityProgression'), 'production MapScreen has no city progression');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen no mapV2');
assert(!read('src/data/routes.ts').includes('CityAvailability'), 'routes.ts not used for unlock');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 City Progression Preview'), 'DEV preview entry');
assert(read('docs/architecture/map-v2/MAP_V2_CITY_PROGRESSION_FOUNDATION.md').includes('LEGACY_ALL_UNLOCKED'), 'docs exist');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
