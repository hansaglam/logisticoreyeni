/**
 * Map V2 domain isolation + mapping contract (static + pure).
 * Does not load MapScreen gameplay. Run: npx tsx scripts/map-v2-domain-architecture-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CITY_IDS } from '../src/data/cities';
import {
  LEGACY_STABLE_GAMEPLAY_CITY_IDS,
  MAP_DATA_RELEASE_VERSION,
  MAP_V2_TRANSPORT_MODES,
  UNRESOLVED_GAMEPLAY_CITY_GEO_MAPPINGS,
  createEmptyMapDataPackage,
  validateGameplayMappingsUnresolved,
  validateMapDataPackage,
} from '../src/mapV2/domain';

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

console.log('\n=== Map V2 Domain Architecture Regression ===\n');

const expected = [
  'izmir',
  'istanbul',
  'ankara',
  'bursa',
  'antalya',
  'adana',
  'diyarbakir',
  'trabzon',
];

assert(CITY_IDS.length === 8, 'catalog still has 8 cities');
assert(expected.every((id, i) => CITY_IDS[i] === id), 'CITY_IDS order/identity unchanged');
assert(
  LEGACY_STABLE_GAMEPLAY_CITY_IDS.every((id, i) => id === expected[i]),
  'legacy-stable list matches catalog',
);

assert(UNRESOLVED_GAMEPLAY_CITY_GEO_MAPPINGS.length === 8, '8 mapping rows');
assert(
  validateGameplayMappingsUnresolved(UNRESOLVED_GAMEPLAY_CITY_GEO_MAPPINGS),
  'all mappings UNRESOLVED with null geoCityId',
);

const empty = createEmptyMapDataPackage();
assert(empty.releaseVersion === null, 'release version unset');
assert(MAP_DATA_RELEASE_VERSION === null, 'MAP_DATA_RELEASE_VERSION null');
assert(empty.countries.length === 0 && empty.cities.length === 0, 'no geo records in empty package');
assert(validateMapDataPackage(empty).join() === 'ok', 'empty package structurally ok');

assert(MAP_V2_TRANSPORT_MODES.join(',') === 'ROAD,RAIL,SEA,AIR', 'canonical modes');

const mapScreen = read('src/screens/MapScreen.tsx');
assert(!mapScreen.includes("from '../mapV2"), 'MapScreen does not import mapV2');
assert(!mapScreen.includes('from "../../mapV2'), 'MapScreen no nested mapV2 import');

const worldCanvas = read('src/components/map/WorldMapCanvas.tsx');
assert(!worldCanvas.includes('mapV2'), 'WorldMapCanvas does not import mapV2');

const domainIndex = read('src/mapV2/domain/index.ts');
assert(!/latitude|longitude|\blat\b|\blng\b/.test(domainIndex), 'domain index has no lat/lng words');

const mappingSrc = read('src/mapV2/domain/mapping.ts');
assert(!mappingSrc.includes('geoCityId: \''), 'no invented geoCityId string literals');

const pkgSrc = read('src/mapV2/domain/mapDataPackage.ts');
assert(pkgSrc.includes('invented-iso'), 'ISO invention flagged in validator');

assert(read('docs/architecture/map-v2/MAP_V2_DOMAIN_ARCHITECTURE.md').includes('GEOGRAPHIC DOMAIN'), 'arch doc');
assert(read('docs/architecture/map-v2/MAP_V2_MIGRATION_CONTRACT.md').includes('DO_NOT_MIGRATE_AS_GEO_DATA'), 'migration doc');
assert(read('docs/architecture/map-v2/MAP_V2_DATA_INVARIANTS.md').includes('pixel coordinates'), 'invariants mention pixels');
assert(read('docs/architecture/map-v2/MAP_V2_ROLLOUT_MODES.md').includes('MAP_V2_SHADOW'), 'rollout modes');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS');
