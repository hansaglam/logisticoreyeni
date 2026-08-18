/**
 * iOS map heading + stale marker regression tests (headless).
 * Run: npx tsx scripts/ios-map-heading-marker-regression-test.ts
 */
import {
  getRoadRoute,
  getRouteHeadingAtProgress,
  getRouteHeadingDegrees,
  normalizeHeadingDegrees360,
  shortestHeadingDeltaDegrees,
} from '../src/components/map/mapRoadUtils';
import {
  buildDeliveryTruckMarkerKey,
  buildMapOverlayRenderVersion,
  buildRoutePathMarkerKey,
  buildVisibleMapMarkers,
  computeDeliveryRouteVersion,
} from '../src/components/map/mapMarkerState';
import { VEHICLE_MARKER_ZERO_HEADING_DEG } from '../src/components/map/mapTheme';
import type { Delivery, TruckTransfer } from '../src/types/game';

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

function headingAt(
  from: string,
  to: string,
  progress: number,
  coordinateScaleX = 1080,
  coordinateScaleY = 608,
): number {
  const route = getRoadRoute(from, to);
  if (!route) return NaN;
  return getRouteHeadingDegrees({
    routePoints: route,
    progress,
    assetBaseHeadingDegrees: VEHICLE_MARKER_ZERO_HEADING_DEG,
    coordinateScaleX,
    coordinateScaleY,
  });
}

function makeDelivery(params: Partial<Delivery> & Pick<Delivery, 'id' | 'originCityId' | 'destinationCityId'>): Delivery {
  return {
    contractId: params.contractId ?? `contract-${params.id}`,
    truckId: params.truckId ?? 'truck-1',
    driverId: params.driverId ?? 'driver-1',
    status: params.status ?? 'on_route',
    progress: params.progress ?? 0.4,
    startedAt: params.startedAt ?? 0,
    estimatedArrivalAt: params.estimatedArrivalAt ?? 0,
    cargoProductId: params.cargoProductId ?? 'product-1',
    cargoAmount: params.cargoAmount ?? 1,
    originCityId: params.originCityId,
    destinationCityId: params.destinationCityId,
    ...params,
  } as Delivery;
}

function makeTransfer(params: Partial<TruckTransfer> & Pick<TruckTransfer, 'id' | 'fromCityId' | 'toCityId'>): TruckTransfer {
  return {
    truckId: params.truckId ?? 'truck-2',
    status: params.status ?? 'active',
    progress: params.progress ?? 0.2,
    startedAt: params.startedAt ?? 0,
    fromCityId: params.fromCityId,
    toCityId: params.toCityId,
    ...params,
  } as TruckTransfer;
}

console.log('\n=== iOS Map Heading + Marker Regression ===\n');

console.log('Heading — catalog routes');
for (const [from, to, label] of [
  ['izmir', 'bursa', 'İzmir → Bursa'],
  ['bursa', 'antalya', 'Bursa → Antalya'],
  ['antalya', 'bursa', 'Antalya → Bursa'],
  ['bursa', 'izmir', 'Bursa → İzmir'],
] as const) {
  const route = getRoadRoute(from, to);
  assert(route != null && route.length >= 2, `${label} resolves`);
  if (!route) continue;
  const h = headingAt(from, to, 0.5);
  assert(Number.isFinite(h), `${label} heading finite`, String(h));
  assert(h >= 0 && h < 360, `${label} heading normalized [0,360)`, String(h));
}

console.log('\nHeading — reverse routes differ ~180°');
{
  const forwardRoute = getRoadRoute('bursa', 'ankara');
  const reverseRoute = getRoadRoute('ankara', 'bursa');
  assert(forwardRoute != null && reverseRoute != null, 'Bursa ↔ Ankara routes resolve');
  if (!forwardRoute || !reverseRoute) {
    // continue
  } else {
    const forward = getRouteHeadingAtProgress({
      points: forwardRoute,
      progress: 0.5,
      coordinateScaleX: 1080,
      coordinateScaleY: 720,
    });
    const reverse = getRouteHeadingAtProgress({
      points: reverseRoute,
      progress: 0.5,
      coordinateScaleX: 1080,
      coordinateScaleY: 720,
    });
    assert(
      angularDistance(forward, reverse) > 150,
      'Bursa ↔ Ankara reverse tangents differ substantially',
      `${forward.toFixed(1)}° / ${reverse.toFixed(1)}°`,
    );
  }
}

