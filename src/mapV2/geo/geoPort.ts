import type { GeoCoordinateWgs84, ProjectedWorldPoint } from './webMercator';
import type {
  PortCapabilityEvidence,
  PortClassification,
  PortLogisticsEligibility,
} from './portClassPolicy';
import type { MaritimeRegionId, PortSeaAccessFailureReason } from './maritimeNavigability';

export const GEO_PORT_SCHEMA_VERSION = 1 as const;
export const OFFICIAL_PORT_QA_STATUS = 'OFFICIAL_PORT_QA_ONLY' as const;

export type PortVerificationStatus = 'VERIFIED' | 'PROVISIONAL' | 'UNRESOLVED';
export type PortCityAssociationType = 'DIRECT' | 'REGIONAL' | 'NONE' | 'UNRESOLVED';
export type PortSeaAccessStatus = 'PROVISIONAL' | 'UNRESOLVED';

export type GeoPortEvidence = {
  osmIds: string[];
  sourceTags: Record<string, string | number | boolean | null>;
  names: string[];
  operator: string | null;
  cargoTags: string[];
  harbourTags: string[];
  terminalTags: string[];
  geometryEvidence: 'POINT' | 'POLYGON' | 'LINE' | 'MIXED';
  officialQaReference: typeof OFFICIAL_PORT_QA_STATUS;
};

export type PortCityAssociation = {
  gameplayCityId: string;
  geoCityId: string;
  associationType: Exclude<PortCityAssociationType, 'NONE'>;
  distanceMeters: number;
  evidence: string;
  portId: string;
};

export type PortSeaAccess = {
  portId: string;
  position: GeoCoordinateWgs84;
  projected: ProjectedWorldPoint;
  status: PortSeaAccessStatus;
  evidence: string;
  failureReason: PortSeaAccessFailureReason | null;
  maritimeRegion: MaritimeRegionId | null;
  graphNodeId: string | null;
  searchRadiusMeters: number | null;
  failureStage: 'LOCAL' | 'TRUNK' | null;
  approachKind: 'TRUNK' | 'LOCAL' | null;
};

export type GeoPort = {
  id: string;
  geoCountryId: 'country.tur';
  displayName: string;
  sourceName: string | null;
  position: GeoCoordinateWgs84;
  projected: ProjectedWorldPoint;
  bounds: { west: number; south: number; east: number; north: number } | null;
  classification: PortClassification;
  logisticsEligibility: PortLogisticsEligibility;
  sourceIds: string[];
  provenance: {
    license: 'ODbL 1.0';
    sourceProvider: 'OpenStreetMap';
    officialQa: typeof OFFICIAL_PORT_QA_STATUS;
  };
  verificationStatus: PortVerificationStatus;
  cityAssociations: PortCityAssociation[];
  primaryForGameplayCityIds: string[];
  attributes: {
    operator: string | null;
    capabilities: PortCapabilityEvidence;
  };
  evidence: GeoPortEvidence;
  seaAccess: PortSeaAccess;
};

export type PortQaIssueType =
  | 'PORT_DUPLICATE'
  | 'PORT_CLASSIFICATION'
  | 'PORT_CITY_ASSOCIATION'
  | 'PORT_POSITION'
  | 'PORT_SOURCE_DISCREPANCY'
  | 'PORT_SEA_ACCESS'
  | 'PORT_NAME'
  | 'UNKNOWN';

export type PortQaIssue = {
  id: string;
  type: PortQaIssueType;
  portId: string | null;
  evidence: string;
  resolutionStatus: 'OPEN';
};

export type CityPortAssociationSummary = {
  gameplayCityId: string;
  geoCityId: string;
  associationType: PortCityAssociationType;
  portIds: string[];
  primaryPortCandidateId: string | null;
  notes: string;
};

export type TurkeyPortPackageV1 = {
  schemaVersion: typeof GEO_PORT_SCHEMA_VERSION;
  countryId: 'country.tur';
  mode: 'SEA';
  packageId: 'map-v2.country.tur.ports.v1';
  classificationPolicyVersion: string;
  clusterPolicyVersion: string;
  processingVersion: string;
  officialQaStatus: typeof OFFICIAL_PORT_QA_STATUS;
  turkeyPortAuthoritySource: 'PENDING_VERIFICATION';
  sourceManifest: {
    sourceName: string;
    sourceURL: string;
    license: string;
    licenseURL: string;
    rawSourceFile: string;
    sourceHash: `sha256:${string}`;
    retrievedAt: string;
    attributionRequired: true;
    productionApproved: false;
    notes: string;
  };
  stats: {
    sourceFeatureCount: number;
    candidateObjectCount: number;
    logicalPortCount: number;
    logisticsEligibleCount: number;
    passengerOnlyCount: number;
    localMaritimeCount: number;
    provisionalCount: number;
    unresolvedCount: number;
  };
  ports: GeoPort[];
  cityAssociations: CityPortAssociationSummary[];
  issues: PortQaIssue[];
  contentHash: `sha256:${string}`;
};
