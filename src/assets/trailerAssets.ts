/**
 * Filo dorse görsel asset registry ve katalog eşleştirmesi.
 *
 * Görseller proje kökünde: assets/fleet/trailers/
 * Stabil eşleştirme anahtarları: Trailer.type (TrailerType) ve catalogId.
 */

import type { ImageSourcePropType } from 'react-native';

import type { Trailer, TrailerType } from '../types/game';

export const fleetTrailerAssets = {
  standardTrailer: require('../../assets/fleet/trailers/standard-trailer.png'),
  heavyHaulTrailer: require('../../assets/fleet/trailers/heavy-haul-trailer.png'),
  refrigeratedTrailer: require('../../assets/fleet/trailers/refrigerated-trailer.png'),
  containerTrailer: require('../../assets/fleet/trailers/container-trailer.png'),
} as const satisfies Record<string, ImageSourcePropType>;

export type FleetTrailerAssetKey = keyof typeof fleetTrailerAssets;

const TRAILER_TYPES: readonly TrailerType[] = [
  'standard',
  'heavy',
  'refrigerated',
  'container',
];

/** Dorse türü → registry anahtarı (Trailer.type) */
export const FLEET_TRAILER_ARTWORK_BY_TYPE: Record<TrailerType, FleetTrailerAssetKey> = {
  standard: 'standardTrailer',
  heavy: 'heavyHaulTrailer',
  refrigerated: 'refrigeratedTrailer',
  container: 'containerTrailer',
};

/** Mağaza katalog kimliği → registry anahtarı (TrailerMarketItem.id / Trailer.catalogId) */
export const FLEET_TRAILER_ARTWORK_BY_CATALOG_ID: Record<string, FleetTrailerAssetKey> = {
  'trailer-standard': 'standardTrailer',
  'trailer-heavy': 'heavyHaulTrailer',
  'trailer-refrigerated': 'refrigeratedTrailer',
  'trailer-container': 'containerTrailer',
};

function isTrailerType(value: string): value is TrailerType {
  return TRAILER_TYPES.includes(value as TrailerType);
}

/** Oyuncu dorsesi için stabil katalog kimliği; yoksa türden türetilir. */
export function getTrailerCatalogId(
  trailer: Pick<Trailer, 'catalogId' | 'type'>,
): string | null {
  if (trailer.catalogId) {
    return trailer.catalogId;
  }

  switch (trailer.type) {
    case 'standard':
      return 'trailer-standard';
    case 'heavy':
      return 'trailer-heavy';
    case 'refrigerated':
      return 'trailer-refrigerated';
    case 'container':
      return 'trailer-container';
    default:
      return null;
  }
}

/**
 * Dorse türüne göre görsel döndürür.
 * Projede stabil alan Trailer.type (TrailerType) değeridir.
 */
export function getTrailerArtworkByType(
  trailerType?: string | null,
): ImageSourcePropType | null {
  if (!trailerType || !isTrailerType(trailerType)) {
    return null;
  }

  const assetKey = FLEET_TRAILER_ARTWORK_BY_TYPE[trailerType];
  return fleetTrailerAssets[assetKey];
}

/** Oyuncu dorsesi için görsel döndürür; bilinmeyen modelde null. */
export function getTrailerArtwork(
  trailer: Pick<Trailer, 'catalogId' | 'type'>,
): ImageSourcePropType | null {
  const catalogId = getTrailerCatalogId(trailer);
  if (catalogId) {
    const assetKeyByCatalog = FLEET_TRAILER_ARTWORK_BY_CATALOG_ID[catalogId];
    if (assetKeyByCatalog) {
      return fleetTrailerAssets[assetKeyByCatalog];
    }
  }

  return getTrailerArtworkByType(trailer.type);
}