console.log('\nHeading — cardinal synthetic segments');
{
  const east = getRouteHeadingDegrees({
    routePoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    progress: 0.5,
    assetBaseHeadingDegrees: VEHICLE_MARKER_ZERO_HEADING_DEG,
  });
  const west = getRouteHeadingDegrees({
    routePoints: [{ x: 1, y: 0 }, { x: 0, y: 0 }],
    progress: 0.5,
    assetBaseHeadingDegrees: VEHICLE_MARKER_ZERO_HEADING_DEG,
  });
  const south = getRouteHeadingDegrees({
    routePoints: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    progress: 0.5,
    assetBaseHeadingDegrees: VEHICLE_MARKER_ZERO_HEADING_DEG,
  });
  const north = getRouteHeadingDegrees({
    routePoints: [{ x: 0, y: 1 }, { x: 0, y: 0 }],
    progress: 0.5,
    assetBaseHeadingDegrees: VEHICLE_MARKER_ZERO_HEADING_DEG,
  });
  assert(angularDistance(east, 0) < 0.01, 'horizontal east chevron rotation ≈ 0°');
  assert(angularDistance(west, 180) < 0.01, 'horizontal west chevron rotation ≈ 180°');
  assert(angularDistance(south, 90) < 0.01, 'vertical south chevron rotation ≈ 90°');
  assert(angularDistance(north, 270) < 0.01, 'vertical north chevron rotation ≈ 270°');
}

console.log('\nHeading — duplicate points + fallback');
{
  const dup = getRouteHeadingDegrees({
    routePoints: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    progress: 0.5,
    assetBaseHeadingDegrees: VEHICLE_MARKER_ZERO_HEADING_DEG,
    fallbackHeadingDeg: 33,
  });
  assert(angularDistance(dup, 0) < 0.01, 'duplicate collinear points use next segment (east chevron)');
  const zero = getRouteHeadingDegrees({
    routePoints: [{ x: 2, y: 2 }, { x: 2, y: 2 }],
    progress: 0.5,
    assetBaseHeadingDegrees: VEHICLE_MARKER_ZERO_HEADING_DEG,
    fallbackHeadingDeg: 44,
  });
  assert(
    angularDistance(zero, normalizeHeadingDegrees360(44 - VEHICLE_MARKER_ZERO_HEADING_DEG)) < 0.01,
    'zero-length tangent keeps fallback heading',
    String(zero),
  );
}

console.log('\nHeading — normalize + no platform hack');
{
  assert(normalizeHeadingDegrees360(-90) === 270, 'normalizeHeadingDegrees360(-90) = 270');
  assert(normalizeHeadingDegrees360(720) === 0, 'normalizeHeadingDegrees360(720) = 0');
  assert(VEHICLE_MARKER_ZERO_HEADING_DEG === 0, 'chevron zero heading is east (+X)');
}

console.log('\nMarker identity — route version changes on topology');
{
  const d1 = makeDelivery({
    id: 'd1',
    originCityId: 'izmir',
    destinationCityId: 'bursa',
    contractId: 'c1',
  });
  const d1b = makeDelivery({
    id: 'd1',
    originCityId: 'bursa',
    destinationCityId: 'antalya',
    contractId: 'c2',
  });
  const v1 = computeDeliveryRouteVersion(d1);
  const v2 = computeDeliveryRouteVersion(d1b);
  assert(v1 !== v2, 'same delivery id new cities → new routeVersion');
  assert(
    buildRoutePathMarkerKey('d1', v1, 'remaining') !==
      buildRoutePathMarkerKey('d1', v2, 'remaining'),
    'route path keys differ when topology changes',
  );
  assert(
    buildDeliveryTruckMarkerKey('d1', v1) !== buildDeliveryTruckMarkerKey('d1', v2),
    'truck marker keys differ when topology changes',
  );
}

