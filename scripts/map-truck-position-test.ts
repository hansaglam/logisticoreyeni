import {
  getDirectRoadSegment,
  getRoadRoute,
  getTruckPositionAlongRoadRoute,
  MAP_ROAD_ENDPOINT_TOLERANCE,
  normalizeMapDeliveryProgress,
} from '../src/components/map/mapRoadUtils';
import { getWorldMapCityPosition } from '../src/data/worldMapPositions';

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

console.log(`PASS: ${pass}`);
console.log(`FAIL: ${fail}`);

if (fail > 0) {
  process.exit(1);
}

console.log('✅ ALL PASS\n');
