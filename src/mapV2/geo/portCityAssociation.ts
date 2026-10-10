import { haversineMeters } from './wgs84Distance';
import type { PortCityAssociationType } from './geoPort';
import type { PortLogisticsEligibility } from './portClassPolicy';

export const PORT_CITY_ASSOCIATION_POLICY_VERSION = 'map-v2-port-city-assoc-v1' as const;
export const PORT_DIRECT_ASSOCIATION_METERS = 35_000;
export const PORT_REGIONAL_ASSOCIATION_METERS = 90_000;

export type PortAssocCandidate = {
  portId: string;
  eligibility: PortLogisticsEligibility;
  position: { longitude: number; latitude: number };
};

const ELIGIBILITY_RANK: Record<PortLogisticsEligibility, number> = {
  LOGISTICS_ELIGIBLE: 50,
  LOCAL_MARITIME: 20,
  PASSENGER_ONLY: 10,
  UNRESOLVED: 5,
  NON_LOGISTICS: 0,
};

export function associationTypeForDistance(meters: number): PortCityAssociationType {
  if (meters <= PORT_DIRECT_ASSOCIATION_METERS) return 'DIRECT';
  if (meters <= PORT_REGIONAL_ASSOCIATION_METERS) return 'REGIONAL';
  return 'NONE';
}

export function associateCityToPorts(
  city: { gameplayCityId: string; geoCityId: string; longitude: number; latitude: number },
  ports: readonly PortAssocCandidate[],
): {
  associationType: PortCityAssociationType;
  portIds: string[];
  primaryPortCandidateId: string | null;
  notes: string;
  matches: Array<{ portId: string; distanceMeters: number; associationType: Exclude<PortCityAssociationType, 'NONE'> }>;
} {
  const logistics = ports.filter((port) => port.eligibility === 'LOGISTICS_ELIGIBLE');
  const scored = logistics
    .map((port) => ({
      portId: port.portId,
      distanceMeters: Math.round(haversineMeters(city, port.position)),
      rank: ELIGIBILITY_RANK[port.eligibility],
    }))
    .filter((row) => row.distanceMeters <= PORT_REGIONAL_ASSOCIATION_METERS)
    .sort((a, b) => b.rank - a.rank || a.distanceMeters - b.distanceMeters || a.portId.localeCompare(b.portId));

  const matches = scored
    .map((row) => {
      const kind = associationTypeForDistance(row.distanceMeters);
      if (kind === 'NONE') return null;
      return { portId: row.portId, distanceMeters: row.distanceMeters, associationType: kind };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (matches.length === 0) {
    return {
      associationType: 'NONE',
      portIds: [],
      primaryPortCandidateId: null,
      notes: 'No LOGISTICS_ELIGIBLE port within regional radius. Passenger/marina facilities are not assigned.',
      matches: [],
    };
  }
  const hasDirect = matches.some((row) => row.associationType === 'DIRECT');
  return {
    associationType: hasDirect ? 'DIRECT' : 'REGIONAL',
    portIds: matches.map((row) => row.portId),
    primaryPortCandidateId: matches[0].portId,
    notes: hasDirect
      ? 'Primary candidate is the nearest LOGISTICS_ELIGIBLE port within direct radius (eligibility before distance).'
      : 'Regional LOGISTICS_ELIGIBLE port only. Not a city-center facility.',
    matches,
  };
}
