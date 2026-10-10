/**
 * Derive DEV multimodal transfer candidates from GeoPort / GeoAirport / rail access.
 * Does not rewrite transport artifacts. Player corridors are not planning truth.
 */
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS, type LegacyStableGameplayCityId } from '../domain/ids';
import {
  airportPlanningNodeId,
  GENERIC_CARGO_COMPATIBILITY,
  MODE_OPERATIONAL_READINESS,
  MULTIMODAL_DOMAIN_POLICY_VERSION,
  MULTIMODAL_DOMAIN_SCHEMA_VERSION,
  portPlanningNodeId,
  railAccessPlanningNodeId,
  roadOperationalNodeId,
  transferNodeIdForPair,
  type CityModeMatrixRow,
  type CityModeMatrixStatus,
  type CityTransferMatrixRow,
  type MultimodalFoundationView,
  type MultimodalPlanningEdge,
  type MultimodalPlanningNode,
  type TransferCapability,
  type TransferNode,
} from '../domain/multimodal';
import type { TurkeyAirportPackageV1 } from '../geo/geoAirport';
import type { TurkeyPortPackageV1 } from '../geo/geoPort';
import type { CountryCityTransportAccessPackageV1 } from '../geo/transportNetwork';
import { geoCityIdForGameplayCity } from '../world/countryCityLoader';

const BIDIRECTIONAL: Record<
  'ROAD_TO_RAIL' | 'ROAD_TO_SEA' | 'ROAD_TO_AIR',
  readonly [TransferCapability, TransferCapability]
> = {
  ROAD_TO_RAIL: ['ROAD_TO_RAIL', 'RAIL_TO_ROAD'],
  ROAD_TO_SEA: ['ROAD_TO_SEA', 'SEA_TO_ROAD'],
  ROAD_TO_AIR: ['ROAD_TO_AIR', 'AIR_TO_ROAD'],
};

function cityList(): readonly LegacyStableGameplayCityId[] {
  return LEGACY_STABLE_GAMEPLAY_CITY_IDS;
}

