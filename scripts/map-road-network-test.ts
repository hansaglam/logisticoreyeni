/**
 * Map road network — direct segment priority, graph inclusion, cache, reverse.
 * Run: npx tsx scripts/map-road-network-test.ts
 */

import './test-globals';

import {
  buildMapRoadSegmentCheck,
  findDuplicateMapRoadCityPairKeys,
  findDuplicateMapRoadSegmentIds,
  findMissingMapRoadCityPairs,
  getAllMapRoadCityPairs,
  getMapRoadSegmentById,
  isMapRoadSegmentRoutable,
  isValidMapRoadPoint,
  MAP_ROAD_CITY_IDS,
  MAP_ROAD_SEGMENTS,
  type MapRoadPoint,
  type MapRoadSegment,
} from '../src/data/mapRoadNetwork';
import {
  getDirectRoadSegment,
  getRoadGraphAdjacency,
  getRoadRoute,
  invalidateRoadGraphCache,
  MAP_ROAD_ENDPOINT_TOLERANCE,
  orientSegmentPoints,
  resetRoadRouteResolutionLogsForTests,
  resolveRoadRoute,
} from '../src/components/map/mapRoadUtils';
import { getWorldMapCityPosition } from '../src/data/worldMapPositions';

function distanceToCity(point: { x: number; y: number }, cityId: string): number {
  const city = getWorldMapCityPosition(cityId);
  if (!city) return Infinity;
  const dx = point.x - city.x;
  const dy = point.y - city.y;
  return Math.sqrt(dx * dx + dy * dy);
}

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

function pointDistanceToCity(point: MapRoadPoint, cityId: string): number {
  return distanceToCity(point, cityId);
}

console.log('\n=== Map Road Network Test ===\n');

console.log('A. Direct priority — Ankara → Antalya');
{
  resetRoadRouteResolutionLogsForTests();
  const { route, resolution } = resolveRoadRoute('ankara', 'antalya');
  assert(resolution.resolution === 'direct', 'resolution is direct', resolution.resolution);
  assert(resolution.segmentIds.includes('ankara-antalya'), 'uses ankara-antalya segment');
  assert(route != null && route.length >= 2, 'route has points', String(route?.length));
  assert(
    resolution.segmentIds.length === 1,
    'single direct segment only',
    resolution.segmentIds.join(','),
  );
}

console.log('\nB. Reverse direct — Antalya → Ankara');
{
  const forward = getDirectRoadSegment('ankara', 'antalya');
  const reverse = getDirectRoadSegment('antalya', 'ankara');
  assert(forward != null && reverse != null, 'both directions resolve');
  if (forward && reverse) {
    assert(
      Math.abs(forward[0].x - reverse[reverse.length - 1].x) < 0.0001,
      'reverse start matches forward end',
    );
    assert(
      Math.abs(forward[forward.length - 1].x - reverse[0].x) < 0.0001,
      'reverse end matches forward start',
    );
  }
}

console.log('\nC. Ankara → Trabzon direct calibrated segment');
{
  resetRoadRouteResolutionLogsForTests();
  const segment = getMapRoadSegmentById('ankara-trabzon');
  assert(segment != null, 'segment exists');
  if (segment) {
    const check = buildMapRoadSegmentCheck(segment, isMapRoadSegmentRoutable(segment));
    assert(check.isCalibrated === true, 'isCalibrated true');
    assert(check.pointCount >= 2, 'pointCount >= 2', String(check.pointCount));
    assert(check.exclusionReason === 'included', 'exclusionReason included', check.exclusionReason);
    assert(check.includedInGraph === true, 'includedInGraph true');
  }

  const { route, resolution } = resolveRoadRoute('ankara', 'trabzon');
  assert(resolution.resolution === 'direct', 'route resolution direct', resolution.resolution);
  assert(resolution.segmentIds.includes('ankara-trabzon'), 'uses ankara-trabzon');
  assert(route != null && route.length >= 2, 'route found', String(route?.length));
}

console.log('\nD. Invalid segment exclusions');
{
  const notCalibrated: MapRoadSegment = {
    id: 'test-not-calibrated',
    fromCityId: 'ankara',
    toCityId: 'adana',
    isCalibrated: false,
    points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
  };
  assert(
    buildMapRoadSegmentCheck(notCalibrated, false).exclusionReason === 'not-calibrated',
    'not-calibrated excluded',
  );

  const emptyPoints: MapRoadSegment = {
    id: 'test-empty',
    fromCityId: 'ankara',
    toCityId: 'adana',
    points: [],
  };
  assert(
    buildMapRoadSegmentCheck(emptyPoints, false).exclusionReason === 'insufficient-points',
    'empty points excluded',
  );

  const stringCoord: MapRoadSegment = {
    id: 'test-string',
    fromCityId: 'ankara',
    toCityId: 'adana',
    points: [{ x: '0.4971' as unknown as number, y: '0.7084' as unknown as number }],
  };
  assert(!isValidMapRoadPoint(stringCoord.points[0]), 'string coordinate invalid');
  assert(
    buildMapRoadSegmentCheck(
      { ...stringCoord, points: [...stringCoord.points, { x: 0.5, y: 0.7 }] },
      false,
    ).exclusionReason === 'invalid-point',
    'invalid-point excluded',
  );
}

