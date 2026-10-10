import type { GeoCityId, GeoInfrastructureId, GeoTransportEdgeId, GeoTransportNodeId, GeometryRef, ProvenanceRef } from './ids';

export const MAP_V2_TRANSPORT_MODES = ['ROAD', 'RAIL', 'SEA', 'AIR'] as const;
export type MapV2TransportMode = (typeof MAP_V2_TRANSPORT_MODES)[number];

export type GeoTransportNodeKind =
  | 'ROAD_JUNCTION'
  | 'CITY_ACCESS'
  | 'BORDER_CROSSING'
  | 'RAIL_JUNCTION'
  | 'RAIL_STATION'
  | 'RAIL_TERMINAL'
  | 'PORT'
  | 'SEA_WAYPOINT'
  | 'ANCHORAGE'
  | 'AIRPORT'
  | 'AIR_WAYPOINT'
  | 'INTERMODAL_HUB';

export interface GeoTransportNode {
  nodeId: GeoTransportNodeId;
  kind: GeoTransportNodeKind;
  geoCityId?: GeoCityId;
  geoInfrastructureId?: GeoInfrastructureId;
  provenanceRef: ProvenanceRef;
  productionApproved: boolean;
}

export interface GeoTransportEdge {
  edgeId: GeoTransportEdgeId;
  mode: MapV2TransportMode;
  fromNodeId: GeoTransportNodeId;
  toNodeId: GeoTransportNodeId;
  geometryRef?: GeometryRef;
  /** Not authoritative until derived/verified. Do not copy ROUTES.distanceKm here. */
  distanceMeters?: number;
  travelMetadata?: Record<string, string | number>;
  provenanceRef: ProvenanceRef;
  productionApproved: boolean;
}

export interface GeographicTransportNetwork {
  networkId: string;
  mode?: MapV2TransportMode;
  nodeIds: GeoTransportNodeId[];
  edgeIds: GeoTransportEdgeId[];
  provenanceRef: ProvenanceRef;
  productionApproved: boolean;
}

/**
 * Future playable/optimized graph. Must keep source IDs; must not equal GeoTransportNetwork.
 */
export interface GameplayTransportGraph {
  graphId: string;
  edgeIds: string[];
  geoNetworkEdgeIds?: GeoTransportEdgeId[];
  notes?: string;
}

export interface GameplayLocationRefCity {
  kind: 'CITY';
  gameplayCityId: string;
}

export interface GameplayLocationRefInfrastructure {
  kind: 'INFRASTRUCTURE';
  playerInfrastructureId: string;
}

export interface GameplayLocationRefHub {
  kind: 'HUB';
  hubId: string;
}

export type GameplayLocationRef =
  | GameplayLocationRefCity
  | GameplayLocationRefInfrastructure
  | GameplayLocationRefHub;

/** Future shipment contract only — not a live Delivery replacement. */
export interface ShipmentLegDraft {
  mode: MapV2TransportMode;
  fromLocation: GameplayLocationRef;
  toLocation: GameplayLocationRef;
  originNodeId?: GeoTransportNodeId;
  destinationNodeId?: GeoTransportNodeId;
  networkEdgeIds?: GeoTransportEdgeId[];
  transportAssetRef?: string;
  startAt?: number;
  arrivalAt?: number;
  routeRef?: string;
}

export interface ShipmentRouteDraft {
  legs: ShipmentLegDraft[];
}
