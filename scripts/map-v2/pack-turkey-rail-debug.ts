import type { CountryCityPackageV1 } from '../../src/mapV2/geo/cityPackage';
import type { CityTransportAccess, GeoTransportNetworkPackageV1, TransportNetworkLod } from '../../src/mapV2/geo/transportNetwork';
import { inflateProjectedLine } from '../../src/mapV2/geo/transportGeometry';
import type { TransportStyleClass } from '../../src/mapV2/presentation/transportPaint';
import { hashCanonical } from './transport-package-factory';

export type RailDebugEdge = {
  edgeId: string;
  networkLod: TransportNetworkLod;
  styleClass: TransportStyleClass;
  projectedQuantized: number[];
};

export type RailDebugStation = {
  nodeId: string;
  kind: 'RAIL_STATION' | 'RAIL_TERMINAL' | 'RAIL_JUNCTION' | 'BORDER_CROSSING';
  x: number;
  y: number;
  name: string | null;
  associated: boolean;
};

export type RailDebugViewV1 = {
  schemaVersion: 1;
  packageId: string;
  contentHash: `sha256:${string}`;
  sourcePackageHash: `sha256:${string}`;
  geoCountryId: 'country.tur';
  mode: 'RAIL';
  quantize: number;
  edges: RailDebugEdge[];
  stations: RailDebugStation[];
  cityAccess: Array<{
    geoCityId: string;
    gameplayCityId?: string;
    status: CityTransportAccess['status'];
    x?: number;
    y?: number;
  }>;
};

export function packRailDebugView(
  network: GeoTransportNetworkPackageV1,
  cityAccess: CityTransportAccess[],
  cities: CountryCityPackageV1,
  styleOf: typeof import('../../src/mapV2/presentation/transportPaint').styleClassFromAttributes,
): RailDebugViewV1 {
  const gameplay = new Map(cities.gameplayMappings.map((row) => [row.geoCityId, row.gameplayCityId]));
  const nodeById = new Map(network.nodes.map((node) => [node.nodeId, node]));
  const edges: RailDebugEdge[] = network.edges.map((edge) => ({
    edgeId: edge.edgeId,
    networkLod: edge.networkLod,
    styleClass: styleOf(edge.mode, edge.attributes),
    projectedQuantized: edge.geometry.projectedQuantized,
  }));
  const stations: RailDebugStation[] = network.nodes
    .filter((node) => node.kind === 'RAIL_STATION' || node.kind === 'RAIL_TERMINAL')
    .map((node) => ({
      nodeId: node.nodeId,
      kind: node.kind,
      x: node.projected?.x ?? 0,
      y: node.projected?.y ?? 0,
      name: typeof node.sourceMetadata.stationName === 'string' ? node.sourceMetadata.stationName : null,
      associated: node.sourceMetadata.associated === true,
    }));
  const access = cityAccess.map((row) => {
    const node = row.accessNodeIds[0] ? nodeById.get(row.accessNodeIds[0]) : undefined;
    return {
      geoCityId: row.geoCityId,
      gameplayCityId: gameplay.get(row.geoCityId),
      status: row.status,
      x: node?.projected?.x,
      y: node?.projected?.y,
    };
  });
  const body = {
    schemaVersion: 1 as const,
    packageId: 'map-v2.country.tur.transport.rail.debug.v1',
    sourcePackageHash: network.contentHash,
    geoCountryId: 'country.tur' as const,
    mode: 'RAIL' as const,
    quantize: network.transformation.quantize,
    edges,
    stations,
    cityAccess: access,
  };
  void inflateProjectedLine;
  return { ...body, contentHash: hashCanonical(body) };
}
