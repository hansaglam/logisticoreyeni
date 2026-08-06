/**
 * Canonical truck route heading + asset base rotation tests.
 */
import {
  getRoadRoute,
  getRouteHeadingAtProgress,
  getTruckPositionAlongRoadRoute,
  normalizeHeadingDegrees,
  normalizeHeadingDegrees360,
  shortestHeadingDeltaDegrees,
} from '../src/components/map/mapRoadUtils';
import {
  TRUCK_ASSET_FORWARD_OFFSET_DEG,
  TRUCK_ASSET_HEADING_OFFSET_DEG,
  TRUCK_ICON_BASE_ROTATION_DEG,
} from '../src/components/map/mapTheme';

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

function displayRotation(headingDeg: number): number {
  return normalizeHeadingDegrees(headingDeg + TRUCK_ASSET_FORWARD_OFFSET_DEG);
}

console.log('\n=== Truck Route Heading Test ===\n');

console.log('Asset base rotation');
assert(
  TRUCK_ASSET_FORWARD_OFFSET_DEG === 0,
  'truck-outline 0° faces right → TRUCK_ASSET_FORWARD_OFFSET_DEG is 0°',
);
assert(
  TRUCK_ICON_BASE_ROTATION_DEG === TRUCK_ASSET_FORWARD_OFFSET_DEG,
  'legacy alias matches canonical forward offset',
);
assert(
  TRUCK_ASSET_HEADING_OFFSET_DEG === TRUCK_ASSET_FORWARD_OFFSET_DEG,
  'legacy heading alias matches canonical forward offset',
);

console.log('\nCardinal synthetic headings');
const east = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
const west = [{ x: 1, y: 0 }, { x: 0, y: 0 }];
const south = [{ x: 0, y: 0 }, { x: 0, y: 1 }];
const north = [{ x: 0, y: 1 }, { x: 0, y: 0 }];

const eastH = getRouteHeadingAtProgress({ points: east, progress: 0.5 });
const westH = getRouteHeadingAtProgress({ points: west, progress: 0.5 });
const southH = getRouteHeadingAtProgress({ points: south, progress: 0.5 });
const northH = getRouteHeadingAtProgress({ points: north, progress: 0.5 });

assert(angularDistance(eastH, 0) < 0.001, 'east = 0°');
assert(angularDistance(westH, 180) < 0.001, 'west = 180°');
assert(angularDistance(eastH, westH) > 179.9, 'west = east + ~180°');
assert(angularDistance(southH, 90) < 0.001, 'south = 90° (Y-down screen)');
assert(angularDistance(northH, -90) < 0.001, 'north = -90° (Y-down screen)');
assert(angularDistance(displayRotation(eastH), 0) < 0.001, 'east display rotation ≈ 0°');
assert(angularDistance(displayRotation(westH), 180) < 0.001, 'west display rotation ≈ 180°');

console.log('\nEndpoint / duplicate safety');
assert(
  angularDistance(getRouteHeadingAtProgress({ points: east, progress: 0 }), 0) < 0.001,
  'progress 0 uses first two distinct points',
);
assert(
  angularDistance(getRouteHeadingAtProgress({ points: east, progress: 1 }), 0) < 0.001,
  'progress 1 uses last two distinct points',
);
const dup = getRouteHeadingAtProgress({
  points: [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 0 },
  ],
  progress: 0.5,
  fallbackHeadingDeg: 12,
});
assert(Number.isFinite(dup) && angularDistance(dup, 0) < 0.001, 'duplicate points skipped safely');
assert(
  getRouteHeadingAtProgress({
    points: [{ x: 2, y: 2 }, { x: 2, y: 2 }],
    progress: 0.5,
    fallbackHeadingDeg: 44,
  }) === 44,
  'zero-length tangent keeps previousHeading/fallback',
);

console.log('\nNormalize + shortest-angle');
assert(normalizeHeadingDegrees(270) === -90, 'normalizeHeadingDegrees maps 270 → -90');
assert(normalizeHeadingDegrees360(-90) === 270, 'normalizeHeadingDegrees360 maps -90 → 270');
assert(normalizeHeadingDegrees360(360) === 0, 'normalizeHeadingDegrees360 maps 360 → 0');
assert(shortestHeadingDeltaDegrees(10, 350) === -20, 'shortest-angle prefers -20 over +340');
assert(shortestHeadingDeltaDegrees(350, 10) === 20, 'shortest-angle prefers +20 over -340');
assert(Math.abs(shortestHeadingDeltaDegrees(0, 180)) === 180, 'shortest-angle 180° is exact');