console.log('\nMarker cleanup — derived visible markers');
{
  const routeA = makeDelivery({
    id: 'del-a',
    originCityId: 'izmir',
    destinationCityId: 'bursa',
    status: 'on_route',
    progress: 0.3,
  });
  const routeB = makeDelivery({
    id: 'del-b',
    originCityId: 'bursa',
    destinationCityId: 'antalya',
    status: 'on_route',
    progress: 0.1,
  });
  const completed = makeDelivery({
    id: 'del-old',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    status: 'completed',
    progress: 1,
  });
  const cancelled = makeDelivery({
    id: 'del-cancel',
    originCityId: 'ankara',
    destinationCityId: 'trabzon',
    status: 'cancelled',
    progress: 0,
  });

  const phase1 = buildVisibleMapMarkers({
    activeDeliveries: [routeA, completed, cancelled],
    activeTransfers: [],
  });
  assert(phase1.deliveries.length === 1, 'only active delivery in phase 1');
  assert(phase1.deliveries[0]?.delivery.id === 'del-a', 'phase 1 is route A');

  const phase2 = buildVisibleMapMarkers({
    activeDeliveries: [routeB, completed, cancelled],
    activeTransfers: [],
  });
  assert(phase2.deliveries.length === 1, 'only active delivery in phase 2');
  assert(phase2.deliveries[0]?.delivery.id === 'del-b', 'phase 2 is route B');
  assert(
    phase1.overlayRenderVersion !== phase2.overlayRenderVersion,
    'overlay render version changes when active route changes',
  );

  const keys1 = phase1.deliveries.map((item) =>
    buildRoutePathMarkerKey(item.delivery.id, item.routeVersion, 'completed'),
  );
  const keys2 = phase2.deliveries.map((item) =>
    buildRoutePathMarkerKey(item.delivery.id, item.routeVersion, 'completed'),
  );
  assert(keys1[0] !== keys2[0], 'route A marker key not reused for route B');
}

console.log('\nMarker cleanup — offline completion hydrate simulation');
{
  const staleCompleted = makeDelivery({
    id: 'del-offline',
    originCityId: 'izmir',
    destinationCityId: 'bursa',
    status: 'completed',
    progress: 1,
  });
  const newJob = makeDelivery({
    id: 'del-new',
    originCityId: 'bursa',
    destinationCityId: 'izmir',
    status: 'on_route',
    progress: 0.05,
  });
  const visible = buildVisibleMapMarkers({
    activeDeliveries: [staleCompleted, newJob],
    activeTransfers: [],
  });
  assert(visible.deliveries.length === 1, 'completed delivery filtered after hydrate');
  assert(visible.deliveries[0]?.delivery.id === 'del-new', 'only new active delivery remains');
  assert(
    !buildMapOverlayRenderVersion({
      deliveries: [staleCompleted],
      transfers: [],
    }).includes('del-offline'),
    'overlay version excludes completed delivery id',
  );
}

console.log('\nMarker cleanup — duplicate id guard + transfer');
{
  const dup1 = makeDelivery({
    id: 'dup',
    originCityId: 'izmir',
    destinationCityId: 'bursa',
  });
  const dup2 = makeDelivery({
    id: 'dup',
    originCityId: 'izmir',
    destinationCityId: 'bursa',
  });
  const visible = buildVisibleMapMarkers({
    activeDeliveries: [dup1, dup2],
    activeTransfers: [],
  });
  assert(visible.deliveries.length === 1, 'duplicate delivery ids deduped to 1');

  const transfer = makeTransfer({
    id: 'tx-1',
    fromCityId: 'ankara',
    toCityId: 'trabzon',
  });
  const withTransfer = buildVisibleMapMarkers({
    activeDeliveries: [],
    activeTransfers: [transfer],
  });
  assert(withTransfer.transfers.length === 1, 'active transfer included');
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
