import type { WorldCountryRecord } from '../geo/worldBoundaryPackage';
import type { MapV2NameLocale } from './cityDisplayName';
export type { MapV2NameLocale };

/**
 * Verified player-facing names. Source/provenance names stay on the record.
 * Do not invent names for countries not listed here.
 */
export const VERIFIED_COUNTRY_DISPLAY_NAMES: Record<string, Partial<Record<MapV2NameLocale, string>>> = {
  'country.tur': { tr: 'Türkiye', en: 'Türkiye' },
  'country.deu': { tr: 'Almanya', en: 'Germany' },
  'country.fra': { tr: 'Fransa', en: 'France' },
  'country.gbr': { tr: 'Birleşik Krallık', en: 'United Kingdom' },
  'country.ita': { tr: 'İtalya', en: 'Italy' },
  'country.esp': { tr: 'İspanya', en: 'Spain' },
  'country.usa': { tr: 'ABD', en: 'United States' },
  'country.can': { tr: 'Kanada', en: 'Canada' },
  'country.bra': { tr: 'Brezilya', en: 'Brazil' },
  'country.rus': { tr: 'Rusya', en: 'Russia' },
  'country.chn': { tr: 'Çin', en: 'China' },
  'country.ind': { tr: 'Hindistan', en: 'India' },
  'country.jpn': { tr: 'Japonya', en: 'Japan' },
  'country.aus': { tr: 'Avustralya', en: 'Australia' },
  'country.nld': { tr: 'Hollanda', en: 'Netherlands' },
  'country.pol': { tr: 'Polonya', en: 'Poland' },
};

export function resolveCountryDisplayName(
  country: WorldCountryRecord | undefined,
  locale: MapV2NameLocale = 'tr',
): string {
  if (!country) return '';
  const verified = VERIFIED_COUNTRY_DISPLAY_NAMES[country.geoCountryId]?.[locale]?.trim();
  if (verified) return verified;
  const name = country.sourceDisplayName?.trim();
  return name && name.length > 0 ? name : country.sourceFeatureId;
}

export function countryNameKey(geoCountryId: string): string {
  return `mapV2.country.${geoCountryId}`;
}
