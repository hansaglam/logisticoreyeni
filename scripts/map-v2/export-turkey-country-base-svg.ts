/**
 * Export a lightweight SVG of verified Türkiye COUNTRY_HIGH geometry.
 * Decoration only — runtime still uses the Skia country path.
 * Run: npx tsx scripts/map-v2/export-turkey-country-base-svg.ts
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { simplifyOpenPolyline } from '../../src/mapV2/geo/simplifyPolyline';
import { getCountryGeometry, getCountryRecord } from '../../src/mapV2/world/worldBoundaryLoader';

const WIDTH = 960;
const HEIGHT = 480;
const PAD = 24;
const root = resolve(__dirname, '../..');
const outDir = resolve(root, 'src/mapV2/generated/visual');

const turkey = getCountryRecord('country.tur');
if (!turkey) throw new Error('country.tur missing');
const polygons = getCountryGeometry('country.tur', 'COUNTRY_HIGH');
const bounds = turkey.lods.COUNTRY_HIGH.projectedBounds;
const spanX = bounds.maxX - bounds.minX;
const spanY = bounds.maxY - bounds.minY;
const scale = Math.min((WIDTH - PAD * 2) / spanX, (HEIGHT - PAD * 2) / spanY);

function mapX(x: number): number {
  return PAD + (x - bounds.minX) * scale;
}
function mapY(y: number): number {
  return PAD + (y - bounds.minY) * scale;
}

function ringToD(points: { x: number; y: number }[]): string {
  const simple = simplifyOpenPolyline(points, 0.00008);
  if (simple.length < 4) return '';
  const parts = simple.map((p, i) => `${i === 0 ? 'M' : 'L'}${mapX(p.x).toFixed(2)},${mapY(p.y).toFixed(2)}`);
  return `${parts.join(' ')} Z`;
}

const pathD = polygons
  .flatMap((poly) => [ringToD(poly.exterior), ...poly.holes.map((hole) => ringToD(hole))])
  .filter(Boolean)
  .join(' ');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Türkiye country base (verified outline)">
  <title>Türkiye country visual base — geography from geoBoundaries COUNTRY_HIGH; styling only</title>
  <defs>
    <linearGradient id="land" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0F3A58"/>
      <stop offset="55%" stop-color="#1C6A8A"/>
      <stop offset="100%" stop-color="#154E6C"/>
    </linearGradient>
    <clipPath id="tr"><path d="${pathD}"/></clipPath>
  </defs>
  <rect width="100%" height="100%" fill="#031225"/>
  <path d="${pathD}" fill="url(#land)" fill-rule="evenodd"/>
  <g clip-path="url(#tr)" opacity="0.35">
    <ellipse cx="${(WIDTH * 0.34).toFixed(0)}" cy="${(HEIGHT * 0.42).toFixed(0)}" rx="120" ry="70" fill="#145A48"/>
    <ellipse cx="${(WIDTH * 0.58).toFixed(0)}" cy="${(HEIGHT * 0.38).toFixed(0)}" rx="90" ry="55" fill="#28466E"/>
    <ellipse cx="${(WIDTH * 0.74).toFixed(0)}" cy="${(HEIGHT * 0.5).toFixed(0)}" rx="80" ry="50" fill="#145A48"/>
  </g>
  <path d="${pathD}" fill="none" stroke="#061220" stroke-width="3.2" fill-rule="evenodd"/>
  <path d="${pathD}" fill="none" stroke="#8EF0DC" stroke-width="1.35" fill-rule="evenodd"/>
</svg>
`;

mkdirSync(outDir, { recursive: true });
const svgPath = resolve(outDir, 'turkey-country-base.svg');
writeFileSync(svgPath, svg);
const bytes = statSync(svgPath).size;
const vertexEstimate = pathD.split(/[MLZ]/i).length;
const meta = {
  file: 'src/mapV2/generated/visual/turkey-country-base.svg',
  format: 'SVG',
  viewBox: [0, 0, WIDTH, HEIGHT],
  encodedBytes: bytes,
  estimatedDecodedMemoryBytes: bytes,
  note: 'Vector; runtime Map V2 country dashboard uses the Skia COUNTRY_HIGH path. This file is the same outline for design/review.',
  geographyLod: 'COUNTRY_HIGH',
  vertexTokens: vertexEstimate,
};
writeFileSync(resolve(outDir, 'turkey-country-base.meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`wrote ${svgPath} (${bytes} bytes)`);
