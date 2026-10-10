/**
 * Map V2 Skia spike — isolation + synthetic math.
 * Run: node --import tsx scripts/map-v2-skia-spike-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getHeadingAtProgress, getPointAtProgress, polylineLength } from '../src/mapV2/spike/spikeRouteMath';
import {
  SPIKE_SCENE_ID,
  SPIKE_VEHICLE_ROUTE,
  createSpikeMarkerPool,
  createSpikeRoutes,
} from '../src/mapV2/spike/spikeSyntheticData';

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

console.log('\n=== Map V2 Skia Spike Regression ===\n');

assert(SPIKE_SCENE_ID === 'noxmere-archipelago-v1', 'fictional scene id');
assert(!SPIKE_SCENE_ID.toLowerCase().includes('turkey'), 'not turkey named');
assert(!SPIKE_SCENE_ID.toLowerCase().includes('türkiye'), 'not turkiye named');

const a = createSpikeMarkerPool(100);
const b = createSpikeMarkerPool(100);
assert(a.length === 100, '100 markers');
assert(a[0]?.x === b[0]?.x && a[0]?.y === b[0]?.y, 'deterministic markers');
assert(createSpikeMarkerPool(1000).length === 1000, '1000 pool');

const routes5 = createSpikeRoutes(5);
assert(routes5.length === 5, '5 routes');
assert(createSpikeRoutes(50).length === 50, '50 routes');
assert(routes5.some((r) => r.mode === 'ROAD'), 'road');
assert(routes5.some((r) => r.mode === 'RAIL'), 'rail');
assert(routes5.some((r) => r.mode === 'SEA'), 'sea');
assert(routes5.some((r) => r.mode === 'AIR'), 'air');

const pts = SPIKE_VEHICLE_ROUTE.points;
const cum = SPIKE_VEHICLE_ROUTE.cumLen;
const start = getPointAtProgress(pts, cum, 0);
const end = getPointAtProgress(pts, cum, 1);
assert(Math.abs(start.x - pts[0].x) < 0.01, 'progress 0');
assert(Math.abs(end.x - pts[pts.length - 1].x) < 0.01, 'progress 1');
assert(Number.isFinite(getHeadingAtProgress(pts, cum, 0.5)), 'heading');
assert(polylineLength(pts) > 0, 'length');

const mapScreen = read('src/screens/MapScreen.tsx');
assert(!mapScreen.includes('@shopify/react-native-skia'), 'MapScreen has no Skia');
assert(!mapScreen.includes('mapV2/spike'), 'MapScreen has no spike');
assert(!mapScreen.includes('mapV2/world'), 'MapScreen has no world viewer');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 Skia Spike'), 'debug entry');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 World Geometry'), 'world debug entry');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 World Experience'), 'world experience entry');
assert(read('src/screens/MoreScreen.tsx').includes("route === 'debug' && __DEV__"), 'debug still __DEV__');
assert(read('src/navigation/quickAccessConfig.ts').includes("label: 'Simülasyon Testi'"), 'yönetim debug tile');
assert(read('App.tsx').includes("pendingMoreSubRoute: 'debug'"), 'yönetim debug navigates to sim test');

const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
assert(pkg.dependencies['@shopify/react-native-skia'] === '2.2.12', 'skia 2.2.12');
assert(pkg.dependencies['react-native'] === '0.81.5', 'RN unchanged');
assert(pkg.dependencies.expo.includes('54.0.35'), 'expo unchanged');
assert(pkg.dependencies['react-native-reanimated'].includes('4.1.1'), 'reanimated unchanged');
assert(pkg.dependencies['react-native-gesture-handler'].includes('2.28.0'), 'gh unchanged');

assert(!read('src/mapV2/spike/spikeSyntheticData.ts').includes('istanbul'), 'no live city ids in synthetic');
assert(!read('src/mapV2/spike/MapV2SpikeCanvas.tsx').includes('turkey-logistics'), 'no png asset');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
