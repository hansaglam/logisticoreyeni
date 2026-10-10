import type { ProjectedBoundingBox } from './webMercator';
import type { TransportNetworkLod } from './transportNetwork';
import { transportLodRank } from './transportNetwork';

export const ROAD_RUNTIME_SCHEMA_VERSION = 1 as const;
export const ROAD_RUNTIME_TRANSFORM_VERSION = 'map-v2-road-runtime-2f-2';
/** Canonical ingest package hash this runtime transform was built against. */
export const ROAD_SOURCE_PACKAGE_HASH_2E =
  'sha256:b506587dfd7e390794a448a0a855b773af640ebfeba316a4ffc86bacf4d45882';

export const ROAD_EDGE_ID_PREFIX = 'te.tur.road.e.';
export const ROAD_NODE_ID_PREFIX = 'tn.tur.road.n.';

/**
 * MEDIUM/HIGH runtime files are *additional* edges, not complete visible sets.
 * Visibility remains LOW ⊂ MEDIUM ⊂ HIGH via layer union at the loader.
 */
export const ROAD_RUNTIME_LOD_SEMANTICS = 'ADDITIONAL_EDGES_CUMULATIVE_VISIBILITY' as const;

export const ROAD_CHUNK_GRID: Record<TransportNetworkLod, { cols: number; rows: number }> = {
  NETWORK_LOW: { cols: 8, rows: 6 },
  NETWORK_MEDIUM: { cols: 12, rows: 9 },
  NETWORK_HIGH: { cols: 16, rows: 12 },
};

export const ROAD_STYLE_CODE = {
  ROAD_MOTORWAY: 0,
  ROAD_TRUNK: 1,
  ROAD_PRIMARY: 2,
  ROAD_SECONDARY: 3,
} as const;

export type RoadStyleCode = (typeof ROAD_STYLE_CODE)[keyof typeof ROAD_STYLE_CODE];

export const ROAD_STYLE_FROM_CODE = ['ROAD_MOTORWAY', 'ROAD_TRUNK', 'ROAD_PRIMARY', 'ROAD_SECONDARY'] as const;

/** LRU: max resident chunks not in the current required set. */
export const ROAD_CACHE_MAX_CHUNKS = 48;
export const ROAD_CACHE_MAX_BYTES = 24 * 1024 * 1024;
export const ROAD_PREFETCH_PAD = 0.04;
export const ROAD_CHUNKS_PER_TICK = 2;
export const ROAD_PATHS_PER_TICK = 2;
/** Relative zoom below this uses the prebaked LOW overview, not spatial chunks. */
export const ROAD_OVERVIEW_MAX_REL_ZOOM = 1.22;
export const ROAD_OVERVIEW_EXIT_REL_ZOOM = 1.14;
/** Render-only Douglas–Peucker in world space (~480 m). Does not change canonical topology. */
export const ROAD_OVERVIEW_SIMPLIFY = 0.000012;

/**
 * AUTO LOD vs relative zoom (camera scale / country fit).
 * Country overview max relative zoom is 1.8; ROAD inspector currently shares that cap.
 * Enter LOW→MEDIUM 1.32, MEDIUM→HIGH 1.62; exit HIGH→MEDIUM 1.48, MEDIUM→LOW 1.18.
 */
export const ROAD_LOD_HYSTERESIS = {
  enterMedium: 1.32,
  exitMedium: 1.18,
  enterHigh: 1.62,
  exitHigh: 1.48,
} as const;

export type RoadRuntimeChunkV1 = {
  v: typeof ROAD_RUNTIME_SCHEMA_VERSION;
  id: string;
  lod: TransportNetworkLod;
  b: [number, number, number, number];
  /** Topology keys interned in this chunk (boundary nodes may repeat across chunks). */
  n: string[];
  /** [edgeHex, styleCode, fromIdx, toIdx, ...deltaQuantized] */
  e: Array<[string, RoadStyleCode, number, number, ...number[]]>;
};

export type RoadRuntimeChunkManifestEntry = {
  id: string;
  lod: TransportNetworkLod;
  bounds: ProjectedBoundingBox;
  file: string;
  byteSize: number;
  edgeCount: number;
  vertexCount: number;
  nodeCount: number;
  contentHash: `sha256:${string}`;
};

