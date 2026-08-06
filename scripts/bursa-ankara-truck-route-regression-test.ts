/**
 * Bursa → Ankara kamyon marker regression — heading, pozisyon, rota sırası.
 * Run: npx tsx scripts/bursa-ankara-truck-route-regression-test.ts
 */
import {
  getPolylineSegmentLengths,
  getRoadRoute,
  getRouteHeadingDegrees,
  getRoutePoseAtProgress,
  normalizeHeadingDegrees360,
  shortestHeadingDeltaDegrees,
} from '../src/components/map/mapRoadUtils';
import { TRUCK_ASSET_FORWARD_OFFSET_DEG } from '../src/components/map/mapTheme';
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

function distancePointToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq));
  const projX = start.x + dx * t;
  const projY = start.y + dy * t;
  return Math.hypot(point.x - projX, point.y - projY);
}

function distanceToPolyline(
  point: { x: number; y: number },
  route: { x: number; y: number }[],
): number {
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i += 1) {
    best = Math.min(best, distancePointToSegment(point, route[i], route[i + 1]));
  }
  return best;
}

const SCALE_X = 1080;
const SCALE_Y = 608;
const PROGRESS = 0.42;

console.log('\n=== Bursa → Ankara Truck Route Regression ===\n');

const bursa = getWorldMapCityPosition('bursa');
const ankara = getWorldMapCityPosition('ankara');
const route = getRoadRoute('bursa', 'ankara');

assert(bursa != null && ankara != null, 'city positions resolve');
assert(route != null && route.length >= 2, 'Bursa → Ankara route resolves');

if (route && bursa && ankara) {
  const routeDx = route[route.length - 1].x - route[0].x;
  assert(routeDx > 0, 'route point order is origin → destination (east overall)', `dx=${routeDx.toFixed(4)}`);

  const startNearBursa = Math.hypot(route[0].x - bursa.x, route[0].y - bursa.y) < 0.2;
  const endNearAnkara = Math.hypot(route[route.length - 1].x - ankara.x, route[route.length - 1].y - ankara.y) < 0.2;
  assert(startNearBursa, 'first route point near Bursa');
  assert(endNearAnkara, 'last route point near Ankara');

  const pose = getRoutePoseAtProgress(route, PROGRESS, {
    coordinateScaleX: SCALE_X,
    coordinateScaleY: SCALE_Y,
  });
  const displayHeading = getRouteHeadingDegrees({
    routePoints: route,
    progress: PROGRESS,
    assetBaseHeadingDegrees: TRUCK_ASSET_FORWARD_OFFSET_DEG,
    coordinateScaleX: SCALE_X,
    coordinateScaleY: SCALE_Y,
  });

  const toAnkaraDx = (ankara.x - pose.position.x) * SCALE_X;
  const toAnkaraDy = (ankara.y - pose.position.y) * SCALE_Y;
  const bearingToAnkara = normalizeHeadingDegrees360(
    (Math.atan2(toAnkaraDy, toAnkaraDx) * 180) / Math.PI - TRUCK_ASSET_FORWARD_OFFSET_DEG,
  );
  const bearingToBursa = normalizeHeadingDegrees360(bearingToAnkara + 180);

  assert(
    angularDistance(displayHeading, bearingToAnkara) < 75,
    'marker faces toward Ankara (not opposite)',
    `display=${displayHeading.toFixed(1)}° bearing=${bearingToAnkara.toFixed(1)}°`,
  );
  assert(
    angularDistance(displayHeading, bearingToBursa) > 90,
    'marker does not face back toward Bursa',
    `display=${displayHeading.toFixed(1)}° back=${bearingToBursa.toFixed(1)}°`,
  );
  assert(
    pose.headingDeg > -90 && pose.headingDeg < 90,
    'segment tangent faces east (toward Ankara)',
    `${pose.headingDeg.toFixed(1)}°`,
  );

  const onRouteDistance = distanceToPolyline(pose.position, route);
  assert(onRouteDistance < 0.0005, 'marker position lies on route polyline', onRouteDistance.toExponential(2));

  const segmentLengths = getPolylineSegmentLengths(route);
  const totalLength = segmentLengths.reduce((sum, len) => sum + len, 0);
  assert(totalLength > 0, 'route has positive total length');
  assert(pose.segmentIndex >= 0 && pose.segmentIndex < route.length - 1, 'valid segment index');

  for (const progress of [0, 0.5, 1] as const) {
    const sample = getRoutePoseAtProgress(route, progress, {
      coordinateScaleX: SCALE_X,
      coordinateScaleY: SCALE_Y,
    });
    assert(Number.isFinite(sample.headingDeg), `progress=${progress} heading finite`);
    assert(distanceToPolyline(sample.position, route) < 0.0005, `progress=${progress} on polyline`);
  }
}

console.log('\nAnkara → Bursa (reverse catalog route)');
{
  const route = getRoadRoute('ankara', 'bursa');
  assert(route != null && route.length >= 2, 'Ankara → Bursa route resolves');
  if (route && ankara && bursa) {
    const pose = getRoutePoseAtProgress(route, PROGRESS, {
      coordinateScaleX: SCALE_X,
      coordinateScaleY: SCALE_Y,
    });
    const displayHeading = getRouteHeadingDegrees({
      routePoints: route,
      progress: PROGRESS,
      assetBaseHeadingDegrees: TRUCK_ASSET_FORWARD_OFFSET_DEG,
      coordinateScaleX: SCALE_X,
      coordinateScaleY: SCALE_Y,
    });
    const toBursaDx = (bursa.x - pose.position.x) * SCALE_X;
    const toBursaDy = (bursa.y - pose.position.y) * SCALE_Y;
    const bearingToBursa = normalizeHeadingDegrees360(
      (Math.atan2(toBursaDy, toBursaDx) * 180) / Math.PI - TRUCK_ASSET_FORWARD_OFFSET_DEG,
    );
    assert(
      angularDistance(displayHeading, bearingToBursa) < 75,
      'Ankara → Bursa marker faces toward Bursa',
      `display=${displayHeading.toFixed(1)}° bearing=${bearingToBursa.toFixed(1)}°`,
    );
    assert(
      pose.headingDeg < -45 || pose.headingDeg > 135,
      'Ankara → Bursa tangent faces west (toward Bursa)',
      `${pose.headingDeg.toFixed(1)}°`,
    );
  }
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
