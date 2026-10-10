import type { AirportCargoCapability, AirportClassification, AirportLogisticsEligibility } from './airportClassPolicy';
import type { AirportOperationalStatus } from './geoAirport';
import {
  cargoEvidenceForIata,
  dhmiCargoTonnesForIata,
  operationalQaForIata,
  type AirportCargoEvidenceRecord,
} from '../data/qa/turkey-airport-cargo-qa';
import { AIRPORT_CARGO_POLICY_VERSION } from './airportClassPolicy';
import { haversineMeters } from './wgs84Distance';
import { airportAssociationTypeForDistance } from './airportCityAssociation';

export const AIRPORT_CARGO_READY_TONNES = 100;
export const AIRPORT_CARGO_PREVIEW_TONNES = 10;

export const AIR_LOGISTICS_READINESS = ['READY', 'PREVIEW_ONLY', 'NOT_READY'] as const;
export type AirLogisticsReadiness = (typeof AIR_LOGISTICS_READINESS)[number];

export const AIRPORT_CIVIL_USES = ['CIVIL', 'MILITARY', 'DUAL_USE', 'UNKNOWN'] as const;
export type AirportCivilUse = (typeof AIRPORT_CIVIL_USES)[number];

export { AIRPORT_CARGO_POLICY_VERSION };

export function resolveCargoCapabilityFromEvidence(evidence: readonly AirportCargoEvidenceRecord[]): AirportCargoCapability {
  if (evidence.some((row) => row.evidenceType === 'OFFICIAL_CARGO_TERMINAL' && row.status === 'ACCEPTED')) {
    return 'VERIFIED_SUPPORTED';
  }
  const tonnes = evidence.map((row) => row.cargoTonnesYtd).find((value) => value != null);
  if (tonnes != null && tonnes >= AIRPORT_CARGO_READY_TONNES) return 'VERIFIED_SUPPORTED';
  if (tonnes != null && tonnes >= AIRPORT_CARGO_PREVIEW_TONNES) return 'PROVISIONAL_SUPPORTED';
  if (evidence.some((row) => row.status === 'WEAK' && (row.cargoTonnesYtd ?? 0) > 0)) return 'PROVISIONAL_SUPPORTED';
  if (evidence.some((row) => row.observedFact.toLowerCase().includes('no cargo') && row.status === 'ACCEPTED')) {
    return 'KNOWN_UNAVAILABLE';
  }
  return 'UNKNOWN';
}

export function resolveLogisticsEligibilityFromCargo(input: {
  cargoCapability: AirportCargoCapability;
  operationalStatus: AirportOperationalStatus;
  civilUse: AirportCivilUse;
  classification: AirportClassification;
}): AirportLogisticsEligibility {
  if (input.operationalStatus === 'CLOSED_OR_INACTIVE' || input.classification === 'CLOSED_OR_INACTIVE') {
    return 'NON_LOGISTICS';
  }
  if (input.civilUse === 'MILITARY' || input.classification === 'MILITARY_AIRFIELD') {
    return 'MILITARY_RESTRICTED';
  }
  if (input.classification === 'HELIPORT' || input.classification === 'GENERAL_AVIATION') {
    return 'NON_LOGISTICS';
  }
  if (input.cargoCapability === 'VERIFIED_SUPPORTED') return 'LOGISTICS_ELIGIBLE';
  if (input.cargoCapability === 'PROVISIONAL_SUPPORTED') return 'LOGISTICS_ELIGIBLE_PREVIEW';
  if (input.cargoCapability === 'KNOWN_UNAVAILABLE') return 'PASSENGER_ONLY';
  if (input.cargoCapability === 'UNKNOWN') return 'UNRESOLVED';
  return 'UNRESOLVED';
}