export type RoadRuntimeManifestV1 = {
  schemaVersion: typeof ROAD_RUNTIME_SCHEMA_VERSION;
  countryId: 'country.tur';
  sourcePackageHash: `sha256:${string}`;
  runtimeTransformVersion: typeof ROAD_RUNTIME_TRANSFORM_VERSION;
  projection: 'WEB_MERCATOR';
  quantization: number;
  lodSemantics: typeof ROAD_RUNTIME_LOD_SEMANTICS;
  nodePolicy: 'CHUNK_LOCAL_INTERNED_BOUNDARY_DUPLICATE';
  coverage: ProjectedBoundingBox;
  grid: typeof ROAD_CHUNK_GRID;
  lods: TransportNetworkLod[];
  chunks: RoadRuntimeChunkManifestEntry[];
  totalCounts: {
    sourceNodes: number;
    sourceEdges: number;
    runtimeEdges: number;
    edgesLow: number;
    edgesMediumAdditional: number;
    edgesHighAdditional: number;
  };
  provenanceRef: {
    packageId: string;
    sourceStatus: 'PROTOTYPE';
    license: string;
    sourceManifestDatasetId: string;
    notes: string;
  };
  overviewLow?: {
    file: string;
    byteSize: number;
    edgeCount: number;
    vertexCount: number;
    contentHash: `sha256:${string}`;
  };
  contentHash: `sha256:${string}`;
};

export type RoadOverviewLowV1 = {
  v: typeof ROAD_RUNTIME_SCHEMA_VERSION;
  id: 'road.overview.low';
  sourcePackageHash: `sha256:${string}`;
  runtimeTransformVersion: string;
  quantization: number;
  edgeCount: number;
  vertexCount: number;
  styles: Array<{ c: RoadStyleCode; p: number[][] }>;
  contentHash: `sha256:${string}`;
};

export function lodShortName(lod: TransportNetworkLod): 'low' | 'medium' | 'high' {
  if (lod === 'NETWORK_LOW') return 'low';
  if (lod === 'NETWORK_MEDIUM') return 'medium';
  return 'high';
}

export function chunkFileName(chunkId: string): string {
  const lod = chunkId.split('.')[1] as 'low' | 'medium' | 'high';
  return `${lod}/${chunkId}.json`;
}

export function makeChunkId(lod: TransportNetworkLod, col: number, row: number): string {
  return `road.${lodShortName(lod)}.${col}.${row}`;
}

export function cellForPoint(
  x: number,
  y: number,
  coverage: ProjectedBoundingBox,
  lod: TransportNetworkLod,
): { col: number; row: number } {
  const { cols, rows } = ROAD_CHUNK_GRID[lod];
  const spanX = Math.max(coverage.maxX - coverage.minX, 1e-12);
  const spanY = Math.max(coverage.maxY - coverage.minY, 1e-12);
  const col = Math.min(cols - 1, Math.max(0, Math.floor(((x - coverage.minX) / spanX) * cols)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(((y - coverage.minY) / spanY) * rows)));
  return { col, row };
}

export function cumulativeLodLayers(viewLod: TransportNetworkLod): TransportNetworkLod[] {
  return (['NETWORK_LOW', 'NETWORK_MEDIUM', 'NETWORK_HIGH'] as TransportNetworkLod[]).filter(
    (lod) => transportLodRank(lod) <= transportLodRank(viewLod),
  );
}

export function inflateBounds(bounds: ProjectedBoundingBox, pad: number): ProjectedBoundingBox {
  const dx = (bounds.maxX - bounds.minX) * pad;
  const dy = (bounds.maxY - bounds.minY) * pad;
  return {
    minX: bounds.minX - dx,
    minY: bounds.minY - dy,
    maxX: bounds.maxX + dx,
    maxY: bounds.maxY + dy,
  };
}

export function deltaEncodeQuantized(quantized: number[]): number[] {
  if (quantized.length < 2) return quantized.slice();
  const out = [quantized[0], quantized[1]];
  for (let i = 2; i + 1 < quantized.length; i += 2) {
    out.push(quantized[i] - quantized[i - 2], quantized[i + 1] - quantized[i - 1]);
  }
  return out;
}

export function deltaDecodeQuantized(encoded: number[]): number[] {
  if (encoded.length < 2) return encoded.slice();
  const out = [encoded[0], encoded[1]];
  for (let i = 2; i + 1 < encoded.length; i += 2) {
    out.push(out[out.length - 2] + encoded[i], out[out.length - 1] + encoded[i + 1]);
  }
  return out;
}

export function expandEdgeId(hex: string): string {
  return hex.startsWith(ROAD_EDGE_ID_PREFIX) ? hex : `${ROAD_EDGE_ID_PREFIX}${hex}`;
}

export function expandNodeId(topologyKey: string): string {
  return topologyKey.startsWith(ROAD_NODE_ID_PREFIX) ? topologyKey : `${ROAD_NODE_ID_PREFIX}${topologyKey}`;
}
