import { measureViewportRoundTripError } from '../src/components/map/mapCoordinateUtils';
import { computeMapContentSize, getMapScaleBounds } from '../src/components/map/mapTransformUtils';
import type { MapTransformState } from '../src/components/map/mapCoordinateUtils';

const VIEWPORT_WIDTH = 360;
const VIEWPORT_HEIGHT = 340;
const ASPECT_RATIO = 1672 / 941;
const contentSize = computeMapContentSize(VIEWPORT_HEIGHT, ASPECT_RATIO);

const bounds = getMapScaleBounds({
  viewportWidth: VIEWPORT_WIDTH,
  viewportHeight: VIEWPORT_HEIGHT,
  contentWidth: contentSize.width,
  contentHeight: contentSize.height,
});

const scenarios: Array<{ name: string; transform: MapTransformState; points: Array<[number, number]> }> = [
  {
    name: 'fit/min zoom',
    transform: bounds.fitTransform,
    points: [
      [40, 40],
      [180, 170],
      [320, 300],
    ],
  },
  {
    name: 'operational start',
    transform: bounds.operationalTransform,
    points: [
      [60, 80],
      [200, 160],
      [300, 280],
    ],
  },
  {
    name: 'medium zoom panned',
    transform: {
      scale: bounds.operationalScale * 1.25,
      translateX: -120,
      translateY: -40,
    },
    points: [
      [120, 100],
      [220, 180],
      [40, 260],
    ],
  },
  {
    name: 'max zoom corner',
    transform: {
      scale: bounds.maxScale,
      translateX: VIEWPORT_WIDTH - contentSize.width * bounds.maxScale,
      translateY: VIEWPORT_HEIGHT - contentSize.height * bounds.maxScale,
    },
    points: [
      [300, 60],
      [180, 200],
      [20, 320],
    ],
  },
];

const contentBounds = { width: contentSize.width, height: contentSize.height };
let pass = 0;
let fail = 0;

console.log('\n=== Map Coordinate Round-Trip Test ===\n');

for (const scenario of scenarios) {
  console.log(`Scenario: ${scenario.name}`);
  for (const [x, y] of scenario.points) {
    const { dx, dy } = measureViewportRoundTripError(x, y, scenario.transform, contentBounds);
    const ok = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
    if (ok) {
      pass += 1;
      console.log(`  ✓ viewport (${x}, ${y}) -> dx=${dx.toFixed(3)} dy=${dy.toFixed(3)}`);
    } else {
      fail += 1;
      console.log(`  ✗ viewport (${x}, ${y}) -> dx=${dx.toFixed(3)} dy=${dy.toFixed(3)}`);
    }
  }
  console.log('');
}

console.log(`PASS: ${pass}`);
console.log(`FAIL: ${fail}`);

if (fail > 0) {
  process.exit(1);
}

console.log('✅ ALL PASS\n');
