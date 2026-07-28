/**
 * 56 directed city-pair route coverage — direct priority, reverse geometry, no mutation.
 * Run: npx tsx scripts/map-route-coverage-test.ts
 */

import './test-globals';

import { MAP_ROAD_CITY_IDS, MAP_ROAD_SEGMENTS } from '../src/data/mapRoadNetwork';
import {
  buildMapRoadRouteIntegrityCheck,
  getDirectRoadSegment,
  invalidateRoadGraphCache,
  MAP_ROAD_ENDPOINT_TOLERANCE,
  orientRoadSegmentPoints,
  resetRoadRouteResolutionLogsForTests,
  resolveRoadRoute,
} from '../src/components/map/mapRoadUtils';
import { getWorldMapCityPosition } from '../src/data/worldMapPositions';

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

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distanceToCity(point: { x: number; y: number }, cityId: string): number {
  const city = getWorldMapCityPosition(cityId);
  if (!city) return Infinity;
  return pointDistance(point, city);
}

function routesMatchGeometry(
  forward: { x: number; y: number }[],
  reverse: { x: number; y: number }[],
): boolean {
  if (forward.length !== reverse.length) return false;
  for (let i = 0; i < forward.length; i += 1) {
    const rev = reverse[reverse.length - 1 - i];
    if (Math.abs(forward[i].x - rev.x) > 0.0001 || Math.abs(forward[i].y - rev.y) > 0.0001) {
      return false;
    }
  }
  return true;
}

invalidateRoadGraphCache();
resetRoadRouteResolutionLogsForTests();

const cityIds = [...MAP_ROAD_CITY_IDS];
const pairs: Array<[string, string]> = [];
for (const from of cityIds) {
  for (const to of cityIds) {
    if (from !== to) pairs.push([from, to]);
  }
}

let directCount = 0;
let graphCount = 0;
let notFoundCount = 0;
let invalidEndpointCount = 0;
let reverseMismatchCount = 0;
let mutationCount = 0;

const notFoundPairs: string[] = [];
const invalidPairs: string[] = [];
const reverseMismatchPairs: string[] = [];

console.log('\n=== Map Route Coverage (56 directed pairs) ===\n');

for (const [from, to] of pairs) {
  const { route, resolution } = resolveRoadRoute(from, to);
  const integrity = buildMapRoadRouteIntegrityCheck(from, to, route, resolution);

  if (resolution.resolution === 'direct') directCount += 1;
  else if (resolution.resolution === 'graph') graphCount += 1;
  else notFoundCount += 1;

  if (route == null) {
    notFoundPairs.push(`${from}→${to}`);
    continue;
  }

  if (!integrity.valid) {
    invalidEndpointCount += 1;
    invalidPairs.push(`${from}→${to}`);
  }

  const reverse = resolveRoadRoute(to, from);
  if (reverse.route && !routesMatchGeometry(route, reverse.route)) {
    reverseMismatchCount += 1;
    reverseMismatchPairs.push(`${from}↔${to}`);
  }
}

for (const segment of MAP_ROAD_SEGMENTS) {
  if (!segment.isCalibrated || segment.points.length < 2) continue;
  const originalFirst = { ...segment.points[0] };
  const originalLast = { ...segment.points[segment.points.length - 1] };
  orientRoadSegmentPoints(segment, segment.fromCityId, segment.toCityId);
  orientRoadSegmentPoints(segment, segment.toCityId, segment.fromCityId);
  if (
    segment.points[0].x !== originalFirst.x ||
    segment.points[0].y !== originalFirst.y ||
    segment.points[segment.points.length - 1].x !== originalLast.x ||
    segment.points[segment.points.length - 1].y !== originalLast.y
  ) {
    mutationCount += 1;
  }
}

console.log('Coverage report:');
console.log(`  cities: ${cityIds.length}`);
console.log(`  directed pairs: ${pairs.length}`);
console.log(`  direct routes: ${directCount}`);
console.log(`  graph routes: ${graphCount}`);
console.log(`  not found: ${notFoundCount}`);
console.log(`  invalid endpoints: ${invalidEndpointCount}`);
console.log(`  reverse mismatches: ${reverseMismatchCount}`);
console.log(`  catalog mutations: ${mutationCount}`);

if (notFoundPairs.length > 0) {
  console.log('\nNot found pairs:', notFoundPairs.join(', '));
}
if (invalidPairs.length > 0) {
  console.log('\nInvalid endpoint pairs:', invalidPairs.join(', '));
}
if (reverseMismatchPairs.length > 0) {
  console.log('\nReverse mismatch pairs:', [...new Set(reverseMismatchPairs)].join(', '));
}

assert(notFoundCount === 0, 'all 56 pairs resolve a route');
assert(directCount === 56, 'all 56 directed routes are direct', String(directCount));
assert(graphCount === 0, 'no graph fallback routes', String(graphCount));
assert(reverseMismatchCount === 0, 'reverse routes mirror forward geometry');
assert(mutationCount === 0, 'segment.points never mutated');

console.log('\n=== Regression spot checks ===\n');

{
  const trabzonBursa = resolveRoadRoute('trabzon', 'bursa');
  assert(trabzonBursa.resolution.resolution === 'direct', 'Trabzon→Bursa uses direct segment');
  if (trabzonBursa.route) {
    assert(
      distanceToCity(trabzonBursa.route[0], 'trabzon') <= MAP_ROAD_ENDPOINT_TOLERANCE,
      'Trabzon→Bursa starts near Trabzon',
    );
    assert(
      distanceToCity(trabzonBursa.route[trabzonBursa.route.length - 1], 'bursa') <=
        MAP_ROAD_ENDPOINT_TOLERANCE,
      'Trabzon→Bursa ends near Bursa',
    );
  }
}

{
  const segment = MAP_ROAD_SEGMENTS.find((item) => item.id === 'ankara-diyarbakir');
  assert(segment != null, 'ankara-diyarbakir segment exists');
  if (segment) {
    const forward = getDirectRoadSegment('ankara', 'diyarbakir');
    const reverse = getDirectRoadSegment('diyarbakir', 'ankara');
    assert(forward != null && reverse != null, 'Ankara↔Diyarbakır both resolve');
    if (forward && reverse) {
      assert(routesMatchGeometry(forward, reverse), 'Diyarbakır→Ankara reverses Ankara→Diyarbakır');
    }
    const metaForward = orientRoadSegmentPoints(segment, 'ankara', 'diyarbakir');
    const metaReverse = orientRoadSegmentPoints(segment, 'diyarbakir', 'ankara');
    assert(routesMatchGeometry(metaForward, metaReverse), 'metadata orientation reverse');
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
