import {
  addInboxItem,
  normalizeProgressionFoundationState,
  type InboxRelatedRoute,
  type ProgressionFoundationState,
} from './progressionFoundation';

export const MARKET_ACTIVITY_RECEIPT_LIMIT = 250;
export const ANALYTICS_RECEIPT_LIMIT = 250;

export interface NotificationPreferences {
  marketSaleAlerts: boolean;
  marketplaceActivityAlerts: boolean;
  challengeAlerts: boolean;
  seasonAlerts: boolean;
  gameplayReminders: boolean;
  permissionAsked: boolean;
}

export type CanonicalMarketAlertType =
  | 'vehicle_sold'
  | 'marketplace_purchase_completed'
  | 'marketplace_listing_expired';

export interface CanonicalMarketAlert {
  id: string;
  type: CanonicalMarketAlertType;
  title: string;
  body: string;
  createdAt: number;
  expiresAt?: number;
  dedupeKey: string;
  relatedRoute: InboxRelatedRoute;
  sourceAuthority: 'trusted-backend' | 'canonical-backend-response';
}

export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = Object.freeze({
  marketSaleAlerts: false,
  marketplaceActivityAlerts: false,
  challengeAlerts: false,
  seasonAlerts: false,
  gameplayReminders: false,
  permissionAsked: false,
});

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const source = value && typeof value === 'object' ? value as Partial<NotificationPreferences> : {};
  return {
    marketSaleAlerts: source.marketSaleAlerts === true,
    marketplaceActivityAlerts: source.marketplaceActivityAlerts === true,
    challengeAlerts: source.challengeAlerts === true,
    seasonAlerts: source.seasonAlerts === true,
    gameplayReminders: source.gameplayReminders === true,
    permissionAsked: source.permissionAsked === true,
  };
}

export function buildCanonicalPurchaseAlert(transactionId: string, createdAt: number): CanonicalMarketAlert | null {
  if (!transactionId.trim()) return null;
  return {
    id: `market-purchase:${transactionId}`,
    type: 'marketplace_purchase_completed',
    title: 'Araç alımı tamamlandı',
    body: 'Satın aldığın araç canonical filona eklendi.',
    createdAt,
    dedupeKey: `market-purchase:${transactionId}`,
    relatedRoute: 'marketplace',
    sourceAuthority: 'canonical-backend-response',
  };
}

export function buildCanonicalSaleAlert(tombstoneId: string, createdAt: number): CanonicalMarketAlert | null {
  if (!tombstoneId.trim()) return null;
  return {
    id: `market-sale:${tombstoneId}`,
    type: 'vehicle_sold',
    title: 'Aracın satıldı',
    body: 'Araç Pazarı satışı canonical hesabına işlendi.',
    createdAt,
    dedupeKey: `market-sale:${tombstoneId}`,
    relatedRoute: 'marketplace',
    sourceAuthority: 'trusted-backend',
  };
}

export function applyCanonicalMarketAlert(
  stateValue: unknown,
  alert: CanonicalMarketAlert | null,
  observedAt = Date.now(),
): { state: ProgressionFoundationState; applied: boolean } {
  const state = normalizeProgressionFoundationState(stateValue, observedAt);
  if (!alert || (alert.expiresAt && alert.expiresAt <= observedAt)) return { state, applied: false };
  if ((state.marketActivityReceiptIds ?? []).includes(alert.dedupeKey)) return { state, applied: false };
  const marketActivityReceiptIds = [...(state.marketActivityReceiptIds ?? []), alert.dedupeKey]
    .slice(-MARKET_ACTIVITY_RECEIPT_LIMIT);
  return {
    applied: true,
    state: addInboxItem(
      { ...state, marketActivityReceiptIds },
      {
        id: alert.id,
        type: 'marketplace_alert',
        title: alert.title,
        body: alert.body,
        createdAt: alert.createdAt,
        expiresAt: alert.expiresAt,
        relatedRoute: alert.relatedRoute,
        dedupeKey: alert.dedupeKey,
        authority: 'server-derived-mirror',
      },
    ),
  };
}

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined';

export function shouldEmitCanonicalMarketOsNotification(input: {
  foreground: boolean;
  permission: NotificationPermissionState;
  preferenceEnabled: boolean;
  receiptApplied: boolean;
}): boolean {
  return !input.foreground &&
    input.permission === 'granted' &&
    input.preferenceEnabled &&
    input.receiptApplied;
}

export function rememberAnalyticsReceipt(
  stateValue: unknown,
  receiptId: string,
): { state: ProgressionFoundationState; applied: boolean } {
  const state = normalizeProgressionFoundationState(stateValue);
  if (!receiptId || (state.analyticsReceiptIds ?? []).includes(receiptId)) return { state, applied: false };
  return {
    applied: true,
    state: {
      ...state,
      analyticsReceiptIds: [...(state.analyticsReceiptIds ?? []), receiptId]
        .slice(-ANALYTICS_RECEIPT_LIMIT),
    },
  };
}
