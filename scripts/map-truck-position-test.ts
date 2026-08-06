import {
  getDirectRoadSegment,
  getRoadRoute,
  getRouteHeadingAtProgress,
  getTruckPositionAlongRoadRoute,
  MAP_ROAD_ENDPOINT_TOLERANCE,
  normalizeMapDeliveryProgress,
} from '../src/components/map/mapRoadUtils';
import {
  ACTIVE_DELIVERY_ROUTE_LINE_ENABLED,
  shouldRenderActiveDeliveryMarker,
} from '../src/components/map/mapDeliveryOverlayPolicy';
import { resolveTruckMapLocation } from '../src/components/map/mapTruckLocation';
import { TRUCK_ICON_BASE_ROTATION_DEG } from '../src/components/map/mapTheme';
import { getWorldMapCityPosition } from '../src/data/worldMapPositions';
import type { Delivery, Truck } from '../src/types/game';

function distanceToCity(point: { x: number; y: number }, cityId: string): number {
  const city = getWorldMapCityPosition(cityId);
  if (!city) return Infinity;
  const dx = point.x - city.x;
  const dy = point.y - city.y;
  return Math.sqrt(dx * dx + dy * dy);
}

const cases = [
  { from: 'istanbul', to: 'bursa', progresses: [0, 0.05, 0.5, 1] },
  { from: 'bursa', to: 'istanbul', progresses: [0, 0.5, 1] },
  { from: 'ankara', to: 'antalya', progresses: [0, 0.5, 1] },
  { from: 'antalya', to: 'ankara', progresses: [0, 0.5, 1] },
  { from: 'ankara', to: 'trabzon', progresses: [0, 0.5, 1] },
  { from: 'trabzon', to: 'ankara', progresses: [0, 0.5, 1] },
];

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
  let delta = Math.abs(a - b) % 360;
  if (delta > 180) delta = 360 - delta;
  return delta;
}

console.log('\n=== Map Truck Position Test ===\n');

for (const { from, to, progresses } of cases) {
  const roadRoute = getRoadRoute(from, to);
  const direct = getDirectRoadSegment(from, to);

  if (!roadRoute || roadRoute.length < 2) {
    console.log(`✗ ${from} → ${to}: route missing`);
    fail += 1;
    continue;
  }

  const reversedOk =
    direct != null &&
    Math.abs(direct[0].x - roadRoute[0].x) < 0.0001 &&
    Math.abs(direct[0].y - roadRoute[0].y) < 0.0001 &&
    Math.abs(direct[direct.length - 1].x - roadRoute[roadRoute.length - 1].x) < 0.0001 &&
    Math.abs(direct[direct.length - 1].y - roadRoute[roadRoute.length - 1].y) < 0.0001;

  console.log(`${from} → ${to} (points=${roadRoute.length}, reverse=${reversedOk ? 'ok' : 'check'})`);

  const fromPos = getWorldMapCityPosition(from);
  const toPos = getWorldMapCityPosition(to);
  if (fromPos && toPos) {
    const startNearOrigin =
      distanceToCity(roadRoute[0], from) <= MAP_ROAD_ENDPOINT_TOLERANCE;
    const endNearDest =
      distanceToCity(roadRoute[roadRoute.length - 1], to) <= MAP_ROAD_ENDPOINT_TOLERANCE;
    if (startNearOrigin && endNearDest) {
      pass += 1;
      console.log(`  ✓ endpoints near ${from} / ${to}`);
    } else {
      fail += 1;
      console.log(
        `  ✗ endpoint mismatch start=${distanceToCity(roadRoute[0], from).toFixed(4)} end=${distanceToCity(roadRoute[roadRoute.length - 1], to).toFixed(4)}`,
      );
    }
  }

  for (const progress of progresses) {
    const normalized = normalizeMapDeliveryProgress(progress);
    const sample = getTruckPositionAlongRoadRoute(roadRoute, progress);
    const atStart =
      normalized <= 0 &&
      Math.abs(sample.point.x - roadRoute[0].x) < 0.0001 &&
      Math.abs(sample.point.y - roadRoute[0].y) < 0.0001;
    const atEnd =
      normalized >= 1 &&
      Math.abs(sample.point.x - roadRoute[roadRoute.length - 1].x) < 0.0001 &&
      Math.abs(sample.point.y - roadRoute[roadRoute.length - 1].y) < 0.0001;
    const onRoute =
      normalized > 0 &&
      normalized < 1 &&
      !(Math.abs(sample.point.x - roadRoute[0].x) < 0.00001 &&
        Math.abs(sample.point.y - roadRoute[0].y) < 0.00001);

    const ok = atStart || atEnd || onRoute;
    if (ok) {
      pass += 1;
      console.log(
        `  ✓ progress=${progress} normalized=${normalized} point=(${sample.point.x.toFixed(4)}, ${sample.point.y.toFixed(4)})`,
      );
    } else {
      fail += 1;
      console.log(
        `  ✗ progress=${progress} normalized=${normalized} point=(${sample.point.x.toFixed(4)}, ${sample.point.y.toFixed(4)})`,
      );
    }
  }

  const pctSample = getTruckPositionAlongRoadRoute(roadRoute, 50);
  const pctOk = Math.abs(pctSample.point.x - getTruckPositionAlongRoadRoute(roadRoute, 0.5).point.x) < 0.0001;
  if (pctOk) {
    pass += 1;
    console.log('  ✓ progress=50 (% format) matches 0.5');
  } else {
    fail += 1;
    console.log('  ✗ progress=50 (% format) mismatch');
  }

  console.log('');
}

