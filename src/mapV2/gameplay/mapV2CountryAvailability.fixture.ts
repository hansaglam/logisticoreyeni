/**
 * DEV / PROVISIONAL / NOT FINAL ECONOMY
 * Map V2 Step 2B country gameplay availability fixture.
 * Independent of geoBoundaries source objects. Not read by production MapScreen.
 * Replace later with the real unlock/economy system. No player save. No backend.
 */
export const COUNTRY_GAMEPLAY_AVAILABILITY = [
  'STARTER_AVAILABLE',
  'UNLOCKED',
  'LOCKED',
  'NOT_GAMEPLAY_SUPPORTED',
] as const;

export type CountryGameplayAvailability = (typeof COUNTRY_GAMEPLAY_AVAILABILITY)[number];

export const MAP_V2_AVAILABILITY_POLICY_ID = 'map-v2-step-2b-dev-fixture-v1' as const;
export const MAP_V2_AVAILABILITY_DEFAULT: CountryGameplayAvailability = 'LOCKED';

export type CountryGameplayAvailabilityRecord = {
  geoCountryId: string;
  availability: CountryGameplayAvailability;
};

export function isCountryOpenable(availability: CountryGameplayAvailability): boolean {
  return availability === 'STARTER_AVAILABLE' || availability === 'UNLOCKED';
}

const FIXTURE_BY_ID: Record<string, CountryGameplayAvailability> = {
  'country.tur': 'STARTER_AVAILABLE',
  'country.deu': 'UNLOCKED',
  'country.gbr': 'UNLOCKED',
  'country.nld': 'UNLOCKED',
  'country.fra': 'LOCKED',
  'country.ita': 'LOCKED',
  'country.usa': 'LOCKED',
  'country.esp': 'LOCKED',
  'country.pol': 'LOCKED',
  'country.jpn': 'LOCKED',
  'country.vat': 'NOT_GAMEPLAY_SUPPORTED',
  'country.smr': 'NOT_GAMEPLAY_SUPPORTED',
  'country.ata': 'NOT_GAMEPLAY_SUPPORTED',
};

export function resolveCountryGameplayAvailability(geoCountryId: string): CountryGameplayAvailability {
  return FIXTURE_BY_ID[geoCountryId] ?? MAP_V2_AVAILABILITY_DEFAULT;
}

export function listFixtureAvailabilityExamples(): CountryGameplayAvailabilityRecord[] {
  return Object.entries(FIXTURE_BY_ID).map(([geoCountryId, availability]) => ({
    geoCountryId,
    availability,
  }));
}
