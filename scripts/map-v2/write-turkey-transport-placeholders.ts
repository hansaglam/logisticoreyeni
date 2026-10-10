/**
 * Writes empty Türkiye transport packages. No geometry is invented.
 * Run: npx tsx scripts/map-v2/write-turkey-transport-placeholders.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { MapV2TransportMode } from '../../src/mapV2/domain/transport';
import {
  createCityAccessPackage,
  createEmptyModeNetwork,
  createInfrastructurePackage,
  createManifest,
  sealNetwork,
} from './transport-package-factory';

const outDir = resolve(__dirname, '../../src/mapV2/generated/transport');

async function main() {
  await mkdir(outDir, { recursive: true });
  const modes: MapV2TransportMode[] = ['ROAD', 'RAIL', 'SEA', 'AIR'];
  for (const mode of modes) {
    const pkg = sealNetwork(createEmptyModeNetwork(mode));
    const file = `turkey-${mode.toLowerCase()}-network.json`;
    await writeFile(resolve(outDir, file), `${JSON.stringify(pkg)}\n`, 'utf8');
  }
  await writeFile(resolve(outDir, 'turkey-city-access.json'), `${JSON.stringify(createCityAccessPackage())}\n`, 'utf8');
  await writeFile(resolve(outDir, 'turkey-infrastructure.json'), `${JSON.stringify(createInfrastructurePackage())}\n`, 'utf8');
  await writeFile(resolve(outDir, 'turkeyTransportManifest.json'), `${JSON.stringify(createManifest())}\n`, 'utf8');
  console.log(`Wrote empty transport placeholders to ${outDir}`);
}

void main();
