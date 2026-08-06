/**
 * Mağaza ekranı görsel asset registry.
 */

import type { ImageSourcePropType } from 'react-native';

export const shopAssetFlags = {
  useHeroWarehouse: true,
} as const;

export const shopAssets = {
  heroWarehouse: require('../../assets/shop/shop-hero-warehouse.png') as ImageSourcePropType,
} as const;

export function getShopHeroArtwork(): ImageSourcePropType {
  return shopAssets.heroWarehouse;
}