console.log('Active delivery overlay policy');
assert(ACTIVE_DELIVERY_ROUTE_LINE_ENABLED, 'active route line remains enabled');
assert(
  !shouldRenderActiveDeliveryMarker('origin-endpoint'),
  'accepted delivery origin endpoint marker is not rendered',
);
assert(
  !shouldRenderActiveDeliveryMarker('destination-endpoint'),
  'accepted delivery destination endpoint marker is not rendered',
);
const renderedDeliveryMarkers = (
  ['moving-truck', 'origin-endpoint', 'destination-endpoint'] as const
).filter(shouldRenderActiveDeliveryMarker);
assert(
  renderedDeliveryMarkers.length === 1 && renderedDeliveryMarkers[0] === 'moving-truck',
  'only one moving truck marker is enabled per active delivery',
);
assert(
  TRUCK_ICON_BASE_ROTATION_DEG === 180,
  'truck asset uses canonical 180° heading offset (faces left at 0°)',
);

console.log('\nSynthetic route headings');
const eastRoute = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
const westRoute = [...eastRoute].reverse();
const southRoute = [{ x: 0, y: 0 }, { x: 0, y: 1 }];
const northRoute = [...southRoute].reverse();
const curvedRoute = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];

const eastHeading = getRouteHeadingAtProgress({ points: eastRoute, progress: 0.5 });
const westHeading = getRouteHeadingAtProgress({ points: westRoute, progress: 0.5 });
const southHeading = getRouteHeadingAtProgress({ points: southRoute, progress: 0.5 });
const northHeading = getRouteHeadingAtProgress({ points: northRoute, progress: 0.5 });
const curveHeading = getRouteHeadingAtProgress({
  points: curvedRoute,
  progress: 0.5,
  lookAheadDistance: 0.1,
});

assert(angularDistance(eastHeading, 0) < 0.001, 'eastbound heading is 0°');
assert(angularDistance(westHeading, 180) < 0.001, 'westbound heading is 180°');
assert(
  angularDistance(eastHeading, westHeading) > 179.9,
  'westbound heading reverses eastbound by approximately 180°',
);
assert(angularDistance(southHeading, 90) < 0.001, 'southbound screen heading is 90°');
assert(angularDistance(northHeading, -90) < 0.001, 'northbound screen heading is -90°');
assert(angularDistance(curveHeading, 45) < 0.001, 'curved node heading follows smoothed tangent');

const beforeCurveHeading = getRouteHeadingAtProgress({
  points: curvedRoute,
  progress: 0.499,
  lookAheadDistance: 0.1,
});
const afterCurveHeading = getRouteHeadingAtProgress({
  points: curvedRoute,
  progress: 0.501,
  lookAheadDistance: 0.1,
});
assert(
  angularDistance(beforeCurveHeading, afterCurveHeading) < 5,
  'small progress changes do not cause a 180° heading jump',
);

const duplicateRoute = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0 },
];
const duplicateSample = getTruckPositionAlongRoadRoute(duplicateRoute, 0.5);
assert(
  Number.isFinite(duplicateSample.headingDeg) &&
    Number.isFinite(duplicateSample.point.x) &&
    Number.isFinite(duplicateSample.point.y),
  'duplicate route points do not produce NaN/Infinity',
);
assert(
  getRouteHeadingAtProgress({
    points: [{ x: 1, y: 1 }, { x: 1, y: 1 }],
    progress: 0.5,
    fallbackHeadingDeg: 73,
  }) === 73,
  'invalid tangent preserves the last valid fallback heading',
);

