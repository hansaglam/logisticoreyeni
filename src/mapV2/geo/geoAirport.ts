import type { GeoCoordinateWgs84, ProjectedWorldPoint } from './webMercator';
import type {
  AirportCargoCapability,
  AirportClassification,
  AirportLogisticsEligibility,
} from './airportClassPolicy';
import type { AirportCivilUse, AirLogisticsReadiness } from './airportCargoPolicy';
import type { AirportCargoEvidenceRecord } from '../data/qa/turkey-airport-cargo-qa';

export const GEO_AIRPORT_SCHEMA_VERSION = 1 as const;
export const DHMI_QA_STATUS = 'DHMİ_QA_ONLY' as const;
export const AIRPORT_VERIFIED_CRITERIA =
  'VERIFIED requires human review plus DHMİ public identity agreement plus OSM geometry agreement. Ingest never mass-promotes.' as const;

export type AirportVerificationStatus = 'VERIFIED' | 'PROVISIONAL' | 'UNRESOLVED';
export type AirportCityAssociationType = 'DIRECT' | 'REGIONAL' | 'NONE' | 'UNRESOLVED';
export type AirportOperationalStatus = 'OPERATIONAL' | 'CLOSED_OR_INACTIVE' | 'UNKNOWN';

export type GeoAirportEvidence = {
  osmIds: string[];
  sourceTags: Record<string, string | number | boolean | null>;
  names: string[];
  operator: string | null;
  geometryEvidence: 'POINT' | 'POLYGON' | 'LINE' | 'MIXED';
  officialQaReference: typeof DHMI_QA_STATUS;
};

export type AirportRunwayRecord = {
  sourceId: string;
  ref: string | null;
  surface: string | null;
  lengthMeters: number | null;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type AirportCityAssociation = {
  gameplayCityId: string;
  geoCityId: string;
  associationType: Exclude<AirportCityAssociationType, 'NONE'>;
  distanceMeters: number;
  evidence: string;
  airportId: string;
};

export type CityAirAccess = {
  legacyCityId: string;
  geoAirportId: string;
  associationType: Exclude<AirportCityAssociationType, 'NONE'>;
  distanceMeters: number;
  status: 'PROVISIONAL' | 'UNRESOLVED';
  reason: string;
};

export type GeoAirport = {
  id: string;
  geoCountryId: 'country.tur';
  displayName: string;
  sourceName: string | null;
  position: GeoCoordinateWgs84;
  projected: ProjectedWorldPoint;
  bounds: { west: number; south: number; east: number; north: number } | null;
  iataCode: string | null;
  icaoCode: string | null;
  classification: AirportClassification;
  logisticsEligibility: AirportLogisticsEligibility;
  cargoCapability: AirportCargoCapability;
  civilUse: AirportCivilUse;
  airLogisticsReadiness: AirLogisticsReadiness;
  readinessReason: string;
  cargoEvidence: AirportCargoEvidenceRecord[];
  cargoTonnesYtd: number | null;
  operationalStatus: AirportOperationalStatus;
  runwayCount: number;
  terminalCount: number;
  runways: AirportRunwayRecord[];
  sourceIds: string[];
  provenance: {
    license: 'ODbL 1.0';
    sourceProvider: 'OpenStreetMap';
    officialQa: typeof DHMI_QA_STATUS;
  };
  verificationStatus: AirportVerificationStatus;
  cityAssociations: AirportCityAssociation[];
  primaryForGameplayCityIds: string[];
  attributes: {
    operator: string | null;
  };
  evidence: GeoAirportEvidence;
};

export type AirportQaIssueType =
  | 'AIRPORT_SOURCE_DISCREPANCY'
  | 'AIRPORT_NAME'
  | 'AIRPORT_CLASSIFICATION'
  | 'AIRPORT_CARGO_CAPABILITY'
  | 'AIRPORT_CITY_ASSOCIATION'
  | 'AIRPORT_POSITION'
  | 'AIRPORT_DUPLICATE'
  | 'AIRPORT_OPERATIONAL_STATUS'
  | 'UNKNOWN';

export type AirportQaIssue = {
  id: string;
  type: AirportQaIssueType;
  airportId: string | null;
  evidence: string;
  resolutionStatus: 'OPEN';
};

export type CityAirportAssociationSummary = {
  gameplayCityId: string;
  geoCityId: string;
  associationType: AirportCityAssociationType;
  airportIds: string[];
  primaryAirportCandidateId: string | null;
  primaryPassengerAirportCandidateId: string | null;
  primaryLogisticsAirportCandidateId: string | null;
  airLogisticsReadiness: AirLogisticsReadiness;
  readinessReason: string;
  airAccess: CityAirAccess[];
  notes: string;
};

export type TurkeyAirportPackageV1 = {
  schemaVersion: typeof GEO_AIRPORT_SCHEMA_VERSION;
  countryId: 'country.tur';
  mode: 'AIR';
  packageId: 'map-v2.country.tur.airports.v1';
  classificationPolicyVersion: string;
  clusterPolicyVersion: string;
  processingVersion: string;
  cargoPolicyVersion?: string;
  officialQaStatus: typeof DHMI_QA_STATUS;
  turkeyAirportAuthoritySource: 'PENDING_VERIFICATION';
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
    logicalAirportCount: number;
    commercialCount: number;
    logisticsEligibleCount: number;
    passengerOnlyCount: number;
    militaryRestrictedCount: number;
    heliportExcludedCount: number;
    closedCount: number;
    provisionalCount: number;
    unresolvedCount: number;
    iataCount: number;
    icaoCount: number;
    cargoVerifiedCount: number;
    cargoProvisionalCount: number;
    cargoUnknownCount: number;
    cargoUnavailableCount: number;
    logisticsPreviewCount: number;
    airReadyCount: number;
  };
  airports: GeoAirport[];
  cityAssociations: CityAirportAssociationSummary[];
  issues: AirportQaIssue[];
  contentHash: `sha256:${string}`;
};