export function buildTurkeyMultimodalFoundation(input: {
  railAccess: CountryCityTransportAccessPackageV1;
  ports: TurkeyPortPackageV1;
  airports: TurkeyAirportPackageV1;
}): MultimodalFoundationView {
  const transferNodes: TransferNode[] = [];
  const cityModeMatrix: CityModeMatrixRow[] = [];
  const cityTransferMatrix: CityTransferMatrixRow[] = [];
  const planningNodes: MultimodalPlanningNode[] = [];
  const planningEdges: MultimodalPlanningEdge[] = [];
  const railByGeo = new Map(
    input.railAccess.accesses.filter((row) => row.mode === 'RAIL').map((row) => [row.geoCityId, row]),
  );
  const portByCity = Object.fromEntries(input.ports.cityAssociations.map((row) => [row.gameplayCityId, row]));
  const airByCity = Object.fromEntries(input.airports.cityAssociations.map((row) => [row.gameplayCityId, row]));
  const airportById = new Map(input.airports.airports.map((row) => [row.id, row]));
  const portById = new Map(input.ports.ports.map((row) => [row.id, row]));

  const railCities = new Set<LegacyStableGameplayCityId>();
  const seaCities = new Set<LegacyStableGameplayCityId>();
  const airCities = new Set<LegacyStableGameplayCityId>();

  for (const city of cityList()) {
    const geoCityId = geoCityIdForGameplayCity(city) ?? '';
    const rail = railByGeo.get(geoCityId);
    const railOk = rail?.status === 'PROVISIONAL' && (rail.accessNodeIds.length ?? 0) > 0;
    const portAssoc = portByCity[city];
    const seaOk =
      Boolean(portAssoc?.primaryPortCandidateId) &&
      (portAssoc?.associationType === 'DIRECT' || portAssoc?.associationType === 'REGIONAL');
    const airAssoc = airByCity[city];
    const logistics = airportById.get(airAssoc?.primaryLogisticsAirportCandidateId ?? '');
    const airOk = airAssoc?.airLogisticsReadiness === 'READY' && Boolean(logistics);

    const ROAD: CityModeMatrixStatus = 'ACTIVE';
    const RAIL: CityModeMatrixStatus = railOk ? 'PROVISIONAL' : 'UNAVAILABLE';
    const SEA: CityModeMatrixStatus = seaOk ? 'PROVISIONAL' : 'UNAVAILABLE';
    const AIR: CityModeMatrixStatus = airOk ? 'PROVISIONAL' : 'NOT_READY';
    cityModeMatrix.push({ gameplayCityId: city, ROAD, RAIL, SEA, AIR });

    planningNodes.push({
      id: roadOperationalNodeId(city),
      kind: 'ROAD_OPERATIONAL',
      gameplayCityId: city,
      mode: 'ROAD',
    });

    const capabilities: TransferCapability[] = [];
    const unresolvedNotes: string[] = [];

    if (railOk && rail) {
      railCities.add(city);
      const railAccessId = rail.accessNodeIds[0];
      const id = transferNodeIdForPair(city, 'road-rail');
      transferNodes.push({
        id,
        geoCountryId: 'country.tur',
        gameplayCityId: city,
        geoCityId,
        supportedModes: ['ROAD', 'RAIL'],
        infrastructureRefs: [railAccessId],
        transferCapabilities: [...BIDIRECTIONAL.ROAD_TO_RAIL],
        verificationStatus: 'PROVISIONAL',
        localTransferDistanceMeters: null,
        evidence: [
          {
            infrastructureRefs: [railAccessId],
            modePair: 'ROAD_TO_RAIL',
            evidenceType: 'CITY_RAIL_ACCESS',
            status: 'PROVISIONAL',
            reason: `City RAIL access ${rail.status}; station ≠ freight terminal proof.`,
          },
        ],
        lineage: { legacyCityId: city, geoPortId: null, geoAirportId: null, railAccessId },
      });
      capabilities.push(...BIDIRECTIONAL.ROAD_TO_RAIL);
      planningNodes.push({
        id: railAccessPlanningNodeId(city),
        kind: 'RAIL_ACCESS',
        gameplayCityId: city,
        mode: 'RAIL',
        infrastructureId: railAccessId,
      });
      planningNodes.push({
        id,
        kind: 'TRANSFER',
        gameplayCityId: city,
        mode: null,
        transferNodeId: id,
        infrastructureId: railAccessId,
      });
      planningEdges.push(
        {
          id: `${id}.road-to-rail`,
          kind: 'TRANSFER',
          fromNodeId: roadOperationalNodeId(city),
          toNodeId: railAccessPlanningNodeId(city),
          transferNodeId: id,
          routeReference: 'domain.transfer.road-rail',
        },
        {
          id: `${id}.rail-to-road`,
          kind: 'TRANSFER',
          fromNodeId: railAccessPlanningNodeId(city),
          toNodeId: roadOperationalNodeId(city),
          transferNodeId: id,
          routeReference: 'domain.transfer.rail-road',
        },
      );
    } else {
      unresolvedNotes.push('RAIL access UNRESOLVED — no ROAD↔RAIL transfer');
    }

    if (seaOk && portAssoc?.primaryPortCandidateId) {
      seaCities.add(city);
      const portId = portAssoc.primaryPortCandidateId;
      const port = portById.get(portId);
      const id = transferNodeIdForPair(city, 'road-sea');
      const distance = port?.cityAssociations.find((row) => row.gameplayCityId === city)?.distanceMeters ?? null;
      transferNodes.push({
        id,
        geoCountryId: 'country.tur',
        gameplayCityId: city,
        geoCityId,
        supportedModes: ['ROAD', 'SEA'],
        infrastructureRefs: [portId],
        transferCapabilities: [...BIDIRECTIONAL.ROAD_TO_SEA],
        verificationStatus: 'PROVISIONAL',
        localTransferDistanceMeters: distance,
        evidence: [
          {
            infrastructureRefs: [portId],
            modePair: 'ROAD_TO_SEA',
            evidenceType: 'CITY_PORT_ASSOCIATION',
            status: 'PROVISIONAL',
            reason: `Explicit city–GeoPort association ${portAssoc.associationType}; not a verified intermodal terminal.`,
          },
        ],
        lineage: { legacyCityId: city, geoPortId: portId, geoAirportId: null, railAccessId: null },
      });
      capabilities.push(...BIDIRECTIONAL.ROAD_TO_SEA);
      planningNodes.push({
        id: portPlanningNodeId(city),
        kind: 'PORT',
        gameplayCityId: city,
        mode: 'SEA',
        infrastructureId: portId,
      });
      planningNodes.push({
        id,
        kind: 'TRANSFER',
        gameplayCityId: city,
        mode: null,
        transferNodeId: id,
        infrastructureId: portId,
      });
      planningEdges.push(
        {
          id: `${id}.road-to-sea`,
          kind: 'TRANSFER',
          fromNodeId: roadOperationalNodeId(city),
          toNodeId: portPlanningNodeId(city),
          transferNodeId: id,
          routeReference: 'domain.transfer.road-sea',
        },
        {
          id: `${id}.sea-to-road`,
          kind: 'TRANSFER',
          fromNodeId: portPlanningNodeId(city),
          toNodeId: roadOperationalNodeId(city),
          transferNodeId: id,
          routeReference: 'domain.transfer.sea-road',
        },
      );
    } else {
      unresolvedNotes.push('No city–GeoPort association — no ROAD↔SEA transfer');
    }

    if (airOk && logistics) {
      airCities.add(city);
      const iata = (logistics.iataCode ?? 'xxx').toLowerCase();
      const id = transferNodeIdForPair(city, 'road-air', iata);
      const distance =
        logistics.cityAssociations.find((row) => row.gameplayCityId === city)?.distanceMeters ?? null;
      transferNodes.push({
        id,
        geoCountryId: 'country.tur',
        gameplayCityId: city,
        geoCityId,
        supportedModes: ['ROAD', 'AIR'],
        infrastructureRefs: [logistics.id],
        transferCapabilities: [...BIDIRECTIONAL.ROAD_TO_AIR],
        verificationStatus: 'PROVISIONAL',
        localTransferDistanceMeters: distance,
        evidence: [
          {
            infrastructureRefs: [logistics.id],
            modePair: 'ROAD_TO_AIR',
            evidenceType: 'CITY_AIRPORT_LOGISTICS_PRIMARY',
            status: 'PROVISIONAL',
            reason: `Logistics primary ${logistics.iataCode} READY / VERIFIED_SUPPORTED. Not an airside cargo terminal QA.`,
          },
        ],
        lineage: { legacyCityId: city, geoPortId: null, geoAirportId: logistics.id, railAccessId: null },
      });
      capabilities.push(...BIDIRECTIONAL.ROAD_TO_AIR);
      planningNodes.push({
        id: airportPlanningNodeId(city),
        kind: 'AIRPORT',
        gameplayCityId: city,
        mode: 'AIR',
        infrastructureId: logistics.id,
      });
      planningNodes.push({
        id,
        kind: 'TRANSFER',
        gameplayCityId: city,
        mode: null,
        transferNodeId: id,
        infrastructureId: logistics.id,
      });
      planningEdges.push(
        {
          id: `${id}.road-to-air`,
          kind: 'TRANSFER',
          fromNodeId: roadOperationalNodeId(city),
          toNodeId: airportPlanningNodeId(city),
          transferNodeId: id,
          routeReference: 'domain.transfer.road-air',
        },
        {
          id: `${id}.air-to-road`,
          kind: 'TRANSFER',
          fromNodeId: airportPlanningNodeId(city),
          toNodeId: roadOperationalNodeId(city),
          transferNodeId: id,
          routeReference: 'domain.transfer.air-road',
        },
      );
    } else {
      unresolvedNotes.push('AIR logistics NOT_READY — no ROAD↔AIR logistics transfer');
    }

    if (railOk && seaOk) {
      unresolvedNotes.push('RAIL and SEA co-present; RAIL↔SEA remains UNRESOLVED without a transfer complex');
    }
    if (railOk && airOk) {
      unresolvedNotes.push('RAIL↔AIR not granted by default');
    }

    cityTransferMatrix.push({ gameplayCityId: city, capabilities, unresolvedNotes });
  }

  const addModeMesh = (
    cities: ReadonlySet<LegacyStableGameplayCityId>,
    mode: 'ROAD' | 'RAIL' | 'SEA' | 'AIR',
    nodeId: (city: string) => string,
  ) => {
    const list = [...cities];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        const from = list[i];
        const to = list[j];
        planningEdges.push({
          id: `leg.tur.${mode.toLowerCase()}.${from}.${to}.v1`,
          kind: 'TRANSPORT_LEG',
          fromNodeId: nodeId(from),
          toNodeId: nodeId(to),
          mode,
          routeReference: `domain.canonical.${mode.toLowerCase()}.city-pair`,
        });
      }
    }
  };

  addModeMesh(new Set(cityList()), 'ROAD', roadOperationalNodeId);
  addModeMesh(railCities, 'RAIL', railAccessPlanningNodeId);
  addModeMesh(seaCities, 'SEA', portPlanningNodeId);
  addModeMesh(airCities, 'AIR', airportPlanningNodeId);

  planningNodes.sort((a, b) => a.id.localeCompare(b.id));
  planningEdges.sort((a, b) => a.id.localeCompare(b.id));
  transferNodes.sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: MULTIMODAL_DOMAIN_SCHEMA_VERSION,
    policyVersion: MULTIMODAL_DOMAIN_POLICY_VERSION,
    countryId: 'country.tur',
    multimodalReadiness: 'READY_FOR_DOMAIN',
    modeOperationalReadiness: MODE_OPERATIONAL_READINESS,
    cityModeMatrix,
    cityTransferMatrix,
    transferNodes,
    planningGraph: { nodes: planningNodes, edges: planningEdges },
    cargoCompatibility: [GENERIC_CARGO_COMPATIBILITY],
  };
}

export function cityModeRow(
  view: MultimodalFoundationView,
  cityId: string,
): CityModeMatrixRow | undefined {
  return view.cityModeMatrix.find((row) => row.gameplayCityId === cityId);
}

export function cityTransferRow(
  view: MultimodalFoundationView,
  cityId: string,
): CityTransferMatrixRow | undefined {
  return view.cityTransferMatrix.find((row) => row.gameplayCityId === cityId);
}

export function cityHasCapability(
  view: MultimodalFoundationView,
  cityId: string,
  capability: TransferCapability,
): boolean {
  return cityTransferRow(view, cityId)?.capabilities.includes(capability) === true;
}
