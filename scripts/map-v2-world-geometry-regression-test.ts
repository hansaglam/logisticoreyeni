/**
 * Map V2 world geometry: projection, package, culling, provenance, MapScreen isolation.
 * Run: node --import tsx scripts/map-v2-world-geometry-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  clampLatitudeWebMercator,
  projectWgs84ToNormalizedMercator,
  unprojectNormalizedMercatorToWgs84,
  WEB_MERCATOR_MAX_LATITUDE,
} from '../src/mapV2/geo/webMercator';
import { clampWorldCamera } from '../src/mapV2/geo/worldCamera';
import {
  pointInProjectedPolygons,
  projectGeoJsonGeometry,
  validateProjectedRing,
} from '../src/mapV2/geo/geometry';
import {
  MAX_PLAUSIBLE_RENDER_SEGMENT_DX,
  POLAR_RENDER_POLICY,
  polarOmitReason,
} from '../src/mapV2/geo/polarPolicy';
import { clipRingToMercatorLatitude, splitRingAtDateline } from '../src/mapV2/geo/wgs84Clip';
import { simplifyRing } from '../src/mapV2/geo/simplifyRing';
import { dequantizePolygons } from '../src/mapV2/geo/worldBoundaryPackage';
import { getRenderableCountries, getVisibleCountryGeometry, getWorldBoundaryPackage } from '../src/mapV2/world/worldBoundaryLoader';
import {
  lodGeometryTotals,
  resolveLoadedLod,
  selectDrawCountryIds,
  worldPathCacheKey,
} from '../src/mapV2/world/worldViewerFrame';
import { hashCanonicalPackage, validateWorldBoundaryPackage } from './map-v2/validate-world-package';

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

function nearly(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

console.log('\n=== Map V2 World Geometry Regression ===\n');

const p180 = projectWgs84ToNormalizedMercator(-180, 0);
const p0 = projectWgs84ToNormalizedMercator(0, 0);
const pE = projectWgs84ToNormalizedMercator(180, 0);
assert(nearly(p180.x, 0), 'lon -180 → x 0');
assert(nearly(p0.x, 0.5), 'lon 0 → x 0.5');
assert(nearly(pE.x, 1), 'lon 180 → x 1');
assert(nearly(p0.y, 0.5, 1e-6), 'lat 0 → y 0.5');
assert(clampLatitudeWebMercator(90) === WEB_MERCATOR_MAX_LATITUDE, 'lat clamp north');
assert(clampLatitudeWebMercator(-90) === -WEB_MERCATOR_MAX_LATITUDE, 'lat clamp south');
assert(Number.isFinite(projectWgs84ToNormalizedMercator(12, 89).y), 'no NaN after clamp');

const round = unprojectNormalizedMercatorToWgs84(p0.x, p0.y);
assert(nearly(round.longitude, 0, 1e-6) && nearly(round.latitude, 0, 1e-6), 'round trip equator');

const fitted = clampWorldCamera({
  scale: 400,
  translateX: 10,
  translateY: 10,
  viewportWidth: 400,
  viewportHeight: 400,
  elastic: false,
});
assert(fitted.translateX === 0 && fitted.translateY === 0, 'fit zoom centers and locks pan');
const zoomed = clampWorldCamera({
  scale: 800,
  translateX: -100,
  translateY: -40,
  viewportWidth: 400,
  viewportHeight: 400,
  elastic: false,
});
assert(zoomed.translateX === -100 && zoomed.translateY === -40, 'zoomed pan is not forced to center');

const canvasSrc =
  read('src/mapV2/world/MapV2WorldGeometryCanvas.tsx') + read('src/mapV2/world/MapV2GeographicCanvas.tsx');
assert(canvasSrc.includes('Gesture.Simultaneous(pinchGesture, panGesture'), 'pan simultaneous with pinch');
assert(canvasSrc.includes('Gesture.Exclusive(doubleTapGesture, tapGesture)'), 'tap exclusive of double tap');
assert(!canvasSrc.includes('Gesture.Race'), 'no Race(tap, pan)');
assert(canvasSrc.includes('collapsable={false}'), 'gesture host is a View not Canvas');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes('contentBottomPadding'), 'chrome above tab bar');

const square = projectGeoJsonGeometry({
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
});
assert(square.length === 1, 'polygon');
assert(validateProjectedRing(square[0].exterior) == null, 'valid ring');

const multi = projectGeoJsonGeometry({
  type: 'MultiPolygon',
  coordinates: [
    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    [[[20, 0], [22, 0], [22, 2], [20, 2], [20, 0]]],
  ],
});
assert(multi.length === 2, 'multipolygon islands');

const withHole = projectGeoJsonGeometry({
  type: 'Polygon',
  coordinates: [
    [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
      [-10, -10],
    ],
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ],
  ],
});
const origin = projectWgs84ToNormalizedMercator(0, 0);
const outsideHole = projectWgs84ToNormalizedMercator(5, 5);
assert(withHole[0].holes.length === 1, 'hole stored');
assert(!pointInProjectedPolygons(origin, withHole), 'hole not filled');
assert(pointInProjectedPolygons(outsideHole, withHole), 'land around hole');
assert(validateProjectedRing([{ x: 1, y: 1 }]) === 'ring-too-short', 'invalid ring rejected');

const dense: { x: number; y: number }[] = [];
for (let i = 0; i <= 80; i += 1) {
  dense.push({ x: i / 80, y: i % 2 === 0 ? 0 : 0.4 });
}
dense.push(dense[0]);
const simplified = simplifyRing(dense, 0.05);
assert(simplified.length >= 4, 'simplify keeps ring');
assert(simplified.length < dense.length, 'simplify reduces vertices');

const pkg = getWorldBoundaryPackage();
const issues = validateWorldBoundaryPackage(pkg);
assert(issues.length === 0, 'package validation empty');
assert(pkg.projection.id === 'WEB_MERCATOR' && pkg.projection.epsg === 3857, 'projection metadata');
assert(pkg.sourceManifest.geoBoundariesReleaseType === 'gbOpen', 'gbOpen');
assert(pkg.sourceManifest.license.includes('CC-BY-4.0'), 'license');
assert(pkg.sourceManifest.productionApproved === false, 'not production approved');
assert(typeof pkg.contentHash === 'string' && pkg.contentHash.startsWith('sha256:'), 'provenance hash');
const { contentHash: _h, ...unsigned } = pkg;
assert(hashCanonicalPackage(unsigned) === pkg.contentHash, 'deterministic content hash');

const ids = new Set(pkg.countries.map((c) => c.geoCountryId));
assert(ids.size === pkg.countries.length, 'unique country ids');
assert(pkg.countries.length >= 200, 'world country count');
assert(
  pkg.countries.every((c) =>
    c.webMercatorLayer === 'OMITTED_UNREPRESENTABLE_POLAR'
      ? c.lods.WORLD_LOW.polygons.length === 0
      : c.lods.WORLD_LOW.polygons.length > 0 && c.lods.COUNTRY_HIGH.polygons.length > 0,
  ),
  'all lods retained for rendered countries',
);
assert(pkg.countries.some((c) => c.geoCountryId === 'country.tur'), 'Türkiye from source iso3 TUR');
assert(
  pkg.countries.every((c) =>
    [c.lods.WORLD_LOW, c.lods.WORLD_MEDIUM, c.lods.COUNTRY_HIGH].every((lod) =>
      lod.polygons.every((poly) => poly.exterior.every((n) => Number.isFinite(n))),
    ),
  ),
  'no NaN quantized coords',
);

assert(pkg.polarRenderPolicy === POLAR_RENDER_POLICY, 'polar policy omit unrepresentable');
assert(pkg.sourceCountryCount === pkg.countries.length, 'source feature count preserved');
assert(pkg.renderedCountryCount === getRenderableCountries().length, 'rendered count matches layer');
assert(pkg.renderedCountryCount === pkg.sourceCountryCount - pkg.omittedPolarFeatures.length, 'rendered = source - omitted');
assert(pkg.countries.some((c) => c.geoCountryId === 'country.ata'), 'Antarctica remains in source package');
const ata = pkg.countries.find((c) => c.geoCountryId === 'country.ata');
assert(ata?.webMercatorLayer === 'OMITTED_UNREPRESENTABLE_POLAR', 'Antarctica omitted from Mercator layer');
assert(ata?.lods.WORLD_LOW.polygons.length === 0, 'Antarctica has no render polygons');
assert(pkg.omittedPolarFeatures.some((f) => f.geoCountryId === 'country.ata'), 'Antarctica listed in omittedPolarFeatures');

const southClip = clipRingToMercatorLatitude([
  [10, -80],
  [20, -80],
  [20, -90],
  [10, -90],
  [10, -80],
]);
assert(southClip.length >= 4, 'south clip keeps a polygon');
assert(
  southClip.every((p) => p[1] >= -WEB_MERCATOR_MAX_LATITUDE - 1e-9),
  'south clip does not retain sub-limit latitudes',
);
assert(southClip.some((p) => nearly(p[1], -WEB_MERCATOR_MAX_LATITUDE, 1e-6)), 'south clip inserts envelope edge');
const southLats = new Set(southClip.map((p) => p[1].toFixed(6)));
assert(southLats.size >= 2, 'south clip is not a collapsed latitude line');

const northClip = clipRingToMercatorLatitude([
  [10, 80],
  [20, 80],
  [20, 90],
  [10, 90],
  [10, 80],
]);
assert(northClip.every((p) => p[1] <= WEB_MERCATOR_MAX_LATITUDE + 1e-9), 'north clip envelope');
assert(northClip.some((p) => nearly(p[1], WEB_MERCATOR_MAX_LATITUDE, 1e-6)), 'north clip inserts envelope edge');

assert(!read('src/mapV2/geo/geometry.ts').includes('clampLatitudeWebMercator'), 'static polygon pipeline does not per-vertex clamp');
assert(read('src/mapV2/geo/geometry.ts').includes('projectWgs84ToNormalizedMercatorStrict'), 'static pipeline uses strict project after clip');
assert(read('src/mapV2/geo/geometry.ts').includes('prepareWgs84RingForMercator'), 'static pipeline clips then splits');

const antarcticaLike = {
  type: 'Polygon',
  coordinates: [[
    [-180, -70],
    [-90, -70],
    [0, -70],
    [90, -70],
    [180, -70],
    [180, -89.9],
    [90, -89.9],
    [0, -89.9],
    [-90, -89.9],
    [-180, -89.9],
    [-180, -70],
  ]],
};
assert(polarOmitReason(antarcticaLike) != null, 'pole-enclosing polygon classified unrepresentable');
const clippedAta = clipRingToMercatorLatitude(antarcticaLike.coordinates[0]);
const ataLonSpan = Math.max(...clippedAta.map((p) => p[0])) - Math.min(...clippedAta.map((p) => p[0]));
assert(ataLonSpan >= 300, 'Mercator latitude clip still leaves a world-spanning Antarctica ring');

const dateline = splitRingAtDateline([
  [170, 0],
  [179, 0],
  [-170, 0],
  [-170, 8],
  [179, 8],
  [170, 8],
  [170, 0],
]);
assert(dateline.length >= 2, 'dateline-crossing ring splits');
assert(
  dateline.every((part) => {
    const xs = part.map((p) => (p[0] + 180) / 360);
    for (let i = 1; i < xs.length; i += 1) {
      if (Math.abs(xs[i] - xs[i - 1]) >= MAX_PLAUSIBLE_RENDER_SEGMENT_DX) return false;
    }
    return true;
  }),
  'dateline parts have no world-spanning X segments',
);

const datelineProjected = projectGeoJsonGeometry({
  type: 'Polygon',
  coordinates: [[
    [170, 0],
    [179, 0],
    [-170, 0],
    [-170, 8],
    [179, 8],
    [170, 8],
    [170, 0],
  ]],
});
assert(datelineProjected.length >= 2, 'dateline polygon projects to split parts');

const world = getVisibleCountryGeometry({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 'WORLD_LOW');
assert(world.length === pkg.renderedCountryCount, 'full world cull is rendered set');
assert(world.every((c) => c.webMercatorLayer === 'INCLUDED'), 'cull excludes omitted polar');
assert(!world.some((c) => c.geoCountryId === 'country.ata'), 'Antarctica not in render cull');

let longSegs = 0;
let outOfRange = 0;
let nonFinite = 0;
for (const country of getRenderableCountries()) {
  for (const lod of ['WORLD_LOW', 'WORLD_MEDIUM', 'COUNTRY_HIGH'] as const) {
    const decoded = dequantizePolygons(country.lods[lod].polygons);
    for (const polygon of decoded) {
      const ring = polygon.exterior;
      for (let i = 0; i < ring.length; i += 1) {
        const p = ring[i];
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) nonFinite += 1;
        if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) outOfRange += 1;
        if (i + 1 < ring.length && Math.abs(ring[i + 1].x - p.x) >= MAX_PLAUSIBLE_RENDER_SEGMENT_DX) {
          longSegs += 1;
        }
      }
    }
  }
}
assert(nonFinite === 0, 'no NaN / Infinity in rendered coords');
assert(outOfRange === 0, 'all rendered coordinates remain [0,1]');
assert(longSegs === 0, 'no implausible world-X segments in rendered layer');

const named = {
  'country.usa': 'North America',
  'country.can': 'Canada',
  'country.bra': 'South America',
  'country.grl': 'Greenland',
  'country.fra': 'Europe',
  'country.zaf': 'Africa',
  'country.rus': 'Russia',
  'country.tur': 'Türkiye',
  'country.egy': 'Middle East / Egypt',
  'country.pak': 'South Asia / Pakistan',
  'country.chn': 'China',
  'country.jpn': 'Japan',
  'country.idn': 'Indonesia',
  'country.phl': 'Philippines',
  'country.aus': 'Australia',
  'country.nzl': 'New Zealand',
  'country.fji': 'Pacific island',
  'country.jam': 'Caribbean',
};
for (const [id, label] of Object.entries(named)) {
  const rec = pkg.countries.find((c) => c.geoCountryId === id);
  assert(Boolean(rec) && rec!.webMercatorLayer === 'INCLUDED' && rec!.lods.WORLD_LOW.polygonCount > 0, `${label} rendered`);
}

assert(!pkg.countries.some((c) => c.sourceIso3 === 'IND'), 'India not in gbOpen ADM0 simplified source (do not invent)');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes('sourceCountries {hud.sourceCountries}'), 'HUD sourceCountries');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes('renderedCountries {hud.renderedCountries}'), 'HUD renderedCountries');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes('visibleCountries'), 'HUD visibleCountries');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes('renderedPaths {hud.renderedPaths}'), 'HUD renderedPaths');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes('selectedLod {hud.selectedLod}'), 'HUD selectedLod');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes('loadedLod {hud.loadedLod}'), 'HUD loadedLod');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes('totalPathsForLod {hud.totalPathsForLod}'), 'HUD totalPathsForLod');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes('culling: {hud.culling}'), 'HUD culling from render state');
assert(read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes("cullEnabled ? 'CULL: ON' : 'CULL: OFF'"), 'cull chip shows current state');
assert(!read('src/mapV2/world/MapV2WorldGeometryScreen.tsx').includes("'CULL ON'"), 'no ambiguous CULL ON label');
assert(canvasSrc.includes('syncFromCamera'), 'LOD/cull resync HUD without waiting for camera');
assert(canvasSrc.includes('lodOverride === \'AUTO\' ? activeLod : lodOverride'), 'explicit LOD used for draw immediately');
assert(canvasSrc.includes('selectDrawCountryIds(cullEnabled, visibleIds, allIds)'), 'cull branch selects draw set');
assert(canvasSrc.includes('getCountryPath(id, loadedLod)'), 'draw uses loaded LOD path');

const tur = pkg.countries.find((c) => c.geoCountryId === 'country.tur')!;
assert(
  tur.lods.WORLD_LOW.polygons !== tur.lods.WORLD_MEDIUM.polygons &&
    tur.lods.WORLD_MEDIUM.polygons !== tur.lods.COUNTRY_HIGH.polygons,
  'LOD selection maps to distinct geometry arrays',
);
assert(tur.lods.WORLD_LOW.vertexCount < tur.lods.WORLD_MEDIUM.vertexCount, 'MEDIUM has more vertices than LOW');
assert(tur.lods.WORLD_MEDIUM.vertexCount < tur.lods.COUNTRY_HIGH.vertexCount, 'HIGH has more vertices than MEDIUM');
assert(worldPathCacheKey('country.tur', 'WORLD_LOW') !== worldPathCacheKey('country.tur', 'WORLD_MEDIUM'), 'cache keys differ by LOD');
assert(worldPathCacheKey('country.tur', 'WORLD_LOW') === 'country.tur::WORLD_LOW', 'cache key format');
assert(resolveLoadedLod('COUNTRY_HIGH', 1, 400, 400) === 'COUNTRY_HIGH', 'explicit LOD wins over camera');
assert(resolveLoadedLod('AUTO', 1, 400, 400) === 'WORLD_LOW', 'AUTO uses WORLD_LOW near fit');
assert(resolveLoadedLod('AUTO', 400 * 3, 400, 400) === 'WORLD_MEDIUM', 'AUTO uses MEDIUM when zoomed');

const lowTotals = lodGeometryTotals(getRenderableCountries(), 'WORLD_LOW');
const medTotals = lodGeometryTotals(getRenderableCountries(), 'WORLD_MEDIUM');
const highTotals = lodGeometryTotals(getRenderableCountries(), 'COUNTRY_HIGH');
assert(lowTotals.paths === pkg.renderedCountryCount, 'one path per renderable country');
assert(lowTotals.vertices < medTotals.vertices && medTotals.vertices < highTotals.vertices, 'LOD vertex totals increase');
assert(lowTotals.polygons <= medTotals.polygons && medTotals.polygons <= highTotals.polygons, 'LOD polygon totals nondecreasing');

const zoomedVisible = getVisibleCountryGeometry({ minX: 0.52, minY: 0.32, maxX: 0.58, maxY: 0.38 }, 'WORLD_LOW');
const allRenderableIds = getRenderableCountries().map((c) => c.geoCountryId);
const visibleIds = zoomedVisible.map((c) => c.geoCountryId);
const cullOnIds = selectDrawCountryIds(true, visibleIds, allRenderableIds);
const cullOffIds = selectDrawCountryIds(false, visibleIds, allRenderableIds);
assert(zoomedVisible.length < pkg.renderedCountryCount, 'zoomed viewport has fewer visible countries');
assert(cullOnIds.length === visibleIds.length, 'CULL ON draws visible set');
assert(cullOffIds.length === allRenderableIds.length, 'CULL OFF draws all renderable paths');
assert(cullOffIds.length > cullOnIds.length, 'CULL OFF increases renderedPaths vs CULL ON in zoomed fixture');
assert(
  cullOnIds.length === zoomedVisible.length && cullOffIds.length === pkg.renderedCountryCount,
  'HUD renderedPaths derives from current cull + viewport',
);
assert(read('docs/architecture/map-v2/decisions/0002-projection-selection.md').includes('OMIT_UNREPRESENTABLE_POLAR_FEATURE'), 'ADR polar policy');
const tiny = getVisibleCountryGeometry({ minX: 0.49, minY: 0.49, maxX: 0.51, maxY: 0.51 }, 'WORLD_LOW');
assert(tiny.length < pkg.renderedCountryCount, 'viewport cull smaller');

const loaderCountry = pkg.countries.find((c) => c.geoCountryId === 'country.tur');
assert(Boolean(loaderCountry?.sourceDisplayName), 'loader country name from source');

const mapScreen = read('src/screens/MapScreen.tsx');
assert(!mapScreen.includes("from '../mapV2"), 'MapScreen unchanged import');
assert(!mapScreen.includes('@shopify/react-native-skia'), 'MapScreen no Skia');
assert(read('src/screens/MoreScreen.tsx').includes("route === 'debug' && __DEV__"), 'debug __DEV__');
assert(read('App.tsx').includes("pendingMoreSubRoute: 'debug'"), 'world viewer reachable from Yönetim');
assert(read('docs/architecture/map-v2/decisions/0001-renderer-selection.md').includes('ACCEPT_SKIA'), 'ADR ACCEPT_SKIA');
assert(read('src/mapData/mapSourcePolicy.ts').includes('SOURCE_AS_PROVIDED'), 'political policy passthrough');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
