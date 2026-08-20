/**
 * Map truck heading regression tests.
 * Run: npx tsx scripts/map-truck-heading-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  getRoadRoute,
  getRouteHeadingAtProgress,
  getRouteHeadingDegrees,
  getTruckPositionAlongRoadRoute,
  normalizeHeadingDegrees360,
  shortestHeadingDeltaDegrees,
} from '../src/components/map/mapRoadUtils';
import { TRUCK_ASSET_FORWARD_OFFSET_DEG, VEHICLE_MARKER_ZERO_HEADING_DEG } from '../src/components/map/mapTheme';
import { getMapVehicleHeading, routeHeadingToMarkerRotationDeg } from '../src/components/map/mapVehicleHeading';
import { getWorldMapCityPosition } from '../src/data/worldMapPositions';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function angularDistance(a: number, b: number): number {
  return Math.abs(shortestHeadingDeltaDegrees(a, b));
}

function displayHeading(tangentDeg: number): number {
  return routeHeadingToMarkerRotationDeg(tangentDeg);
}

function geoBearing(from: string, to: string): number {
  const a = getWorldMapCityPosition(from);
  const b = getWorldMapCityPosition(to);
  if (!a || !b) return NaN;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

console.log('\n=== Map Truck Heading Regression ===\n');

console.log('Asset base orientation');
{
  assert(VEHICLE_MARKER_ZERO_HEADING_DEG === 0, 'chevron zero heading is east (+X)');
  assert(TRUCK_ASSET_FORWARD_OFFSET_DEG === VEHICLE_MARKER_ZERO_HEADING_DEG, 'legacy alias matches chevron zero');
  const marker = readFileSync('src/components/map/AnimatedDeliveryTruckMarker.tsx', 'utf8');
  const roadUtils = readFileSync('src/components/map/mapRoadUtils.ts', 'utf8');
  const heading = readFileSync('src/components/map/mapVehicleHeading.ts', 'utf8');
  assert(!marker.includes('GameIcon'), 'live map marker uses chevron, not truck pictogram');
  assert(marker.includes('VehicleDirectionChevron'), 'direction chevron component exists');
  assert(marker.includes('Polygon'), 'chevron is an SVG polygon, not a CSS triangle');
  assert(!marker.includes("name=\"truck\""), 'live map marker does not use truck icon');
  assert(marker.includes('chevronRotationStyle'), 'only chevron rotates, not the circle');
  assert(!marker.includes('scaleX: -1'), 'no scaleX mirror in marker');
  assert(!marker.includes("Platform.OS === 'ios'"), 'no iOS-specific heading hack in marker');
  assert(!marker.includes("Platform.OS === 'android'"), 'no Android-specific heading hack in marker');
  assert(roadUtils.includes('computePixelSpaceHeadingDeg'), 'heading uses pixel-space atan2');
  assert(heading.includes('getMapVehicleHeading'), 'canonical map vehicle heading helper exists');
  assert(roadUtils.includes('ROUTE_HEADING_LOOK_AHEAD_PX'), 'pixel-space look-ahead enabled');
}

console.log('\nCardinal synthetic headings');
{
  const east = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const west = [{ x: 1, y: 0 }, { x: 0, y: 0 }];
  const south = [{ x: 0, y: 0 }, { x: 0, y: 1 }];
  const north = [{ x: 0, y: 1 }, { x: 0, y: 0 }];

  const eastTangent = getRouteHeadingAtProgress({ points: east, progress: 0.5 });
  const westTangent = getRouteHeadingAtProgress({ points: west, progress: 0.5 });
  const southTangent = getRouteHeadingAtProgress({ points: south, progress: 0.5 });
  const northTangent = getRouteHeadingAtProgress({ points: north, progress: 0.5 });

  assert(angularDistance(eastTangent, 0) < 0.01, 'east tangent ≈ 0°');
  assert(angularDistance(westTangent, 180) < 0.01, 'west tangent ≈ 180°');
  assert(angularDistance(southTangent, 90) < 0.01, 'south tangent ≈ 90°');
  assert(angularDistance(northTangent, -90) < 0.01, 'north tangent ≈ -90°');

  const eastDisplay = getRouteHeadingDegrees({
    routePoints: east,
    progress: 0.5,
    assetBaseHeadingDegrees: VEHICLE_MARKER_ZERO_HEADING_DEG,
  });
  assert(angularDistance(eastDisplay, 0) < 0.01, 'east chevron rotation ≈ 0°');
  assert(angularDistance(displayHeading(westTangent), 180) < 0.01, 'west chevron rotation ≈ 180°');
  assert(angularDistance(displayHeading(southTangent), 90) < 0.01, 'south chevron rotation ≈ 90°');
  assert(angularDistance(displayHeading(northTangent), 270) < 0.01, 'north chevron rotation ≈ 270°');
}

console.log('\nCatalog routes');
for (const [from, to] of [
  ['ankara', 'antalya', 'Ankara → Antalya'],
  ['antalya', 'ankara', 'Antalya → Ankara'],
  ['izmir', 'ankara', 'İzmir → Ankara'],
  ['ankara', 'izmir', 'Ankara → İzmir'],
  ['ankara', 'bursa', 'Ankara → Bursa'],
  ['bursa', 'ankara', 'Bursa → Ankara'],
  ['izmir', 'bursa', 'İzmir → Bursa'],
  ['bursa', 'izmir', 'Bursa → İzmir'],
  ['antalya', 'bursa', 'Antalya → Bursa'],
  ['bursa', 'antalya', 'Bursa → Antalya'],
] as const) {
  const route = getRoadRoute(from, to);
  assert(route != null && route.length >= 2, `${from} → ${to} resolves`);
  if (!route) continue;

  const startNear = Math.hypot(
    route[0].x - (getWorldMapCityPosition(from)?.x ?? 0),
    route[0].y - (getWorldMapCityPosition(from)?.y ?? 0),
  );
  const endNear = Math.hypot(
    route[route.length - 1].x - (getWorldMapCityPosition(to)?.x ?? 0),
    route[route.length - 1].y - (getWorldMapCityPosition(to)?.y ?? 0),
  );
  assert(startNear < 0.2, `${from} → ${to} starts near origin`, startNear.toFixed(3));
  assert(endNear < 0.2, `${from} → ${to} ends near destination`, endNear.toFixed(3));

  for (const progress of [0.1, 0.5, 0.9] as const) {
    const tangent = getRouteHeadingAtProgress({
      points: route,
      progress,
      coordinateScaleX: 1080,
      coordinateScaleY: 720,
    });
    const finalHeading = getRouteHeadingDegrees({
      routePoints: route,
      progress,
      assetBaseHeadingDegrees: VEHICLE_MARKER_ZERO_HEADING_DEG,
      coordinateScaleX: 1080,
      coordinateScaleY: 720,
    });
    assert(Number.isFinite(tangent), `${from} → ${to} p=${progress} tangent finite`);
    assert(Number.isFinite(finalHeading), `${from} → ${to} p=${progress} final finite`);
    assert(finalHeading >= 0 && finalHeading < 360, `${from} → ${to} p=${progress} normalized [0,360)`);
    assert(
      angularDistance(finalHeading, displayHeading(tangent)) < 0.01,
      `${from} → ${to} p=${progress} chevron = route tangent`,
    );
  }

  const forward = getMapVehicleHeading({
    routePoints: route,
    progress: 0.5,
    mapBounds: { width: 1080, height: 720 },
  });
  const reverseRoute = getRoadRoute(to, from);
  if (reverseRoute) {
    const reverse = getMapVehicleHeading({
      routePoints: reverseRoute,
      progress: 0.5,
      mapBounds: { width: 1080, height: 720 },
    });
    assert(
      angularDistance(forward.routeHeadingDeg, reverse.routeHeadingDeg) > 90,
      `${from} ↔ ${to} reverse tangents oppose`,
    );
  }
}

console.log('\nReverse routes differ ~180° tangent');
{
  const forward = getRouteHeadingAtProgress({
    points: getRoadRoute('izmir', 'bursa')!,
    progress: 0.5,
    coordinateScaleX: 1080,
    coordinateScaleY: 720,
  });
  const reverse = getRouteHeadingAtProgress({
    points: getRoadRoute('bursa', 'izmir')!,
    progress: 0.5,
    coordinateScaleX: 1080,
    coordinateScaleY: 720,
  });
  assert(angularDistance(forward, reverse) > 150, 'İzmir ↔ Bursa tangents oppose');
}

console.log('\nDuplicate points + route end');
{
  const dup = getRouteHeadingAtProgress({
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    progress: 0.5,
    fallbackHeadingDeg: 12,
  });
  assert(angularDistance(dup, 0) < 0.01, 'duplicate points skip to next segment');

  const endTangent = getRouteHeadingAtProgress({
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    progress: 1,
  });
  assert(angularDistance(endTangent, 0) < 0.01, 'route end keeps last segment heading');
}

console.log('\nShared marker transform structure');
{
  const marker = readFileSync('src/components/map/AnimatedDeliveryTruckMarker.tsx', 'utf8');
  assert(marker.includes('chevronLayer'), 'chevron rotation layer exists');
  assert(marker.includes('scaleLayer'), 'inverse zoom scale isolated');
  assert(marker.includes('chevronRotationStyle'), 'rotation only on chevron layer');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
