import type { MapV2TransportMode } from '../domain/transport';
import type { ProjectedBoundingBox } from '../geo/webMercator';
import type {
  CityTransportAccess,
  CountryCityTransportAccessPackageV1,
  CountryInfrastructurePackageV1,
  CountryTransportManifestV1,
  GeoTransportEdgeRecord,
  GeoTransportNetworkPackageV1,
  GeoTransportNodeRecord,
  TransportNetworkLod,
} from '../geo/transportNetwork';
import { edgeVisibleAtLod, TRANSPORT_NETWORK_SCHEMA_VERSION, WEB_MERCATOR_TRANSPORT_PROJECTION } from '../geo/transportNetwork';
import { boundsIntersect, inflateProjectedLine, projectedLineBounds } from '../geo/transportGeometry';
import { toRenderableEdge, type TransportRenderableEdge } from '../presentation/transportPaint';
import { getRoadRuntimeManifest, getVisibleRoadRuntimeEdges, findRoadRuntimeNode } from './roadChunkLoader';
import { WEB_MERCATOR_PROJECTION_VERSION } from '../geo/webMercator';
import type { RailConnectivityQaV1, RailDebugViewV1, RailRuntimeManifestV1 } from '../geo/railRuntime';
import type { SeaDebugViewV1, SeaRuntimeManifestV1 } from '../geo/maritimeRuntime';

/* Bundled DEV packages. Not a production MapData release. Metro requires static paths. */
/* eslint-disable @typescript-eslint/no-require-imports */
const TRANSPORT_JSON_MODULES = {
  'turkeyTransportManifest.json': require('../generated/transport/turkeyTransportManifest.json'),
  'turkey-rail-runtime-manifest.json': require('../generated/transport/turkey-rail-runtime-manifest.json'),
  'turkey-rail-debug.json': require('../generated/transport/turkey-rail-debug.json'),
  'turkey-rail-connectivity-qa.json': require('../generated/transport/turkey-rail-connectivity-qa.json'),
  'turkey-sea-runtime-manifest.json': require('../generated/transport/turkey-sea-runtime-manifest.json'),
  'turkey-sea-debug.json': require('../generated/transport/turkey-sea-debug.json'),
  'turkey-air-network.json': require('../generated/transport/turkey-air-network.json'),
  'turkey-infrastructure.json': require('../generated/transport/turkey-infrastructure.json'),
  'turkey-city-access.json': require('../generated/transport/turkey-city-access.json'),
} as const;
/* eslint-enable @typescript-eslint/no-require-imports */

type TransportJsonFile = keyof typeof TRANSPORT_JSON_MODULES;

const NETWORK_FILE: Record<Exclude<MapV2TransportMode, 'ROAD' | 'RAIL' | 'SEA'>, TransportJsonFile> = {
  AIR: 'turkey-air-network.json',
};

let manifestCache: CountryTransportManifestV1 | null = null;
const networkCache = new Map<string, GeoTransportNetworkPackageV1>();
let accessCache: CountryCityTransportAccessPackageV1 | null = null;
let infraCache: CountryInfrastructurePackageV1 | null = null;

let seaRuntimeCache: SeaRuntimeManifestV1 | null = null;
let seaDebugCache: SeaDebugViewV1 | null = null;
let railRuntimeCache: RailRuntimeManifestV1 | null = null;
let railDebugCache: RailDebugViewV1 | null = null;

export function getSeaRuntimeManifest(): SeaRuntimeManifestV1 {
  if (seaRuntimeCache) return seaRuntimeCache;
  seaRuntimeCache = loadJson<SeaRuntimeManifestV1>('turkey-sea-runtime-manifest.json');
  return seaRuntimeCache;
}

export function getSeaDebugView(): SeaDebugViewV1 {
  if (seaDebugCache) return seaDebugCache;
  seaDebugCache = loadJson<SeaDebugViewV1>('turkey-sea-debug.json');
  return seaDebugCache;
}

