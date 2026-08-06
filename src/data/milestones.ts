import type { RetentionMilestoneCategory, RetentionReward } from '../types/game';

export type MilestoneMetricType =
  | 'completed_contracts'
  | 'trade_profit_total'
  | 'trade_profit_product'
  | 'trade_buy_and_sell'
  | 'truck_count'
  | 'high_capacity_truck'
  | 'warehouse_active'
  | 'warehouse_stock_tons'
  | 'warehouse_cities'
  | 'reputation'
  | 'cash'
  | 'company_score'
  | 'city_deliveries'
  | 'urgent_contracts_completed'
  | 'fragile_contracts_completed'
  | 'high_reputation_contracts_completed'
  | 'driver_level_3'
  | 'truck_upgraded'
  | 'maintenance_count';

export interface MilestoneMetric {
  type: MilestoneMetricType;
  productId?: string;
  cityId?: string;
  minCapacity?: number;
}

export interface MilestoneDefinition {
  id: string;
  title: string;
  description: string;
  category: RetentionMilestoneCategory;
  target: number;
  reward: RetentionReward;
  metric: MilestoneMetric;
}

export const MILESTONE_DEFINITIONS: MilestoneDefinition[] = [
  // Sözleşme
  {
    id: 'ms_first_delivery',
    title: 'İlk Teslimat',
    description: 'İlk teslimatını tamamla.',
    category: 'contracts',
    target: 1,
    reward: { cash: 500, xp: 25 },
    metric: { type: 'completed_contracts' },
  },
  {
    id: 'ms_regular_carrier',
    title: 'Düzenli Taşıyıcı',
    description: '10 teslimat tamamla.',
    category: 'contracts',
    target: 10,
    reward: { cash: 2000, xp: 75 },
    metric: { type: 'completed_contracts' },
  },
  {
    id: 'ms_regional_operator',
    title: 'Bölgesel Operatör',
    description: '25 teslimat tamamla.',
    category: 'contracts',
    target: 25,
    reward: { cash: 5000, xp: 150, reputation: 1 },
    metric: { type: 'completed_contracts' },
  },
  {
    id: 'ms_national_carrier',
    title: 'Ulusal Taşıyıcı',
    description: '50 teslimat tamamla.',
    category: 'contracts',
    target: 50,
    reward: { cash: 10000, xp: 250, reputation: 2 },
    metric: { type: 'completed_contracts' },
  },
  {
    id: 'ms_logistics_giant',
    title: 'Lojistik Devi',
    description: '100 teslimat tamamla.',
    category: 'contracts',
    target: 100,
    reward: { cash: 25000, xp: 500, reputation: 3, badgeId: 'logistics_giant' },
    metric: { type: 'completed_contracts' },
  },
  // Ticaret
  {
    id: 'ms_first_trade',
    title: 'İlk Al-Sat',
    description: 'Piyasadan ürün al ve sat.',
    category: 'trading',
    target: 1,
    reward: { cash: 1000, xp: 40 },
    metric: { type: 'trade_buy_and_sell' },
  },
  {
    id: 'ms_smart_trader',
    title: 'Akıllı Tüccar',
    description: 'Ticaretten toplam $10.000 net kâr et.',
    category: 'trading',
    target: 10_000,
    reward: { cash: 3000, xp: 100 },
    metric: { type: 'trade_profit_total' },
  },
  {
    id: 'ms_market_expert',
    title: 'Piyasa Uzmanı',
    description: 'Ticaretten toplam $50.000 net kâr et.',
    category: 'trading',
    target: 50_000,
    reward: { cash: 8000, xp: 200, reputation: 2 },
    metric: { type: 'trade_profit_total' },
  },
  {
    id: 'ms_electronics_expert',
    title: 'Elektronik Uzmanı',
    description: 'Elektronik ticaretinden $25.000 net kâr et.',
    category: 'trading',
    target: 25_000,
    reward: { cash: 5000, xp: 150 },
    metric: { type: 'trade_profit_product', productId: 'electronics' },
  },
  {
    id: 'ms_fruit_trader',
    title: 'Meyve Tüccarı',
    description: 'Meyve ticaretinden $15.000 net kâr et.',
    category: 'trading',
    target: 15_000,
    reward: { cash: 3500, xp: 100 },
    metric: { type: 'trade_profit_product', productId: 'fruit' },
  },
  // Filo
  {
    id: 'ms_second_truck',
    title: 'İkinci Kamyon',
    description: 'Filonda 2 kamyon bulundur.',
    category: 'fleet',
    target: 2,
    reward: { cash: 2500, xp: 75 },
    metric: { type: 'truck_count' },
  },
  {
    id: 'ms_small_fleet',
    title: 'Küçük Filo',
    description: 'Filonda 3 kamyon bulundur.',
    category: 'fleet',
    target: 3,
    reward: { cash: 4000, xp: 120 },
    metric: { type: 'truck_count' },
  },
  {
    id: 'ms_ops_fleet',
    title: 'Operasyon Filosu',
    description: 'Filonda 5 kamyon bulundur.',
    category: 'fleet',
    target: 5,
    reward: { cash: 8000, xp: 200, reputation: 1 },
    metric: { type: 'truck_count' },
  },
  {
    id: 'ms_heavy_hauler',
    title: 'Ağır Taşıyıcı',
    description: '20 ton ve üzeri kapasiteli kamyon sahibi ol.',
    category: 'fleet',
    target: 1,
    reward: { cash: 6000, xp: 150 },
    metric: { type: 'high_capacity_truck', minCapacity: 20 },
  },
  // Depo
  {
    id: 'ms_first_warehouse',
    title: 'İlk Depo',
    description: 'Depoda stok bulundur.',
    category: 'warehouse',
    target: 1,
    reward: { cash: 1500, xp: 50 },
    metric: { type: 'warehouse_active' },
  },
  {
    id: 'ms_warehouse_keeper',
    title: 'Depocu',
    description: 'Depolarda toplam 100 ton ürün bulundur.',
    category: 'warehouse',
    target: 100,
    reward: { cash: 4000, xp: 120 },
    metric: { type: 'warehouse_stock_tons' },
  },
  {
    id: 'ms_regional_stock',
    title: 'Bölgesel Stokçu',
    description: '3 farklı şehirde depo kullan.',
    category: 'warehouse',
    target: 3,
    reward: { cash: 6000, xp: 180, reputation: 1 },
    metric: { type: 'warehouse_cities' },
  },
  {
    id: 'ms_strategic_stock',
    title: 'Stratejik Stokçu',
    description: 'Depolarda toplam 250 ton ürün bulundur.',
    category: 'warehouse',
    target: 250,
    reward: { cash: 10000, xp: 250, badgeId: 'strategic_stock' },
    metric: { type: 'warehouse_stock_tons' },
  },
  // İtibar
  {
    id: 'ms_trusted_company',
    title: 'Güvenilir Firma',
    description: '60 itibara ulaş.',
    category: 'reputation',
    target: 60,
    reward: { cash: 3000, xp: 100 },
    metric: { type: 'reputation' },
  },
  {
    id: 'ms_respected_brand',
    title: 'Saygın Marka',
    description: '75 itibara ulaş.',
    category: 'reputation',
    target: 75,
    reward: { cash: 5000, xp: 150, reputation: 1 },
    metric: { type: 'reputation' },
  },
  {
    id: 'ms_flawless_operator',
    title: 'Kusursuz Operatör',
    description: '90 itibara ulaş.',
    category: 'reputation',
    target: 90,
    reward: { cash: 8000, xp: 250, reputation: 2, badgeId: 'flawless_operator' },
    metric: { type: 'reputation' },
  },
  // Ekonomi
  {
    id: 'ms_cash_100k',
    title: '100 Bin Dolar',
    description: '$100.000 nakde ulaş.',
    category: 'economy',
    target: 100_000,
    reward: { cash: 5000, xp: 150 },
    metric: { type: 'cash' },
  },
  {
    id: 'ms_company_score_500k',
    title: 'Güçlü Şirket',
    description: '500.000 şirket puanına ulaş.',
    category: 'economy',
    target: 500_000,
    reward: { cash: 8000, xp: 200 },
    metric: { type: 'company_score' },
  },
  {
    id: 'ms_company_score_1m',
    title: 'Lojistik İmparatorluğu',
    description: '1.000.000 şirket puanına ulaş.',
    category: 'economy',
    target: 1_000_000,
    reward: { cash: 15000, xp: 400, badgeId: 'empire' },
    metric: { type: 'company_score' },
  },
  // Şehir
  {
    id: 'ms_city_istanbul',
    title: 'İstanbul Uzmanı',
    description: 'İstanbul çıkışlı veya varışlı 10 teslimat tamamla.',
    category: 'city',
    target: 10,
    reward: { cash: 4000, xp: 120 },
    metric: { type: 'city_deliveries', cityId: 'istanbul' },
  },
  {
    id: 'ms_city_ankara',
    title: 'Ankara Uzmanı',
    description: 'Ankara çıkışlı veya varışlı 10 teslimat tamamla.',
    category: 'city',
    target: 10,
    reward: { cash: 4000, xp: 120 },
    metric: { type: 'city_deliveries', cityId: 'ankara' },
  },
  {
    id: 'ms_city_izmir',
    title: 'İzmir Uzmanı',
    description: 'İzmir çıkışlı veya varışlı 10 teslimat tamamla.',
    category: 'city',
    target: 10,
    reward: { cash: 4000, xp: 120 },
    metric: { type: 'city_deliveries', cityId: 'izmir' },
  },
  {
    id: 'ms_city_antalya',
    title: 'Antalya Uzmanı',
    description: 'Antalya çıkışlı veya varışlı 10 teslimat tamamla.',
    category: 'city',
    target: 10,
    reward: { cash: 4000, xp: 120 },
    metric: { type: 'city_deliveries', cityId: 'antalya' },
  },
  {
    id: 'ms_city_bursa',
    title: 'Bursa Uzmanı',
    description: 'Bursa çıkışlı veya varışlı 10 teslimat tamamla.',
    category: 'city',
    target: 10,
    reward: { cash: 4000, xp: 120 },
    metric: { type: 'city_deliveries', cityId: 'bursa' },
  },
  // Ek kariyer
  {
    id: 'ms_deliveries_200',
    title: 'Deneyimli Operatör',
    description: '200 teslimat tamamla.',
    category: 'contracts',
    target: 200,
    reward: { cash: 35000, xp: 600, reputation: 3 },
    metric: { type: 'completed_contracts' },
  },
  {
    id: 'ms_trade_profit_100k',
    title: 'Ticaret Baronu',
    description: 'Ticaretten toplam $100.000 net kâr et.',
    category: 'trading',
    target: 100_000,
    reward: { cash: 12000, xp: 300, badgeId: 'trade_baron' },
    metric: { type: 'trade_profit_total' },
  },
  {
    id: 'ms_fleet_8',
    title: 'Büyük Filo',
    description: 'Filonda 8 kamyon bulundur.',
    category: 'fleet',
    target: 8,
    reward: { cash: 15000, xp: 350, reputation: 2 },
    metric: { type: 'truck_count' },
  },
  {
    id: 'ms_cash_500k',
    title: 'Yarım Milyon',
    description: '$500.000 nakde ulaş.',
    category: 'economy',
    target: 500_000,
    reward: { cash: 10000, xp: 300 },
    metric: { type: 'cash' },
  },
  {
    id: 'ms_warehouse_500t',
    title: 'Mega Depo',
    description: 'Depolarda toplam 500 ton ürün bulundur.',
    category: 'warehouse',
    target: 500,
    reward: { cash: 12000, xp: 280, reputation: 2 },
    metric: { type: 'warehouse_stock_tons' },
  },
  {
    id: 'ms_reputation_max',
    title: 'Efsanevi İtibar',
    description: '100 itibara ulaş.',
    category: 'reputation',
    target: 100,
    reward: { cash: 10000, xp: 300, badgeId: 'legend_reputation' },
    metric: { type: 'reputation' },
  },
  // Phase 3 — özel sözleşme tipleri
  {
    id: 'ms_urgent_5',
    title: 'Acil Kurye',
    description: '5 acil teslimat tamamla.',
    category: 'contracts',
    target: 5,
    reward: { cash: 3000, xp: 100, reputation: 1 },
    metric: { type: 'urgent_contracts_completed' },
  },
  {
    id: 'ms_fragile_5',
    title: 'Hassas Eller',
    description: '5 hassas yük teslim et.',
    category: 'contracts',
    target: 5,
    reward: { cash: 3500, xp: 120 },
    metric: { type: 'fragile_contracts_completed' },
  },
  {
    id: 'ms_prestige_1',
    title: 'Prestijli İş',
    description: 'İlk prestijli işi tamamla.',
    category: 'contracts',
    target: 1,
    reward: { cash: 5000, xp: 150, reputation: 2 },
    metric: { type: 'high_reputation_contracts_completed' },
  },
  {
    id: 'ms_driver_level_3',
    title: 'Deneyimli Şoför',
    description: 'Bir şoförü seviye 3 yap.',
    category: 'fleet',
    target: 3,
    reward: { cash: 2500, xp: 100 },
    metric: { type: 'driver_level_3' },
  },
  {
    id: 'ms_truck_upgrade_1',
    title: 'Filo Yatırımı',
    description: 'Bir kamyonu geliştir.',
    category: 'fleet',
    target: 1,
    reward: { cash: 4000, xp: 120 },
    metric: { type: 'truck_upgraded' },
  },
  {
    id: 'ms_maintenance_10',
    title: 'Bakım Ustası',
    description: '10 bakım işlemi yap.',
    category: 'fleet',
    target: 10,
    reward: { cash: 2000, xp: 80 },
    metric: { type: 'maintenance_count' },
  },
];

export const MILESTONE_BY_ID: Record<string, MilestoneDefinition> = Object.fromEntries(
  MILESTONE_DEFINITIONS.map((m) => [m.id, m]),
);

export function getMilestoneById(id: string): MilestoneDefinition | undefined {
  return MILESTONE_BY_ID[id];
}
