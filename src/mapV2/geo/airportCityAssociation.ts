import { haversineMeters } from './wgs84Distance';
import type { AirportCityAssociationType } from './geoAirport';
import type { AirportClassification, AirportLogisticsEligibility } from './airportClassPolicy';

export const AIRPORT_DIRECT_ASSOCIATION_METERS = 45_000;
export const AIRPORT_REGIONAL_ASSOCIATION_METERS = 100_000;

export type AirportAssocCandidate = {
  airportId: string;
  eligibility: AirportLogisticsEligibility;
  classification: AirportClassification;
  position: { longitude: number; latitude: number };
  iataCode?: string | null;
};

const ELIGIBILITY_RANK: Record<AirportLogisticsEligibility, number> = {
  LOGISTICS_ELIGIBLE: 80,
  LOGISTICS_ELIGIBLE_PREVIEW: 60,
  PASSENGER_ONLY: 50,
  UNRESOLVED: 10,
  NON_LOGISTICS: 0,
  MILITARY_RESTRICTED: 0,
};

const CLASS_RANK: Record<AirportClassification, number> = {
  CARGO_AIRPORT: 90,
  INTERNATIONAL_AIRPORT: 80,
  COMMERCIAL_AIRPORT: 70,
  DOMESTIC_AIRPORT: 55,
  GENERAL_AVIATION: 15,
  MILITARY_AIRFIELD: 0,
  CLOSED_OR_INACTIVE: 0,
  HELIPORT: 0,
  UNKNOWN_AIRPORT: 5,
};

export function airportAssociationTypeForDistance(meters: number): AirportCityAssociationType {
  if (meters <= AIRPORT_DIRECT_ASSOCIATION_METERS) return 'DIRECT';
  if (meters <= AIRPORT_REGIONAL_ASSOCIATION_METERS) return 'REGIONAL';
  return 'NONE';
}

export function associateCityToAirports(
  city: { gameplayCityId: string; geoCityId: string; longitude: number; latitude: number },
  airports: readonly AirportAssocCandidate[],
): {
  associationType: AirportCityAssociationType;
  airportIds: string[];
  primaryAirportCandidateId: string | null;
  notes: string;
  matches: Array<{ airportId: string; distanceMeters: number; associationType: Exclude<AirportCityAssociationType, 'NONE'> }>;
} {
  const usable = airports.filter(
    (row) =>
      Boolean(row.iataCode) &&
      (row.eligibility === 'LOGISTICS_ELIGIBLE' ||
        row.eligibility === 'LOGISTICS_ELIGIBLE_PREVIEW' ||
        row.eligibility === 'PASSENGER_ONLY' ||
        row.eligibility === 'UNRESOLVED'),
  );
  const BAND_RANK = { DIRECT: 20, REGIONAL: 10 } as const;
  const scored = usable
    .map((row) => {
      const distanceMeters = Math.round(haversineMeters(city, row.position));
      const associationType = airportAssociationTypeForDistance(distanceMeters);
      return {
        airportId: row.airportId,
        distanceMeters,
        associationType,
        eligibilityRank: ELIGIBILITY_RANK[row.eligibility],
        classRank: CLASS_RANK[row.classification],
      };
    })
    .filter((row): row is typeof row & { associationType: 'DIRECT' | 'REGIONAL' } =>
      row.associationType === 'DIRECT' || row.associationType === 'REGIONAL',
    )
    .sort(
      (a, b) =>
        b.eligibilityRank - a.eligibilityRank ||
        BAND_RANK[b.associationType] - BAND_RANK[a.associationType] ||
        a.distanceMeters - b.distanceMeters ||
        b.classRank - a.classRank ||
        a.airportId.localeCompare(b.airportId),
    );

  const matches = scored.map((row) => ({
    airportId: row.airportId,
    distanceMeters: row.distanceMeters,
    associationType: row.associationType,
  }));

  if (matches.length === 0) {
    return {
      associationType: 'NONE',
      airportIds: [],
      primaryAirportCandidateId: null,
      notes: 'No civilian commercial/passenger airport within regional radius. Military/helipads are not assigned.',
      matches: [],
    };
  }
  const hasDirect = matches.some((row) => row.associationType === 'DIRECT');
  return {
    associationType: hasDirect ? 'DIRECT' : 'REGIONAL',
    airportIds: matches.map((row) => row.airportId),
    primaryAirportCandidateId: matches[0].airportId,
    notes: hasDirect
      ? 'Primary prefers logistics eligibility, then DIRECT over REGIONAL, then nearer distance.'
      : 'Regional civilian airport only. Not forced to city center.',
    matches,
  };
}
