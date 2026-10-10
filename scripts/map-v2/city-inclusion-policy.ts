/**
 * Türkiye city inclusion — source-backed Natural Earth 10m populated places only.
 * Importance uses FEATURECLA + POP_MAX from the source. No AI ranking.
 */
export const CITY_INCLUSION_POLICY_ID = 'tur-ne10m-v1';

export const CITY_INCLUSION_POLICY = {
  id: CITY_INCLUSION_POLICY_ID,
  countryIso3: 'TUR',
  geoCountryId: 'country.tur',
  /** Include every TUR row in ne_10m_populated_places. No hamlets beyond that file. */
  includeAllSourceRowsForCountry: true,
  overview: {
    minPopulation: 500_000,
    includeAdmin0Capital: true,
    includeMappedGameplayCities: true,
  },
  regional: {
    minPopulation: 150_000,
    includeAdmin1Capital: true,
  },
} as const;

export const LEGACY_GAMEPLAY_CITY_SOURCE_ASCII: Record<string, string> = {
  izmir: 'Izmir',
  istanbul: 'Istanbul',
  ankara: 'Ankara',
  bursa: 'Bursa',
  antalya: 'Antalya',
  adana: 'Adana',
  diyarbakir: 'Diyarbakir',
  trabzon: 'Trabzon',
};

/** Plausibility envelopes for mapping QA only. Not coordinates to assign. */
export const LEGACY_CITY_PLAUSIBILITY_WGS84: Record<
  string,
  { minLon: number; maxLon: number; minLat: number; maxLat: number; region: string }
> = {
  izmir: { minLon: 26.5, maxLon: 28.0, minLat: 37.8, maxLat: 38.9, region: 'west-coast' },
  istanbul: { minLon: 28.4, maxLon: 29.5, minLat: 40.7, maxLat: 41.4, region: 'bosphorus' },
  ankara: { minLon: 32.3, maxLon: 33.4, minLat: 39.5, maxLat: 40.3, region: 'central' },
  bursa: { minLon: 28.7, maxLon: 29.5, minLat: 39.9, maxLat: 40.5, region: 'northwest' },
  antalya: { minLon: 30.2, maxLon: 31.2, minLat: 36.6, maxLat: 37.2, region: 'south-coast' },
  adana: { minLon: 34.8, maxLon: 35.8, minLat: 36.7, maxLat: 37.3, region: 'south' },
  diyarbakir: { minLon: 39.8, maxLon: 40.6, minLat: 37.6, maxLat: 38.2, region: 'southeast' },
  trabzon: { minLon: 39.3, maxLon: 40.1, minLat: 40.7, maxLat: 41.2, region: 'black-sea' },
};
