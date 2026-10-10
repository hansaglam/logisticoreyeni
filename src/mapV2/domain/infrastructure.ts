import type { GameplayCityId, GeoCityId, GeoCountryId, GeoInfrastructureId, GeometryRef, NameKey, ProvenanceRef } from './ids';

export type RealWorldInfrastructureType =
  | 'DEPOT'
  | 'WAREHOUSE'
  | 'RAIL_STATION'
  | 'RAIL_TERMINAL'
  | 'PORT'
  | 'AIRPORT'
  | 'CARGO_TERMINAL'
  | 'INTERMODAL_HUB';

/** Geographic catalog — not player-owned. */
export interface GeoInfrastructure {
  geoInfrastructureId: GeoInfrastructureId;
  infrastructureType: RealWorldInfrastructureType;
  geoCityId?: GeoCityId;
  geoCountryId: GeoCountryId;
  nameKey?: NameKey;
  locationRef: GeometryRef;
  provenanceRef: ProvenanceRef;
  productionApproved: boolean;
}

/**
 * Player-owned facility. Not a Firestore schema yet.
 * Live warehouses continue to use Warehouse.cityId as gameplayCityId.
 */
export interface PlayerInfrastructureDraft {
  playerInfrastructureId: string;
  ownerUid: string;
  geoInfrastructureId?: GeoInfrastructureId | null;
  gameplayCityId?: GameplayCityId | null;
  type: RealWorldInfrastructureType | 'GAMEPLAY_WAREHOUSE';
  level?: number;
  capacity?: number;
  status?: string;
}

/**
 * Live WarehouseType "port" | "airport" is a storage class.
 * It MUST NOT auto-create GeoInfrastructure.
 */
export const LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA = true as const;
