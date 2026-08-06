import type { MissionsState } from '../types/game';

export type MissionCategory =
  | 'starter'
  | 'career'
  | 'delivery'
  | 'market'
  | 'warehouse'
  | 'fleet'
  | 'trade';

export interface MissionReward {
  money?: number;
  xp?: number;
  reputation?: number;
}

export interface MissionConfig {
  id: string;
  title: string;
  description: string;
  targetValue: number;
  reward: MissionReward;
  category: MissionCategory;
}

export const STARTER_MISSIONS: MissionConfig[] = [
  {
    id: 'first_contract_start',
    title: 'İlk İşini Başlat',
    description: 'İlk sözleşmeni seç ve teslimatı başlat.',
    targetValue: 1,
    reward: { money: 500, xp: 25 },
    category: 'starter',
  },
  {
    id: 'first_delivery',
    title: 'İlk Teslimat',
    description: 'İlk teslimatını tamamla.',
    targetValue: 1,
    reward: { money: 1500, xp: 50, reputation: 1 },
    category: 'delivery',
  },
  {
    id: 'first_profit',
    title: 'İlk Büyük Gelir',
    description: 'Sözleşmelerden toplam $5.000 gelir elde et.',
    targetValue: 5000,
    reward: { money: 2000, xp: 75 },
    category: 'delivery',
  },
  {
    id: 'open_market',
    title: 'Piyasayı Keşfet',
    description: 'Piyasa ekranını aç ve ürün fiyatlarını incele.',
    targetValue: 1,
    reward: { xp: 50 },
    category: 'market',
  },
  {
    id: 'first_trade',
    title: 'İlk Ticaret',
    description: 'Deposu olan bir şehirde ilk ürün alımını yap.',
    targetValue: 1,
    reward: { money: 1000, xp: 50 },
    category: 'warehouse',
  },
];

export const CAREER_MISSIONS: MissionConfig[] = [
  {
    id: 'complete_5_deliveries',
    title: '5 Teslimat Tamamla',
    description: 'Toplam 5 başarılı teslimat yap.',
    targetValue: 5,
    reward: { money: 2500, xp: 100, reputation: 1 },
    category: 'career',
  },
  {
    id: 'complete_10_deliveries',
    title: '10 Teslimat Tamamla',
    description: 'Şirketini büyütmek için 10 teslimatı başarıyla tamamla.',
    targetValue: 10,
    reward: { money: 7500, xp: 200, reputation: 2 },
    category: 'career',
  },
  {
    id: 'reach_company_score_150k',
    title: 'Şirket Puanı 250.000',
    description: 'Şirket puanını 250.000 seviyesine çıkar.',
    targetValue: 250_000,
    reward: { money: 5000, xp: 150 },
    category: 'career',
  },
  {
    id: 'own_2_trucks',
    title: '2 Kamyonla Operasyon Yap',
    description: 'Filonda toplam 2 aktif kamyon bulundur (sahip veya kiralık).',
    targetValue: 2,
    reward: { money: 3000, xp: 120 },
    category: 'career',
  },
  {
    id: 'reach_warehouse_value_25000',
    title: 'Depo Değeri $25.000',
    description: 'Depolarındaki toplam ürün değerini $25.000 seviyesine çıkar.',
    targetValue: 25000,
    reward: { money: 3500, xp: 100 },
    category: 'career',
  },
  {
    id: 'earn_10000_trade_profit',
    title: 'Ticaret Kârı $10.000',
    description: 'Ürün al-sat işlemlerinden toplam $10.000 kâr elde et.',
    targetValue: 10000,
    reward: { money: 5000, xp: 150 },
    category: 'career',
  },
  {
    id: 'operate_in_3_cities',
    title: '3 Şehirde Operasyon',
    description: 'Kamyon veya depo varlığını 3 farklı şehre yay.',
    targetValue: 3,
    reward: { money: 4000, xp: 100 },
    category: 'career',
  },
];

export const ALL_MISSIONS: MissionConfig[] = [...STARTER_MISSIONS, ...CAREER_MISSIONS];

export const STARTER_MISSION_IDS = STARTER_MISSIONS.map((mission) => mission.id);
export const CAREER_MISSION_IDS = CAREER_MISSIONS.map((mission) => mission.id);

const MISSION_BY_ID = new Map(ALL_MISSIONS.map((mission) => [mission.id, mission]));

export function getMissionById(missionId: string): MissionConfig | undefined {
  return MISSION_BY_ID.get(missionId);
}

export function ensureActiveMissionIds(ids: string[]): string[] {
  const merged = new Set(ids);
  for (const missionId of CAREER_MISSION_IDS) {
    merged.add(missionId);
  }
  return [...merged];
}

export function createDefaultMissionsState(): MissionsState {
  return {
    activeMissionIds: ensureActiveMissionIds([
      'first_contract_start',
      'first_delivery',
      'first_profit',
    ]),
    completedMissionIds: [],
    claimedMissionRewardIds: [],
    completedAtByMissionId: {},
    flags: {
      marketOpened: false,
      deliveryStarted: false,
      tradePurchased: false,
    },
  };
}