console.log('\nE. Cache invalidates when segment points change');
{
  resetRoadRouteResolutionLogsForTests();
  invalidateRoadGraphCache();
  const before = getRoadGraphAdjacency();
  const edgeCountBefore = [...before.values()].reduce((sum, edges) => sum + edges.length, 0);

  invalidateRoadGraphCache();
  const after = getRoadGraphAdjacency();
  const edgeCountAfter = [...after.values()].reduce((sum, edges) => sum + edges.length, 0);

  assert(edgeCountBefore === edgeCountAfter, 'graph rebuilds consistently');
  assert(edgeCountAfter > 0, 'graph has edges');
}

console.log('\nF. Reverse does not mutate original segment points');
{
  const segment = getMapRoadSegmentById('ankara-antalya');
  assert(segment != null, 'ankara-antalya segment loaded');
  if (segment) {
    const originalFirst = { ...segment.points[0] };
    const originalLast = { ...segment.points[segment.points.length - 1] };
    orientSegmentPoints(segment, 'antalya', 'ankara');
    assert(
      segment.points[0].x === originalFirst.x && segment.points[0].y === originalFirst.y,
      'original first point unchanged',
    );
    assert(
      segment.points[segment.points.length - 1].x === originalLast.x &&
        segment.points[segment.points.length - 1].y === originalLast.y,
      'original last point unchanged',
    );
  }
}

console.log('\nG. Direct coverage for former graph-only pairs');
{
  resetRoadRouteResolutionLogsForTests();
  const istanbulAntalya = resolveRoadRoute('istanbul', 'antalya');
  assert(istanbulAntalya.route != null, 'istanbul-antalya resolves');
  assert(
    istanbulAntalya.resolution.resolution === 'direct',
    'istanbul-antalya is direct',
    istanbulAntalya.resolution.resolution,
  );

  const adanaDiyarbakir = resolveRoadRoute('adana', 'diyarbakir');
  assert(adanaDiyarbakir.route != null, 'adana-diyarbakir resolves');
  assert(
    adanaDiyarbakir.resolution.resolution === 'direct',
    'adana-diyarbakir is direct',
    adanaDiyarbakir.resolution.resolution,
  );
  assert(
    adanaDiyarbakir.resolution.segmentIds.includes('adana-diyarbakir'),
    'uses adana-diyarbakir segment',
  );

  assert(getRoadRoute('ankara', 'trabzon') != null, 'ankara-trabzon no longer not-found');
}

console.log('\nH. Ankara → Trabzon endpoint orientation');
{
  resetRoadRouteResolutionLogsForTests();
  const { route, resolution } = resolveRoadRoute('ankara', 'trabzon');
  assert(route != null, 'route exists');
  if (route) {
    assert(
      distanceToCity(route[0], 'ankara') <= MAP_ROAD_ENDPOINT_TOLERANCE,
      'first point near Ankara',
      String(distanceToCity(route[0], 'ankara')),
    );
    assert(
      distanceToCity(route[route.length - 1], 'trabzon') <= MAP_ROAD_ENDPOINT_TOLERANCE,
      'last point near Trabzon',
      String(distanceToCity(route[route.length - 1], 'trabzon')),
    );
    assert(resolution.segmentIds.length === 1, 'single segment only');
    assert(resolution.segmentIds[0] === 'ankara-trabzon', 'only ankara-trabzon');
  }
}

console.log('\nI. Trabzon → Ankara reverse endpoints');
{
  resetRoadRouteResolutionLogsForTests();
  const { route, resolution } = resolveRoadRoute('trabzon', 'ankara');
  assert(route != null, 'route exists');
  assert(resolution.resolution === 'direct', 'direct resolution', resolution.resolution);
  assert(
    resolution.segmentIds.join(',') === 'ankara-trabzon',
    'only ankara-trabzon segment',
    resolution.segmentIds.join(','),
  );
  if (route) {
    assert(
      distanceToCity(route[0], 'trabzon') <= MAP_ROAD_ENDPOINT_TOLERANCE,
      'progress 0 side near Trabzon',
      String(distanceToCity(route[0], 'trabzon')),
    );
    assert(
      distanceToCity(route[route.length - 1], 'ankara') <= MAP_ROAD_ENDPOINT_TOLERANCE,
      'progress 1 side near Ankara',
      String(distanceToCity(route[route.length - 1], 'ankara')),
    );
    assert(
      Math.abs(route[route.length - 1].x - 0.5528) > 0.05,
      'route does not end at removed stray south point',
    );
  }
}

