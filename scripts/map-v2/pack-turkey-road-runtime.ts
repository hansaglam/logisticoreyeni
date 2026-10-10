/**
 * Pack canonical turkey-road-network.json into viewport chunks.
 * Monolith remains a gitignored build artifact; Metro loads chunks only.
 *
 * Run: npx tsx scripts/map-v2/pack-turkey-road-runtime.ts
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { GeoTransportNetworkPackageV1 } from '../../src/mapV2/geo/transportNetwork';
import { ROAD_SOURCE_PACKAGE_HASH_2E } from '../../src/mapV2/geo/roadRuntimePackage';
import { emitRoadChunkRegistrySource, packRoadRuntime } from './road-runtime-core';

const root = resolve(__dirname, '../..');
const sourcePath = resolve(root, 'src/mapV2/generated/transport/turkey-road-network.json');
const outDir = resolve(root, 'src/mapV2/generated/transport/road');

export async function packTurkeyRoadRuntimeFromDisk(): Promise<ReturnType<typeof packRoadRuntime> & { sizes: Record<string, number> }> {
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing ROAD source package: ${sourcePath}`);
  }
  const source = JSON.parse(await readFile(sourcePath, 'utf8')) as GeoTransportNetworkPackageV1;
  if (source.contentHash !== ROAD_SOURCE_PACKAGE_HASH_2E) {
    console.warn(`Source hash ${source.contentHash} != frozen 2E hash ${ROAD_SOURCE_PACKAGE_HASH_2E}`);
  }
  const packed = packRoadRuntime(source);
  if (existsSync(outDir)) {
    const entries = await readdir(outDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'low' || entry.name === 'medium' || entry.name === 'high') {
        await rm(resolve(outDir, entry.name), { recursive: true, force: true });
      }
    }
  }
  await mkdir(resolve(outDir, 'low'), { recursive: true });
  await mkdir(resolve(outDir, 'medium'), { recursive: true });
  await mkdir(resolve(outDir, 'high'), { recursive: true });
  for (const chunk of packed.chunks) {
    const lod = chunk.id.split('.')[1];
    const file = resolve(outDir, lod, `${chunk.id}.json`);
    const body = { v: chunk.v, id: chunk.id, lod: chunk.lod, b: chunk.b, n: chunk.n, e: chunk.e };
    await writeFile(file, JSON.stringify(body), 'utf8');
  }
  const manifestBody = { ...packed.manifest };
  delete (manifestBody as { contentHash?: string }).contentHash;
  await writeFile(
    resolve(outDir, 'manifest.json'),
    `${JSON.stringify({ ...manifestBody, contentHash: packed.manifest.contentHash })}\n`,
    'utf8',
  );
  await writeFile(
    resolve(outDir, 'turkey-road-overview-low.json'),
    JSON.stringify({
      v: packed.overviewLow.v,
      id: packed.overviewLow.id,
      sourcePackageHash: packed.overviewLow.sourcePackageHash,
      runtimeTransformVersion: packed.overviewLow.runtimeTransformVersion,
      quantization: packed.overviewLow.quantization,
      edgeCount: packed.overviewLow.edgeCount,
      vertexCount: packed.overviewLow.vertexCount,
      styles: packed.overviewLow.styles,
      contentHash: packed.overviewLow.contentHash,
    }),
    'utf8',
  );
  await writeFile(
    resolve(outDir, 'roadChunkRegistry.ts'),
    emitRoadChunkRegistrySource(packed.chunks.map((chunk) => chunk.id)),
    'utf8',
  );
  const sizes = {
    low: packed.manifest.chunks.filter((c) => c.lod === 'NETWORK_LOW').reduce((s, c) => s + c.byteSize, 0),
    medium: packed.manifest.chunks.filter((c) => c.lod === 'NETWORK_MEDIUM').reduce((s, c) => s + c.byteSize, 0),
    high: packed.manifest.chunks.filter((c) => c.lod === 'NETWORK_HIGH').reduce((s, c) => s + c.byteSize, 0),
    manifest: Buffer.byteLength(JSON.stringify(packed.manifest), 'utf8'),
  };
  return { ...packed, sizes };
}

async function main() {
  const packed = await packTurkeyRoadRuntimeFromDisk();
  const bytes = packed.manifest.chunks.map((c) => c.byteSize).sort((a, b) => a - b);
  const median = bytes.length ? bytes[Math.floor(bytes.length / 2)] : 0;
  console.log(
    JSON.stringify(
      {
        decision: 'STEP_2F_PACKED_ROAD_RUNTIME',
        sourceHash: packed.manifest.sourcePackageHash,
        runtimeHash: packed.manifest.contentHash,
        chunks: packed.chunks.length,
        perLod: {
          low: packed.manifest.chunks.filter((c) => c.lod === 'NETWORK_LOW').length,
          medium: packed.manifest.chunks.filter((c) => c.lod === 'NETWORK_MEDIUM').length,
          high: packed.manifest.chunks.filter((c) => c.lod === 'NETWORK_HIGH').length,
        },
        sizes: packed.sizes,
        largestChunk: bytes[bytes.length - 1] ?? 0,
        medianChunk: median,
        overviewBytes: packed.manifest.overviewLow?.byteSize ?? packed.sizes.low,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  void main();
}
