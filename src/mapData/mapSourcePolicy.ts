/**
 * Map V2 source-policy constants and manifest types.
 *
 * Documentation: docs/architecture/MAP_DATA_SOURCE_POLICY_V1.md
 *
 * Not wired into gameplay, rendering, or feature flags.
 * Geographic values must not be added here.
 */

export const MAP_DATA_SOURCE_POLICY_VERSION = 1 as const;

/** Structure of LogistiCore MapData once that format exists. Not a geographic release pin. */
export const MAP_DATA_SCHEMA_VERSION = 1 as const;

/**
 * Geographic package pin. Unset until the first license-approved MapData release.
 * Do not treat documentation examples such as "2026.01" as live.
 */
export const MAP_DATA_RELEASE_VERSION: string | null = null;

export const GOOGLE_MAP_DATA_EXTRACTION_FOR_MAP_V2 = 'FORBIDDEN' as const;

export const TURKEY_PORT_AUTHORITY_SOURCE = 'PENDING_VERIFICATION' as const;
export const TURKEY_AIRPORT_AUTHORITY_SOURCE = 'PENDING_VERIFICATION' as const;

export type MapDatasetType =
  | 'administrative-boundary'
  | 'physical-base'
  | 'transport-network'
  | 'rail-network'
  | 'road-network'
  | 'airport'
  | 'port'
  | 'poi'
  | 'settlement'
  | 'gameplay-graph'
  | 'localization'
  | 'other'
  | 'unresolved';

export type GeoBoundariesReleaseType = 'gbOpen' | 'forbidden-gbAuthoritative' | 'unresolved';

export type Unresolved = 'unresolved';

export interface MapSourceConflictRecord {
  withDatasetId: string;
  summary: string;
  resolution: 'unresolved' | 'human-accepted-primary' | 'human-accepted-secondary';
}

/**
 * Future display policy. The renderer must receive already-resolved display data.
 * Do not implement geopolitical decisions in map components.
 */
export interface PoliticalBoundaryDisplayPolicy {
  showStandardAdministrativeBoundaries: boolean;
  showDisputedBoundaries: boolean;
  showClaimLines: boolean;
  namingLocale: 'tr' | 'en';
  /**
   * Step 2A: pass source geometry through. The renderer must not choose
   * recognition, ownership, or naming. Future variants remain source-backed.
   */
  displayVariant: 'SOURCE_AS_PROVIDED';
}

export const STEP_2A_POLITICAL_BOUNDARY_DISPLAY_POLICY: PoliticalBoundaryDisplayPolicy = {
  showStandardAdministrativeBoundaries: true,
  showDisputedBoundaries: true,
  showClaimLines: false,
  namingLocale: 'tr',
  displayVariant: 'SOURCE_AS_PROVIDED',
};

export interface MapSourceManifest {
  policyVersion: typeof MAP_DATA_SOURCE_POLICY_VERSION;
  datasetId: string;
  datasetType: MapDatasetType;
  sourceName: string;
  sourceURL: string | Unresolved;
  license: string;
  licenseURL: string | Unresolved;
  sourceVersion: string | Unresolved;
  retrievedAt: string | Unresolved;
  sourceHash: `sha256:${string}` | Unresolved;
  originalFormat: string | Unresolved;
  processedFormat: string | Unresolved;
  processingVersion: string | Unresolved;
  derivedFrom: string[];
  attributionRequired: boolean;
  productionApproved: boolean;
  geoBoundariesReleaseType?: GeoBoundariesReleaseType;
  notes: string;
  conflicts?: MapSourceConflictRecord[];
}

export function isMapSourceProductionApproved(manifest: MapSourceManifest): boolean {
  if (!manifest.productionApproved) {
    return false;
  }
  if (manifest.geoBoundariesReleaseType === 'forbidden-gbAuthoritative') {
    return false;
  }
  const unresolvedFields = [
    manifest.sourceURL,
    manifest.licenseURL,
    manifest.sourceVersion,
    manifest.retrievedAt,
    manifest.sourceHash,
    manifest.originalFormat,
    manifest.processedFormat,
    manifest.processingVersion,
  ];
  if (unresolvedFields.includes('unresolved')) {
    return false;
  }
  return true;
}
