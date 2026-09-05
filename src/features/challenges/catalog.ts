import type { ChallengeDefinition } from '../seasons/types';

/** Display mirror of backend catalog v1. Backend remains claim authority. */
export const CHALLENGE_CATALOG: readonly ChallengeDefinition[] = [
  { id: 'daily_delivery_foundation_deferred', cadence: 'daily', metric: 'deliveries_completed', target: 2, reward: { cash: 500, seasonPoints: 10 }, title: 'Günlük Teslimatlar', description: 'Günde 2 teslimat tamamla.', enabled: false, version: 1 },
  { id: 'daily_marketplace_purchase', cadence: 'daily', metric: 'marketplace_purchases', target: 1, reward: { cash: 500, seasonPoints: 10 }, title: 'Günün Filo Yatırımı', description: 'Araç Pazarı’ndan 1 araç satın al.', enabled: true, version: 1 },
  { id: 'daily_marketplace_sale', cadence: 'daily', metric: 'marketplace_sales', target: 1, reward: { cash: 750, seasonPoints: 15 }, title: 'Günün Araç Satışı', description: 'Araç Pazarı’nda 1 araç sat.', enabled: true, version: 1 },
  { id: 'weekly_marketplace_purchases', cadence: 'weekly', metric: 'marketplace_purchases', target: 3, reward: { cash: 1_500, seasonPoints: 40 }, title: 'Haftalık Filo Yatırımı', description: 'Bu hafta Araç Pazarı’ndan 3 araç satın al.', enabled: true, version: 1 },
  { id: 'weekly_marketplace_sales', cadence: 'weekly', metric: 'marketplace_sales', target: 2, reward: { cash: 2_000, seasonPoints: 50 }, title: 'Haftalık Satış Hedefi', description: 'Bu hafta Araç Pazarı’nda 2 araç sat.', enabled: true, version: 1 },
] as const;
