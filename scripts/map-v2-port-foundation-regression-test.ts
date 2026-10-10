/**
 * Map V2 Step 10 SEA / PORT geographic foundation.
 * Run: npx tsx scripts/map-v2-port-foundation-regression-test.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA } from '../src/mapV2/domain';
import { classifyPortTags } from '../src/mapV2/geo/portClassPolicy';
import { associateCityToPorts } from '../src/mapV2/geo/portCityAssociation';
import { validateTurkeyPortPackage, assertNoPlayerWarehouseDependency } from '../src/mapV2/geo/validateGeoPorts';
import type { TurkeyPortPackageV1 } from '../src/mapV2/geo/geoPort';
import {
  clusterPortCandidates,
  collectPortCandidates,
  geoPortIdForSourceIds,
  type OsmPortFeature,
} from './map-v2/port-ingest-core';

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

console.log('\n=== Map V2 Port Foundation ===\n');

function feat(
  sourceId: string,
  tags: Record<string, unknown>,
  geometry: OsmPortFeature['geometry'],
): OsmPortFeature {
  const [kind, id] = sourceId.split('/');
  return {
    type: 'Feature',
    properties: { ...tags, '@type': kind, '@id': Number(id) },
    geometry,
  };
}

const point = (lon: number, lat: number): OsmPortFeature['geometry'] => ({
  type: 'Point',
  coordinates: [lon, lat],
});
const poly = (lon: number, lat: number): OsmPortFeature['geometry'] => ({
  type: 'Polygon',
  coordinates: [
    [
      [lon - 0.002, lat - 0.002],
      [lon + 0.002, lat - 0.002],
      [lon + 0.002, lat + 0.002],
      [lon - 0.002, lat + 0.002],
      [lon - 0.002, lat - 0.002],
    ],
  ],
});

const commercial = classifyPortTags({ harbour: 'yes', name: 'Alsancak Limanı', industrial: 'port' });
assert(commercial.classification === 'COMMERCIAL_PORT' && commercial.eligibility === 'LOGISTICS_ELIGIBLE', 'commercial harbour logistics');
assert(commercial.includeAsGeoPort, 'commercial included');

const marina = classifyPortTags({ leisure: 'marina', name: 'Kalamış Marina' });
assert(marina.classification === 'MARINA' && marina.eligibility === 'NON_LOGISTICS' && !marina.includeAsGeoPort, 'marina excluded');

const ferry = classifyPortTags({ amenity: 'ferry_terminal', name: 'Kadıköy Feribot İskelesi' });
assert(ferry.classification === 'FERRY_PORT' && ferry.eligibility === 'PASSENGER_ONLY' && ferry.includeAsGeoPort, 'ferry passenger-only');

const pier = classifyPortTags({ man_made: 'pier', name: 'Küçük İskele' });
assert(!pier.includeAsGeoPort && pier.eligibility === 'NON_LOGISTICS', 'standalone pier not a GeoPort');

const industrial = classifyPortTags({ industrial: 'port', name: 'Aliağa' });
assert(industrial.classification === 'INDUSTRIAL_PORT' && industrial.eligibility === 'LOGISTICS_ELIGIBLE', 'industrial port area');

const unnamed = classifyPortTags({ harbour: 'yes' });
assert(unnamed.includeAsGeoPort && unnamed.eligibility === 'UNRESOLVED', 'unnamed harbour unresolved');

const passengerOnly = classifyPortTags({ amenity: 'ferry_terminal', cargo: 'passengers' });
assert(passengerOnly.eligibility === 'PASSENGER_ONLY', 'passenger-only facility');

const nodePoly: OsmPortFeature[] = [
  feat('way/1', { name: 'Mersin Limanı', landuse: 'port' }, poly(34.64, 36.8)),
  feat('node/2', { name: 'Mersin Limanı', harbour: 'yes' }, point(34.641, 36.801)),
];
const merged = clusterPortCandidates(collectPortCandidates(nodePoly));
assert(merged.length === 1, 'same facility node+polygon merges');
assert(merged[0].map((row) => row.sourceId).sort().join(',') === 'node/2,way/1', 'source IDs preserved');
assert(geoPortIdForSourceIds(['node/2', 'way/1']) === geoPortIdForSourceIds(['way/1', 'node/2']), 'deterministic id from sorted source ids');

const independent: OsmPortFeature[] = [
  feat('way/10', { name: 'Alsancak Limanı', industrial: 'port' }, poly(27.15, 38.45)),
  feat('way/11', { name: 'Aliağa Limanı', industrial: 'port' }, poly(26.97, 38.83)),
];
assert(clusterPortCandidates(collectPortCandidates(independent)).length === 2, 'nearby independent ports do not merge');

const twiceA = clusterPortCandidates(collectPortCandidates(nodePoly)).map((g) => g.map((r) => r.sourceId).join('|'));
const twiceB = clusterPortCandidates(collectPortCandidates(nodePoly)).map((g) => g.map((r) => r.sourceId).join('|'));
assert(JSON.stringify(twiceA) === JSON.stringify(twiceB), 'clustering deterministic');

const izmir = { gameplayCityId: 'izmir', geoCityId: 'city.tur.test.izmir', longitude: 27.14, latitude: 38.42 };
const ankara = { gameplayCityId: 'ankara', geoCityId: 'city.tur.test.ankara', longitude: 32.85, latitude: 39.93 };
const near = { portId: 'infra.tur.port.near', eligibility: 'LOGISTICS_ELIGIBLE' as const, position: { longitude: 27.15, latitude: 38.43 } };
const farFerry = { portId: 'infra.tur.port.ferry', eligibility: 'PASSENGER_ONLY' as const, position: { longitude: 27.14, latitude: 38.42 } };
const closerPassenger = { portId: 'infra.tur.port.pass', eligibility: 'PASSENGER_ONLY' as const, position: { longitude: 27.141, latitude: 38.421 } };
const regional = { portId: 'infra.tur.port.reg', eligibility: 'LOGISTICS_ELIGIBLE' as const, position: { longitude: 26.4, latitude: 38.2 } };
const otherLogistics = { portId: 'infra.tur.port.other', eligibility: 'LOGISTICS_ELIGIBLE' as const, position: { longitude: 27.2, latitude: 38.5 } };

const coastal = associateCityToPorts(izmir, [near, farFerry, closerPassenger, otherLogistics]);
assert(coastal.associationType === 'DIRECT', 'coastal city with logistics port DIRECT');
assert(coastal.portIds.includes('infra.tur.port.near') && coastal.portIds.includes('infra.tur.port.other'), 'multiple ports supported');
assert(coastal.primaryPortCandidateId === 'infra.tur.port.near', 'primary nearest logistics');
assert(!coastal.portIds.includes('infra.tur.port.pass'), 'passenger not associated');

const inland = associateCityToPorts(ankara, [near, farFerry]);
assert(inland.associationType === 'NONE' && inland.portIds.length === 0, 'inland city remains NONE');

const eligibilityBeatsDistance = associateCityToPorts(izmir, [
  { portId: 'infra.tur.port.close-ferry', eligibility: 'PASSENGER_ONLY', position: { longitude: 27.14, latitude: 38.42 } },
  { portId: 'infra.tur.port.far-logistics', eligibility: 'LOGISTICS_ELIGIBLE', position: { longitude: 27.35, latitude: 38.55 } },
]);
assert(eligibilityBeatsDistance.primaryPortCandidateId === 'infra.tur.port.far-logistics', 'distance alone does not beat logistics eligibility');

const pkgPath = resolve(root, 'src/mapV2/generated/infrastructure/turkey-ports.json');
assert(existsSync(pkgPath), 'turkey-ports.json exists');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as TurkeyPortPackageV1;
assert(validateTurkeyPortPackage(pkg).length === 0, 'package validates');
assert(assertNoPlayerWarehouseDependency(pkg.ports), 'no warehouseType on GeoPorts');
assert(pkg.mode === 'SEA' && pkg.countryId === 'country.tur', 'package identity');
assert(pkg.officialQaStatus === 'OFFICIAL_PORT_QA_ONLY', 'official QA only');
assert(pkg.turkeyPortAuthoritySource === 'PENDING_VERIFICATION', 'authority pending');
assert(pkg.ports.every((port) => port.verificationStatus === 'PROVISIONAL'), 'all PROVISIONAL');
assert(pkg.ports.every((port) => port.sourceIds.length > 0), 'source IDs present');
assert(pkg.stats.logicalPortCount === pkg.ports.length, 'logical count matches');
assert(pkg.stats.logisticsEligibleCount > 0 && pkg.stats.logisticsEligibleCount < pkg.stats.logicalPortCount, 'logistics subset, not inflated to all features');
assert(statSync(pkgPath).size < 2_000_000, 'artifact much smaller than ROAD/RAIL graphs');

const assoc = Object.fromEntries(pkg.cityAssociations.map((row) => [row.gameplayCityId, row]));
assert(assoc.ankara?.associationType === 'NONE', 'ankara NONE');
assert(assoc.diyarbakir?.associationType === 'NONE', 'diyarbakir NONE');
assert(assoc.izmir?.associationType === 'DIRECT', 'izmir DIRECT');
assert(assoc.istanbul?.associationType === 'DIRECT', 'istanbul DIRECT');
assert(['DIRECT', 'REGIONAL'].includes(assoc.adana?.associationType ?? ''), 'adana coastal/regional');
assert((assoc.istanbul?.portIds.length ?? 0) > 1, 'istanbul multi-port');

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(!world.includes('countryPortLoader'), 'player country dashboard does not import port loader');
assert(!world.includes('turkey-ports'), 'player country dashboard does not load turkey-ports.json');
assert(!world.includes('turkey-sea-network'), 'player country dashboard does not load turkey-sea-network.json');
assert(!world.includes('devPortLayer'), 'player country dashboard does not render port markers');

const loader = read('src/mapV2/world/transportNetworkLoader.ts');
assert(!loader.includes('turkey-ports.json'), 'transport loader does not bundle ports');
const infra = JSON.parse(read('src/mapV2/generated/transport/turkey-infrastructure.json')) as { facilities: unknown[] };
assert(infra.facilities.length === 0, 'placeholder infrastructure remains empty');

const legend = read('src/mapV2/screens/MapV2TransportLegend.tsx');
assert(legend.includes("key: 'SEA'") && legend.includes('active: false'), 'Denizyolu legend inactive');
assert(read('src/mapV2/presentation/mapV2ExperienceCopy.ts').includes("legendSea: 'Denizyolu'"), 'Denizyolu copy');
assert(read('src/mapV2/presentation/mapV2ExperienceCopy.ts').includes("legendSoon: 'Yakında'"), 'Yakında copy remains');

assert(LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA, 'warehouse type is not GeoInfra');
assert(read('src/types/game.ts').includes("| 'port'"), 'player warehouse type port still exists as gameplay storage');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('PORT Haritasını Aç'), 'DEV port map CTA');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('SEA / PORT infrastructure'), 'inspector SEA section');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_SEA_PORT_FOUNDATION.md')), 'architecture doc');

assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');
assert(read('src/mapV2/geo/playerFacingRoadCorridor.ts').includes('country dashboard'), 'ROAD corridor module intact');
assert(read('src/mapV2/geo/playerFacingRailCorridor.ts').includes('PLAYER_RAIL_CORRIDOR_POLICY_VERSION'), 'RAIL corridor module intact');

const seaRuntime = JSON.parse(read('src/mapV2/generated/transport/turkey-sea-runtime-manifest.json')) as {
  sourceStatus: string;
  stats: { nodeCount: number; edgeCount: number };
};
assert(seaRuntime.sourceStatus === 'PROTOTYPE' && seaRuntime.stats.nodeCount > 0, 'SEA runtime manifest is prototype with graph stats');
assert(!read('src/mapV2/world/transportNetworkLoader.ts').includes("require('../generated/transport/turkey-sea-network.json')"), 'canonical sea graph not imported at runtime');

const body = { ...pkg };
delete (body as { contentHash?: string }).contentHash;
const recomputed = `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
assert(pkg.contentHash === recomputed, 'artifact contentHash matches body');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
