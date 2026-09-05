import type { CompanyStats } from './companyStats';
import type { Player } from '../types/game';
import { getDriverProgress } from '../simulation/driverProgress';

export const PROGRESSION_FOUNDATION_SCHEMA_VERSION = 1;
export const INBOX_RETENTION_LIMIT = 150;
export const SEASON_HISTORY_RETENTION_LIMIT = 52;

export type ProgressMetricAuthority =
  | 'trusted-backend'
  | 'client-local-canonical'
  | 'derived-informational'
  | 'unsafe-deferred';

export type AchievementCategory =
  | 'delivery'
  | 'driver'
  | 'company'
  | 'marketplace'
  | 'season';
export type AchievementTier = 'bronze' | 'silver' | 'gold';
export type AchievementMetric =
  | 'deliveries_completed'
  | 'driver_level'
  | 'fleet_size'
  | 'warehouse_count'
  | 'reputation'
  | 'marketplace_purchases'
  | 'marketplace_sales'
  | 'season_points'
  | 'challenges_completed';

export interface AchievementDefinition {
  id: string;
  category: AchievementCategory;
  title: string;
  description: string;
  metric: AchievementMetric;
  target: number;
  tier: AchievementTier;
  hidden?: boolean;
  enabled: boolean;
  version: number;
  authority: ProgressMetricAuthority;
  trackedFromV11?: boolean;
}

export interface AchievementProgress {
  achievementId: string;
  current: number;
  target: number;
  completed: boolean;
  completedAt?: number;
  /** Reserved for a later reward phase. Always false in this foundation. */
  claimed: false;
}

export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = Object.freeze([
  { id: 'delivery_first', category: 'delivery', title: 'İlk Sefer', description: 'İlk teslimatını tamamla.', metric: 'deliveries_completed', target: 1, tier: 'bronze', enabled: true, version: 1, authority: 'client-local-canonical' },
  { id: 'delivery_ten', category: 'delivery', title: 'Yolların Hakimi', description: '10 teslimat tamamla.', metric: 'deliveries_completed', target: 10, tier: 'silver', enabled: true, version: 1, authority: 'client-local-canonical' },
  { id: 'driver_level_five', category: 'driver', title: 'Usta Şoför', description: 'Bir şoförü 5. seviyeye ulaştır.', metric: 'driver_level', target: 5, tier: 'silver', enabled: true, version: 1, authority: 'client-local-canonical' },
  { id: 'fleet_three', category: 'company', title: 'Büyüyen Filo', description: '3 araca sahip ol.', metric: 'fleet_size', target: 3, tier: 'bronze', enabled: true, version: 1, authority: 'derived-informational' },
  { id: 'warehouse_first', category: 'company', title: 'Lojistik Üssü', description: 'İlk deponu aç.', metric: 'warehouse_count', target: 1, tier: 'bronze', enabled: true, version: 1, authority: 'derived-informational' },
  { id: 'reputation_75', category: 'company', title: 'Güvenilir Ortak', description: '75 itibara ulaş.', metric: 'reputation', target: 75, tier: 'silver', enabled: true, version: 1, authority: 'derived-informational' },
  { id: 'reputation_95_hidden', category: 'company', title: 'Sektör Efsanesi', description: '95 itibara ulaş.', metric: 'reputation', target: 95, tier: 'gold', hidden: true, enabled: true, version: 1, authority: 'derived-informational' },
  { id: 'market_buy_first', category: 'marketplace', title: 'Akıllı Yatırım', description: 'Araç Pazarı’ndan araç satın al.', metric: 'marketplace_purchases', target: 1, tier: 'bronze', enabled: true, version: 1, authority: 'client-local-canonical', trackedFromV11: true },
  { id: 'market_sell_first', category: 'marketplace', title: 'Galerici', description: 'Araç Pazarı’nda araç sat.', metric: 'marketplace_sales', target: 1, tier: 'bronze', enabled: true, version: 1, authority: 'client-local-canonical', trackedFromV11: true },
  { id: 'season_points_100', category: 'season', title: 'Sezon Yarışmacısı', description: 'Bir sezonda 100 puana ulaş.', metric: 'season_points', target: 100, tier: 'silver', enabled: true, version: 1, authority: 'trusted-backend' },
  { id: 'challenge_three', category: 'season', title: 'Hedef Odaklı', description: '3 sezon görevi tamamla.', metric: 'challenges_completed', target: 3, tier: 'silver', enabled: true, version: 1, authority: 'trusted-backend' },
]);

