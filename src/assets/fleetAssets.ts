/**
 * Filo kamyon görsel asset registry ve katalog eşleştirmesi.
 *
 * Görseller proje kökünde: assets/fleet/trucks/
 * Stabil eşleştirme anahtarı: catalogId (getTruckCatalogId ile çözülür).
 */

import type { ImageSourcePropType } from 'react-native';

import { getTruckCatalogId } from '../data/trucks';
import type { Truck } from '../types/game';

export const fleetTruckAssets = {
  fordanCargoPro: require('../../assets/fleet/trucks/fordan-cargopro.png'),
  izmirExpress: require('../../assets/fleet/trucks/izmir-express.png'),
  sternbergAtlas: require('../../assets/fleet/trucks/sternberg-atlas.png'),
  nordvikTitan: require('../../assets/fleet/trucks/nordvik-titan.png'),
  marmaraHeavy: require('../../assets/fleet/trucks/marmara-heavy.png'),
  egeColdline: require('../../assets/fleet/trucks/ege-coldline.png'),
} as const;

export type FleetTruckAssetKey = keyof typeof fleetTruckAssets;

/** Katalog / şablon kimliği → registry anahtarı */
export const FLEET_TRUCK_ARTWORK_BY_CATALOG_ID: Record<string, FleetTruckAssetKey> = {
  'truck-starter-1': 'izmirExpress',
  'truck-ford-cargo': 'fordanCargoPro',
  'truck-volvo-fh': 'nordvikTitan',
  'truck-mercedes-actros': 'sternbergAtlas',
  'truck-heavy-haul': 'marmaraHeavy',
  'truck-refrigerated': 'egeColdline',
};

/**
 * Katalog şablon kimliğine göre kamyon görseli döndürür.
 * Projede stabil kimlik catalogId'dir; templateId parametresi bu değeri temsil eder.
 */
export function getTruckArtworkByTemplateId(
  templateId?: string | null,
): ImageSourcePropType | null {
  if (!templateId) {
    return null;
  }

  const assetKey = FLEET_TRUCK_ARTWORK_BY_CATALOG_ID[templateId];
  if (!assetKey) {
    return null;
  }

  return fleetTruckAssets[assetKey];
}

/** Oyuncu kamyonu için görsel döndürür; bilinmeyen modelde null. */
export function getTruckArtwork(truck: Pick<Truck, 'id' | 'catalogId'>): ImageSourcePropType | null {
  return getTruckArtworkByTemplateId(getTruckCatalogId(truck));
}
