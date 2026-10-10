import { createHash } from 'node:crypto';

import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../../src/mapV2/domain/ids';
import type { MapV2TransportMode } from '../../src/mapV2/domain/transport';
import { ROAD_CLASS_POLICY_ID } from '../../src/mapV2/geo/roadClassPolicy';
import {
  osmPendingManifest,
  emptyPendingManifest,
  TRANSPORT_LOD_POLICY_ID,
  TRANSPORT_NETWORK_SCHEMA_VERSION,
  TRANSPORT_PACKAGE_PROCESSING_VERSION,
  TRANSPORT_QUANTIZE,
  TRANSPORT_SIMPLIFICATION_VERSION,
  WEB_MERCATOR_TRANSPORT_PROJECTION,
  type CountryCityTransportAccessPackageV1,
  type CountryInfrastructurePackageV1,
  type CountryTransportManifestV1,
  type GeoTransportNetworkPackageV1,
  type TransportModeManifestRow,
} from '../../src/mapV2/geo/transportNetwork';
import { WEB_MERCATOR_PROJECTION_VERSION } from '../../src/mapV2/geo/webMercator';
import { measureConnectivity } from '../../src/mapV2/geo/validateTransportNetwork';
import { unresolvedCityAccess } from '../../src/mapV2/geo/cityTransportAccess';
import { getTurkeyCityPackage } from '../../src/mapV2/world/countryCityLoader';

export function hashCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function createEmptyModeNetwork(mode: MapV2TransportMode): Omit<GeoTransportNetworkPackageV1, 'contentHash'> {
  const osm = mode === 'ROAD' || mode === 'RAIL';
  const datasetType = mode === 'ROAD' ? 'road-network' : mode === 'RAIL' ? 'rail-network' : 'transport-network';
  const notes =
    mode === 'ROAD'
      ? 'Step 2D placeholder. OSM ODbL is the candidate ROAD source. No geometry ingested. KGM remains QA/reference. OSM_TRANSFORMED_DB_LICENSE_CHECKPOINT not cleared.'
      : mode === 'RAIL'
        ? 'Step 2D placeholder. OSM ODbL is the candidate RAIL source. TCDD is QA/reference. No geometry ingested. Do not invent four lines.'
        : mode === 'SEA'
          ? 'SEA graph SOURCE_PENDING. Do not invent shipping lanes. TURKEY_PORT_AUTHORITY_SOURCE is PENDING_VERIFICATION.'
          : 'AIR airport catalog may be DEV-only (turkey-airports.json). AIR route graph SOURCE_PENDING. DHMİ_QA_ONLY. Do not invent corridors.';
  const sourceManifest = osm
    ? osmPendingManifest(datasetType, `osm.tur.${mode.toLowerCase()}.pending`, notes)
    : emptyPendingManifest(datasetType, `pending.tur.${mode.toLowerCase()}`, notes);
  const nodes: GeoTransportNetworkPackageV1['nodes'] = [];
  const edges: GeoTransportNetworkPackageV1['edges'] = [];
  const metrics = measureConnectivity(nodes, edges);
  return {
    schemaVersion: TRANSPORT_NETWORK_SCHEMA_VERSION,
    packageId: `map-v2.country.tur.transport.${mode.toLowerCase()}.v1`,
    geoCountryId: 'country.tur',
    mode,
    sourceStatus: 'SOURCE_PENDING',
    projection: WEB_MERCATOR_TRANSPORT_PROJECTION,
    sourceManifest,
    transformation: {
      processingVersion: TRANSPORT_PACKAGE_PROCESSING_VERSION,
      projectionVersion: WEB_MERCATOR_PROJECTION_VERSION,
      simplificationVersion: TRANSPORT_SIMPLIFICATION_VERSION,
      filtersApplied: mode === 'ROAD' ? [ROAD_CLASS_POLICY_ID] : [],
      lodPolicyId: TRANSPORT_LOD_POLICY_ID,
      quantize: TRANSPORT_QUANTIZE,
    },
    nodes,
    edges,
    stats: {
      nodeCount: metrics.nodeCount,
      edgeCount: metrics.edgeCount,
      componentCount: metrics.componentCount,
    },
    productionApproved: false,
  };
}

