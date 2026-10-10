import type { GeoCityRecord } from './cityPackage';
import type { CityTransportAccess, CityTransportAccessStatus, GeoTransportNodeRecord } from './transportNetwork';
import type { MapV2TransportMode } from '../domain/transport';

export type CityAccessCandidate = {
  geoCityId: string;
  mode: MapV2TransportMode;
  nodeId: string;
  projectedDistance: number;
};

function cloneCity(city: GeoCityRecord): GeoCityRecord {
  return JSON.parse(JSON.stringify(city)) as GeoCityRecord;
}

/**
 * Propose nearest nodes. Never writes VERIFIED. Never mutates the city record.
 */
export function proposeCityTransportAccess(
  city: GeoCityRecord,
  mode: MapV2TransportMode,
  nodes: GeoTransportNodeRecord[],
  limit = 3,
): { cityUnchanged: GeoCityRecord; candidates: CityAccessCandidate[] } {
  const before = JSON.stringify(city);
  const withCoords = nodes.filter((node) => node.mode === mode && node.projected);
  const candidates = withCoords
    .map((node) => ({
      geoCityId: city.geoCityId,
      mode,
      nodeId: node.nodeId,
      projectedDistance: Math.hypot(node.projected!.x - city.projected.x, node.projected!.y - city.projected.y),
    }))
    .sort((a, b) => a.projectedDistance - b.projectedDistance)
    .slice(0, limit);
  const after = JSON.stringify(city);
  if (before !== after) {
    throw new Error('proposeCityTransportAccess mutated GeoCity');
  }
  return { cityUnchanged: cloneCity(city), candidates };
}

export function unresolvedCityAccess(geoCityId: string, mode: MapV2TransportMode): CityTransportAccess {
  return {
    geoCityId,
    mode,
    accessNodeIds: [],
    status: 'UNRESOLVED',
    notes: 'No verified access node. Nearest-node helpers may only propose candidates.',
  };
}

export function accessStatusOrUnresolved(row: CityTransportAccess | undefined): CityTransportAccessStatus {
  return row?.status ?? 'UNRESOLVED';
}
