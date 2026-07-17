import type { TabKey } from '../../navigation/tabTypes';
import { createDefaultMissionsState, getMissionById } from '../../config/missions';
import type { MissionsState } from '../../types/game';
import type { GameIconName } from '../../theme/icons';
import { formatMoney } from '../../theme';
import {
  getDashboardMissionIds,
  getMissionDisplayStatus,
  type MissionProgressResult,
} from '../../utils/missionProgress';

export type NextActionVariant = 'primary' | 'reward' | 'track' | 'explore';

export type NextActionDispatch =
  | { type: 'navigate'; tab: TabKey }
  | { type: 'claim'; missionId: string }
  | { type: 'open-missions' };

export type RewardChipKey = 'count' | 'money' | 'xp' | 'diamonds' | 'reputation';

export interface RewardChipData {
  key: RewardChipKey;
  label: string;
  icon?: GameIconName;
}

export interface NextActionState {
  title: string;
  description: string;
  ctaLabel: string;
  variant: NextActionVariant;
  icon: GameIconName;
  badgeLabel?: string;
  rewardChips?: RewardChipData[];
  action: NextActionDispatch;
}

const MAX_REWARD_CHIPS = 3;

function buildRewardChips(missionIds: string[], includeCount: boolean): RewardChipData[] {
  let money = 0;
  let xp = 0;
  let diamonds = 0;
  let reputation = 0;

  for (const missionId of missionIds) {
    const mission = getMissionById(missionId);
    if (!mission) continue;
    money += mission.reward.money ?? 0;
    xp += mission.reward.xp ?? 0;
    diamonds += mission.reward.diamonds ?? 0;
    reputation += mission.reward.reputation ?? 0;
  }

  const chips: RewardChipData[] = [];
  if (includeCount) {
    chips.push({ key: 'count', label: `${missionIds.length} ödül` });
  }
  if (money > 0) {
    chips.push({ key: 'money', icon: 'cash', label: `+${formatMoney(money)}` });
  }
  if (xp > 0) {
    chips.push({ key: 'xp', icon: 'xp', label: `+${xp} XP` });
  }
  if (diamonds > 0) {
    chips.push({ key: 'diamonds', icon: 'diamond', label: `+${diamonds} Elmas` });
  }
  if (reputation > 0) {
    chips.push({ key: 'reputation', icon: 'reputation', label: `+${reputation} İtibar` });
  }

  return chips.slice(0, MAX_REWARD_CHIPS);
}

interface ResolveNextActionInput {
  runningDeliveries: number;
  playableContracts: number;
  idleTruckCount: number;
  missions: MissionsState;
  getMissionProgress: (missionId: string) => MissionProgressResult;
  marketOpened: boolean;
}

export function resolveNextAction(input: ResolveNextActionInput): NextActionState {
  const missions = input.missions ?? createDefaultMissionsState();
  const visibleMissions = getDashboardMissionIds(missions, input.getMissionProgress, 3);
  const readyMissionIds = visibleMissions.filter(
    (missionId) =>
      getMissionDisplayStatus(missionId, missions, input.getMissionProgress(missionId)) === 'ready',
  );

  if (readyMissionIds.length === 1) {
    const mission = getMissionById(readyMissionIds[0]);
    return {
      title: 'Ödül Hazır',
      description: `${mission?.title ?? 'Görev'} görevinden ödül alabilirsin.`,
      ctaLabel: 'Ödülü Al',
      variant: 'reward',
      icon: 'xp',
      badgeLabel: 'HAZIR',
      rewardChips: buildRewardChips(readyMissionIds, false),
      action: { type: 'claim', missionId: readyMissionIds[0] },
    };
  }

  if (readyMissionIds.length > 1) {
    return {
      title: 'Ödüller Hazır',
      description: `${readyMissionIds.length} görev ödülü seni bekliyor.`,
      ctaLabel: 'Görevleri Aç',
      variant: 'reward',
      icon: 'xp',
      badgeLabel: 'HAZIR',
      rewardChips: buildRewardChips(readyMissionIds, true),
      action: { type: 'open-missions' },
    };
  }

  if (input.runningDeliveries > 0) {
    return {
      title: 'Teslimat Yolda',
      description: 'Araçlarını haritada takip edebilirsin.',
      ctaLabel: 'Haritaya Git',
      variant: 'track',
      icon: 'map',
      action: { type: 'navigate', tab: 'map' },
    };
  }

  if (input.playableContracts > 0) {
    return {
      title: 'İlk İşini Seç',
      description: `${input.playableContracts} uygun iş var — teslimata başla.`,
      ctaLabel: 'İşlere Git',
      variant: 'primary',
      icon: 'contract',
      action: { type: 'navigate', tab: 'contracts' },
    };
  }

  if (input.idleTruckCount > 0) {
    return {
      title: 'Kamyonunu Konumlandır',
      description: 'Boştaki kamyonun bulunduğu şehirden uygun iş seçebilirsin.',
      ctaLabel: 'İşleri Gör',
      variant: 'primary',
      icon: 'city',
      action: { type: 'navigate', tab: 'contracts' },
    };
  }

  if (!input.marketOpened) {
    return {
      title: 'Piyasaya Göz At',
      description: 'Ürün fiyatlarını takip et, stok fırsatlarını yakala.',
      ctaLabel: 'Piyasaya Git',
      variant: 'explore',
      icon: 'market',
      action: { type: 'navigate', tab: 'market' },
    };
  }

  return {
    title: 'Operasyonu Kontrol Et',
    description: 'Filo ve depolarını gözden geçir.',
    ctaLabel: 'Filo',
    variant: 'explore',
    icon: 'truck',
    action: { type: 'navigate', tab: 'fleet' },
  };
}
