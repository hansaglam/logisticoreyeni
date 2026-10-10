import { createHash } from 'node:crypto';

import { inflateProjectedLine, projectedLineBounds, quantizeProjectedPoint } from '../../src/mapV2/geo/transportGeometry';
import { simplifyOpenPolyline } from '../../src/mapV2/geo/simplifyPolyline';
import type { GeoTransportEdgeRecord, GeoTransportNetworkPackageV1 } from '../../src/mapV2/geo/transportNetwork';
import { styleClassFromAttributes } from '../../src/mapV2/presentation/transportPaint';
import {
  ROAD_CHUNK_GRID,
  ROAD_EDGE_ID_PREFIX,
  ROAD_NODE_ID_PREFIX,
  ROAD_OVERVIEW_SIMPLIFY,
  ROAD_RUNTIME_LOD_SEMANTICS,
  ROAD_RUNTIME_SCHEMA_VERSION,
  ROAD_RUNTIME_TRANSFORM_VERSION,
  ROAD_STYLE_CODE,
  cellForPoint,
  chunkFileName,
  deltaEncodeQuantized,
  lodShortName,
  makeChunkId,
  type RoadOverviewLowV1,
  type RoadRuntimeChunkManifestEntry,
  type RoadRuntimeChunkV1,
  type RoadRuntimeManifestV1,
  type RoadStyleCode,
} from '../../src/mapV2/geo/roadRuntimePackage';
import type { ProjectedBoundingBox } from '../../src/mapV2/geo/webMercator';

export function hashCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function styleCodeForEdge(edge: GeoTransportEdgeRecord): RoadStyleCode | null {
  const style = styleClassFromAttributes('ROAD', edge.attributes);
  if (style === 'ROAD_MOTORWAY') return ROAD_STYLE_CODE.ROAD_MOTORWAY;
  if (style === 'ROAD_TRUNK') return ROAD_STYLE_CODE.ROAD_TRUNK;
  if (style === 'ROAD_PRIMARY') return ROAD_STYLE_CODE.ROAD_PRIMARY;
  if (style === 'ROAD_SECONDARY') return ROAD_STYLE_CODE.ROAD_SECONDARY;
  return null;
}

function compactEdgeId(edgeId: string): string {
  return edgeId.startsWith(ROAD_EDGE_ID_PREFIX) ? edgeId.slice(ROAD_EDGE_ID_PREFIX.length) : edgeId;
}

function compactNodeKey(nodeId: string): string {
  return nodeId.startsWith(ROAD_NODE_ID_PREFIX) ? nodeId.slice(ROAD_NODE_ID_PREFIX.length) : nodeId;
}

function unionBounds(a: ProjectedBoundingBox, b: ProjectedBoundingBox): ProjectedBoundingBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

type Bucket = {
  id: string;
  lod: GeoTransportNetworkPackageV1['edges'][number]['networkLod'];
  col: number;
  row: number;
  edges: GeoTransportEdgeRecord[];
  bounds: ProjectedBoundingBox | null;
};

export type PackedRoadRuntime = {
  manifest: RoadRuntimeManifestV1;
  chunks: RoadRuntimeChunkV1[];
  coverage: ProjectedBoundingBox;
  overviewLow: RoadOverviewLowV1;
};