export interface SeasonHistoryEntry {
  seasonKey: string;
  displayName: string;
  seasonPoints: number;
  challengeCompletionCount: number;
  endedAt: number;
  readOnly: true;
  /** Rank/score are omitted until a trusted final snapshot exists. */
  finalLeaderboardRank?: number;
  finalLeaderboardScore?: number;
}

export type InboxItemType =
  | 'achievement_unlocked'
  | 'challenge_completed'
  | 'challenge_reward_claimed'
  | 'season_started'
  | 'season_ended'
  | 'marketplace_alert'
  | 'system';
export type InboxRelatedRoute = 'progress-history' | 'seasons-challenges' | 'marketplace';

export interface InboxItem {
  id: string;
  type: InboxItemType;
  title: string;
  body: string;
  createdAt: number;
  readAt?: number;
  relatedRoute?: InboxRelatedRoute;
  dedupeKey?: string;
  expiresAt?: number;
  authority: 'client-local-informational' | 'server-derived-mirror';
}

export interface ProgressionFoundationState {
  schemaVersion: number;
  achievementCompletedAt: Record<string, number>;
  seasonHistory: SeasonHistoryEntry[];
  inbox: InboxItem[];
  activeSeasonKey?: string;
  /** Read-only cache of the last owner-verified backend response. */
  currentSeasonSnapshot?: {
    seasonKey: string;
    seasonPoints: number;
    challengesCompleted: number;
    loadedAt: number;
  };
  notificationPreferences?: import('./v11Notifications').NotificationPreferences;
  marketActivityReceiptIds?: string[];
  analyticsReceiptIds?: string[];
}

