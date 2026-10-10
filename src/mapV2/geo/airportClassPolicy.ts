export const AIRPORT_CLASSIFICATION_POLICY_VERSION = 'map-v2-airport-class-v1' as const;
export const AIRPORT_CLUSTER_POLICY_VERSION = 'map-v2-airport-cluster-v1' as const;
export const AIRPORT_INGEST_PROCESSING_VERSION = 'map-v2-airport-osm-1' as const;
export const AIRPORT_CITY_ASSOCIATION_POLICY_VERSION = 'map-v2-airport-city-assoc-v2' as const;
export const AIRPORT_CARGO_POLICY_VERSION = 'map-v2-airport-cargo-qa-v1' as const;

export const AIRPORT_CLASSIFICATIONS = [
  'COMMERCIAL_AIRPORT',
  'INTERNATIONAL_AIRPORT',
  'DOMESTIC_AIRPORT',
  'CARGO_AIRPORT',
  'MILITARY_AIRFIELD',
  'GENERAL_AVIATION',
  'HELIPORT',
  'CLOSED_OR_INACTIVE',
  'UNKNOWN_AIRPORT',
] as const;
export type AirportClassification = (typeof AIRPORT_CLASSIFICATIONS)[number];

export const AIRPORT_LOGISTICS_ELIGIBILITY = [
  'LOGISTICS_ELIGIBLE',
  'LOGISTICS_ELIGIBLE_PREVIEW',
  'PASSENGER_ONLY',
  'NON_LOGISTICS',
  'MILITARY_RESTRICTED',
  'UNRESOLVED',
] as const;
export type AirportLogisticsEligibility = (typeof AIRPORT_LOGISTICS_ELIGIBILITY)[number];

export const AIRPORT_CARGO_CAPABILITIES = [
  'VERIFIED_SUPPORTED',
  'PROVISIONAL_SUPPORTED',
  'UNKNOWN',
  'KNOWN_UNAVAILABLE',
] as const;
export type AirportCargoCapability = (typeof AIRPORT_CARGO_CAPABILITIES)[number];

function tag(props: Record<string, unknown> | undefined, key: string): string {
  const raw = props?.[key];
  if (raw == null || raw === '') return '';
  return String(raw).trim().toLowerCase();
}

export function isValidIata(code: string | null | undefined): boolean {
  return Boolean(code && /^[A-Z]{3}$/.test(code.trim()));
}

export function isValidIcao(code: string | null | undefined): boolean {
  return Boolean(code && /^[A-Z]{4}$/.test(code.trim()));
}

export function readIata(props: Record<string, unknown> | undefined): string | null {
  const code = String(props?.iata ?? props?.iata_code ?? '').trim().toUpperCase();
  return isValidIata(code) ? code : null;
}

export function readIcao(props: Record<string, unknown> | undefined): string | null {
  const code = String(props?.icao ?? props?.icao_code ?? '').trim().toUpperCase();
  return isValidIcao(code) ? code : null;
}

export function isMilitaryAirportTags(props: Record<string, unknown> | undefined): boolean {
  const military = tag(props, 'military');
  const landuse = tag(props, 'landuse');
  const aerodromeType = tag(props, 'aerodrome:type');
  const access = tag(props, 'access');
  if (military === 'airfield' || military === 'yes') return true;
  if (landuse === 'military') return true;
  if (aerodromeType === 'military' || aerodromeType.includes('military')) return true;
  if (access === 'military' || access === 'private' && aerodromeType === 'military') return true;
  return false;
}

export function isClosedAirportTags(props: Record<string, unknown> | undefined): boolean {
  if (tag(props, 'disused') === 'yes' || tag(props, 'abandoned') === 'yes') return true;
  const aerodromeType = tag(props, 'aerodrome:type');
  if (aerodromeType === 'abandoned' || aerodromeType === 'disused') return true;
  if (tag(props, 'aeroway') === 'abandoned') return true;
  return /closed|kapalı|kapatılmış|disused|abandoned/i.test(String(props?.name ?? ''));
}

