import type { ComponentProps } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export const gameIcons = {
  cash: 'cash-multiple',
  revenue: 'trending-up',
  expense: 'trending-down',
  profit: 'chart-line-variant',
  contract: 'clipboard-text-outline',
  truck: 'truck-outline',
  driver: 'account-tie-outline',
  warehouse: 'warehouse',
  market: 'chart-line',
  route: 'routes',
  map: 'map-outline',
  city: 'city-variant-outline',
  company: 'office-building-outline',
  fuel: 'gas-station-outline',
  time: 'clock-outline',
  distance: 'map-marker-distance',
  inventory: 'package-variant-closed',
  product: 'package-variant-closed',
  package: 'package-variant',
  chip: 'chip',
  cog: 'cog',
  foodApple: 'food-apple',
  cube: 'cube-outline',
  textile: 'tshirt-crew-outline',
  sofa: 'sofa-outline',
  cup: 'cup-outline',
  alert: 'alert-outline',
  lock: 'lock-outline',
  urgent: 'clock-alert-outline',
  repair: 'wrench-outline',
  maintenance: 'cog-outline',
  warning: 'alert-circle-outline',
  success: 'check-circle-outline',
  level: 'shield-star-outline',
  xp: 'star-circle-outline',
  reputation: 'star-outline',
  employees: 'account-group-outline',
  headquarters: 'home-city-outline',
  upgrade: 'arrow-up-bold-circle-outline',
  filter: 'filter-variant',
  refresh: 'refresh',
  settings: 'cog-outline',
  notification: 'bell-outline',
  close: 'close',
  back: 'chevron-left',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  chevronRight: 'chevron-right',
  plus: 'plus',
  minus: 'minus',
  search: 'magnify',
  dashboard: 'view-dashboard-outline',
  more: 'dots-grid',
  pause: 'pause',
  play: 'play',
} as const;

export type GameIconName = keyof typeof gameIcons;

export type VectorIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Ürün türüne göre oyun içi ikon eşlemesi */
export const productIcons = {
  electronics: 'chip',
  machinery: 'cog',
  fruit: 'foodApple',
  steel: 'cube',
  textile: 'textile',
  furniture: 'sofa',
  beverage: 'cup',
  default: 'inventory',
} as const satisfies Record<string, GameIconName>;

export type ProductIconKey = keyof typeof productIcons;

export function getProductGameIcon(productId?: string | null): GameIconName {
  if (!productId) {
    return productIcons.default;
  }
  if (productId in productIcons && productId !== 'default') {
    return productIcons[productId as Exclude<ProductIconKey, 'default'>];
  }
  return productIcons.default;
}

export function resolveGameIcon(name: GameIconName): VectorIconName {
  return gameIcons[name] as VectorIconName;
}

export { MaterialCommunityIcons };
