/**
 * Country dashboard corridor interaction polish.
 * Run: npx tsx scripts/map-v2-country-corridor-interaction-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  connectedNeighborGeoCityIds,
  corridorTouchesGeoCity,
  groupCorridorsByInteractionState,
  resolveCountryCorridorInteractionState,
} from '../src/mapV2/gameplay/countryCorridorInteraction';
import { geoCityIdForGameplayCity } from '../src/mapV2/world/countryCityLoader';
import { getTurkeyPlayerRoadCorridors } from '../src/mapV2/world/countryRoadCorridorLoader';
import { corridorInteractionPaint } from '../src/mapV2/presentation/countryCorridorPaint';

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

console.log('\n=== Map V2 Country Corridor Interaction ===\n');

const artifact = getTurkeyPlayerRoadCorridors();
const ankara = geoCityIdForGameplayCity('ankara')!;
const izmir = geoCityIdForGameplayCity('izmir')!;
const none = groupCorridorsByInteractionState(artifact.corridors, null);
assert(none.DEFAULT.length === 10, 'no selection → all corridors DEFAULT');
assert(none.CONNECTED_TO_SELECTED.length === 0 && none.DIMMED.length === 0, 'no selection → no dim/highlight');

const ankaraGroups = groupCorridorsByInteractionState(artifact.corridors, ankara);
assert(ankaraGroups.CONNECTED_TO_SELECTED.length === 5, 'Ankara has 5 connected corridors');
assert(
  ankaraGroups.CONNECTED_TO_SELECTED.every((row) => corridorTouchesGeoCity(row, ankara)),
  'highlighted corridors all touch Ankara',
);
assert(
  ankaraGroups.DIMMED.every((row) => !corridorTouchesGeoCity(row, ankara)),
  'dimmed corridors do not touch Ankara',
);
assert(ankaraGroups.DIMMED.length === 5, 'unrelated corridors are dimmed, not hidden');
assert(ankaraGroups.CONNECTED_TO_SELECTED.length + ankaraGroups.DIMMED.length === 10, 'geometry set unchanged');

const izmirGroups = groupCorridorsByInteractionState(artifact.corridors, izmir);
assert(
  izmirGroups.CONNECTED_TO_SELECTED.map((row) => row.id).join() !==
    ankaraGroups.CONNECTED_TO_SELECTED.map((row) => row.id).join(),
  'İzmir emphasis set differs from Ankara',
);

const neighbors = connectedNeighborGeoCityIds(artifact.corridors, ankara);
assert(!neighbors.has(ankara), 'selected city is not listed as a neighbor');
assert(neighbors.has(geoCityIdForGameplayCity('istanbul')!), 'İstanbul is an Ankara neighbor');

const lockedAvail = {
  [artifact.corridors[0].fromGeoCityId]: 'LOCKED' as const,
  [artifact.corridors[0].toGeoCityId]: 'LOCKED' as const,
};
assert(
  resolveCountryCorridorInteractionState({
    corridor: artifact.corridors[0],
    selectedGeoCityId: artifact.corridors[0].fromGeoCityId,
    availabilityByGeoCityId: lockedAvail,
  }) === 'LOCKED_AND_SELECTED_CONTEXT',
  'selected locked city keeps locked-selected context',
);
assert(
  resolveCountryCorridorInteractionState({
    corridor: artifact.corridors[0],
    selectedGeoCityId: artifact.corridors[0].fromGeoCityId,
    availabilityByGeoCityId: lockedAvail,
  }) !== 'CONNECTED_TO_SELECTED',
  'locked selected corridor is not painted as unlocked connected',
);
assert(
  resolveCountryCorridorInteractionState({
    corridor: artifact.corridors[0],
    selectedGeoCityId: 'other',
    availabilityByGeoCityId: lockedAvail,
  }) === 'LOCKED_OR_MIXED',
  'unrelated locked corridor stays locked/mixed',
);

const mixedAvail = {
  [artifact.corridors[0].fromGeoCityId]: 'UNLOCKED' as const,
  [artifact.corridors[0].toGeoCityId]: 'LOCKED' as const,
};
assert(
  resolveCountryCorridorInteractionState({
    corridor: artifact.corridors[0],
    selectedGeoCityId: null,
    availabilityByGeoCityId: mixedAvail,
  }) === 'LOCKED_OR_MIXED',
  'unlocked↔locked stays muted without selection',
);

assert(corridorInteractionPaint('CONNECTED_TO_SELECTED').opacity === 1, 'connected paint is full opacity');
assert(corridorInteractionPaint('DIMMED').opacity < 1, 'dimmed paint is reduced opacity');
assert(
  corridorInteractionPaint('LOCKED_AND_SELECTED_CONTEXT').strokes[0].color !==
    corridorInteractionPaint('CONNECTED_TO_SELECTED').strokes[1].color,
  'locked-selected color is not the unlocked connected steel',
);

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(world.includes('selectedCityId={selectedCityId}'), 'list uses shared selectedCityId');
assert(world.includes('onSelect={setSelectedCityId}'), 'list writes the same selection');
assert(world.includes('onSelectCity: setSelectedCityId'), 'map writes the same selection');
assert(world.includes('returnFromCityDetail'), 'city detail back exists');
assert(!/const returnFromCityDetail[\s\S]{0,80}setSelectedCityId\(null\)/.test(world), 'city detail back does not clear city selection');
assert(world.includes("setMode('COUNTRY')"), 'city detail back restores country');

const canvas = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
assert(canvas.includes('groupCorridorsByInteractionState'), 'canvas uses isolated interaction model');
assert(canvas.includes('cityLayer?.selectedCityId'), 'corridor emphasis reads shared city selection');
assert(!canvas.includes('dijkstraShortestPath'), 'no device pathfinding');
assert(!canvas.includes('build-turkey-road-corridors'), 'no route extraction in canvas');
const cache = read('src/mapV2/world/countryCorridorPathCache.ts');
assert(cache.includes('contentHash}:${corridorId}'), 'geometry cache key is contentHash + corridor id');
assert(!cache.includes('selectedCityId'), 'geometry cache is not keyed by selection');
assert(cache.includes('getCachedCorridorPath'), 'per-corridor geometry is cached');
assert(canvas.includes('COUNTRY_CORRIDOR_INTERACTION_DRAW_ORDER'), 'corridors batched by visual state');
assert(canvas.includes('COUNTRY_CORRIDOR_SELECTION_FADE_MS'), 'selection fade respects the 180–250ms budget');
assert(read('src/mapV2/screens/MapV2CitySelectionPanel.tsx').includes('COUNTRY_CORRIDOR_CONNECTED'), 'city card shares corridor accent');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
