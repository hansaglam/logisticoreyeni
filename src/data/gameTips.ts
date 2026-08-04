/**
 * Akıllı Oyun İpuçları — lokalize edilebilir ipucu kataloğu.
 * Metinler component içine dağılmaz; ileride `en` alanı eklenebilir.
 */

import type { GameIconName } from '../theme/icons';

export type GameTipCategory =
  | 'onboarding'
  | 'trucks'
  | 'drivers'
  | 'fuel'
  | 'contracts'
  | 'warehouses'
  | 'trailers'
  | 'market'
  | 'vehicle_marketplace'
  | 'reputation'
  | 'level'
  | 'cloud_save'
  | 'leaderboard'
  | 'finance'
  | 'route_delivery'
  | 'maintenance';

/** Koşul anahtarları — değerlendirme `smartGameTips` içinde yapılır. */
export type GameTipConditionKey =
  | 'always'
  | 'early_session'
  | 'low_fuel'
  | 'idle_truck'
  | 'truck_without_driver'
  | 'warehouse_full'
  | 'delivery_urgent'
  | 'account_unlinked'
  | 'low_reputation'
  | 'low_condition'
  | 'no_trailers'
  | 'low_cash';

/** Banner dokunuşunda hedef navigasyon. */
export type GameTipTargetRoute =
  | 'fleet'
  | 'contracts'
  | 'market'
  | 'warehouse'
  | 'account'
  | 'vehicleMarketplace'
  | 'leaderboard'
  | 'map'
  | 'finance';

export interface GameTipLocalizedText {
  tr: string;
  en?: string;
}

export interface GameTipDefinition {
  id: string;
  category: GameTipCategory;
  message: GameTipLocalizedText;
  icon: GameIconName;
  /** Yüksek değer = daha öncelikli. Kritik bağlamsal ipuçları 80+. */
  priority: number;
  targetRoute: GameTipTargetRoute | null;
  condition: GameTipConditionKey;
  /** true ise sorun çözülene kadar uzun süre önde kalır. */
  critical?: boolean;
}

