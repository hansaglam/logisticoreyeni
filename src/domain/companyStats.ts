import type { Player } from '../types/game';
import type { DeliveryPunctuality } from '../simulation/reputationSettlement';

export const COMPANY_STATS_SCHEMA_VERSION = 1;
export const COMPANY_STATS_EVENT_RECEIPT_LIMIT = 256;

export type CompanyStatAuthority =
  | 'trusted-backend'
  | 'client-local-canonical'
  | 'derived'
  | 'unavailable-deferred';

/**
 * Authority is explicit because these informational counters must not become a
 * reward/leaderboard input without a trusted server settlement journal.
 */
export const COMPANY_STATS_AUTHORITY = {
  deliveriesCompleted: 'client-local-canonical',
  deliveriesFailed: 'client-local-canonical',
  earlyDeliveries: 'client-local-canonical',
  onTimeDeliveries: 'client-local-canonical',
  lateDeliveries: 'client-local-canonical',
  totalDistanceCompleted: 'client-local-canonical',
  deliveryRevenueEarned: 'client-local-canonical',
  marketplacePurchases: 'client-local-canonical',
  marketplaceSales: 'client-local-canonical',
  highestCash: 'derived',
  vehiclesOwnedPeak: 'derived',
  warehousesOwnedPeak: 'derived',
  reputationPeak: 'derived',
  driverLifetimeXp: 'client-local-canonical',
} as const satisfies Record<string, CompanyStatAuthority>;

export interface CompanyStats {
  schemaVersion: number;
  /** Game time at which complete V1.1 tracking began. */
  trackingStartedAtGameTime: number;
  /** False for migrated saves because lifetime distance/revenue cannot be reconstructed. */
  historicalDataComplete: boolean;
  deliveriesCompleted: number;
  deliveriesFailed: number;
  earlyDeliveries: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  totalDistanceCompleted: number;
  deliveryRevenueEarned: number;
  marketplacePurchases: number;
  marketplaceSales: number;
  /** First authoritative tombstone snapshot is a baseline, not invented history. */
  marketplaceSalesBaselineInitialized: boolean;
  highestCash: number;
  vehiclesOwnedPeak: number;
  warehousesOwnedPeak: number;
  reputationPeak: number;
  driverLifetimeXp: number;
  /** Bounded idempotency receipts; never a backend authority source. */
  appliedEventIds: string[];
}

export type CompanyStatsEvent =
  | {
      type: 'delivery-success';
      eventId: string;
      punctuality: DeliveryPunctuality;
      distanceKm: number;
      revenue: number;
      driverXp: number;
    }
  | { type: 'delivery-failure'; eventId: string }
  | { type: 'marketplace-purchase'; eventId: string }
  | { type: 'marketplace-sale'; eventId: string };

function finiteNonNegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : Math.max(0, fallback);
}

function finiteCount(value: unknown, fallback = 0): number {
  return Math.floor(finiteNonNegative(value, fallback));
}

function currentDriverLifetimeXp(player: Pick<Player, 'drivers'>): number {
  return (player.drivers ?? []).reduce(
    (total, driver) => total + finiteNonNegative(driver.xp, 0),
    0,
  );
}

export function createCompanyStatsBaseline(
  player: Pick<
    Player,
    | 'money'
    | 'trucks'
    | 'warehouses'
    | 'reputation'
    | 'drivers'
    | 'completedContracts'
    | 'failedDeliveries'
    | 'lateDeliveries'
  >,
  currentTime: number,
): CompanyStats {
  return {
    schemaVersion: COMPANY_STATS_SCHEMA_VERSION,
    trackingStartedAtGameTime: finiteNonNegative(currentTime, 0),
    // Existing counters/peaks are conservative minima. Distance, revenue and
    // punctuality detail intentionally start at zero instead of being invented.
    historicalDataComplete: false,
    deliveriesCompleted: finiteCount(player.completedContracts, 0),
    deliveriesFailed: finiteCount(player.failedDeliveries, 0),
    earlyDeliveries: 0,
    onTimeDeliveries: 0,
    lateDeliveries: finiteCount(player.lateDeliveries, 0),
    totalDistanceCompleted: 0,
    deliveryRevenueEarned: 0,
    marketplacePurchases: 0,
    marketplaceSales: 0,
    marketplaceSalesBaselineInitialized: false,
    highestCash: finiteNonNegative(player.money, 0),
    vehiclesOwnedPeak: finiteCount(player.trucks?.length, 0),
    warehousesOwnedPeak: finiteCount(player.warehouses?.length, 0),
    reputationPeak: finiteNonNegative(player.reputation, 0),
    driverLifetimeXp: currentDriverLifetimeXp(player),
    appliedEventIds: [],
  };
}

