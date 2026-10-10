import type { GeoCityRecord } from '../geo/cityPackage';

export type MapV2NameLocale = 'tr' | 'en';

/**
 * Player-facing city names. Never use geoCityId in UI.
 * Does not invent translations for missing localized fields.
 */
export function resolveCityDisplayName(city: GeoCityRecord | undefined, locale: MapV2NameLocale): string {
  if (!city) return '';
  if (locale === 'tr') {
    const tr = city.names.tr?.trim();
    if (tr) return tr;
    const source = city.sourceName?.trim();
    if (source) return source;
    return city.sourceNameAscii;
  }
  const en = city.names.en?.trim();
  if (en) return en;
  const ascii = city.sourceNameAscii?.trim();
  if (ascii) return ascii;
  return city.sourceName;
}

export function cityNameKey(geoCityId: string): string {
  return `mapV2.city.${geoCityId}`;
}