export function sealNetwork(pkg: Omit<GeoTransportNetworkPackageV1, 'contentHash'>): GeoTransportNetworkPackageV1 {
  return { ...pkg, contentHash: hashCanonical(pkg) };
}

export function createCityAccessPackage(): CountryCityTransportAccessPackageV1 {
  const mapped = getTurkeyCityPackage().gameplayMappings;
  const accesses = mapped.flatMap((row) =>
    (['ROAD', 'RAIL', 'SEA', 'AIR'] as MapV2TransportMode[]).map((mode) => unresolvedCityAccess(row.geoCityId, mode)),
  );
  void LEGACY_STABLE_GAMEPLAY_CITY_IDS;
  const body = {
    schemaVersion: 1 as const,
    packageId: 'map-v2.country.tur.city-transport-access.v1',
    geoCountryId: 'country.tur',
    accesses,
  };
  return { ...body, contentHash: hashCanonical(body) };
}

export function createInfrastructurePackage(): CountryInfrastructurePackageV1 {
  const body = {
    schemaVersion: 1 as const,
    packageId: 'map-v2.country.tur.infrastructure.v1',
    geoCountryId: 'country.tur',
    facilities: [] as CountryInfrastructurePackageV1['facilities'],
    intermodalLinks: [] as CountryInfrastructurePackageV1['intermodalLinks'],
  };
  return { ...body, contentHash: hashCanonical(body) };
}

export function createManifest(): CountryTransportManifestV1 {
  const rows: TransportModeManifestRow[] = [
    {
      mode: 'ROAD',
      source: 'OSM-derived (candidate; not ingested)',
      license: 'ODbL 1.0',
      status: 'SOURCE_PENDING',
      qaAuthority: 'KGM (QA/reference, not bundled)',
      odblDerived: true,
      notes: 'approved-for-prototype source direction only. Empty package. No fake roads.',
      packageFile: 'turkey-road-network.json',
    },
    {
      mode: 'RAIL',
      source: 'OSM-derived (candidate; not ingested)',
      license: 'ODbL 1.0',
      status: 'SOURCE_PENDING',
      qaAuthority: 'TCDD (QA/reference, not bundled)',
      odblDerived: true,
      notes: 'Do not reduce to invented trunk lines. Empty package.',
      packageFile: 'turkey-rail-network.json',
    },
    {
      mode: 'SEA',
      source: 'pending',
      license: 'pending',
      status: 'SOURCE_PENDING',
      qaAuthority: 'port authority pending',
      odblDerived: false,
      notes: 'No shipping lanes. TURKEY_PORT_AUTHORITY_SOURCE = PENDING_VERIFICATION.',
      packageFile: 'turkey-sea-network.json',
    },
    {
      mode: 'AIR',
      source: 'airport infra later via DHMİ identity check; routes pending',
      license: 'pending',
      status: 'SOURCE_PENDING',
      qaAuthority: 'DHMİ (airports, later)',
      odblDerived: false,
      notes: 'No invented air corridors.',
      packageFile: 'turkey-air-network.json',
    },
  ];
  const body = {
    schemaVersion: 1 as const,
    packageId: 'map-v2.country.tur.transport-manifest.v1',
    geoCountryId: 'country.tur',
    layout: 'per-mode' as const,
    processingVersion: TRANSPORT_PACKAGE_PROCESSING_VERSION,
    modes: rows,
    infrastructurePackageFile: 'turkey-infrastructure.json',
    cityAccessPackageFile: 'turkey-city-access.json',
    gameplaySeparation: {
      routesTs: 'gameplay-metadata-not-topology' as const,
      mapRoadNetwork: 'legacy-png-aligned-not-geo' as const,
    },
  };
  return { ...body, contentHash: hashCanonical(body) };
}