export function normalizeCompanyStats(
  value: unknown,
  context: {
    player: Pick<
      Player,
      | 'money'
      | 'trucks'
      | 'warehouses'
      | 'reputation'
      | 'drivers'
      | 'completedContracts'
      | 'failedDeliveries'
      | 'lateDeliveries'
    >;
    currentTime: number;
  },
): CompanyStats {
  const baseline = createCompanyStatsBaseline(context.player, context.currentTime);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return baseline;
  }
  const source = value as Partial<CompanyStats>;
  const receipts = Array.isArray(source.appliedEventIds)
    ? source.appliedEventIds
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(-COMPANY_STATS_EVENT_RECEIPT_LIMIT)
    : [];

  return {
    schemaVersion: COMPANY_STATS_SCHEMA_VERSION,
    trackingStartedAtGameTime: finiteNonNegative(
      source.trackingStartedAtGameTime,
      baseline.trackingStartedAtGameTime,
    ),
    historicalDataComplete: source.historicalDataComplete === true,
    deliveriesCompleted: Math.max(
      finiteCount(source.deliveriesCompleted),
      baseline.deliveriesCompleted,
    ),
    deliveriesFailed: Math.max(
      finiteCount(source.deliveriesFailed),
      baseline.deliveriesFailed,
    ),
    earlyDeliveries: finiteCount(source.earlyDeliveries),
    onTimeDeliveries: finiteCount(source.onTimeDeliveries),
    lateDeliveries: Math.max(finiteCount(source.lateDeliveries), baseline.lateDeliveries),
    totalDistanceCompleted: finiteNonNegative(source.totalDistanceCompleted),
    deliveryRevenueEarned: finiteNonNegative(source.deliveryRevenueEarned),
    marketplacePurchases: finiteCount(source.marketplacePurchases),
    marketplaceSales: finiteCount(source.marketplaceSales),
    marketplaceSalesBaselineInitialized:
      source.marketplaceSalesBaselineInitialized === true,
    highestCash: Math.max(finiteNonNegative(source.highestCash), baseline.highestCash),
    vehiclesOwnedPeak: Math.max(
      finiteCount(source.vehiclesOwnedPeak),
      baseline.vehiclesOwnedPeak,
    ),
    warehousesOwnedPeak: Math.max(
      finiteCount(source.warehousesOwnedPeak),
      baseline.warehousesOwnedPeak,
    ),
    reputationPeak: Math.max(
      finiteNonNegative(source.reputationPeak),
      baseline.reputationPeak,
    ),
    driverLifetimeXp: Math.max(
      finiteNonNegative(source.driverLifetimeXp),
      baseline.driverLifetimeXp,
    ),
    appliedEventIds: [...new Set(receipts)],
  };
}

export function captureCompanyStatsPeaks(
  stats: CompanyStats,
  player: Pick<Player, 'money' | 'trucks' | 'warehouses' | 'reputation' | 'drivers'>,
): CompanyStats {
  return {
    ...stats,
    highestCash: Math.max(stats.highestCash, finiteNonNegative(player.money)),
    vehiclesOwnedPeak: Math.max(stats.vehiclesOwnedPeak, player.trucks?.length ?? 0),
    warehousesOwnedPeak: Math.max(stats.warehousesOwnedPeak, player.warehouses?.length ?? 0),
    reputationPeak: Math.max(stats.reputationPeak, finiteNonNegative(player.reputation)),
    driverLifetimeXp: Math.max(stats.driverLifetimeXp, currentDriverLifetimeXp(player)),
  };
}

export function applyCompanyStatsEvent(
  current: CompanyStats,
  event: CompanyStatsEvent,
): { stats: CompanyStats; applied: boolean } {
  if (!event.eventId || current.appliedEventIds.includes(event.eventId)) {
    return { stats: current, applied: false };
  }

  const stats: CompanyStats = {
    ...current,
    appliedEventIds: [...current.appliedEventIds, event.eventId].slice(
      -COMPANY_STATS_EVENT_RECEIPT_LIMIT,
    ),
  };

  switch (event.type) {
    case 'delivery-success':
      stats.deliveriesCompleted += 1;
      stats.totalDistanceCompleted += finiteNonNegative(event.distanceKm);
      stats.deliveryRevenueEarned += finiteNonNegative(event.revenue);
      stats.driverLifetimeXp += finiteNonNegative(event.driverXp);
      if (event.punctuality === 'early') stats.earlyDeliveries += 1;
      else if (event.punctuality === 'on-time') stats.onTimeDeliveries += 1;
      else if (event.punctuality === 'late-minor' || event.punctuality === 'late-major') {
        stats.lateDeliveries += 1;
      }
      break;
    case 'delivery-failure':
      stats.deliveriesFailed += 1;
      break;
    case 'marketplace-purchase':
      stats.marketplacePurchases += 1;
      break;
    case 'marketplace-sale':
      stats.marketplaceSales += 1;
      break;
    default:
      break;
  }

  return { stats, applied: true };
}

export function applyAuthoritativeMarketplaceSales(
  current: CompanyStats,
  soldTruckIds: readonly string[],
): CompanyStats {
  const uniqueIds = [...new Set(soldTruckIds.filter((id) => id.length > 0))];
  if (!current.marketplaceSalesBaselineInitialized) {
    return {
      ...current,
      marketplaceSalesBaselineInitialized: true,
      appliedEventIds: [
        ...current.appliedEventIds,
        ...uniqueIds.map((id) => `marketplace-sale:${id}`),
      ].slice(-COMPANY_STATS_EVENT_RECEIPT_LIMIT),
    };
  }

  return uniqueIds.reduce(
    (stats, truckId) =>
      applyCompanyStatsEvent(stats, {
        type: 'marketplace-sale',
        eventId: `marketplace-sale:${truckId}`,
      }).stats,
    current,
  );
}
