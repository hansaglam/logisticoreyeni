import {
  WEEKLY_MISSION_CATALOG_VERSION,
  WEEKLY_MISSION_WEEKLY_CASH_CAP,
  type WeeklyMissionDifficulty,
  type WeeklyMissionSnapshot,
  type WeeklyMissionTemplate,
} from './weeklyMissionTypes';

export const WEEKLY_MISSION_DIFFICULTY_CASH: Record<WeeklyMissionDifficulty, number> = {
  easy: 2_000,
  medium: 4_000,
  hard: 6_500,
};

const DIFFICULTY_ORDER: readonly WeeklyMissionDifficulty[] = ['easy', 'medium', 'hard'];

export const WEEKLY_MISSION_CATALOG: readonly WeeklyMissionTemplate[] = [
  {
    id: 'wm_deliveries_5',
    type: 'weekly_completed_deliveries',
    target: 5,
    difficulty: 'easy',
    reward: { cash: WEEKLY_MISSION_DIFFICULTY_CASH.easy },
    enabled: true,
    weight: 1,
    title: 'Haftalık Teslimat',
    description: 'Bu hafta 5 teslimat tamamla.',
    version: WEEKLY_MISSION_CATALOG_VERSION,
  },
  {
    id: 'wm_deliveries_6',
    type: 'weekly_completed_deliveries',
    target: 6,
    difficulty: 'easy',
    reward: { cash: WEEKLY_MISSION_DIFFICULTY_CASH.easy },
    enabled: true,
    weight: 1,
    title: 'Haftalık Teslimat',
    description: 'Bu hafta 6 teslimat tamamla.',
    version: WEEKLY_MISSION_CATALOG_VERSION,
  },
  {
    id: 'wm_deliveries_10',
    type: 'weekly_completed_deliveries',
    target: 10,
    difficulty: 'medium',
    reward: { cash: WEEKLY_MISSION_DIFFICULTY_CASH.medium },
    enabled: true,
    weight: 1,
    title: 'Yoğun Hafta',
    description: 'Bu hafta 10 teslimat tamamla.',
    version: WEEKLY_MISSION_CATALOG_VERSION,
  },
  {
    id: 'wm_deliveries_12',
    type: 'weekly_completed_deliveries',
    target: 12,
    difficulty: 'medium',
    reward: { cash: WEEKLY_MISSION_DIFFICULTY_CASH.medium },
    enabled: true,
    weight: 1,
    title: 'Yoğun Hafta',
    description: 'Bu hafta 12 teslimat tamamla.',
    version: WEEKLY_MISSION_CATALOG_VERSION,
  },
  {
    id: 'wm_deliveries_18',
    type: 'weekly_completed_deliveries',
    target: 18,
    difficulty: 'hard',
    reward: { cash: WEEKLY_MISSION_DIFFICULTY_CASH.hard },
    enabled: true,
    weight: 1,
    title: 'Ağır Operasyon',
    description: 'Bu hafta 18 teslimat tamamla.',
    version: WEEKLY_MISSION_CATALOG_VERSION,
  },
  {
    id: 'wm_deliveries_20',
    type: 'weekly_completed_deliveries',
    target: 20,
    difficulty: 'hard',
    reward: { cash: WEEKLY_MISSION_DIFFICULTY_CASH.hard },
    enabled: true,
    weight: 1,
    title: 'Ağır Operasyon',
    description: 'Bu hafta 20 teslimat tamamla.',
    version: WEEKLY_MISSION_CATALOG_VERSION,
  },
] as const;

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isValidWeeklyMissionTemplate(
  template: WeeklyMissionTemplate,
): boolean {
  if (!template.enabled) {
    return false;
  }
  if (typeof template.id !== 'string' || template.id.length < 1 || template.id.length > 80) {
    return false;
  }
  if (template.type !== 'weekly_completed_deliveries') {
    return false;
  }
  if (!isPositiveInt(template.target) || template.target > 10_000) {
    return false;
  }
  if (!DIFFICULTY_ORDER.includes(template.difficulty)) {
    return false;
  }
  if (template.reward.cash !== WEEKLY_MISSION_DIFFICULTY_CASH[template.difficulty]) {
    return false;
  }
  if ('xp' in template.reward || 'reputation' in template.reward) {
    return false;
  }
  if (!isPositiveInt(template.weight) || template.weight > 1_000) {
    return false;
  }
  if (
    template.minCompanyLevel != null &&
    (!Number.isInteger(template.minCompanyLevel) || template.minCompanyLevel < 1)
  ) {
    return false;
  }
  return true;
}

export function getEnabledWeeklyMissionTemplates(
  catalog: readonly WeeklyMissionTemplate[] = WEEKLY_MISSION_CATALOG,
): WeeklyMissionTemplate[] {
  return catalog.filter(isValidWeeklyMissionTemplate);
}

export function toWeeklyMissionSnapshot(template: WeeklyMissionTemplate): WeeklyMissionSnapshot {
  return {
    id: template.id,
    type: template.type,
    target: template.target,
    difficulty: template.difficulty,
    reward: { cash: template.reward.cash },
    title: template.title,
    description: template.description,
  };
}

export function validateWeeklyMissionRotationSnapshots(
  missions: readonly WeeklyMissionSnapshot[],
): { ok: true } | { ok: false; reason: 'invalid-catalog' } {
  if (missions.length !== 3) {
    return { ok: false, reason: 'invalid-catalog' };
  }
  const ids = new Set(missions.map((mission) => mission.id));
  if (ids.size !== 3) {
    return { ok: false, reason: 'invalid-catalog' };
  }
  const byDifficulty = new Map<WeeklyMissionDifficulty, WeeklyMissionSnapshot>();
  let totalCash = 0;
  for (const mission of missions) {
    if (byDifficulty.has(mission.difficulty)) {
      return { ok: false, reason: 'invalid-catalog' };
    }
    if (mission.reward.cash !== WEEKLY_MISSION_DIFFICULTY_CASH[mission.difficulty]) {
      return { ok: false, reason: 'invalid-catalog' };
    }
    if (mission.type !== 'weekly_completed_deliveries') {
      return { ok: false, reason: 'invalid-catalog' };
    }
    byDifficulty.set(mission.difficulty, mission);
    totalCash += mission.reward.cash;
  }
  if (byDifficulty.size !== 3 || totalCash > WEEKLY_MISSION_WEEKLY_CASH_CAP) {
    return { ok: false, reason: 'invalid-catalog' };
  }
  return { ok: true };
}