export function resolveAirLogisticsReadiness(input: {
  logisticsEligibility: AirportLogisticsEligibility;
  cargoCapability: AirportCargoCapability;
  operationalStatus: AirportOperationalStatus;
  civilUse: AirportCivilUse;
}): { readiness: AirLogisticsReadiness; reason: string } {
  if (input.operationalStatus === 'CLOSED_OR_INACTIVE') {
    return { readiness: 'NOT_READY', reason: 'Closed/inactive; excluded from future AIR endpoints.' };
  }
  if (input.civilUse === 'MILITARY' || input.logisticsEligibility === 'MILITARY_RESTRICTED') {
    return { readiness: 'NOT_READY', reason: 'Military/restricted; civil cargo gameplay not allowed from military runway alone.' };
  }
  if (input.logisticsEligibility === 'LOGISTICS_ELIGIBLE' && input.cargoCapability === 'VERIFIED_SUPPORTED') {
    return { readiness: 'READY', reason: 'Official cargo evidence + civil operational.' };
  }
  if (input.logisticsEligibility === 'LOGISTICS_ELIGIBLE_PREVIEW' || input.cargoCapability === 'PROVISIONAL_SUPPORTED') {
    return { readiness: 'PREVIEW_ONLY', reason: 'Source-backed cargo exists but below dedicated-logistics threshold.' };
  }
  if (input.cargoCapability === 'UNKNOWN') {
    return { readiness: 'NOT_READY', reason: 'Cargo capability UNKNOWN. Passenger airport ≠ cargo airport.' };
  }
  return { readiness: 'NOT_READY', reason: `Eligibility ${input.logisticsEligibility}; not logistics-ready.` };
}

export function resolveCivilUse(input: { osmMilitary: boolean; hasDhmiCivilIdentity: boolean; classification: AirportClassification }): AirportCivilUse {
  if (input.classification === 'MILITARY_AIRFIELD' && !input.hasDhmiCivilIdentity) return 'MILITARY';
  if (input.osmMilitary && input.hasDhmiCivilIdentity) return 'DUAL_USE';
  if (input.hasDhmiCivilIdentity) return 'CIVIL';
  if (input.osmMilitary) return 'MILITARY';
  return 'UNKNOWN';
}

export type DualPrimaryCandidate = {
  airportId: string;
  iataCode?: string | null;
  eligibility: AirportLogisticsEligibility;
  classification: AirportClassification;
  position: { longitude: number; latitude: number };
  operationalStatus: AirportOperationalStatus;
  cargoCapability: AirportCargoCapability;
  civilUse: AirportCivilUse;
  airLogisticsReadiness: AirLogisticsReadiness;
  cargoTonnesYtd?: number | null;
};

function passengerCapable(row: DualPrimaryCandidate): boolean {
  if (!row.iataCode) return false;
  if (row.operationalStatus === 'CLOSED_OR_INACTIVE') return false;
  if (row.eligibility === 'MILITARY_RESTRICTED' || row.eligibility === 'NON_LOGISTICS') return false;
  if (row.civilUse === 'MILITARY') return false;
  return true;
}

function logisticsCapable(row: DualPrimaryCandidate): boolean {
  if (!row.iataCode) return false;
  if (row.operationalStatus === 'CLOSED_OR_INACTIVE') return false;
  if (row.civilUse === 'MILITARY') return false;
  if (row.eligibility !== 'LOGISTICS_ELIGIBLE') return false;
  if (row.airLogisticsReadiness !== 'READY') return false;
  return true;
}