console.log('\nJ. Reverse mutation — ankara-trabzon catalog unchanged');
{
  const segment = getMapRoadSegmentById('ankara-trabzon');
  assert(segment != null, 'segment loaded');
  if (segment) {
    const originalFirst = { ...segment.points[0] };
    orientSegmentPoints(segment, 'trabzon', 'ankara');
    orientSegmentPoints(segment, 'ankara', 'trabzon');
    assert(
      segment.points[0].x === originalFirst.x && segment.points[0].y === originalFirst.y,
      'catalog first point unchanged after reverse calls',
    );
  }
}

console.log('\nK. Full 8-city segment catalog — all pairs calibrated');
{
  assert(MAP_ROAD_CITY_IDS.length === 8, '8 cities in catalog');
  assert(getAllMapRoadCityPairs().length === 28, '28 unique city pairs');
  assert(MAP_ROAD_SEGMENTS.length === 28, '28 segments total', String(MAP_ROAD_SEGMENTS.length));

  const missing = findMissingMapRoadCityPairs();
  assert(missing.length === 0, 'no missing city pairs', missing.map((m) => m.pairKey).join(', '));

  const duplicatePairs = findDuplicateMapRoadCityPairKeys();
  assert(duplicatePairs.length === 0, 'no duplicate city pairs', JSON.stringify(duplicatePairs));

  const duplicateIds = findDuplicateMapRoadSegmentIds();
  assert(duplicateIds.size === 0, 'all segment ids unique');

  const uncalibrated: string[] = [];
  const emptyPoints: string[] = [];
  const notRoutable: string[] = [];

  for (const segment of MAP_ROAD_SEGMENTS) {
    const check = buildMapRoadSegmentCheck(segment, true, duplicateIds);
    if (segment.isCalibrated === false) {
      uncalibrated.push(segment.id);
    }
    if (segment.points.length < 2) {
      emptyPoints.push(segment.id);
    }
    if (!isMapRoadSegmentRoutable(segment)) {
      notRoutable.push(`${segment.id}:${check.exclusionReason}`);
    }

    assert(segment != null, `${segment.id} exists`);
    assert(
      segment.isCalibrated !== false,
      `${segment.id} calibrated`,
      `isCalibrated=${String(segment.isCalibrated)}`,
    );
    assert(
      segment.points.length >= 2,
      `${segment.id} has points`,
      `pointCount=${segment.points.length}`,
    );
    assert(
      isMapRoadSegmentRoutable(segment),
      `${segment.id} included in graph`,
      check.exclusionReason,
    );
  }

  assert(uncalibrated.length === 0, 'no uncalibrated segments', uncalibrated.join(', '));
  assert(emptyPoints.length === 0, 'no empty-point segments', emptyPoints.join(', '));
  assert(notRoutable.length === 0, 'all segments routable', notRoutable.join(', '));

  // Spot-check historically important segments still present with stable geometry.
  const calibratedAnchors = [
    { id: 'izmir-istanbul', minPoints: 10 },
    { id: 'ankara-adana', minPoints: 10 },
    { id: 'antalya-adana', minPoints: 10 },
    { id: 'ankara-trabzon', minPoints: 10 },
    { id: 'adana-diyarbakir', minPoints: 10 },
    { id: 'istanbul-trabzon', minPoints: 10 },
    { id: 'izmir-trabzon', minPoints: 10 },
    { id: 'antalya-trabzon', minPoints: 10 },
    { id: 'istanbul-diyarbakir', minPoints: 10 },
    { id: 'diyarbakir-trabzon', minPoints: 10 },
  ] as const;
  for (const anchor of calibratedAnchors) {
    const segment = getMapRoadSegmentById(anchor.id);
    assert(segment != null, `${anchor.id} preserved`);
    if (segment) {
      assert(
        segment.points.length >= anchor.minPoints,
        `${anchor.id} has calibrated points`,
        String(segment.points.length),
      );
      assert(segment.isCalibrated !== false, `${anchor.id} isCalibrated true`);
      assert(isMapRoadSegmentRoutable(segment), `${anchor.id} routable`);
    }
  }

  // All 56 directed pairs must resolve as direct now that catalog is fully calibrated.
  let directedDirect = 0;
  let directedGraph = 0;
  let directedMissing = 0;
  for (const from of MAP_ROAD_CITY_IDS) {
    for (const to of MAP_ROAD_CITY_IDS) {
      if (from === to) continue;
      const { resolution } = resolveRoadRoute(from, to);
      if (resolution.resolution === 'direct') directedDirect += 1;
      else if (resolution.resolution === 'graph') directedGraph += 1;
      else directedMissing += 1;
    }
  }
  assert(directedDirect === 56, '56 directed direct routes', String(directedDirect));
  assert(directedGraph === 0, '0 graph fallback routes', String(directedGraph));
  assert(directedMissing === 0, '0 missing directed routes', String(directedMissing));
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