export function isHelipadOnly(props: Record<string, unknown> | undefined): boolean {
  const aeroway = tag(props, 'aeroway');
  if (aeroway === 'helipad' || aeroway === 'heliport') {
    if (tag(props, 'aerodrome') === 'yes' || tag(props, 'aerodrome:type')) return false;
    return true;
  }
  return false;
}

export function hasExplicitCargoEvidence(props: Record<string, unknown> | undefined): boolean {
  const cargo = tag(props, 'cargo');
  const aerodromeType = tag(props, 'aerodrome:type');
  const industrial = tag(props, 'industrial');
  if (cargo === 'yes' || cargo.includes('freight') || cargo.includes('goods')) return true;
  if (aerodromeType === 'cargo' || aerodromeType.includes('cargo')) return true;
  if (industrial === 'cargo') return true;
  if (tag(props, 'cargo:yes') === 'yes') return true;
  return false;
}

export function classifyAirportTags(props: Record<string, unknown> | undefined): {
  classification: AirportClassification;
  eligibility: AirportLogisticsEligibility;
  cargoCapability: AirportCargoCapability;
  includeAsGeoAirport: boolean;
  supportGeometry: boolean;
} {
  const aeroway = tag(props, 'aeroway');
  const aerodromeType = tag(props, 'aerodrome:type');
  const iata = readIata(props);
  const icao = readIcao(props);
  const cargo = hasExplicitCargoEvidence(props);

  if (['runway', 'taxiway', 'apron', 'terminal', 'hangar', 'gate'].includes(aeroway) && aeroway !== 'aerodrome') {
    return {
      classification: 'UNKNOWN_AIRPORT',
      eligibility: 'UNRESOLVED',
      cargoCapability: 'UNKNOWN',
      includeAsGeoAirport: false,
      supportGeometry: true,
    };
  }
  if (isHelipadOnly(props)) {
    return {
      classification: 'HELIPORT',
      eligibility: 'NON_LOGISTICS',
      cargoCapability: 'UNKNOWN',
      includeAsGeoAirport: false,
      supportGeometry: true,
    };
  }
  if (isClosedAirportTags(props)) {
    return {
      classification: 'CLOSED_OR_INACTIVE',
      eligibility: 'NON_LOGISTICS',
      cargoCapability: cargo ? 'PROVISIONAL_SUPPORTED' : 'UNKNOWN',
      includeAsGeoAirport: true,
      supportGeometry: false,
    };
  }
  if (isMilitaryAirportTags(props) && !iata) {
    return {
      classification: 'MILITARY_AIRFIELD',
      eligibility: 'MILITARY_RESTRICTED',
      cargoCapability: 'UNKNOWN',
      includeAsGeoAirport: true,
      supportGeometry: false,
    };
  }
  if (cargo) {
    return {
      classification: 'CARGO_AIRPORT',
      eligibility: 'LOGISTICS_ELIGIBLE',
      cargoCapability: 'PROVISIONAL_SUPPORTED',
      includeAsGeoAirport: true,
      supportGeometry: false,
    };
  }
  if (aerodromeType === 'international' || tag(props, 'international') === 'yes') {
    return {
      classification: 'INTERNATIONAL_AIRPORT',
      eligibility: 'PASSENGER_ONLY',
      cargoCapability: 'UNKNOWN',
      includeAsGeoAirport: true,
      supportGeometry: false,
    };
  }
  if (aerodromeType === 'regional' || aerodromeType === 'domestic') {
    return {
      classification: 'DOMESTIC_AIRPORT',
      eligibility: 'PASSENGER_ONLY',
      cargoCapability: 'UNKNOWN',
      includeAsGeoAirport: true,
      supportGeometry: false,
    };
  }
  if (aeroway === 'aerodrome' || tag(props, 'aerodrome') === 'yes') {
    if (iata || icao) {
      const militaryMixed = isMilitaryAirportTags(props);
      return {
        classification: militaryMixed ? 'MILITARY_AIRFIELD' : 'COMMERCIAL_AIRPORT',
        eligibility: militaryMixed ? 'MILITARY_RESTRICTED' : 'PASSENGER_ONLY',
        cargoCapability: 'UNKNOWN',
        includeAsGeoAirport: true,
        supportGeometry: false,
      };
    }
    return {
      classification: 'GENERAL_AVIATION',
      eligibility: 'NON_LOGISTICS',
      cargoCapability: 'UNKNOWN',
      includeAsGeoAirport: true,
      supportGeometry: false,
    };
  }
  return {
    classification: 'UNKNOWN_AIRPORT',
    eligibility: 'UNRESOLVED',
    cargoCapability: 'UNKNOWN',
    includeAsGeoAirport: false,
    supportGeometry: false,
  };
}

