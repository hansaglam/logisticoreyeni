import type { MissionsState } from '../types/game';

export type MissionCategory = 'starter' | 'delivery' | 'market' | 'warehouse' | 'fleet';

export interface MissionReward {
  money?: number;
  diamonds?: number;
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
    id: 'first_contract',
    title: 'İlk İşini Seç',
    description: 'Bir sözleşme seç ve ekibini ata.',
    targetValue: 1,
    reward: { money: 500, xp: 25 },
    category: 'starter',
  },
  {
    id: 'first_delivery',
    title: 'İlk Teslimat',
    description: 'İlk teslimatını başarıyla tamamla.',
    targetValue: 1,
    reward: { money: 1500, xp: 50, reputation: 1 },
    category: 'delivery',
  },
  {
    id: 'first_profit',
    title: 'Kâra Geç',
    description: 'Toplam 5.000$ sözleşme geliri elde et.',
    targetValue: 5000,
    reward: { money: 2000, xp: 75 },
    category: 'delivery',
  },
  {
    id: 'open_market',
    title: 'Piyasayı Keşfet',
    description: 'Piyasa ekranını aç ve fırsatları incele.',
    targetValue: 1,
    reward: { diamonds: 10, xp: 25 },
    category: 'market',
  },
  {
    id: 'first_trade',
    title: 'İlk Ticaret',
    description: 'Depo üzerinden ilk ürün alımını yap.',
    targetValue: 1,
    reward: { money: 1000, xp: 50 },
    category: 'warehouse',
  },
];

export const STARTER_MISSION_IDS = STARTER_MISSIONS.map((mission) => mission.id);

const MISSION_BY_ID = new Map(STARTER_MISSIONS.map((mission) => [mission.id, mission]));

export function getMissionById(missionId: string): MissionConfig | undefined {
  return MISSION_BY_ID.get(missionId);
}

export function createDefaultMissionsState(): MissionsState {
  return {
    activeMissionIds: ['first_contract', 'first_delivery', 'first_profit'],
    completedMissionIds: [],
    claimedMissionRewardIds: [],
    flags: {
      marketOpened: false,
      deliveryStarted: false,
      tradePurchased: false,
    },
  };
}