const minimumSample = getTruckPositionAlongRoadRoute(eastRoute, -Infinity);
const maximumSample = getTruckPositionAlongRoadRoute(eastRoute, Infinity);
assert(
  minimumSample.point.x === 0 && Number.isFinite(minimumSample.headingDeg),
  'minimum progress clamps safely',
);
assert(
  maximumSample.point.x === 1 && Number.isFinite(maximumSample.headingDeg),
  'maximum progress clamps safely',
);

console.log('\nDirected catalog routes');
for (const [from, to] of [
  ['izmir', 'ankara'],
  ['ankara', 'izmir'],
  ['istanbul', 'antalya'],
  ['antalya', 'istanbul'],
] as const) {
  const route = getRoadRoute(from, to);
  assert(route != null && route.length >= 2, `${from} → ${to} resolves`);
  if (!route) continue;
  const sample = getTruckPositionAlongRoadRoute(route, 0.5);
  assert(Number.isFinite(sample.headingDeg), `${from} → ${to} heading is finite`);
}

for (const [from, to] of [
  ['izmir', 'ankara'],
  ['istanbul', 'antalya'],
] as const) {
  const forward = getRoadRoute(from, to);
  const reverse = getRoadRoute(to, from);
  if (!forward || !reverse) continue;
  const forwardHeading = getTruckPositionAlongRoadRoute(forward, 0.37).headingDeg;
  const reverseHeading = getTruckPositionAlongRoadRoute(reverse, 0.63).headingDeg;
  assert(
    angularDistance(forwardHeading, reverseHeading) > 170,
    `${from} ↔ ${to} reverse route heading differs by approximately 180°`,
    `${forwardHeading.toFixed(1)}° / ${reverseHeading.toFixed(1)}°`,
  );
}

const catalogRoute = getRoadRoute('izmir', 'ankara');
if (catalogRoute) {
  const catalogSnapshot = JSON.stringify(catalogRoute);
  getTruckPositionAlongRoadRoute(catalogRoute, 0.25);
  getRoadRoute('ankara', 'izmir');
  assert(JSON.stringify(catalogRoute) === catalogSnapshot, 'route catalog geometry is not mutated');
}

console.log('\nPaused delivery heading');
const pausedTruck = {
  id: 'paused-truck',
  name: 'Paused Truck',
  capacity: 10,
  fuelConsumptionPerKm: 0.3,
  speed: 80,
  reliability: 100,
  maintenanceCost: 0.1,
  comfort: 80,
  condition: 100,
  purchasePrice: 100_000,
  currentCityId: 'izmir',
  status: 'out_of_fuel',
} satisfies Truck;
const pausedDelivery = {
  id: 'paused-delivery',
  contractId: 'contract',
  truckId: pausedTruck.id,
  driverId: 'driver',
  originCityId: 'izmir',
  destinationCityId: 'ankara',
  productId: 'electronics',
  amount: 1,
  distanceKm: 500,
  progress: 0.42,
  status: 'paused',
  pausedReason: 'out-of-fuel',
  startedAt: 0,
  estimatedArrivalTime: 10,
  deadlineTime: 20,
  fuelCost: 0,
  maintenanceCost: 0,
  estimatedProfit: 0,
  travelHours: 10,
  breakdownChance: 0,
  accidentChance: 0,
  conditionLoss: 0,
} as Delivery;
const pausedLocationA = resolveTruckMapLocation({
  truck: pausedTruck,
  activeDelivery: pausedDelivery,
});
const pausedLocationB = resolveTruckMapLocation({
  truck: pausedTruck,
  activeDelivery: { ...pausedDelivery },
});
assert(
  pausedLocationA.kind === 'route' &&
    pausedLocationB.kind === 'route' &&
    pausedLocationA.normalizedPoint?.x === pausedLocationB.normalizedPoint?.x &&
    pausedLocationA.normalizedPoint?.y === pausedLocationB.normalizedPoint?.y,
  'paused/out-of-fuel truck position remains fixed',
);
assert(
  pausedLocationA.angleRadians === pausedLocationB.angleRadians,
  'paused/out-of-fuel truck preserves its route heading',
);

console.log(`PASS: ${pass}`);
console.log(`FAIL: ${fail}`);

if (fail > 0) {
  process.exit(1);
}

console.log('✅ ALL PASS\n');
