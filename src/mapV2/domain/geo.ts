import type {
  GeoBoundaryId,
  GeoCityId,
  GeoCountryId,
  GeoInfrastructureId,
  GeoRegionId,
  GeometryRef,
  NameKey,
  ProvenanceRef,
} from './ids';

export type GeoEntityKind =
  | 'country'
  | 'region'
  | 'city'
  | 'infrastructure'
  | 'transport-node'
  | 'transport-edge'
  | 'boundary'
  | 'label';

export interface GeoEntityReference {
  kind: GeoEntityKind;
  id: string;
}

export type GeoRegionKind = 'continent' | 'subregion' | 'gameplay_grouping' | 'visual_grouping';

export interface GeoDisputedDisplayMeta {
  hasDisputedBoundaryMetadata: boolean;
  notes?: string;
}

/**
 * ISO codes must be copied from an approved source at ingest, then validated.
 * Do not invent iso2/iso3 in defaults or tests as if they were geographic truth.
 */
export interface GeoCountry {
  geoCountryId: GeoCountryId;
  iso2?: string;
  iso3?: string;
  nameKey: NameKey;
  boundaryRef?: GeoBoundaryId;
  centroidRef?: GeometryRef;
  regionIds?: GeoRegionId[];
  provenanceRef: ProvenanceRef;
  productionApproved: boolean;
  disputedDisplay?: GeoDisputedDisplayMeta;
}

/** Optional navigation/display grouping. Not required for Türkiye gameplay. */
export interface GeoRegion {
  geoRegionId: GeoRegionId;
  kind: GeoRegionKind;
  nameKey: NameKey;
  childCountryIds?: GeoCountryId[];
  provenanceRef: ProvenanceRef;
  productionApproved: boolean;
}

export interface GeoCity {
  geoCityId: GeoCityId;
  geoCountryId: GeoCountryId;
  nameKey: NameKey;
  coordinateRef?: GeometryRef;
  administrativeAreaRef?: string;
  provenanceRef: ProvenanceRef;
  productionApproved: boolean;
}

export interface GeoBoundary {
  geoBoundaryId: GeoBoundaryId;
  geometryRef: GeometryRef;
  provenanceRef: ProvenanceRef;
  productionApproved: boolean;
}

export interface GeoLabel {
  nameKey: NameKey;
  entity: GeoEntityReference;
  locale?: 'tr' | 'en';
}

export type GeoCoordinateWgs84 = {
  longitude: number;
  latitude: number;
};

export type ProjectedWorldPoint = {
  x: number;
  y: number;
};

export type GeoBoundingBoxWgs84 = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type ProjectedBoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type CoordinateSpace = 'WGS84' | 'PROJECTED_MAP' | 'SCREEN' | 'LEGACY_PNG_NORMALIZED';

export type GeometryKind = 'point' | 'polyline' | 'polygon' | 'multipolygon';