export function selectPassengerAndLogisticsPrimaries(
  city: { gameplayCityId: string; longitude: number; latitude: number },
  airports: readonly DualPrimaryCandidate[],
): {
  primaryPassengerAirportCandidateId: string | null;
  primaryLogisticsAirportCandidateId: string | null;
  cityReadiness: AirLogisticsReadiness;
  cityReadinessReason: string;
} {
  const withDist = airports.map((row) => ({
    ...row,
    distanceMeters: Math.round(haversineMeters(city, row.position)),
    band: airportAssociationTypeForDistance(Math.round(haversineMeters(city, row.position))),
  }));
  const inRange = withDist.filter((row) => row.band === 'DIRECT' || row.band === 'REGIONAL');
  const passengers = inRange.filter(passengerCapable).sort((a, b) => {
    const band = (x: typeof a) => (x.band === 'DIRECT' ? 1 : 0);
    return band(b) - band(a) || a.distanceMeters - b.distanceMeters || a.airportId.localeCompare(b.airportId);
  });
  const logisticsDirect = inRange.filter((row) => row.band === 'DIRECT' && logisticsCapable(row));
  const logisticsSorted = [...logisticsDirect].sort((a, b) => {
    const cargoRank = { VERIFIED_SUPPORTED: 3, PROVISIONAL_SUPPORTED: 2, UNKNOWN: 0, KNOWN_UNAVAILABLE: 0 };
    return (
      cargoRank[b.cargoCapability] - cargoRank[a.cargoCapability] ||
      (b.cargoTonnesYtd ?? 0) - (a.cargoTonnesYtd ?? 0) ||
      a.distanceMeters - b.distanceMeters ||
      a.airportId.localeCompare(b.airportId)
    );
  });
  const passengerId = passengers[0]?.airportId ?? null;
  const logisticsId = logisticsSorted[0]?.airportId ?? null;
  if (logisticsId) {
    return {
      primaryPassengerAirportCandidateId: passengerId,
      primaryLogisticsAirportCandidateId: logisticsId,
      cityReadiness: 'READY',
      cityReadinessReason: 'DIRECT logistics-ready civil airport with verified cargo evidence.',
    };
  }
  return {
    primaryPassengerAirportCandidateId: passengerId,
    primaryLogisticsAirportCandidateId: null,
    cityReadiness: 'NOT_READY',
    cityReadinessReason: logisticsDirect.length
      ? 'Direct airports exist but none are cargo READY.'
      : 'No DIRECT logistics-ready airport. Regional cargo airports are not auto-assigned.',
  };
}

export function applyOfficialCargoQaToDraft(input: {
  iataCode: string | null;
  osmMilitary: boolean;
  classification: AirportClassification;
  operationalStatus: AirportOperationalStatus;
  eligibility: AirportLogisticsEligibility;
  cargoCapability: AirportCargoCapability;
  hasDhmiCivilIdentity: boolean;
}): {
  cargoCapability: AirportCargoCapability;
  logisticsEligibility: AirportLogisticsEligibility;
  operationalStatus: AirportOperationalStatus;
  civilUse: AirportCivilUse;
  airLogisticsReadiness: AirLogisticsReadiness;
  readinessReason: string;
  cargoEvidence: AirportCargoEvidenceRecord[];
  cargoTonnesYtd: number | null;
  operationalQaApplied: boolean;
} {
  const evidence = cargoEvidenceForIata(input.iataCode);
  const opQa = operationalQaForIata(input.iataCode);
  const civilUse = resolveCivilUse({
    osmMilitary: input.osmMilitary,
    hasDhmiCivilIdentity: input.hasDhmiCivilIdentity,
    classification: input.classification,
  });
  const operationalStatus = opQa?.operationalStatus ?? input.operationalStatus;
  const cargoCapability = evidence.length ? resolveCargoCapabilityFromEvidence(evidence) : input.cargoCapability;
  const classification = operationalStatus === 'CLOSED_OR_INACTIVE' ? 'CLOSED_OR_INACTIVE' : input.classification;
  const logisticsEligibility = resolveLogisticsEligibilityFromCargo({
    cargoCapability,
    operationalStatus,
    civilUse,
    classification,
  });
  const ready = resolveAirLogisticsReadiness({
    logisticsEligibility,
    cargoCapability,
    operationalStatus,
    civilUse,
  });
  return {
    cargoCapability,
    logisticsEligibility,
    operationalStatus,
    civilUse,
    airLogisticsReadiness: ready.readiness,
    readinessReason: ready.reason,
    cargoEvidence: evidence,
    cargoTonnesYtd: dhmiCargoTonnesForIata(input.iataCode),
    operationalQaApplied: Boolean(opQa),
  };
}

export const FUTURE_AIR_CORRIDOR_ELIGIBILITY_RULE =
  'A future player AIR corridor may only be generated between cities whose primaryLogisticsAirportCandidate is READY, or PREVIEW_ONLY if an explicit later allowlist says so. Default PREVIEW_ONLY is not a corridor grant. Do not invent endpoints.' as const;