export const GAME_TIPS: readonly GameTipDefinition[] = [
  // —— Başlangıç ——
  {
    id: 'onboarding-truck-stays',
    category: 'onboarding',
    message: {
      tr: 'Kamyonlar teslimatı bitirdiği şehirde kalır. Yeni iş seçerken konumunu kontrol et.',
    },
    icon: 'city',
    priority: 40,
    targetRoute: 'contracts',
    condition: 'early_session',
  },
  {
    id: 'onboarding-combine-jobs',
    category: 'onboarding',
    message: {
      tr: 'Aynı şehirdeki işleri birleştirmek boş kilometreyi azaltır.',
    },
    icon: 'route',
    priority: 35,
    targetRoute: 'contracts',
    condition: 'early_session',
  },
  {
    id: 'onboarding-cash-reserve',
    category: 'onboarding',
    message: {
      tr: 'Nakit rezervi bırak. Yakıt, bakım ve maaş giderleri devam eder.',
    },
    icon: 'cash',
    priority: 36,
    targetRoute: 'finance',
    condition: 'early_session',
  },

  // —— Kamyonlar / Rota ——
  {
    id: 'trucks-stay-city',
    category: 'trucks',
    message: {
      tr: 'Kamyonlar teslimatı bitirdiği şehirde kalır. Yeni iş seçerken konumunu kontrol et.',
    },
    icon: 'truck',
    priority: 20,
    targetRoute: 'contracts',
    condition: 'always',
  },
  {
    id: 'trucks-idle-jobs',
    category: 'trucks',
    message: {
      tr: 'Boşta kamyonun var. Konumuna uygun yeni bir sözleşme seç.',
    },
    icon: 'truck',
    priority: 85,
    targetRoute: 'contracts',
    condition: 'idle_truck',
    critical: true,
  },
  {
    id: 'route-combine-jobs',
    category: 'route_delivery',
    message: {
      tr: 'Aynı şehirdeki işleri birleştirmek boş kilometreyi azaltır.',
    },
    icon: 'route',
    priority: 18,
    targetRoute: 'map',
    condition: 'always',
  },
  {
    id: 'route-deadline',
    category: 'route_delivery',
    message: {
      tr: 'Teslimat süresini aşmak itibar kaybına yol açabilir.',
    },
    icon: 'urgent',
    priority: 90,
    targetRoute: 'contracts',
    condition: 'delivery_urgent',
    critical: true,
  },

  // —— Şoförler ——
  {
    id: 'drivers-skills',
    category: 'drivers',
    message: {
      tr: 'Şoför becerileri teslimat süresini ve yakıt tüketimini etkiler.',
    },
    icon: 'driver',
    priority: 18,
    targetRoute: 'fleet',
    condition: 'always',
  },
  {
    id: 'drivers-unassigned',
    category: 'drivers',
    message: {
      tr: 'Şoförsüz kamyonlar sözleşmeye çıkamaz.',
    },
    icon: 'driver',
    priority: 92,
    targetRoute: 'fleet',
    condition: 'truck_without_driver',
    critical: true,
  },

  // —— Yakıt ——
  {
    id: 'fuel-refill',
    category: 'fuel',
    message: {
      tr: 'Yakıtı düşük araçlar yolda kalabilir. Uzun rota öncesi depoyu doldur.',
    },
    icon: 'fuel',
    priority: 95,
    targetRoute: 'fleet',
    condition: 'low_fuel',
    critical: true,
  },
  {
    id: 'fuel-general',
    category: 'fuel',
    message: {
      tr: 'Yakıtı düşük araçlar yolda kalabilir. Uzun rota öncesi depoyu doldur.',
    },
    icon: 'fuel',
    priority: 16,
    targetRoute: 'fleet',
    condition: 'always',
  },

  // —— Sözleşmeler ——
  {
    id: 'contracts-deadline-general',
    category: 'contracts',
    message: {
      tr: 'Teslimat süresini aşmak itibar kaybına yol açabilir.',
    },
    icon: 'contract',
    priority: 17,
    targetRoute: 'contracts',
    condition: 'always',
  },

  // —— Depolar ——
  {
    id: 'warehouses-full',
    category: 'warehouses',
    message: {
      tr: 'Depo kapasitesi dolduğunda yeni ürün satın alamazsın.',
    },
    icon: 'warehouse',
    priority: 88,
    targetRoute: 'warehouse',
    condition: 'warehouse_full',
    critical: true,
  },
  {
    id: 'warehouses-general',
    category: 'warehouses',
    message: {
      tr: 'Depo kapasitesi dolduğunda yeni ürün satın alamazsın.',
    },
    icon: 'warehouse',
    priority: 15,
    targetRoute: 'warehouse',
    condition: 'always',
  },

  // —— Dorseler ——
  {
    id: 'trailers-type',
    category: 'trailers',
    message: {
      tr: 'Dorse türü, kabul edebileceğin yük sözleşmelerini belirler.',
    },
    icon: 'trailer',
    priority: 82,
    targetRoute: 'fleet',
    condition: 'no_trailers',
    critical: true,
  },
  {
    id: 'trailers-general',
    category: 'trailers',
    message: {
      tr: 'Dorse türü, kabul edebileceğin yük sözleşmelerini belirler.',
    },
    icon: 'trailer',
    priority: 15,
    targetRoute: 'fleet',
    condition: 'always',
  },

  // —— Piyasa ——
  {
    id: 'market-arbitrage',
    category: 'market',
    message: {
      tr: 'Piyasa fiyatları şehirden şehre değişir. Ucuz şehirden alıp pahalı şehirde sat.',
    },
    icon: 'market',
    priority: 19,
    targetRoute: 'market',
    condition: 'always',
  },

  // —— Araç Pazarı ——
  {
    id: 'vehicle-marketplace-safe',
    category: 'vehicle_marketplace',
    message: {
      tr: 'Araç Pazarı’ndaki araç satışları backend tarafından güvenli şekilde işlenir.',
    },
    icon: 'truck',
    priority: 14,
    targetRoute: 'vehicleMarketplace',
    condition: 'always',
  },

  // —— İtibar ——
  {
    id: 'reputation-low',
    category: 'reputation',
    message: {
      tr: 'Yüksek itibar, daha değerli sözleşmelerin açılmasını sağlar.',
    },
    icon: 'reputation',
    priority: 84,
    targetRoute: 'contracts',
    condition: 'low_reputation',
    critical: true,
  },
  {
    id: 'reputation-general',
    category: 'reputation',
    message: {
      tr: 'Yüksek itibar, daha değerli sözleşmelerin açılmasını sağlar.',
    },
    icon: 'reputation',
    priority: 16,
    targetRoute: 'contracts',
    condition: 'always',
  },

  // —— Seviye ——
  {
    id: 'level-unlocks',
    category: 'level',
    message: {
      tr: 'Seviye atladıkça yeni araçlar, şoförler ve sözleşme türleri açılır.',
    },
    icon: 'level',
    priority: 14,
    targetRoute: null,
    condition: 'always',
  },

  // —— Bulut / Hesap ——
  {
    id: 'cloud-save-link',
    category: 'cloud_save',
    message: {
      tr: 'Bulut kaydı, ilerlemeni farklı cihazlarda korur.',
    },
    icon: 'account',
    priority: 86,
    targetRoute: 'account',
    condition: 'account_unlinked',
    critical: true,
  },
  {
    id: 'cloud-save-general',
    category: 'cloud_save',
    message: {
      tr: 'Bulut kaydı, ilerlemeni farklı cihazlarda korur.',
    },
    icon: 'account',
    priority: 13,
    targetRoute: 'account',
    condition: 'always',
  },

  // —— Liderlik ——
  {
    id: 'leaderboard-link',
    category: 'leaderboard',
    message: {
      tr: 'Liderlik Tablosuna katılmak için hesabını bağlamalısın.',
    },
    icon: 'trophy',
    priority: 83,
    targetRoute: 'leaderboard',
    condition: 'account_unlinked',
    critical: true,
  },
  {
    id: 'leaderboard-general',
    category: 'leaderboard',
    message: {
      tr: 'Liderlik Tablosuna katılmak için hesabını bağlamalısın.',
    },
    icon: 'trophy',
    priority: 12,
    targetRoute: 'leaderboard',
    condition: 'always',
  },

  // —— Finans ——
  {
    id: 'finance-reserve',
    category: 'finance',
    message: {
      tr: 'Nakit rezervi bırak. Yakıt, bakım ve maaş giderleri devam eder.',
    },
    icon: 'cash',
    priority: 87,
    targetRoute: 'finance',
    condition: 'low_cash',
    critical: true,
  },
  {
    id: 'finance-general',
    category: 'finance',
    message: {
      tr: 'Nakit rezervi bırak. Yakıt, bakım ve maaş giderleri devam eder.',
    },
    icon: 'cash',
    priority: 15,
    targetRoute: 'finance',
    condition: 'always',
  },

  // —— Bakım ——
  {
    id: 'maintenance-condition',
    category: 'maintenance',
    message: {
      tr: 'Hasarlı kamyonlar daha fazla yakıt tüketebilir.',
    },
    icon: 'repair',
    priority: 89,
    targetRoute: 'fleet',
    condition: 'low_condition',
    critical: true,
  },
  {
    id: 'maintenance-general',
    category: 'maintenance',
    message: {
      tr: 'Hasarlı kamyonlar daha fazla yakıt tüketebilir.',
    },
    icon: 'repair',
    priority: 16,
    targetRoute: 'fleet',
    condition: 'always',
  },
] as const;

export function getTipMessage(
  tip: GameTipDefinition,
  locale: 'tr' | 'en' = 'tr',
): string {
  if (locale === 'en' && tip.message.en) {
    return tip.message.en;
  }
  return tip.message.tr;
}
