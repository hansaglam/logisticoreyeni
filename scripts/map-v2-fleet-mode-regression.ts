/**
 * MAP-05 fleet map mode.
 * Run: npx tsx scripts/map-v2-fleet-mode-regression.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { commandModeAfterMapScopeChange, resolveCommandInspectorPanel, resolveMapCommandMode } from '../src/components/map/commandCenter/mapCommandMode';
import { clusterPolicyActive } from '../src/mapV2/experience/mapClusterPolicy';
import { clearMapFleetSession, readMapFleetSession, selectMapFleetTruck, setMapFleetFilter } from '../src/mapV2/experience/mapFleetSession';
import { playerCorridorPointsForCityPair } from '../src/mapV2/gameplay/fleetCorridorGeometry';
import { resolveStationaryTruckCityId } from '../src/mapV2/gameplay/fleetLocation';
import {
  adaptTruckToFleetEntity,
  buildFleetMarkers,
  fleetEntityMatchesFilter,
  resolveTruckConditionPercent,
  resolveTruckFuelPercent,
  summarizeFleet,
} from '../src/mapV2/gameplay/mapV2FleetAdapter';
import { countStationaryVehiclesInCity } from '../src/mapV2/gameplay/cityOperationsSelectors';
import { formatStoredArrivalRemaining, resolveTruckStatusPresentation } from '../src/mapV2/gameplay/truckStatusPresentation';
import { resolveVehicleMapPosition } from '../src/mapV2/gameplay/vehicleMapPosition';
import { markerStateForTruckStatus, resolveVehicleMarkerPaint } from '../src/mapV2/presentation/vehicleMarkerVisual';
import { EXPECTED_RAIL_SOURCE_PACKAGE_HASH } from '../src/mapV2/geo/playerFacingRailCorridor';
import { ROAD_SOURCE_PACKAGE_HASH_2E } from '../src/mapV2/geo/roadRuntimePackage';
import type { Truck } from '../src/types/game';

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function truck(partial: Partial<Truck> & Pick<Truck, 'id' | 'status'>): Truck {
  return {
    name: 'Volvo FH',
    capacity: 22,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 80,
    maintenanceCost: 1,
    comfort: 50,
    condition: 94,
    purchasePrice: 1,
    currentCityId: 'ankara',
    ...partial,
  };
}

function run(): void {
  console.log('\nmap-v2-fleet-mode-regression\n');
  const mapScreen = read('src/screens/MapScreen.tsx');
  const viewport = read('src/mapV2/experience/MapV2CommandCenterViewport.tsx');
  const canvas = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
  const adapter = read('src/mapV2/gameplay/mapV2FleetAdapter.ts');
  const position = read('src/mapV2/gameplay/vehicleMapPosition.ts');
  const location = read('src/mapV2/gameplay/fleetLocation.ts');
  const visual = read('src/mapV2/presentation/vehicleMarkerVisual.ts');
  const inspector = read('src/components/map/commandCenter/MapVehicleInspector.tsx');
  const summary = read('src/components/map/commandCenter/MapFleetSummary.tsx');
  const session = read('src/mapV2/experience/mapFleetSession.ts');
  const store = read('src/store/gameStore.ts');
  const saveGame = read('src/storage/saveGame.ts');
  const routes = read('src/data/routes.ts');
  const roadHash = read('src/mapV2/geo/roadRuntimePackage.ts');
  const railHash = read('src/mapV2/geo/playerFacingRailCorridor.ts');
  const fleetSources = [adapter, position, location, visual, inspector, summary, session, canvas].join('\n');

  assert(mapScreen.includes("enabled: safeMode === 'fleet'"), '1. Filo command mode enables the fleet overlay');
  assert(viewport.includes('fleetLayer={fleetMode ? fleetLayer : null}'), '1b. the viewport mounts the fleet layer only in Filo mode');
  assert(mapScreen.includes('setCommandMode(resolved)') && !mapScreen.includes("navigation.navigate('Fleet'"), '2. Filo stays inside Harita');
  assert(!mapScreen.slice(mapScreen.indexOf('const handleModeChange'), mapScreen.indexOf('const handleCityAction')).includes('navigation.navigate'), '3. no portrait Fleet navigation occurs');
  assert(adapter.includes('getVisibleFleetTrucks') || read('src/mapV2/experience/useMapFleetOverlay.ts').includes('getVisibleFleetTrucks'), '4. fleet entities come from the visible fleet');
  assert(adapter.includes('adaptTruckToFleetEntity'), '4b. map entities come from the truck adapter');

  const idle = truck({ id: 't-idle', status: 'idle', currentCityId: 'ankara', homeCityId: 'izmir' });
  const missingCurrent = truck({ id: 't-home', status: 'idle', currentCityId: undefined as unknown as string, homeCityId: 'bursa' });
  assert(resolveStationaryTruckCityId(idle) === 'ankara', '5. idle city location uses currentCityId');
  assert(resolveStationaryTruckCityId(missingCurrent) === 'bursa', '5b. a missing current city can use the truck home city');
  assert(!location.includes('player.homeCityId') && !location.includes('fallbackHomeCityId') && !adapter.includes('player.homeCityId'), '6. player home city is not a generic fallback');
  assert(!location.includes('resolveTruckCityId') && !adapter.includes('resolveTruckCityId'), '6b. fleet location does not use the player-home resolver');

  const moving = truck({ id: 't-move', status: 'on_route', currentCityId: 'ankara' });
  const placement = resolveVehicleMapPosition({
    status: 'on_route',
    currentCityId: 'ankara',
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    progress: 0.5,
    cityPoint: { x: 1, y: 1 },
    corridorPoints: null,
  });
  assert(placement.kind === 'status-only', '7. on_route truck is not claimed to be at an endpoint');
  assert(resolveStationaryTruckCityId(moving) == null, '7b. on_route is excluded from the city count');
  const exact = resolveVehicleMapPosition({
    status: 'on_route',
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    progress: 0.5,
    corridorPoints: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
  });
  assert(exact.kind === 'route' && exact.x === 5 && exact.y === 0, '8. exact on-route marker requires corridor geometry and progress');
  const adanaAnkara = playerCorridorPointsForCityPair('adana', 'ankara');
  assert(adanaAnkara != null && adanaAnkara.length >= 2, '8b. a known player corridor can place a truck');
  assert(!fleetSources.includes('setInterval') && !position.includes('requestAnimationFrame'), '9. no fake movement timer exists');

  assert(visual.includes('AVAILABLE') && visual.includes('ON_ROUTE') && visual.includes('SELECTED') && visual.includes('MARKETPLACE_LOCKED'), '10. vehicle marker states are centralized');
  const selectedPaint = resolveVehicleMarkerPaint({ state: 'ON_ROUTE', lod: 'COUNTRY_OPERATIONS', selected: true, muted: false });
  const idlePaint = resolveVehicleMarkerPaint({ state: markerStateForTruckStatus('idle'), lod: 'COUNTRY_OPERATIONS', selected: false, muted: false });
  assert(selectedPaint.ring != null && idlePaint.ring == null, '11. selected truck has a selected visual state');

  const writes = ['startDelivery', 'refuel(', 'repairTruck', 'assignDriver', 'acceptContract', 'gameStore.setState', 'Sefere Başla', 'Yakıt Al', 'Tamir Et', 'Sürücü Ata', 'İşi Kabul Et'];
  for (const token of writes) {
    assert(!inspector.includes(token) && !summary.includes(token), `12. vehicle inspector does not write via ${token}`);
  }
  assert(inspector.includes('Yakıt') && adapter.includes('getTruckFuelSnapshot'), '13. fuel display uses existing fuel authority');
  const fueled = resolveTruckFuelPercent({ ...idle, currentFuelL: 72, fuelTankCapacityL: 100, capacity: 22, fuelConsumptionPerKm: 0.3 });
  assert(fueled === 72, '13b. fuel percent is current fuel over tank capacity');
  assert(resolveTruckFuelPercent(idle) == null, '13c. fuel is omitted when the truck has no fuel fields');
  assert(inspector.includes('Kondisyon') && adapter.includes('resolveTruckConditionPercent') && !adapter.includes('condition / 100'), '14. condition display keeps the 0–100 scale');
  assert(resolveTruckConditionPercent(94) === 94 && resolveTruckConditionPercent(0) === 0, '14b. condition is rounded inside 0–100');
  assert(inspector.includes("truck.driverName ?? 'Atanmamış'"), '15. driver display uses the assignment or Atanmamış');
  assert(inspector.includes('Aktif iş') && adapter.includes('findActiveDeliveryForTruck'), '16. active delivery display uses the existing delivery relation');
  assert(!adapter.includes('distanceKm /') && !adapter.includes('travelHours') && formatStoredArrivalRemaining(10, 12) === '2s 0dk', '17. ETA is the stored arrival minus the game clock');
  assert(formatStoredArrivalRemaining(10, Number.NaN) == null, '17b. a missing ETA is omitted');

  const cityTrucks = [idle, truck({ id: 't2', status: 'maintenance', currentCityId: 'ankara' }), moving];
  assert(countStationaryVehiclesInCity(cityTrucks, 'ankara') === 2, '18. city count stays on the shared stationary rule');
  const entities = cityTrucks.map((row) => adaptTruckToFleetEntity({ truck: row }));
  assert(summarizeFleet(entities, 'ankara').cityVehicleCount === 2, '18b. fleet city count matches the inspector rule');
  const clustered = buildFleetMarkers({
    entities: entities.filter((entity) => fleetEntityMatchesFilter(entity, 'all')),
    lod: 'COUNTRY_OPERATIONS',
  });
  assert(clustered.some((marker) => marker.id === 'cluster:ankara' && marker.countLabel === '2'), '19. two trucks in one city become one cluster');
  assert(clusterPolicyActive('VEHICLE_CLUSTER') === true, '19b. vehicle clustering is enabled');
  assert(!mapScreen.slice(mapScreen.indexOf('const handleModeChange'), mapScreen.indexOf('const handleCityAction')).includes('setCityLink'), '20. selected city survives entering Filo mode');
  assert(commandModeAfterMapScopeChange('fleet') === 'fleet', '21. WORLD back preserves Filo command mode');
  assert(resolveCommandInspectorPanel({ mode: 'fleet', citySelected: false, scope: 'WORLD' }) === 'OVERVIEW', '22. WORLD does not keep a country vehicle inspector');
  assert(mapScreen.includes('clearMapFleetVehicleContext()'), '22b. WORLD return clears the selected vehicle context');
  assert(!saveGame.includes('clearMapFleetSession') && !saveGame.includes('mapFleetSession') && !saveGame.includes('FleetMapFilter'), '23. session fleet UI is not saved to the player save');
  selectMapFleetTruck('previous-account');
  setMapFleetFilter('problem');
  clearMapFleetSession();
  const cleared = readMapFleetSession();
  assert(cleared.selectedTruckId == null && cleared.filter === 'all' && store.includes('clearMapFleetSession()'), '24. account reset clears transient fleet selection');
  assert(!fleetSources.includes('player.money') && !fleetSources.includes('grantXp'), '25. no gameplay writes added');
  assert(resolveMapCommandMode('sea') === 'overview' && resolveMapCommandMode('air') === 'overview', '26. SEA and AIR remain locked');
  assert(routes.includes("route('izmir', 'istanbul', 480, 0.82, 180)"), '27. routes.ts is unchanged');
  assert(ROAD_SOURCE_PACKAGE_HASH_2E === 'sha256:b506587dfd7e390794a448a0a855b773af640ebfeba316a4ffc86bacf4d45882' && roadHash.includes(ROAD_SOURCE_PACKAGE_HASH_2E), '28. ROAD hash is unchanged');
  assert(EXPECTED_RAIL_SOURCE_PACKAGE_HASH === 'sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b' && railHash.includes(EXPECTED_RAIL_SOURCE_PACKAGE_HASH), '29. RAIL hash is unchanged');
  assert(summary.includes('Toplam araç') && summary.includes('Yakıt bekliyor') && summary.includes('accessibilityRole="button"'), 'filters and fleet summary stay read-only');
  assert(resolveTruckStatusPresentation('out_of_fuel').label === 'Yakıt yok', 'status copy is centralized');
  const worldMarkers = buildFleetMarkers({ entities, lod: 'WORLD_OVERVIEW' });
  assert(worldMarkers.length === 1 && worldMarkers[0]?.id === 'fleet-world' && worldMarkers[0]?.countLabel === '2', 'WORLD lod shows one aggregate, not every truck');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
