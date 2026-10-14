/**
 * MAP-04 city inspector and city operations foundation.
 * Run: npx tsx scripts/map-v2-city-inspector-regression.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { resolveCommandInspectorPanel, resolveMapCommandMode, commandModeAfterMapScopeChange } from '../src/components/map/commandCenter/mapCommandMode';
import { EXPECTED_RAIL_SOURCE_PACKAGE_HASH } from '../src/mapV2/geo/playerFacingRailCorridor';
import { ROAD_SOURCE_PACKAGE_HASH_2E } from '../src/mapV2/geo/roadRuntimePackage';
import {
  countActiveShipmentLinks,
  countContractsOriginatingInCity,
  countStationaryVehiclesInCity,
  getCityOperationsSnapshot,
  warehousePresenceInCity,
} from '../src/mapV2/gameplay/cityOperationsSelectors';
import {
  cityQuickActionMode,
  resolveMapV2CityGameplay,
} from '../src/mapV2/gameplay/mapV2CityGameplayAdapter';
import { resolveCountryDisplayName } from '../src/mapV2/presentation/countryDisplayName';
import { geoCityIdForGameplayCity } from '../src/mapV2/world/countryCityLoader';
import { getCountryRecord } from '../src/mapV2/world/worldBoundaryLoader';
import { getCityName } from '../src/utils/entityLookup';

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function run(): void {
  console.log('\nmap-v2-city-inspector-regression\n');

  const inspector = read('src/components/map/commandCenter/MapContextualInspector.tsx');
  const cityPanel = read('src/components/map/commandCenter/MapCityInspector.tsx');
  const shell = read('src/components/map/commandCenter/MapCommandCenterShell.tsx');
  const mapScreen = read('src/screens/MapScreen.tsx');
  const hook = read('src/mapV2/experience/useMapV2GeographicExperience.ts');
  const selectors = read('src/mapV2/gameplay/cityOperationsSelectors.ts');
  const adapter = read('src/mapV2/gameplay/mapV2CityGameplayAdapter.ts');
  const saveGame = read('src/storage/saveGame.ts');
  const routes = read('src/data/routes.ts');
  const roadHash = read('src/mapV2/geo/roadRuntimePackage.ts');
  const railHash = read('src/mapV2/geo/playerFacingRailCorridor.ts');
  const readOnlySources = [inspector, cityPanel, selectors, adapter, mapScreen].join('\n');

  const ankaraGeoId = geoCityIdForGameplayCity('ankara');
  const ankara = resolveMapV2CityGameplay({
    geoCityId: ankaraGeoId ?? null,
    countryId: 'country.tur',
  });
  const countryName = resolveCountryDisplayName(getCountryRecord('country.tur'), 'tr');
  const unsupported = resolveMapV2CityGameplay({
    geoCityId: 'geo.city.not.in.network',
    geoDisplayName: 'Örnek yer',
    countryId: 'country.tur',
  });

  assert(Boolean(ankaraGeoId), '1. Ankara geo id comes from the explicit package mapping');
  assert(
    resolveCommandInspectorPanel({ mode: 'overview', citySelected: true }) === 'CITY',
    '1b. a selected gameplay city opens the CITY inspector',
  );
  assert(mapScreen.includes('setCityLink(link)') && mapScreen.includes('cityLink={cityLink}'), '1c. Harita passes the selected city into the inspector');
  assert(inspector.includes("panel === 'CITY'"), '1d. inspector renders the city panel');

  assert(adapter.includes('getCityName'), '2. city name uses the city catalog helper');
  assert(ankara.displayName === getCityName('ankara'), '2b. Ankara display name matches getCityName', ankara.displayName);
  assert(!cityPanel.includes('ANKARA') && !cityPanel.includes('Ankara'), '2c. city panel does not hard-code a city name');

  assert(adapter.includes('resolveCountryDisplayName'), '3. country name uses the country display helper');
  assert(ankara.countryName === countryName && countryName.length > 0, '3b. country name matches country data', `${ankara.countryName} / ${countryName}`);
  assert(!cityPanel.includes('Türkiye'), '3c. country label is not hard-coded in the city panel');

  const contracts = [
    { status: 'available' as const, originCityId: 'ankara' },
    { status: 'available' as const, originCityId: 'ankara' },
    { status: 'available' as const, originCityId: 'izmir' },
    { status: 'active' as const, originCityId: 'ankara' },
    { status: 'available' as const, originCityId: 'istanbul' },
  ];
  assert(inspector.includes('selectContracts'), '4. available jobs read the existing contract collection');
  assert(countContractsOriginatingInCity(contracts, 'ankara') === 2, '4b. count is available contracts originating in the city');
  const contractCounter = selectors.slice(
    selectors.indexOf('export function countContractsOriginatingInCity'),
    selectors.indexOf('export function countStationaryVehiclesInCity'),
  );
  assert(!contractCounter.includes('destinationCityId'), '4c. contract count does not treat a destination as an available job');

  const contractWrites = ['generateContract', 'createContract', 'issueContract', 'acceptContract', 'contracts.push'];
  for (const token of contractWrites) {
    assert(!readOnlySources.includes(token), `5. no contract creation via ${token}`);
  }

  const trucks = [
    { status: 'idle' as const, currentCityId: 'ankara', homeCityId: 'izmir' },
    { status: 'on_route' as const, currentCityId: 'ankara', homeCityId: 'ankara' },
    { status: 'idle' as const, currentCityId: 'izmir', homeCityId: 'ankara' },
    { status: 'transferring' as const, currentCityId: 'ankara', homeCityId: 'ankara' },
    { status: 'marketplace_locked' as const, currentCityId: 'ankara', homeCityId: 'ankara' },
    { status: 'maintenance' as const, currentCityId: 'ankara', homeCityId: 'ankara' },
  ];
  assert(countStationaryVehiclesInCity(trucks, 'ankara') === 2, '6. stationary trucks at the city are counted');
  assert(!selectors.includes('resolveTruckCityId'), '6b. inspector count does not use the player-home location fallback');
  assert(selectors.includes('Stationary only'), '6c. the city location rule is documented on the selector');

  const warehouses = [{ cityId: 'ankara', upgradeTier: 2, capacityTons: 40 }];
  const present = warehousePresenceInCity(warehouses, 'ankara');
  const absent = warehousePresenceInCity(warehouses, 'bursa');
  assert(present.present && present.level === 2 && present.capacityTons === 40, '7. warehouse presence reads the city warehouse');
  assert(!absent.present && absent.level == null, '7b. a city without a warehouse reports none');
  assert(cityPanel.includes("'Var'") && cityPanel.includes("'Yok'"), '7c. inspector shows Var / Yok');

  const warehouseWrites = ['openWarehouse', 'upgradeWarehouse', 'buyWarehouse', 'warehouse.inventory'];
  for (const token of warehouseWrites) {
    assert(!readOnlySources.includes(token), `8. no warehouse mutation via ${token}`);
  }

  assert(cityQuickActionMode('contracts') === 'contracts', '9. İşleri Gör targets the contracts map mode');
  assert(mapScreen.includes('setCommandMode(resolveMapCommandMode(cityQuickActionMode(action)))'), '9b. the action changes command mode inside Harita');
  assert(!mapScreen.includes('navigation.navigate'), '9c. city actions do not leave for a portrait route');
  const actionBlock = mapScreen.slice(mapScreen.indexOf('const handleCityAction'), mapScreen.indexOf('const handleClearCity'));
  assert(!actionBlock.includes('onOpenContracts') && !actionBlock.includes('onExitHome'), '9d. the jobs action does not call portrait navigation');

  assert(cityQuickActionMode('fleet') === 'fleet', '10. Filoyu Gör targets the fleet map mode');
  assert(cityQuickActionMode('warehouses') === 'warehouses', '11. Depoyu Gör targets the warehouse map mode');
  assert(cityQuickActionMode('market') === 'market', '12. Pazarı Gör targets the market map mode');
  assert(cityPanel.includes('İşleri Gör') && cityPanel.includes('Filoyu Gör') && cityPanel.includes('Depoyu Gör') && cityPanel.includes('Pazarı Gör'), '12b. the four actions are in the city panel');

  assert(!actionBlock.includes('setCityLink') && !actionBlock.includes('setCityClearNonce'), '13. mode changes keep the selected city');
  assert(!mapScreen.slice(mapScreen.indexOf('const handleModeChange'), mapScreen.indexOf('const handleCityAction')).includes('setCityLink'), '13b. the rail mode change does not clear the city');

  assert(resolveMapCommandMode('sea') === 'overview', '14. SEA stays locked');
  assert(resolveMapCommandMode('air') === 'overview', '14b. AIR stays locked');
  assert(!cityPanel.includes("'sea'") && !cityPanel.includes("'air'"), '14c. city actions do not expose SEA or AIR');

  assert(hook.includes('setSelectedCityId(null)'), '15. WORLD back clears the selected city');
  assert(mapScreen.includes('setCityLink(null)') && mapScreen.includes("setMapScope('WORLD')"), '15b. leaving the country clears the city inspector context');
  const countryBack = mapScreen.slice(mapScreen.indexOf('const handleCountrySelect'), mapScreen.indexOf('const handleCitySelect'));
  assert(!countryBack.includes('setCommandMode'), '15c. WORLD return does not reset command mode');

  assert(
    resolveCommandInspectorPanel({ mode: 'overview', citySelected: false }) === 'OVERVIEW',
    '16. WORLD without a city returns the overview inspector',
  );
  assert(mapScreen.includes('if (!selection.geoCityId)') && mapScreen.includes('setCityLink(null)'), '16b. a cleared city does not keep the CITY panel');

  assert(shell.includes('onClose={() => setInspectorOpen(false)}'), '17. inspector close only collapses the panel');
  assert(!shell.includes('onClose={() => onExit'), '17b. closing the inspector does not exit Harita');
  assert(!shell.slice(shell.indexOf('onClose={() => setInspectorOpen(false)}'), shell.indexOf('onClose={() => setInspectorOpen(false)}') + 48).includes('onClearCity'), '17c. close does not clear the city');

  assert(!unsupported.operationsAvailable && !unsupported.isGameplayCity, '18. an unmapped place is not a gameplay city');
  assert(unsupported.gameplayCityId == null, '18b. an unmapped place has no gameplay id');
  assert(cityPanel.includes('Operasyon ağına henüz bağlı değil'), '18c. unsupported cities do not invent operations');
  assert(cityPanel.includes('disabled={!link.operationsAvailable}'), '18d. operational actions stay disabled off the network');

  assert(!saveGame.includes('inspectorFocusKey'), '19. inspector focus is not in the player save');
  assert(!saveGame.includes('getCityOperationsSnapshot') && !saveGame.includes('MapV2CityGameplayLink'), '19b. city inspector state is not in the player save');
  assert(!saveGame.includes('MapCommandMode'), '19c. command mode stays out of the player save');

  const economyWrites = ['player.money', 'grantXp', 'reputation +=', 'buyCargo', 'sellCargo', 'refuel(', 'startDelivery'];
  for (const token of economyWrites) {
    assert(!readOnlySources.includes(token), `20. no progression or economy write via ${token}`);
  }
  assert(!selectors.includes('useGameStore'), '20b. the city snapshot selector does not write through the store');

  assert(routes.includes("route('izmir', 'istanbul', 480, 0.82, 180)"), '21. routes.ts canonical edge is unchanged');

  assert(
    ROAD_SOURCE_PACKAGE_HASH_2E === 'sha256:b506587dfd7e390794a448a0a855b773af640ebfeba316a4ffc86bacf4d45882',
    '22. ROAD hash is unchanged',
  );
  assert(roadHash.includes(ROAD_SOURCE_PACKAGE_HASH_2E), '22b. ROAD hash still lives in the runtime package');

  assert(
    EXPECTED_RAIL_SOURCE_PACKAGE_HASH === 'sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b',
    '23. RAIL hash is unchanged',
  );
  assert(railHash.includes(EXPECTED_RAIL_SOURCE_PACKAGE_HASH), '23b. RAIL hash still lives in the corridor package');

  const snapshot = getCityOperationsSnapshot({
    cityId: 'ankara',
    homeCityId: 'ankara',
    contracts,
    trucks,
    deliveries: [
      { status: 'on_route', originCityId: 'ankara', destinationCityId: 'izmir' },
      { status: 'preparing', originCityId: 'istanbul', destinationCityId: 'ankara' },
      { status: 'completed', originCityId: 'ankara', destinationCityId: 'bursa' },
    ],
    warehouses,
  });
  assert(snapshot.availableContractCount === 2, 'snapshot keeps the origin contract count');
  assert(snapshot.vehicleCount === 2, 'snapshot keeps the stationary vehicle count');
  assert(snapshot.activeShipmentLinkCount === 2, 'snapshot counts origin or destination shipment links');
  assert(snapshot.isHomeCity, 'snapshot marks the player home city');
  assert(countActiveShipmentLinks([{ status: 'completed', originCityId: 'ankara', destinationCityId: 'izmir' }], 'ankara') === 0, 'completed deliveries are not active shipment links');
  assert(!cityPanel.includes('Pazar verisi') && !selectors.includes('marketPrice'), 'market summary is omitted');
  assert(hook.includes('setCitySelectionNonce'), 'tapping the selected city still notifies the inspector');
  assert(!hook.slice(hook.indexOf('const selectOverviewCity'), hook.indexOf('const overviewCities')).includes('applyHome'), 'a city tap does not reset the camera');

  const headerStart = inspector.indexOf('<View style={styles.header}>');
  const headerBlock = inspector.slice(headerStart, inspector.indexOf('<ScrollView', headerStart));
  assert(headerBlock.includes('cityLink.displayName'), 'A1. CITY header renders the city display name');
  assert(!headerBlock.includes('availableContractCount') && !headerBlock.includes('vehicleCount'), 'A2. city name does not depend on metric values');
  assert(headerBlock.includes('cityLink.countryName'), 'A3. CITY header renders the country name');
  assert(cityPanel.includes('label="Müsait işler"') && !cityPanel.includes('availableContractCount > 0'), 'A4. Müsait işler renders when the count is zero');
  assert(cityPanel.includes('label="Şehirdeki araçlar"') && !cityPanel.includes('vehicleCount > 0'), 'A5. vehicle row renders when the count is zero');
  assert(cityPanel.includes('label="Aktif sevkiyat"') && !cityPanel.includes('activeShipmentLinkCount > 0'), 'A6. shipment row renders when the count is zero');
  assert(cityPanel.includes("snapshot?.warehouse.present ? 'Var' : 'Yok'"), 'A7. warehouse renders Var or Yok');
  assert(!inspector.includes("cityPanel ? ''"), 'A8. CITY layout does not keep an empty overview title spacer');
  assert(inspector.includes('flexGrow: 0'), 'A8b. the header row does not grow into the metric area');
  assert(inspector.includes('scrollTo({ y: 0, animated: false })'), 'A9. CITY selection can scroll the inspector to the top');
  assert(inspector.includes('cityIdentity') && inspector.includes('inspectorFocusKey') && inspector.includes('scrollResetKey'), 'A10. a new city or a reopen resets inspector scroll');
  const resetKeyStart = inspector.indexOf('const scrollResetKey');
  const resetKeyLine = inspector.slice(resetKeyStart, inspector.indexOf('\n', resetKeyStart));
  assert(!resetKeyLine.includes('mode'), 'A11. command mode is not part of the scroll reset key');
  assert(resolveCommandInspectorPanel({ mode: 'market', citySelected: true }) === 'CITY', 'A12. Pazar mode keeps the CITY inspector');
  assert(commandModeAfterMapScopeChange('market') === 'market', 'B1. Pazar remains Pazar after COUNTRY -> WORLD');
  assert(commandModeAfterMapScopeChange('fleet') === 'fleet', 'B2. Filo remains Filo after COUNTRY -> WORLD');
  assert(commandModeAfterMapScopeChange('contracts') === 'contracts', 'B3. İşler remains İşler after COUNTRY -> WORLD');
  assert(commandModeAfterMapScopeChange('warehouses') === 'warehouses', 'B4. Depolar remains Depolar after COUNTRY -> WORLD');
  assert(commandModeAfterMapScopeChange('road') === 'road', 'B5. ROAD remains ROAD after COUNTRY -> WORLD');
  assert(commandModeAfterMapScopeChange('rail') === 'rail', 'B6. RAIL remains RAIL after COUNTRY -> WORLD');
  assert(resolveCommandInspectorPanel({ mode: 'market', citySelected: false, scope: 'WORLD' }) === 'OVERVIEW', 'B15. WORLD inspector is Operasyon özeti');
  assert(!countryBack.includes('cityLink.displayName'), 'B16. WORLD return does not keep a city header');
  assert(inspector.includes('scrollResetKey') && inspector.includes('inspectorFocusKey'), 'B17. MAP-04A scroll reset is unchanged');
  assert(headerBlock.includes('cityLink.displayName'), 'A13. Pazar mode still mounts the city header');
  assert(shell.includes('onClose={() => setInspectorOpen(false)}') && !shell.includes('onClose={() => onClearCity'), 'A14. X does not clear the selected city');
  assert(mapScreen.includes('setCityLink(null)') && hook.includes('setSelectedCityId(null)'), 'A15. Dünya clears CITY state');
  assert(!readOnlySources.includes('acceptContract') && !readOnlySources.includes('player.money'), 'A16. layout correction adds no gameplay writes');
  assert(routes.includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'A17. routes.ts stays unchanged');
  assert(ROAD_SOURCE_PACKAGE_HASH_2E === 'sha256:b506587dfd7e390794a448a0a855b773af640ebfeba316a4ffc86bacf4d45882', 'A18. ROAD hash stays unchanged');
  assert(EXPECTED_RAIL_SOURCE_PACKAGE_HASH === 'sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b', 'A19. RAIL hash stays unchanged');
  assert(inspector.includes('contentInsetAdjustmentBehavior="never"'), 'iOS scroll insets do not pad the inspector');
  assert(inspector.includes('automaticallyAdjustContentInsets={false}'), 'automatic content insets stay off');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