export function packRoadRuntime(source: GeoTransportNetworkPackageV1): PackedRoadRuntime {
  const quantize = source.transformation.quantize;
  let coverage: ProjectedBoundingBox | null = null;
  const edgeBounds = new Map<string, ProjectedBoundingBox>();
  for (const edge of source.edges) {
    const bounds = projectedLineBounds(inflateProjectedLine(edge.geometry.projectedQuantized, quantize));
    if (!bounds) continue;
    edgeBounds.set(edge.edgeId, bounds);
    coverage = coverage ? unionBounds(coverage, bounds) : bounds;
  }
  if (!coverage) {
    throw new Error('ROAD source package has no projectable edges');
  }
  const padX = (coverage.maxX - coverage.minX) * 0.002;
  const padY = (coverage.maxY - coverage.minY) * 0.002;
  coverage = {
    minX: coverage.minX - padX,
    minY: coverage.minY - padY,
    maxX: coverage.maxX + padX,
    maxY: coverage.maxY + padY,
  };

  const buckets = new Map<string, Bucket>();
  for (const edge of source.edges) {
    const bounds = edgeBounds.get(edge.edgeId);
    if (!bounds) continue;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const { col, row } = cellForPoint(cx, cy, coverage, edge.networkLod);
    const id = makeChunkId(edge.networkLod, col, row);
    const bucket = buckets.get(id) ?? {
      id,
      lod: edge.networkLod,
      col,
      row,
      edges: [],
      bounds: null,
    };
    bucket.edges.push(edge);
    bucket.bounds = bucket.bounds ? unionBounds(bucket.bounds, bounds) : bounds;
    buckets.set(id, bucket);
  }

  const chunks: RoadRuntimeChunkV1[] = [...buckets.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((bucket) => {
      const nodeIndex = new Map<string, number>();
      const nodes: string[] = [];
      const intern = (nodeId: string): number => {
        const key = compactNodeKey(nodeId);
        const existing = nodeIndex.get(key);
        if (existing != null) return existing;
        const idx = nodes.length;
        nodeIndex.set(key, idx);
        nodes.push(key);
        return idx;
      };
      const compactEdges: RoadRuntimeChunkV1['e'] = bucket.edges
        .slice()
        .sort((a, b) => a.edgeId.localeCompare(b.edgeId))
        .map((edge) => {
          const code = styleCodeForEdge(edge);
          if (code == null) {
            throw new Error(`Unsupported runtime style for ${edge.edgeId}`);
          }
          const encoded = deltaEncodeQuantized(edge.geometry.projectedQuantized);
          return [compactEdgeId(edge.edgeId), code, intern(edge.fromNodeId), intern(edge.toNodeId), ...encoded];
        });
      const bounds = bucket.bounds!;
      return {
        v: ROAD_RUNTIME_SCHEMA_VERSION,
        id: bucket.id,
        lod: bucket.lod,
        b: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
        n: nodes,
        e: compactEdges,
      };
    });

  const entries: RoadRuntimeChunkManifestEntry[] = chunks.map((chunk) => {
    const body = {
      v: chunk.v,
      id: chunk.id,
      lod: chunk.lod,
      b: chunk.b,
      n: chunk.n,
      e: chunk.e,
    };
    const json = JSON.stringify(body);
    return {
      id: chunk.id,
      lod: chunk.lod,
      bounds: { minX: chunk.b[0], minY: chunk.b[1], maxX: chunk.b[2], maxY: chunk.b[3] },
      file: chunkFileName(chunk.id),
      byteSize: Buffer.byteLength(json, 'utf8'),
      edgeCount: chunk.e.length,
      vertexCount: chunk.e.reduce((sum, row) => sum + Math.floor((row.length - 4) / 2), 0),
      nodeCount: chunk.n.length,
      contentHash: hashCanonical(body),
    };
  });

  const edgesLow = source.edges.filter((e) => e.networkLod === 'NETWORK_LOW').length;
  const edgesMediumAdditional = source.edges.filter((e) => e.networkLod === 'NETWORK_MEDIUM').length;
  const edgesHighAdditional = source.edges.filter((e) => e.networkLod === 'NETWORK_HIGH').length;

  const manifestBody = {
    schemaVersion: ROAD_RUNTIME_SCHEMA_VERSION,
    countryId: 'country.tur' as const,
    sourcePackageHash: source.contentHash,
    runtimeTransformVersion: ROAD_RUNTIME_TRANSFORM_VERSION,
    projection: 'WEB_MERCATOR' as const,
    quantization: quantize,
    lodSemantics: ROAD_RUNTIME_LOD_SEMANTICS,
    nodePolicy: 'CHUNK_LOCAL_INTERNED_BOUNDARY_DUPLICATE' as const,
    coverage,
    grid: ROAD_CHUNK_GRID,
    lods: ['NETWORK_LOW', 'NETWORK_MEDIUM', 'NETWORK_HIGH'] as RoadRuntimeManifestV1['lods'],
    chunks: entries,
    totalCounts: {
      sourceNodes: source.stats.nodeCount,
      sourceEdges: source.stats.edgeCount,
      runtimeEdges: entries.reduce((sum, row) => sum + row.edgeCount, 0),
      edgesLow,
      edgesMediumAdditional,
      edgesHighAdditional,
    },
    provenanceRef: {
      packageId: source.packageId,
      sourceStatus: 'PROTOTYPE' as const,
      license: source.sourceManifest.license,
      sourceManifestDatasetId: source.sourceManifest.datasetId,
      notes: 'Runtime chunks compact projected geometry only. Canonical WGS84 remains in the ingest build artifact.',
    },
    overviewLow: undefined as RoadRuntimeManifestV1['overviewLow'],
  };
  const overviewLow = packRoadOverviewLow(source);
  const overviewJson = JSON.stringify({
    v: overviewLow.v,
    id: overviewLow.id,
    sourcePackageHash: overviewLow.sourcePackageHash,
    runtimeTransformVersion: overviewLow.runtimeTransformVersion,
    quantization: overviewLow.quantization,
    edgeCount: overviewLow.edgeCount,
    vertexCount: overviewLow.vertexCount,
    styles: overviewLow.styles,
  });
  manifestBody.overviewLow = {
    file: 'turkey-road-overview-low.json',
    byteSize: Buffer.byteLength(overviewJson, 'utf8'),
    edgeCount: overviewLow.edgeCount,
    vertexCount: overviewLow.vertexCount,
    contentHash: overviewLow.contentHash,
  };
  const manifest: RoadRuntimeManifestV1 = { ...manifestBody, contentHash: hashCanonical(manifestBody) };
  return { manifest, chunks, coverage, overviewLow };
}

export function packRoadOverviewLow(source: GeoTransportNetworkPackageV1): RoadOverviewLowV1 {
  const quantize = source.transformation.quantize;
  const grouped = new Map<RoadStyleCode, number[][]>();
  let edgeCount = 0;
  let vertexCount = 0;
  for (const edge of source.edges) {
    if (edge.networkLod !== 'NETWORK_LOW') continue;
    const code = styleCodeForEdge(edge);
    if (code == null) continue;
    const inflated = inflateProjectedLine(edge.geometry.projectedQuantized, quantize);
    const simplified = simplifyOpenPolyline(inflated, ROAD_OVERVIEW_SIMPLIFY);
    if (simplified.length < 2) continue;
    const quantized = simplified.flatMap((p) => quantizeProjectedPoint(p, quantize));
    const encoded = deltaEncodeQuantized(quantized);
    const list = grouped.get(code) ?? [];
    list.push(encoded);
    grouped.set(code, list);
    edgeCount += 1;
    vertexCount += simplified.length;
  }
  const styles = [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, p]) => ({ c, p }));
  const body = {
    v: ROAD_RUNTIME_SCHEMA_VERSION,
    id: 'road.overview.low' as const,
    sourcePackageHash: source.contentHash,
    runtimeTransformVersion: ROAD_RUNTIME_TRANSFORM_VERSION,
    quantization: quantize,
    edgeCount,
    vertexCount,
    styles,
  };
  return { ...body, contentHash: hashCanonical(body) };
}

export function emitRoadChunkRegistrySource(chunkIds: string[]): string {
  const lines = [
    '/* Auto-generated by pack-turkey-road-runtime.ts. Metro-safe lazy require. Do not edit. */',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    'import type { RoadRuntimeChunkV1 } from \'../../../geo/roadRuntimePackage\';',
    '',
    'export const ROAD_CHUNK_REGISTRY: Record<string, () => RoadRuntimeChunkV1> = {',
  ];
  for (const id of chunkIds) {
    const lod = id.split('.')[1];
    lines.push(`  '${id}': () => require('./${lod}/${id}.json') as RoadRuntimeChunkV1,`);
  }
  lines.push('};');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function lodDirName(lod: PackedRoadRuntime['chunks'][number]['lod']): string {
  return lodShortName(lod);
}
