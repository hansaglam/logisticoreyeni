/**
 * Map V2 Step 4 plan isolation — docs/constants only.
 * Run: node --import tsx scripts/map-v2-implementation-plan-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

console.log('\n=== Map V2 Implementation Plan Regression ===\n');

const pkg = read('package.json');
assert(pkg.includes('"@shopify/react-native-skia": "2.2.12"'), 'Skia is accepted Map V2 renderer dependency');
assert(pkg.includes('"react-native-svg": "15.12.1"'), 'svg dependency unchanged in assert snapshot');
assert(pkg.includes('"react-native": "0.81.5"'), 'RN version snapshot');

const mapScreen = read('src/screens/MapScreen.tsx');
const worldCanvas = read('src/components/map/WorldMapCanvas.tsx');
assert(!mapScreen.includes('mapV2'), 'MapScreen does not import mapV2');
assert(!mapScreen.includes('@shopify/react-native-skia'), 'MapScreen does not import Skia');
assert(!worldCanvas.includes('mapV2'), 'WorldMapCanvas does not import mapV2');
assert(!worldCanvas.includes('@shopify/react-native-skia'), 'WorldMapCanvas does not import Skia');
assert(
  read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('@shopify/react-native-skia'),
  'Map V2 DEV geographic canvas may use Skia',
);
assert(read('src/mapV2/spike/MapV2SpikeCanvas.tsx').includes('@shopify/react-native-skia'), 'Map V2 DEV spike may use Skia');

const docs = [
  'docs/architecture/map-v2/MAP_V2_TECHNICAL_IMPLEMENTATION_PLAN.md',
  'docs/performance/map-v2/MAP_V2_PERFORMANCE_BUDGETS.md',
  'docs/qa/map-v2/MAP_V2_TEST_STRATEGY.md',
  'docs/qa/map-v2/MAP_V2_DEVICE_MATRIX.md',
  'docs/release-audit/map-v2/MAP_V2_ROLLOUT_AND_RELEASE_GATES.md',
  'docs/architecture/map-v2/decisions/0001-renderer-selection.md',
];

for (const rel of docs) {
  assert(read(rel).length > 200, `${rel} exists`);
}

const plan = read('docs/architecture/map-v2/MAP_V2_TECHNICAL_IMPLEMENTATION_PLAN.md');
assert(read('docs/architecture/map-v2/decisions/0001-renderer-selection.md').includes('ACCEPT_SKIA'), 'ADR ACCEPT_SKIA is current renderer decision');
assert(plan.includes('PHASE 1') || plan.includes('**1**'), 'phase 1 spike listed');
assert(!/\b\d+\.\d+\s*,\s*-?\d+\.\d+/.test(plan), 'no lon/lat pair in plan');

const gates = read('docs/release-audit/map-v2/MAP_V2_ROLLOUT_AND_RELEASE_GATES.md');
assert(gates.includes('MAP_V2_DOES_NOT_REQUIRE_USER_LOCATION_PERMISSION'), 'privacy marker');
assert(gates.includes('LEGACY_ONLY'), 'rollout starts legacy');

const budgets = read('docs/performance/map-v2/MAP_V2_PERFORMANCE_BUDGETS.md');
assert(budgets.includes('TARGET_INTERACTION_FPS'), 'fps target named');
assert(budgets.includes('MINIMUM_ACCEPTABLE_FPS'), 'min fps named');
assert(budgets.includes('provisional'), 'budgets marked provisional');

assert(read('app.json').includes('"orientation": "portrait"'), 'portrait unchanged');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS');
