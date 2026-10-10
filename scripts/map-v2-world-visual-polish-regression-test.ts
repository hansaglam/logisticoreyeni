/**
 * Map V2 world visual polish: labels, availability paint, rounded clip.
 * Run: npx tsx scripts/map-v2-world-visual-polish-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { pointInProjectedPolygons } from '../src/mapV2/geo/geometry';
import { countryLabelAnchorFromPolygons, getCountryLabelAnchor } from '../src/mapV2/geo/countryLabelAnchor';
import { dequantizePolygons } from '../src/mapV2/geo/worldBoundaryPackage';
import { resolveCountryGameplayAvailability } from '../src/mapV2/gameplay/mapV2CountryAvailability.fixture';
import { resolveCountryDisplayName } from '../src/mapV2/presentation/countryDisplayName';
import { paintForCountryAvailability } from '../src/mapV2/presentation/countryPaint';
import {
  buildWorldCountryLabel,
  selectWorldCountryLabels,
  worldLabelPriority,
  worldLabelTierForRelativeZoom,
  type WorldCountryLabel,
} from '../src/mapV2/presentation/worldCountryLabel';
import { getCountryRecord, getRenderableCountries, getWorldBoundaryPackage } from '../src/mapV2/world/worldBoundaryLoader';

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

console.log('\n=== Map V2 World Visual Polish ===\n');

const tur = getCountryRecord('country.tur')!;
const vat = getCountryRecord('country.vat')!;
const usa = getCountryRecord('country.usa')!;
const fra = getCountryRecord('country.fra')!;
const deu = getCountryRecord('country.deu')!;

const starter = buildWorldCountryLabel(tur, resolveCountryGameplayAvailability(tur.geoCountryId), false, 'tr');
assert(starter.minZoomTier === 'WORLD_LABEL_MAJOR', 'starter country always major-tier eligible');
assert(starter.displayName === 'Türkiye', 'starter uses localization layer');
assert(tur.sourceDisplayName !== 'Türkiye', 'provenance name unchanged');

const selected = buildWorldCountryLabel(fra, 'LOCKED', true, 'tr');
const locked = buildWorldCountryLabel(fra, 'LOCKED', false, 'tr');
assert(selected.priority > starter.priority, 'selected label highest priority');
assert(selected.priority > locked.priority, 'selection boosts same country');

const vatLabel = buildWorldCountryLabel(vat, resolveCountryGameplayAvailability(vat.geoCountryId), false, 'tr');
assert(vatLabel.minZoomTier === 'WORLD_LABEL_DETAIL', 'microstate hidden at far zoom');
assert(worldLabelTierForRelativeZoom(1.1, 'WORLD_LABEL_MAJOR') === 'WORLD_LABEL_MAJOR', 'default world stays MAJOR');
assert(worldLabelTierForRelativeZoom(1.4, 'WORLD_LABEL_MAJOR') === 'WORLD_LABEL_MEDIUM', 'enter medium');
assert(worldLabelTierForRelativeZoom(1.28, 'WORLD_LABEL_MEDIUM') === 'WORLD_LABEL_MEDIUM', 'hysteresis hold medium');

const far = selectWorldCountryLabels({
  labels: [starter, vatLabel, buildWorldCountryLabel(deu, 'UNLOCKED', false, 'tr')],
  viewTier: 'WORLD_LABEL_MAJOR',
  translateX: 0,
  translateY: 0,
  scale: 800,
  clip: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 },
});
assert(far.some((row) => row.geoCountryId === 'country.tur'), 'labels visible without selection');
assert(!far.some((row) => row.geoCountryId === 'country.vat'), 'Vatican suppressed at far zoom');

const collideLow: WorldCountryLabel = {
  ...vatLabel,
  geoCountryId: 'country.fake.low',
  displayName: 'X',
  projectedAnchor: starter.projectedAnchor,
  priority: 1,
  minZoomTier: 'WORLD_LABEL_MAJOR',
};
const collide = selectWorldCountryLabels({
  labels: [starter, collideLow],
  viewTier: 'WORLD_LABEL_MAJOR',
  translateX: 0,
  translateY: 0,
  scale: 800,
  clip: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 },
});
assert(collide.some((row) => row.geoCountryId === 'country.tur'), 'higher priority wins collision');
assert(!collide.some((row) => row.geoCountryId === 'country.fake.low'), 'lower priority suppressed');

const clippedOut = selectWorldCountryLabels({
  labels: [starter],
  viewTier: 'WORLD_LABEL_MAJOR',
  translateX: -10000,
  translateY: -10000,
  scale: 800,
  clip: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
});
assert(clippedOut.length === 0, 'labels cannot escape viewport clip');

assert(resolveCountryDisplayName(deu, 'tr') === 'Almanya', 'Germany TR');
assert(resolveCountryDisplayName(deu, 'en') === 'Germany', 'Germany EN');
assert(resolveCountryDisplayName(fra, 'tr') === 'Fransa', 'France TR');

const paints = {
  starter: paintForCountryAvailability('STARTER_AVAILABLE', false),
  unlocked: paintForCountryAvailability('UNLOCKED', false),
  locked: paintForCountryAvailability('LOCKED', false),
  unsupported: paintForCountryAvailability('NOT_GAMEPLAY_SUPPORTED', false),
};
assert(paints.starter.fill !== paints.unlocked.fill, 'starter/unlocked fills distinct');
assert(paints.unlocked.fill !== paints.locked.fill, 'unlocked/locked fills distinct');
assert(paints.locked.fill !== paints.unsupported.fill, 'locked/unsupported fills distinct');
assert(paints.starter.strokeWidth > paints.locked.strokeWidth, 'starter outline clearer than locked');
assert(paintForCountryAvailability('UNLOCKED', true).strokeWidth > paints.unlocked.strokeWidth, 'selected outline stronger');

const usaAnchor = getCountryLabelAnchor(usa);
const usaPolys = dequantizePolygons(usa.lods.WORLD_LOW.polygons);
assert(pointInProjectedPolygons(usaAnchor.projected, usaPolys), 'USA label anchor inside geometry');
assert(usaAnchor.projected.y > 0.28, 'USA label not Alaska/high-latitude mass');
const fraAnchor = getCountryLabelAnchor(fra);
const fraPolys = dequantizePolygons(fra.lods.WORLD_LOW.polygons);
assert(pointInProjectedPolygons(fraAnchor.projected, fraPolys), 'France label inside geometry');
assert(fraAnchor.projected.x > 0.48 && fraAnchor.projected.x < 0.58, 'France label not overseas centroid');

const synthetic = countryLabelAnchorFromPolygons('fixture', [
  {
    exterior: [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.1, y: 0.1 },
      { x: 0, y: 0.1 },
      { x: 0, y: 0 },
    ],
    holes: [],
  },
]);
assert(synthetic.method === 'centroid' || synthetic.method === 'grid', 'deterministic interior method');

assert(worldLabelPriority('STARTER_AVAILABLE', false, 0.01) > worldLabelPriority('LOCKED', false, 0.01), 'starter beats locked at same area');

const pkg = getWorldBoundaryPackage();
assert(pkg.omittedPolarFeatures.some((row) => row.geoCountryId === 'country.ata'), 'Antarctica remains omitted');
assert(!getRenderableCountries().some((row) => row.geoCountryId === 'country.ata'), 'Antarctica not renderable');

const canvas = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
assert(canvas.includes("viewportClip === 'ROUNDED'"), 'rounded clip implemented');
assert(canvas.includes('selectWorldCountryLabels'), 'world labels batched in canvas');
assert(canvas.includes('pointInProjectedPolygons'), 'country selection remains polygon-based');
assert(!canvas.includes('SceneKit') && !canvas.includes('sphere'), 'no 3D globe');
assert(read('src/mapV2/screens/MapV2WorldScreen.tsx').includes('viewportClip={mode === \'WORLD\' ? \'ROUNDED\' : \'NONE\'}'), 'world screen enables rounded clip');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen unchanged');
assert(!read('src/mapV2/geo/countryLabelAnchor.ts').includes('Math.random'), 'anchors deterministic');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
