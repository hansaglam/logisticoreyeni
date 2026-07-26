/**
 * Mağaza ekranı görsel asset registry.
 */

import type { ImageSourcePropType } from 'react-native';

import { dashboardAssets } from './dashboardAssets';

export const shopAssetFlags = {
  useHeroWarehouse: true,
  useGridOverlay: true,
} as const;

export const shopAssets = {
  heroWarehouse: require('../../assets/shop/shop-hero-warehouse.png') as ImageSourcePropType,
  gridOverlay: dashboardAssets.gridOverlay,
} as const;

export function getShopHeroArtwork(): ImageSourcePropType {
  return shopAssets.heroWarehouse;
}
