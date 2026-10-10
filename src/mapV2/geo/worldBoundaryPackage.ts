import type { MapSourceManifest } from '../../mapData/mapSourcePolicy';
import type { CountryIdentityRecord, GeometryLodId, ProjectedPolygon } from './geometry';
import type { OmittedPolarFeature, PolarRenderPolicy, WebMercatorLayerStatus } from './polarPolicy';
import type { ProjectedBoundingBox, WebMercatorProjectionMeta } from './webMercator';

export const WORLD_BOUNDARY_PACKAGE_SCHEMA_VERSION = 1 as const;
export const WORLD_BOUNDARY_QUANTIZE = 100000;

export type QuantizedRing = number[];

export type QuantizedPolygon = {
  exterior: QuantizedRing;
  holes: QuantizedRing[];
};

export type WorldCountryLodGeometry = {
  lod: GeometryLodId;
  polygons: QuantizedPolygon[];
  projectedBounds: ProjectedBoundingBox;
  polygonCount: number;
  vertexCount: number;
};

export type WorldCountryRecord = CountryIdentityRecord & {
  webMercatorLayer: WebMercatorLayerStatus;
  lods: Record<GeometryLodId, WorldCountryLodGeometry>;
};

export type WorldBoundaryPackageV1 = {
  schemaVersion: typeof WORLD_BOUNDARY_PACKAGE_SCHEMA_VERSION;
  packageId: string;
  contentHash: `sha256:${string}`;
  projection: WebMercatorProjectionMeta;
  polarRenderPolicy: PolarRenderPolicy;
  sourceCountryCount: number;
  renderedCountryCount: number;
  omittedPolarFeatures: OmittedPolarFeature[];
  sourceManifest: MapSourceManifest;
  transformation: {
    processingVersion: string;
    projectionVersion: number;
    simplificationConfigVersion: string;
    winding: string;
    quantize: number;
    polarRenderPolicy: PolarRenderPolicy;
  };
  unresolvedIdentities: string[];
  countries: WorldCountryRecord[];
};

export type WorldBoundaryBuildMeta = {
  generatedAt: string;
  contentHash: `sha256:${string}`;
  stats: Record<string, number | string>;
};

export function quantizePoint(x: number, y: number, scale = WORLD_BOUNDARY_QUANTIZE): [number, number] {
  return [Math.round(x * scale), Math.round(y * scale)];
}

export function dequantizePoint(qx: number, qy: number, scale = WORLD_BOUNDARY_QUANTIZE): { x: number; y: number } {
  return { x: qx / scale, y: qy / scale };
}

export function quantizePolygons(polygons: ProjectedPolygon[], scale = WORLD_BOUNDARY_QUANTIZE): QuantizedPolygon[] {
  return polygons.map((polygon) => ({
    exterior: flattenRing(polygon.exterior, scale),
    holes: polygon.holes.map((hole) => flattenRing(hole, scale)),
  }));
}

export function dequantizePolygons(
  polygons: QuantizedPolygon[],
  scale = WORLD_BOUNDARY_QUANTIZE,
): ProjectedPolygon[] {
  return polygons.map((polygon) => ({
    exterior: inflateRing(polygon.exterior, scale),
    holes: polygon.holes.map((hole) => inflateRing(hole, scale)),
  }));
}

function flattenRing(ring: { x: number; y: number }[], scale: number): number[] {
  const out: number[] = [];
  for (const p of ring) {
    const [qx, qy] = quantizePoint(p.x, p.y, scale);
    out.push(qx, qy);
  }
  return out;
}

function inflateRing(flat: number[], scale: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push(dequantizePoint(flat[i], flat[i + 1], scale));
  }
  return out;
}