export function mergeAirportClusterClassification(
  rows: readonly { classification: AirportClassification; eligibility: AirportLogisticsEligibility; cargoCapability: AirportCargoCapability; includeAsGeoAirport?: boolean }[],
): { classification: AirportClassification; eligibility: AirportLogisticsEligibility; cargoCapability: AirportCargoCapability } {
  const seeds = rows.filter((row) => row.includeAsGeoAirport !== false);
  const use = seeds.length > 0 ? seeds : rows;
  const rank: Record<AirportClassification, number> = {
    CARGO_AIRPORT: 90,
    INTERNATIONAL_AIRPORT: 80,
    COMMERCIAL_AIRPORT: 70,
    DOMESTIC_AIRPORT: 60,
    GENERAL_AVIATION: 30,
    MILITARY_AIRFIELD: 20,
    CLOSED_OR_INACTIVE: 10,
    HELIPORT: 5,
    UNKNOWN_AIRPORT: 0,
  };
  let best = use[0] ?? {
    classification: 'UNKNOWN_AIRPORT' as const,
    eligibility: 'UNRESOLVED' as const,
    cargoCapability: 'UNKNOWN' as const,
  };
  for (const row of use) {
    if (rank[row.classification] > rank[best.classification]) best = row;
  }
  const cargo = use.some((row) => row.cargoCapability === 'PROVISIONAL_SUPPORTED' || row.cargoCapability === 'VERIFIED_SUPPORTED')
    ? 'PROVISIONAL_SUPPORTED'
    : use.every((row) => row.cargoCapability === 'KNOWN_UNAVAILABLE')
      ? 'KNOWN_UNAVAILABLE'
      : 'UNKNOWN';
  if (use.some((row) => row.eligibility === 'MILITARY_RESTRICTED') && !use.some((row) => row.classification === 'INTERNATIONAL_AIRPORT' || row.classification === 'COMMERCIAL_AIRPORT' || row.classification === 'CARGO_AIRPORT')) {
    return { classification: 'MILITARY_AIRFIELD', eligibility: 'MILITARY_RESTRICTED', cargoCapability: cargo };
  }
  if (use.some((row) => row.eligibility === 'LOGISTICS_ELIGIBLE')) {
    return { classification: best.classification === 'UNKNOWN_AIRPORT' ? 'CARGO_AIRPORT' : best.classification, eligibility: 'LOGISTICS_ELIGIBLE', cargoCapability: cargo };
  }
  if (best.classification === 'CLOSED_OR_INACTIVE') {
    return { classification: 'CLOSED_OR_INACTIVE', eligibility: 'NON_LOGISTICS', cargoCapability: cargo };
  }
  if (best.classification === 'HELIPORT') {
    return { classification: 'HELIPORT', eligibility: 'NON_LOGISTICS', cargoCapability: cargo };
  }
  return { classification: best.classification, eligibility: best.eligibility, cargoCapability: cargo };
}