console.log('\nCurved route — active segment tangent');
const curve = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
const curveMid = getRouteHeadingAtProgress({
  points: curve,
  progress: 0.5,
});
assert(angularDistance(curveMid, 0) < 0.001, 'L-route corner at vertex keeps first segment (east ≈ 0°)');
const curveLate = getRouteHeadingAtProgress({ points: curve, progress: 0.75 });
assert(angularDistance(curveLate, 90) < 0.001, 'L-route second leg faces south ≈ 90°');
const curveEarly = getRouteHeadingAtProgress({ points: curve, progress: 0.25 });
assert(angularDistance(curveEarly, 0) < 0.001, 'L-route first leg faces east ≈ 0°');

console.log('\nCatalog routes: Bursa ↔ Ankara');
const bursaAnkara = getRoadRoute('bursa', 'ankara');
const ankaraBursa = getRoadRoute('ankara', 'bursa');
assert(bursaAnkara != null && bursaAnkara.length >= 2, 'Bursa → Ankara resolves');
assert(ankaraBursa != null && ankaraBursa.length >= 2, 'Ankara → Bursa resolves');

if (bursaAnkara && ankaraBursa) {
  const forward = getTruckPositionAlongRoadRoute(bursaAnkara, 0.5, {
    coordinateScaleX: 1080,
    coordinateScaleY: 720,
  });
  const reverse = getTruckPositionAlongRoadRoute(ankaraBursa, 0.5, {
    coordinateScaleX: 1080,
    coordinateScaleY: 720,
  });
  const dx = bursaAnkara[bursaAnkara.length - 1].x - bursaAnkara[0].x;
  assert(dx > 0, 'Bursa → Ankara routePoints advance east overall', `dx=${dx.toFixed(4)}`);
  assert(
    Math.abs(forward.headingDeg) < 90,
    'Bursa → Ankara mid heading faces roughly east (toward Ankara)',
    `${forward.headingDeg.toFixed(1)}°`,
  );
  assert(
    angularDistance(forward.headingDeg, reverse.headingDeg) > 170,
    'Ankara → Bursa heading reverses by ~180°',
    `${forward.headingDeg.toFixed(1)}° / ${reverse.headingDeg.toFixed(1)}°`,
  );
  for (const progress of [0, 0.5, 1] as const) {
    const sample = getTruckPositionAlongRoadRoute(bursaAnkara, progress, {
      coordinateScaleX: 1080,
      coordinateScaleY: 720,
    });
    assert(
      Number.isFinite(sample.headingDeg) && Number.isFinite(sample.point.x),
      `Bursa → Ankara progress=${progress} is finite`,
    );
  }
}

console.log('\nCatalog routes: İzmir ↔ İstanbul');
for (const [from, to] of [
  ['izmir', 'istanbul'],
  ['istanbul', 'izmir'],
] as const) {
  const route = getRoadRoute(from, to);
  assert(route != null && route.length >= 2, `${from} → ${to} resolves`);
  if (!route) continue;
  const sample = getTruckPositionAlongRoadRoute(route, 0.5);
  assert(Number.isFinite(sample.headingDeg), `${from} → ${to} heading finite`);
}
{
  const forward = getRoadRoute('izmir', 'istanbul');
  const reverse = getRoadRoute('istanbul', 'izmir');
  if (forward && reverse) {
    const fh = getTruckPositionAlongRoadRoute(forward, 0.4).headingDeg;
    const rh = getTruckPositionAlongRoadRoute(reverse, 0.6).headingDeg;
    assert(
      angularDistance(fh, rh) > 150,
      'İzmir ↔ İstanbul reverse heading differs substantially',
      `${fh.toFixed(1)}° / ${rh.toFixed(1)}°`,
    );
  }
}

console.log('\nCardinal catalog smoke');
for (const [from, to, label] of [
  ['ankara', 'trabzon', 'eastish'],
  ['trabzon', 'ankara', 'westish'],
  ['ankara', 'antalya', 'southish'],
  ['antalya', 'ankara', 'northish'],
] as const) {
  const route = getRoadRoute(from, to);
  assert(route != null && route.length >= 2, `${from} → ${to} (${label}) resolves`);
  if (!route) continue;
  const sample = getTruckPositionAlongRoadRoute(route, 0.5);
  assert(Number.isFinite(sample.headingDeg), `${from} → ${to} heading finite`);
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
