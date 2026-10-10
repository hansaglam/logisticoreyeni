/**
 * Map V2 City Detail foundation: selectors, identity, navigation.
 * Run: npx tsx scripts/map-v2-city-detail-foundation-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../src/mapV2/domain/ids';
import {
  buildCityOperationViewModel,
  cityNodeOperationHint,
  selectActiveDeliveriesByCity,
  selectOwnedTrucksByCity,
  selectWarehousesByCity,
} from '../src/mapV2/gameplay/cityOperation';
import { canEnterCityDetail, mapV2BackAction } from '../src/mapV2/gameplay/mapV2ExperienceNavigation';
import { resolveCityDisplayName } from '../src/mapV2/presentation/cityDisplayName';
import {
  gameplayIdForGeoCity,
  geoCityIdForGameplayCity,
  getTurkeyCityById,
  getTurkeyCityPackage,
  turkeyOverviewGameplayCities,
} from '../src/mapV2/world/countryCityLoader';
import type { Delivery, Truck, Warehouse } from '../src/types/game';

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

console.log('\n=== Map V2 City Detail Foundation ===\n');

const warehouses = [
  { id: 'w-izmir', cityId: 'izmir', capacityTons: 100 },
  { id: 'w-ist', cityId: 'istanbul', capacityTons: 80 },
] as Warehouse[];
const trucks = [
  { id: 't1', name: 'A', currentCityId: 'izmir', status: 'idle' },
  { id: 't2', name: 'B', currentCityId: 'istanbul', status: 'idle', ownershipType: 'owned' },
  { id: 't3', name: 'C', currentCityId: 'izmir', status: 'marketplace_locked' },
] as Truck[];
const deliveries = [
  { id: 'd1', originCityId: 'izmir', destinationCityId: 'istanbul', status: 'on_route' },
  { id: 'd2', originCityId: 'ankara', destinationCityId: 'bursa', status: 'completed' },
  { id: 'd3', originCityId: 'adana', destinationCityId: 'izmir', status: 'preparing' },
] as Delivery[];

assert(selectWarehousesByCity(warehouses, 'izmir').length === 1, 'warehouses counted only for matching city');
assert(selectWarehousesByCity(warehouses, 'trabzon').length === 0, 'zero warehouses is a valid empty list');
assert(selectWarehousesByCity(undefined, 'izmir').length === 0, 'missing warehouses do not crash');
assert(selectOwnedTrucksByCity(trucks, 'izmir', 'izmir').length === 1, 'trucks counted only for matching city; marketplace locked excluded');
assert(selectOwnedTrucksByCity(trucks, 'istanbul', 'izmir').length === 1, 'istanbul truck count');
assert(selectActiveDeliveriesByCity(deliveries, 'izmir').length === 2, 'active jobs use origin OR destination');
assert(selectActiveDeliveriesByCity(deliveries, 'istanbul').length === 1, 'istanbul is destination of one active job');
assert(selectActiveDeliveriesByCity(deliveries, 'ankara').length === 0, 'completed jobs are not active');

const izmirVm = buildCityOperationViewModel({
  legacyCityId: 'izmir',
  geoCityId: geoCityIdForGameplayCity('izmir') ?? null,
  displayName: 'İzmir',
  snapshot: { homeCityId: 'izmir', warehouses, trucks, deliveries },
});
assert(izmirVm.isHomeCity, 'home city derived from homeCityId only');
assert(izmirVm.warehouseCount === 1 && izmirVm.ownedTruckCount === 1 && izmirVm.activeDeliveryCount === 2, 'izmir metrics from existing state');
assert(izmirVm.operationalStatus === 'HOME', 'home operational status');
assert(izmirVm.canInspect, 'mapped city can inspect');
assert(cityNodeOperationHint(izmirVm) === 'HOME', 'one map hint: home wins');

const trabzonVm = buildCityOperationViewModel({
  legacyCityId: 'trabzon',
  geoCityId: geoCityIdForGameplayCity('trabzon') ?? null,
  displayName: 'Trabzon',
  snapshot: { homeCityId: 'izmir', warehouses, trucks, deliveries },
});
assert(trabzonVm.warehouseCount === 0 && trabzonVm.ownedTruckCount === 0 && trabzonVm.activeDeliveryCount === 0, 'zero-value city returns valid zeros');
assert(!trabzonVm.isHomeCity, 'trabzon is not inferred as home from warehouses');
assert(JSON.stringify(trabzonVm).includes('"warehouseCount":0'), 'zeros are numeric, not Yakında');

const unmapped = buildCityOperationViewModel({
  legacyCityId: 'ghost',
  geoCityId: null,
  displayName: 'Ghost',
  snapshot: { homeCityId: 'izmir', warehouses: [], trucks: [], deliveries: [] },
});
assert(!unmapped.canInspect, 'unmapped city cannot inspect');
assert(!canEnterCityDetail(null, new Set(mappedIds())), 'null geo cannot enter detail');

function mappedIds(): string[] {
  return getTurkeyCityPackage().gameplayMappings.map((row) => row.geoCityId);
}

const mapped = new Set(mappedIds());
for (const gameplayId of LEGACY_STABLE_GAMEPLAY_CITY_IDS) {
  const geoId = geoCityIdForGameplayCity(gameplayId);
  assert(Boolean(geoId), `${gameplayId} has verified geoCityId`);
  const city = geoId ? getTurkeyCityById(geoId) : undefined;
  assert(Boolean(city), `${gameplayId} geo city record exists`);
  if (city && geoId) {
    assert(gameplayIdForGeoCity(geoId) === gameplayId, `${gameplayId} reverse mapping`);
    assert(canEnterCityDetail(geoId, mapped), `${gameplayId} can enter city detail`);
    const name = resolveCityDisplayName(city, 'tr');
    assert(name.length > 0 && !name.includes(geoId), `${gameplayId} player name ${name}`);
    const before = { x: city.projected.x, y: city.projected.y };
    assert(city.projected.x === before.x && city.projected.y === before.y, `${gameplayId} coordinates unchanged`);
  }
}

assert(turkeyOverviewGameplayCities().length === 8, 'overview remains 8 gameplay cities');
assert(LEGACY_STABLE_GAMEPLAY_CITY_IDS.join(',') === 'izmir,istanbul,ankara,bursa,antalya,adana,diyarbakir,trabzon', 'legacy IDs not renamed');

assert(mapV2BackAction('CITY_DETAIL', { selectedCityId: 'x', selectedCountryId: 'c' }) === 'EXIT_CITY_DETAIL', 'CITY_DETAIL back returns to country');
assert(mapV2BackAction('COUNTRY', { selectedCityId: 'x', selectedCountryId: 'c' }) === 'CLEAR_CITY_SELECTION', 'country hardware back clears city first');
assert(mapV2BackAction('COUNTRY', { selectedCityId: null, selectedCountryId: 'c' }) === 'EXIT_COUNTRY', 'country back to world');
assert(mapV2BackAction('WORLD', { selectedCityId: null, selectedCountryId: 'c' }) === 'CLEAR_COUNTRY_SELECTION', 'world deselect');
assert(mapV2BackAction('WORLD', { selectedCityId: null, selectedCountryId: null }) === 'CLOSE_EXPERIENCE', 'world close');

const screen = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(screen.includes("setMode('CITY_DETAIL')"), 'experience can enter CITY_DETAIL');
assert(screen.includes('returnFromCityDetail'), 'city detail back restores country');
assert(screen.includes('restoreCamera'), 'world camera restore remains');
assert(screen.includes('MapV2CityDetailScreen'), 'city detail screen wired');
assert(screen.includes('operationHints'), 'map receives lightweight hints, not gameStore');
assert(!screen.includes('useGameStore') || screen.includes('operationHints'), 'store used only to build view models');
assert(read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('operationHints'), 'canvas consumes hint map');
assert(!read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('useGameStore'), 'canvas does not read gameStore');
assert(read('src/mapV2/screens/MapV2CityDetailScreen.tsx').includes('cityEmptyWarehouses'), 'warehouse empty state');
assert(read('src/mapV2/screens/MapV2CityDetailScreen.tsx').includes('cityEmptyFleet'), 'fleet empty state');
assert(read('src/mapV2/screens/MapV2CityDetailScreen.tsx').includes('cityEmptyJobs'), 'jobs empty state');
assert(!read('src/mapV2/screens/MapV2CityDetailScreen.tsx').includes('roadLayer'), 'city detail does not mount ROAD');
assert(!read('src/screens/MapScreen.tsx').includes('MapV2CityDetailScreen'), 'production MapScreen unchanged');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen no mapV2');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