function loadJson<T>(rel: TransportJsonFile): T {
  return TRANSPORT_JSON_MODULES[rel] as T;
}

export function getRailRuntimeManifest(): RailRuntimeManifestV1 {
  if (railRuntimeCache) return railRuntimeCache;
  const loaded = loadJson<RailRuntimeManifestV1>('turkey-rail-runtime-manifest.json');
  railRuntimeCache = loaded;
  return loaded;
}

export function getRailDebugView(): RailDebugViewV1 {
  if (railDebugCache) return railDebugCache;
  const loaded = loadJson<RailDebugViewV1>('turkey-rail-debug.json');
  railDebugCache = loaded;
  return loaded;
}

let railQaCache: RailConnectivityQaV1 | null = null;

export function getRailConnectivityQa(): RailConnectivityQaV1 {
  if (railQaCache) return railQaCache;
  const loaded = loadJson<RailConnectivityQaV1>('turkey-rail-connectivity-qa.json');
  railQaCache = loaded;
  return loaded;
}

export function getTurkeyTransportManifest(): CountryTransportManifestV1 {
  if (manifestCache) return manifestCache;
  const loaded: CountryTransportManifestV1 = loadJson('turkeyTransportManifest.json');
  manifestCache = loaded;
  return loaded;
}

function roadRuntimeAsNetworkPackage(): GeoTransportNetworkPackageV1 {
  const runtime = getRoadRuntimeManifest();
  const sourceManifest = {
    policyVersion: 1 as const,
    datasetId: runtime.provenanceRef.sourceManifestDatasetId,
    datasetType: 'road-network' as const,
    sourceName: 'OpenStreetMap-derived Türkiye roads (runtime chunks)',
    sourceURL: 'https://www.openstreetmap.org/copyright',
    license: runtime.provenanceRef.license,
    licenseURL: 'https://opendatacommons.org/licenses/odbl/1-0/',
    sourceVersion: 'runtime-chunks',
    retrievedAt: 'runtime',
    sourceHash: runtime.sourcePackageHash,
    originalFormat: 'GeoTransportNetworkPackageV1',
    processedFormat: 'RoadRuntimeManifestV1',
    processingVersion: runtime.runtimeTransformVersion,
    derivedFrom: [runtime.sourcePackageHash],
    attributionRequired: true,
    productionApproved: false,
    notes: runtime.provenanceRef.notes,
  };
  return {
    schemaVersion: TRANSPORT_NETWORK_SCHEMA_VERSION,
    packageId: runtime.provenanceRef.packageId,
    contentHash: runtime.sourcePackageHash,
    geoCountryId: 'country.tur',
    mode: 'ROAD',
    sourceStatus: 'PROTOTYPE',
    projection: WEB_MERCATOR_TRANSPORT_PROJECTION,
    sourceManifest,
    transformation: {
      processingVersion: runtime.runtimeTransformVersion,
      projectionVersion: WEB_MERCATOR_PROJECTION_VERSION,
      simplificationVersion: 'runtime-chunks',
      filtersApplied: [],
      lodPolicyId: runtime.lodSemantics,
      quantize: runtime.quantization,
    },
    nodes: [],
    edges: [],
    stats: {
      nodeCount: runtime.totalCounts.sourceNodes,
      edgeCount: runtime.totalCounts.sourceEdges,
      componentCount: 0,
    },
    productionApproved: false,
  };
}

function railRuntimeAsNetworkPackage(): GeoTransportNetworkPackageV1 {
  const runtime = getRailRuntimeManifest();
  return {
    schemaVersion: TRANSPORT_NETWORK_SCHEMA_VERSION,
    packageId: runtime.packageId,
    contentHash: runtime.sourcePackageHash,
    geoCountryId: 'country.tur',
    mode: 'RAIL',
    sourceStatus: 'PROTOTYPE',
    projection: WEB_MERCATOR_TRANSPORT_PROJECTION,
    sourceManifest: runtime.sourceManifest,
    transformation: runtime.transformation,
    nodes: [],
    edges: [],
    stats: {
      nodeCount: runtime.stats.nodeCount,
      edgeCount: runtime.stats.edgeCount,
      componentCount: runtime.connectivity.componentCount,
    },
    productionApproved: false,
  };
}