export interface AchievementEvaluationContext {
  player: Pick<Player, 'trucks' | 'warehouses' | 'drivers' | 'reputation'>;
  companyStats: CompanyStats;
  seasonPoints?: number;
  challengesCompleted?: number;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeStoredNotificationPreferences(
  value: unknown,
): ProgressionFoundationState['notificationPreferences'] {
  const source = value && typeof value === 'object'
    ? value as Partial<NonNullable<ProgressionFoundationState['notificationPreferences']>>
    : {};
  return {
    marketSaleAlerts: source.marketSaleAlerts === true,
    marketplaceActivityAlerts: source.marketplaceActivityAlerts === true,
    challengeAlerts: source.challengeAlerts === true,
    seasonAlerts: source.seasonAlerts === true,
    gameplayReminders: source.gameplayReminders === true,
    permissionAsked: source.permissionAsked === true,
  };
}

function metricValue(metric: AchievementMetric, context: AchievementEvaluationContext): number {
  switch (metric) {
    case 'deliveries_completed': return context.companyStats.deliveriesCompleted;
    case 'driver_level': return context.player.drivers.reduce((max, driver) => Math.max(max, getDriverProgress(driver).level), 0);
    case 'fleet_size': return context.player.trucks.length;
    case 'warehouse_count': return context.player.warehouses.length;
    case 'reputation': return finiteNonNegative(context.player.reputation);
    case 'marketplace_purchases': return context.companyStats.marketplacePurchases;
    case 'marketplace_sales': return context.companyStats.marketplaceSales;
    case 'season_points': return finiteNonNegative(context.seasonPoints);
    case 'challenges_completed': return finiteNonNegative(context.challengesCompleted);
    default: return 0;
  }
}

export function createDefaultProgressionFoundationState(): ProgressionFoundationState {
  return {
    schemaVersion: PROGRESSION_FOUNDATION_SCHEMA_VERSION,
    achievementCompletedAt: {},
    seasonHistory: [],
    inbox: [],
    notificationPreferences: normalizeStoredNotificationPreferences(undefined),
    marketActivityReceiptIds: [],
    analyticsReceiptIds: [],
  };
}

export function normalizeProgressionFoundationState(value: unknown, now = Date.now()): ProgressionFoundationState {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ProgressionFoundationState>
    : {};
  const completedSource = source.achievementCompletedAt && typeof source.achievementCompletedAt === 'object'
    ? source.achievementCompletedAt
    : {};
  const validAchievementIds = new Set(ACHIEVEMENT_CATALOG.map((item) => item.id));
  const achievementCompletedAt = Object.fromEntries(
    Object.entries(completedSource).filter(([id, at]) => validAchievementIds.has(id) && finiteNonNegative(at) > 0),
  ) as Record<string, number>;
  const seasonHistory = (Array.isArray(source.seasonHistory) ? source.seasonHistory : [])
    .filter((entry): entry is SeasonHistoryEntry => Boolean(entry && typeof entry.seasonKey === 'string'))
    .map((entry) => ({ ...entry, displayName: typeof entry.displayName === 'string' ? entry.displayName : entry.seasonKey, seasonPoints: finiteNonNegative(entry.seasonPoints), challengeCompletionCount: Math.floor(finiteNonNegative(entry.challengeCompletionCount)), endedAt: finiteNonNegative(entry.endedAt), readOnly: true as const }))
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, SEASON_HISTORY_RETENTION_LIMIT);
  const dedupe = new Set<string>();
  const inbox = (Array.isArray(source.inbox) ? source.inbox : [])
    .filter((item): item is InboxItem => Boolean(item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.body === 'string'))
    .map((item) => ({
      ...item,
      createdAt: finiteNonNegative(item.createdAt),
      readAt: item.readAt === undefined ? undefined : finiteNonNegative(item.readAt),
      expiresAt: item.expiresAt === undefined ? undefined : finiteNonNegative(item.expiresAt),
    }))
    .filter((item) => !item.expiresAt || item.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((item) => {
      const key = item.dedupeKey ?? item.id;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    })
    .slice(0, INBOX_RETENTION_LIMIT);
  const snapshot = source.currentSeasonSnapshot;
  const currentSeasonSnapshot = snapshot && typeof snapshot.seasonKey === 'string'
    ? { seasonKey: snapshot.seasonKey, seasonPoints: finiteNonNegative(snapshot.seasonPoints), challengesCompleted: Math.floor(finiteNonNegative(snapshot.challengesCompleted)), loadedAt: finiteNonNegative(snapshot.loadedAt) }
    : undefined;
  const normalizeReceipts = (receipts: unknown, limit: number) => Array.isArray(receipts)
    ? [...new Set(receipts.filter((item): item is string => typeof item === 'string' && item.length > 0))].slice(-limit)
    : [];
  return {
    schemaVersion: PROGRESSION_FOUNDATION_SCHEMA_VERSION,
    achievementCompletedAt,
    seasonHistory,
    inbox,
    activeSeasonKey: typeof source.activeSeasonKey === 'string' ? source.activeSeasonKey : undefined,
    currentSeasonSnapshot,
    notificationPreferences: normalizeStoredNotificationPreferences(source.notificationPreferences),
    marketActivityReceiptIds: normalizeReceipts(source.marketActivityReceiptIds, 250),
    analyticsReceiptIds: normalizeReceipts(source.analyticsReceiptIds, 250),
  };
}

export function deriveAchievementProgress(state: ProgressionFoundationState, context: AchievementEvaluationContext): AchievementProgress[] {
  return ACHIEVEMENT_CATALOG.filter((definition) => definition.enabled).map((definition) => {
    const completedAt = state.achievementCompletedAt[definition.id];
    const current = metricValue(definition.metric, context);
    const completed = Boolean(completedAt) || current >= definition.target;
    return { achievementId: definition.id, current: completed ? definition.target : Math.min(current, definition.target), target: definition.target, completed, completedAt, claimed: false };
  });
}

export function addInboxItem(state: ProgressionFoundationState, item: InboxItem): ProgressionFoundationState {
  const key = item.dedupeKey ?? item.id;
  if (state.inbox.some((candidate) => (candidate.dedupeKey ?? candidate.id) === key)) return state;
  return normalizeProgressionFoundationState({ ...state, inbox: [item, ...state.inbox] }, item.createdAt);
}

export function evaluateAchievementUnlocks(stateValue: unknown, context: AchievementEvaluationContext, now: number): { state: ProgressionFoundationState; progress: AchievementProgress[]; unlockedIds: string[] } {
  let state = normalizeProgressionFoundationState(stateValue, now);
  const progress = deriveAchievementProgress(state, context);
  const unlockedIds: string[] = [];
  for (const item of progress) {
    if (!item.completed || state.achievementCompletedAt[item.achievementId]) continue;
    const definition = ACHIEVEMENT_CATALOG.find((candidate) => candidate.id === item.achievementId);
    if (!definition) continue;
    state = { ...state, achievementCompletedAt: { ...state.achievementCompletedAt, [item.achievementId]: now } };
    state = addInboxItem(state, { id: `achievement:${item.achievementId}`, type: 'achievement_unlocked', title: 'Başarım açıldı', body: definition.title, createdAt: now, relatedRoute: 'progress-history', dedupeKey: `achievement:${item.achievementId}`, authority: definition.authority === 'trusted-backend' ? 'server-derived-mirror' : 'client-local-informational' });
    unlockedIds.push(item.achievementId);
  }
  return { state, progress: deriveAchievementProgress(state, context), unlockedIds };
}

export function mergeCanonicalSeasonHistory(stateValue: unknown, entries: readonly SeasonHistoryEntry[], activeSeasonKey: string, now: number): ProgressionFoundationState {
  let state = normalizeProgressionFoundationState(stateValue, now);
  const byKey = new Map(state.seasonHistory.map((entry) => [entry.seasonKey, entry]));
  for (const entry of entries) if (entry.seasonKey !== activeSeasonKey) byKey.set(entry.seasonKey, { ...entry, readOnly: true });
  const previousActiveKey = state.activeSeasonKey;
  state = normalizeProgressionFoundationState({
    ...state,
    activeSeasonKey,
    seasonHistory: [...byKey.values()],
    currentSeasonSnapshot:
      state.currentSeasonSnapshot?.seasonKey === activeSeasonKey
        ? state.currentSeasonSnapshot
        : undefined,
  }, now);
  if (previousActiveKey && previousActiveKey !== activeSeasonKey) {
    state = addInboxItem(state, { id: `season-ended:${previousActiveKey}`, type: 'season_ended', title: 'Sezon tamamlandı', body: `${previousActiveKey} sonuçların geçmişe eklendi.`, createdAt: now, relatedRoute: 'progress-history', dedupeKey: `season-ended:${previousActiveKey}`, authority: 'server-derived-mirror' });
  }
  if (previousActiveKey !== activeSeasonKey) {
    state = addInboxItem(state, { id: `season-started:${activeSeasonKey}`, type: 'season_started', title: 'Yeni sezon başladı', body: `${activeSeasonKey} hedefleri açıldı.`, createdAt: now, relatedRoute: 'seasons-challenges', dedupeKey: `season-started:${activeSeasonKey}`, authority: 'server-derived-mirror' });
  }
  return state;
}

export function markInboxRead(stateValue: unknown, itemId: string, now: number): ProgressionFoundationState {
  const state = normalizeProgressionFoundationState(stateValue, now);
  return { ...state, inbox: state.inbox.map((item) => item.id === itemId && !item.readAt ? { ...item, readAt: now } : item) };
}

export function markAllInboxRead(stateValue: unknown, now: number): ProgressionFoundationState {
  const state = normalizeProgressionFoundationState(stateValue, now);
  return { ...state, inbox: state.inbox.map((item) => item.readAt ? item : { ...item, readAt: now }) };
}
