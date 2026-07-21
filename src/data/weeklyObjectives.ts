import type { RetentionReward, RetentionWeeklyCategory } from '../types/game';

export interface WeeklyObjectiveTemplate {
  slot: 'delivery' | 'trade' | 'warehouse' | 'reputation' | 'bonus';
  category: RetentionWeeklyCategory;
  title: string;
  description: string;
  targetOptions: number[];
  rewardOptions: RetentionReward[];
}

export interface WeeklyObjectiveDefinition {
  id: string;
  seasonKey: string;
  slot: WeeklyObjectiveTemplate['slot'];
  title: string;
  description: string;
  category: RetentionWeeklyCategory;
  target: number;
  reward: RetentionReward;
  metric:
    | 'weekly_deliveries'
    | 'weekly_trade_profit'
    | 'weekly_stock_stored'
    | 'weekly_on_time_deliveries'
    | 'weekly_cities_operated'
    | 'weekly_trade_roundtrip';
}

const WEEKLY_OBJECTIVE_TEMPLATES: WeeklyObjectiveTemplate[] = [
  {
    slot: 'delivery',
    category: 'contracts',
    title: 'Haftalık Teslimat',
    description: 'Bu hafta {target} teslimat tamamla.',
    targetOptions: [8, 10, 12, 15],
    rewardOptions: [
      { cash: 3000, xp: 80 },
      { cash: 4000, xp: 100 },
      { cash: 5000, xp: 120 },
    ],
  },
  {
    slot: 'trade',
    category: 'trading',
    title: 'Haftalık Ticaret Kârı',
    description: 'Bu hafta ticaretten ${target} net kâr et.',
    targetOptions: [15_000, 20_000, 25_000, 30_000],
    rewardOptions: [
      { cash: 2500, xp: 70 },
      { cash: 3500, xp: 90, reputation: 1 },
      { cash: 4500, xp: 110 },
    ],
  },
  {
    slot: 'warehouse',
    category: 'warehouse',
    title: 'Haftalık Stok',
    description: 'Bu hafta depolarda toplam {target} ton ürün bulundur.',
    targetOptions: [30, 50, 75, 100],
    rewardOptions: [
      { cash: 2000, xp: 60 },
      { cash: 3000, xp: 80 },
      { cash: 4000, xp: 100 },
    ],
  },
  {
    slot: 'reputation',
    category: 'reputation',
    title: 'Zamanında Teslimat',
    description: 'Bu hafta {target} teslimatı geç kalmadan tamamla.',
    targetOptions: [3, 5, 7, 8],
    rewardOptions: [
      { cash: 2000, xp: 60, reputation: 1 },
      { cash: 3000, xp: 80, reputation: 1 },
      { cash: 4000, xp: 100, reputation: 2 },
    ],
  },
  {
    slot: 'bonus',
    category: 'season',
    title: 'Çoklu Şehir Operasyonu',
    description: 'Bu hafta {target} farklı şehirde operasyon yap.',
    targetOptions: [2, 3, 4],
    rewardOptions: [
      { cash: 2500, xp: 70 },
      { cash: 3500, xp: 90, diamonds: 1 },
      { cash: 5000, xp: 120, diamonds: 2 },
    ],
  },
];

function hashSeasonKey(seasonKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seasonKey.length; i += 1) {
    hash ^= seasonKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickFrom<T>(seed: number, index: number, pool: T[]): T {
  if (pool.length === 0) {
    throw new Error('pickFrom: empty pool');
  }
  return pool[(seed + index * 7919) % pool.length];
}

function formatWeeklyDescription(template: string, target: number): string {
  return template
    .replace('{target}', String(target))
    .replace('${target}', target.toLocaleString('en-US'));
}

function metricForSlot(slot: WeeklyObjectiveTemplate['slot']): WeeklyObjectiveDefinition['metric'] {
  switch (slot) {
    case 'delivery':
      return 'weekly_deliveries';
    case 'trade':
      return 'weekly_trade_profit';
    case 'warehouse':
      return 'weekly_stock_stored';
    case 'reputation':
      return 'weekly_on_time_deliveries';
    case 'bonus':
      return 'weekly_cities_operated';
    default:
      return 'weekly_deliveries';
  }
}

export function generateWeeklyObjectives(seasonKey: string): WeeklyObjectiveDefinition[] {
  const seed = hashSeasonKey(seasonKey);

  return WEEKLY_OBJECTIVE_TEMPLATES.map((template, index) => {
    const target = pickFrom(seed, index, template.targetOptions);
    const reward = pickFrom(seed, index + 17, template.rewardOptions);

    return {
      id: `weekly_${seasonKey}_${template.slot}`,
      seasonKey,
      slot: template.slot,
      title: template.title,
      description: formatWeeklyDescription(template.description, target),
      category: template.category,
      target,
      reward,
      metric: metricForSlot(template.slot),
    };
  });
}

export function getWeeklyObjectiveDefinitions(seasonKey: string): WeeklyObjectiveDefinition[] {
  return generateWeeklyObjectives(seasonKey);
}

export function getWeeklyObjectiveById(
  seasonKey: string,
  objectiveId: string,
): WeeklyObjectiveDefinition | undefined {
  return getWeeklyObjectiveDefinitions(seasonKey).find((obj) => obj.id === objectiveId);
}