function seaRuntimeAsNetworkPackage(): GeoTransportNetworkPackageV1 {
  const runtime = getSeaRuntimeManifest();
  return {
    schemaVersion: TRANSPORT_NETWORK_SCHEMA_VERSION,
    packageId: runtime.packageId,
    contentHash: runtime.sourcePackageHash,
    geoCountryId: 'country.tur',
    mode: 'SEA',
    sourceStatus: 'PROTOTYPE',
    projection: WEB_MERCATOR_TRANSPORT_PROJECTION,
    sourceManifest: runtime.sourceManifest,
    transformation: {
      processingVersion: runtime.processingVersion,
      projectionVersion: WEB_MERCATOR_PROJECTION_VERSION,
      simplificationVersion: runtime.graphPolicyVersion,
      filtersApplied: [runtime.landMaskVersion],
      lodPolicyId: 'maritime-coarse-plus-straits-v1',
      quantize: 100000,
    },
    nodes: [],
    edges: [],
    stats: {
      nodeCount: runtime.stats.nodeCount,
      edgeCount: runtime.stats.edgeCount,
      componentCount: runtime.stats.componentCount,
    },
    productionApproved: false,
  };
}

export function getTransportNetwork(geoCountryId: string, mode: MapV2TransportMode, _lod?: TransportNetworkLod): GeoTransportNetworkPackageV1 | null {
  if (geoCountryId !== 'country.tur') return null;
  if (mode === 'ROAD') {
    if (!networkCache.has('ROAD')) {
      networkCache.set('ROAD', roadRuntimeAsNetworkPackage());
    }
    return networkCache.get('ROAD') ?? null;
  }
  if (mode === 'RAIL') {
    if (!networkCache.has('RAIL')) {
      networkCache.set('RAIL', railRuntimeAsNetworkPackage());
    }
    return networkCache.get('RAIL') ?? null;
  }
  if (mode === 'SEA') {
    if (!networkCache.has('SEA')) {
      networkCache.set('SEA', seaRuntimeAsNetworkPackage());
    }
    return networkCache.get('SEA') ?? null;
  }
  const key = mode;
  if (!networkCache.has(key)) {
    const loaded: GeoTransportNetworkPackageV1 = loadJson(NETWORK_FILE[mode]);
    networkCache.set(key, loaded);
  }
  return networkCache.get(key) ?? null;
}

export function getTransportNode(nodeId: string): GeoTransportNodeRecord | null {
  const runtime = findRoadRuntimeNode(nodeId);
  if (runtime) {
    return {
      nodeId: runtime.topologyKey,
      mode: 'ROAD',
      kind: 'ROAD_JUNCTION',
      geoCountryId: 'country.tur',
      sourceMetadata: { chunkId: runtime.chunkId, runtimeOnly: true },
    };
  }
  const railStation = getRailDebugView().stations.find((row) => row.nodeId === nodeId);
  if (railStation) {
    return {
      nodeId: railStation.nodeId,
      mode: 'RAIL',
      kind: railStation.kind === 'RAIL_TERMINAL' ? 'RAIL_TERMINAL' : 'RAIL_STATION',
      geoCountryId: 'country.tur',
      projected: { x: railStation.x, y: railStation.y },
      sourceMetadata: { debugOnly: true, associated: railStation.associated, stationName: railStation.name },
    };
  }
  for (const mode of ['SEA', 'AIR'] as MapV2TransportMode[]) {
    const network = getTransportNetwork('country.tur', mode);
    const node = network?.nodes.find((item) => item.nodeId === nodeId);
    if (node) return node;
  }
  return null;
}

export function getCityTransportAccessPackage(): CountryCityTransportAccessPackageV1 {
  if (accessCache) return accessCache;
  const loaded: CountryCityTransportAccessPackageV1 = loadJson('turkey-city-access.json');
  accessCache = loaded;
  return loaded;
}

