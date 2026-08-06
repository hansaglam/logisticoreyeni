import type { GameIconName } from '../theme/icons';
import type { QuickAccessAction } from './quickAccessTypes';

export type QuickAccessIconTone = 'info' | 'amber';

export interface QuickAccessItemDef {
  key: QuickAccessAction;
  label: string;
  subtitle?: string;
  icon: GameIconName;
  iconTone?: QuickAccessIconTone;
  accessibilityLabel: string;
  accessibilityHint: string;
}

export const QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO = 0.85;
export const QUICK_ACCESS_TILE_GAP = 14;
export const QUICK_ACCESS_TILE_HEIGHT = 76;

const BASE_QUICK_ACCESS_ITEMS: QuickAccessItemDef[] = [
  {
    key: 'fleet',
    label: 'Filo',
    icon: 'truck',
    accessibilityLabel: 'Filoyu aç',
    accessibilityHint: 'Kamyonlar, şoförler ve filo yönetimini görüntüler',
  },
  {
    key: 'shop',
    label: 'Mağaza',
    icon: 'inventory',
    accessibilityLabel: 'Mağazayı aç',
    accessibilityHint: 'Kamyon, şoför ve ekipman satın alma ekranını açar',
  },
  {
    key: 'warehouse',
    label: 'Depolar',
    icon: 'warehouse',
    accessibilityLabel: 'Depoları aç',
    accessibilityHint: 'Depo envanteri ve transferlerini görüntüler',
  },
  {
    key: 'finance',
    label: 'Finans',
    icon: 'cash',
    accessibilityLabel: 'Finansı aç',
    accessibilityHint: 'Gelir, gider ve finans özetini görüntüler',
  },
];

const VEHICLE_MARKETPLACE_ITEM: QuickAccessItemDef = {
  key: 'vehicleMarketplace',
  label: 'Araç Pazarı',
  subtitle: 'Oyuncu ilanları',
  icon: 'truck',
  accessibilityLabel: 'Araç pazarını aç',
  accessibilityHint: 'Oyuncu ilanlarını görüntüler',
};

const TRAILING_QUICK_ACCESS_ITEMS: QuickAccessItemDef[] = [
  {
    key: 'missions',
    label: 'Görevler',
    icon: 'contract',
    accessibilityLabel: 'Görevleri aç',
    accessibilityHint: 'Günlük ve haftalık görevleri görüntüler',
  },
  {
    key: 'leaderboard',
    label: 'Liderlik',
    subtitle: 'Haftalık sıralama',
    icon: 'trophy',
    iconTone: 'amber',
    accessibilityLabel: 'Liderlik tablosunu aç',
    accessibilityHint: 'Haftalık sıralamayı ve kendi dereceni görüntüler',
  },
  {
    key: 'account',
    label: 'Hesap',
    subtitle: 'Profil ve ayarlar',
    icon: 'account',
    accessibilityLabel: 'Hesap ayarlarını aç',
    accessibilityHint: 'Profil, giriş ve hesap seçeneklerini görüntüler',
  },
];

export const QUICK_ACCESS_CARD_ORDER: QuickAccessAction[] = [
  'fleet',
  'shop',
  'warehouse',
  'finance',
  'vehicleMarketplace',
  'missions',
  'leaderboard',
  'account',
];

export function buildQuickAccessItems(vehicleMarketplaceEnabled: boolean): QuickAccessItemDef[] {
  return [
    ...BASE_QUICK_ACCESS_ITEMS,
    ...(vehicleMarketplaceEnabled ? [VEHICLE_MARKETPLACE_ITEM] : []),
    ...TRAILING_QUICK_ACCESS_ITEMS,
  ];
}
