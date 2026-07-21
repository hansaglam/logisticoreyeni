/**
 * Piyasa olayı şablonları — Retention Pack V1 Phase 2
 */

import type { ProductId, WorldEventImpact, WorldEventSeverity, WorldEventType } from '../types/game';

export const WORLD_EVENTS_VERSION = 1;

export const MAX_ACTIVE_WORLD_EVENTS = 4;
export const MAX_NEW_EVENTS_PER_DAY = 2;

type ImpactRange = readonly [number, number];

export interface WorldEventTemplate {
  type: WorldEventType;
  title: string;
  description: string;
  severity: WorldEventSeverity;
  /** Olasılık ağırlığı — yüksek = daha sık */
  weight: number;
  durationDays: readonly [number, number];
  scope: 'global' | 'city' | 'product' | 'city_product';
  cityIds?: readonly string[];
  productIds?: readonly ProductId[];
  impactRanges: Partial<Record<keyof WorldEventImpact, ImpactRange>>;
  uiLabel: string;
}

export const WORLD_EVENT_TEMPLATES: WorldEventTemplate[] = [
  {
    type: 'fuel_crisis',
    title: 'Yakıt Krizi',
    description: 'Yakıt maliyetleri geçici olarak yükseldi. Teslimat giderleri artabilir.',
    severity: 'high',
    weight: 6,
    durationDays: [1, 3],
    scope: 'global',
    impactRanges: {
      fuelPriceMultiplier: [1.15, 1.35],
    },
    uiLabel: 'Yakıt Krizi',
  },
  {
    type: 'industrial_support',
    title: 'Sanayi Desteği',
    description: 'Sanayi bölgelerinde üretim destekleri devrede. Çelik ve makine talebi arttı.',
    severity: 'medium',
    weight: 10,
    durationDays: [2, 4],
    scope: 'city_product',
    cityIds: ['ankara', 'bursa'],
    productIds: ['steel', 'machinery'],
    impactRanges: {
      productPriceMultiplier: [0.9, 0.96],
      contractSpawnWeightMultiplier: [1.1, 1.15],
    },
    uiLabel: 'Sanayi Desteği',
  },
  {
    type: 'harvest_surplus',
    title: 'Meyve Bolluğu',
    description: 'Hasat sezonu bolluğu fiyatları aşağı çekti. Düşükten alım fırsatı.',
    severity: 'medium',
    weight: 10,
    durationDays: [1, 3],
    scope: 'city_product',
    cityIds: ['antalya'],
    productIds: ['fruit'],
    impactRanges: {
      productPriceMultiplier: [0.82, 0.92],
    },
    uiLabel: 'Bolluk',
  },
  {
    type: 'electronics_boom',
    title: 'Elektronik Talep Patlaması',
    description: 'Elektronik ürünlere talep arttı, fiyatlar yükseldi.',
    severity: 'medium',
    weight: 9,
    durationDays: [1, 2],
    scope: 'product',
    productIds: ['electronics'],
    impactRanges: {
      productPriceMultiplier: [1.12, 1.28],
    },
    uiLabel: 'Talep Patlaması',
  },
  {
    type: 'port_congestion',
    title: 'Liman Yoğunluğu',
    description: 'Liman trafiği yoğun. Teslimat süreleri uzadı ama ödemeler arttı.',
    severity: 'medium',
    weight: 8,
    durationDays: [1, 3],
    scope: 'city',
    cityIds: ['istanbul', 'izmir'],
    impactRanges: {
      deliveryDurationMultiplier: [1.1, 1.25],
      contractPaymentMultiplier: [1.05, 1.15],
    },
    uiLabel: 'Yoğunluk Bonusu',
  },
  {
    type: 'road_work',
    title: 'Yol Çalışması',
    description: 'Bölgede yol çalışması nedeniyle sevkiyatlar yavaşladı.',
    severity: 'low',
    weight: 12,
    durationDays: [1, 2],
    scope: 'city',
    cityIds: ['istanbul', 'ankara', 'izmir', 'bursa', 'antalya'],
    impactRanges: {
      deliveryDurationMultiplier: [1.1, 1.2],
    },
    uiLabel: 'Yol Çalışması',
  },
  {
    type: 'cold_chain_demand',
    title: 'Soğuk Zincir Talebi',
    description: 'Hassas ürün taşımacılığına talep arttı. Ödemeler yükseldi.',
    severity: 'medium',
    weight: 8,
    durationDays: [2, 3],
    scope: 'product',
    productIds: ['fruit', 'beverage'],
    impactRanges: {
      contractPaymentMultiplier: [1.1, 1.25],
      contractSpawnWeightMultiplier: [1.1, 1.2],
    },
    uiLabel: 'Talep Bonusu',
  },
  {
    type: 'maintenance_campaign',
    title: 'Bakım Kampanyası',
    description: 'Servis kampanyası sayesinde bakım maliyetleri geçici olarak düştü.',
    severity: 'low',
    weight: 10,
    durationDays: [2, 3],
    scope: 'global',
    impactRanges: {
      maintenanceCostMultiplier: [0.75, 0.9],
    },
    uiLabel: 'Bakım Kampanyası',
  },
  {
    type: 'city_demand_boom',
    title: 'Şehir Talep Patlaması',
    description: 'Bölgede talep arttı, fiyatlar yükseldi.',
    severity: 'low',
    weight: 9,
    durationDays: [1, 3],
    scope: 'city',
    cityIds: ['istanbul', 'ankara', 'izmir', 'bursa', 'antalya'],
    impactRanges: {
      productPriceMultiplier: [1.08, 1.18],
      contractSpawnWeightMultiplier: [1.05, 1.12],
    },
    uiLabel: 'Talep Patlaması',
  },
  {
    type: 'city_supply_shortage',
    title: 'Arz Sıkıntısı',
    description: 'Bölgede arz daraldı, fiyatlar yükseldi.',
    severity: 'medium',
    weight: 7,
    durationDays: [1, 2],
    scope: 'city',
    cityIds: ['istanbul', 'ankara', 'izmir', 'bursa', 'antalya'],
    impactRanges: {
      productPriceMultiplier: [1.1, 1.22],
    },
    uiLabel: 'Arz Sıkıntısı',
  },
];

export const WORLD_EVENT_TEMPLATE_BY_TYPE: Record<WorldEventType, WorldEventTemplate> =
  WORLD_EVENT_TEMPLATES.reduce(
    (acc, template) => {
      acc[template.type] = template;
      return acc;
    },
    {} as Record<WorldEventType, WorldEventTemplate>,
  );

export function getWorldEventTemplate(type: WorldEventType): WorldEventTemplate | undefined {
  return WORLD_EVENT_TEMPLATE_BY_TYPE[type];
}