export function getCityTransportAccess(geoCityId: string, mode: MapV2TransportMode): CityTransportAccess | undefined {
  return getCityTransportAccessPackage().accesses.find((row) => row.geoCityId === geoCityId && row.mode === mode);
}

export function getTurkeyInfrastructurePackage(): CountryInfrastructurePackageV1 {
  if (infraCache) return infraCache;
  const loaded: CountryInfrastructurePackageV1 = loadJson('turkey-infrastructure.json');
  infraCache = loaded;
  return loaded;
}

export function getVisibleTransportEdges(
  geoCountryId: string,
  mode: MapV2TransportMode,
  viewport: ProjectedBoundingBox,
  lod: TransportNetworkLod,
): TransportRenderableEdge[] {
  if (mode === 'SEA' || mode === 'AIR') return [];
  if (mode === 'ROAD') {
    return getVisibleRoadRuntimeEdges(viewport, lod, true);
  }
  if (mode === 'RAIL') {
    const debug = getRailDebugView();
    const out: TransportRenderableEdge[] = [];
    for (const edge of debug.edges) {
      if (!edgeVisibleAtLod(edge.networkLod, lod)) continue;
      const bounds = projectedLineBounds(inflateProjectedLine(edge.projectedQuantized, debug.quantize));
      if (!bounds || !boundsIntersect(bounds, viewport)) continue;
      out.push({
        edgeId: edge.edgeId,
        mode: 'RAIL',
        projectedGeometry: edge.projectedQuantized,
        styleClass: edge.styleClass,
        quantizeScale: debug.quantize,
      });
    }
    return out;
  }
  const network = getTransportNetwork(geoCountryId, mode, lod);
  if (!network || network.sourceStatus === 'SOURCE_PENDING' || network.edges.length === 0) {
    return [];
  }
  const out: TransportRenderableEdge[] = [];
  for (const edge of network.edges) {
    if (!edgeVisibleAtLod(edge.networkLod, lod)) continue;
    const bounds = projectedLineBounds(inflateProjectedLine(edge.geometry.projectedQuantized, network.transformation.quantize));
    if (!bounds || !boundsIntersect(bounds, viewport)) continue;
    out.push(toRenderableEdge(edge.edgeId, edge.mode, edge.geometry.projectedQuantized, edge.attributes, network.transformation.quantize));
  }
  return out;
}

export function getLodTransportEdges(
  geoCountryId: string,
  mode: MapV2TransportMode,
  lod: TransportNetworkLod,
): TransportRenderableEdge[] {
  if (mode === 'SEA' || mode === 'AIR') return [];
  if (mode === 'ROAD') {
    const coverage = getRoadRuntimeManifest().coverage;
    return getVisibleRoadRuntimeEdges(coverage, lod, false);
  }
  if (mode === 'RAIL') {
    const debug = getRailDebugView();
    return debug.edges
      .filter((edge) => edgeVisibleAtLod(edge.networkLod, lod))
      .map((edge) => ({
        edgeId: edge.edgeId,
        mode: 'RAIL' as const,
        projectedGeometry: edge.projectedQuantized,
        styleClass: edge.styleClass,
        quantizeScale: debug.quantize,
      }));
  }
  const network = getTransportNetwork(geoCountryId, mode, lod);
  if (!network || network.sourceStatus === 'SOURCE_PENDING' || network.edges.length === 0) {
    return [];
  }
  return network.edges
    .filter((edge) => edgeVisibleAtLod(edge.networkLod, lod))
    .map((edge) =>
      toRenderableEdge(edge.edgeId, edge.mode, edge.geometry.projectedQuantized, edge.attributes, network.transformation.quantize),
    );
}

export function listModeStatuses(): CountryTransportManifestV1['modes'] {
  return getTurkeyTransportManifest().modes;
}

export function assertNoLiveOsmFetch(): true {
  return true;
}

export type { GeoTransportEdgeRecord, GeoTransportNodeRecord };
