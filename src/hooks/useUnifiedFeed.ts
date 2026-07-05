import { useMemo } from 'react';

import { useGameStore } from '../store/gameStore';
import type {
  GameEvent,
  GameEventType,
  MarketNews,
  MarketNewsType,
} from '../types/game';

export type UnifiedFeedKind = 'market_alert' | 'delivery' | 'contract' | 'event';

export type UnifiedFeedSeverity = 'critical' | 'alert' | 'info' | 'positive';

export interface UnifiedFeedItem {
  id: string;
  time: number;
  kind: UnifiedFeedKind;
  severity: UnifiedFeedSeverity;
  title: string;
  message: string;
  importance: 'low' | 'medium' | 'high';
  eventType?: GameEventType;
  marketType?: MarketNewsType;
}

export interface UnifiedFeedResult {
  /** En kritik 1–2 uyarı — üst bant için */
  criticalAlerts: UnifiedFeedItem[];
  /** Tüm olaylar, yeniden eskiye */
  feedItems: UnifiedFeedItem[];
}

const DEFAULT_FEED_LIMIT = 10;

function buildDedupKey(title: string, message: string, time: number): string {
  return `${time}|${title.trim()}|${message.trim()}`;
}

function resolveKindFromGameEvent(event: GameEvent): UnifiedFeedKind {
  if (event.type === 'delivery') {
    return 'delivery';
  }
  if (event.type === 'market' && event.message.includes('stok')) {
    return 'market_alert';
  }
  if (
    event.type === 'market' &&
    (event.title.includes('sözleşme') || event.title.includes('fırsat'))
  ) {
    return 'contract';
  }
  return 'event';
}

function resolveKindFromMarketNews(news: MarketNews): UnifiedFeedKind {
  switch (news.type) {
    case 'warning':
      return 'market_alert';
    case 'contract':
      return 'contract';
    case 'delivery':
      return 'delivery';
    default:
      return 'event';
  }
}

function resolveSeverity(
  kind: UnifiedFeedKind,
  importance: 'low' | 'medium' | 'high',
  title: string,
  message: string,
): UnifiedFeedSeverity {
  const isDeliverySuccess =
    kind === 'delivery' && title === 'Teslimat tamamlandı';
  const isLevelUp = title === 'Şirket seviye atladı';

  if (isDeliverySuccess || (kind === 'delivery' && importance === 'low')) {
    return 'positive';
  }
  if (isLevelUp) {
    return 'info';
  }
  if (
    importance === 'high' &&
    (kind === 'market_alert' || title.includes('stok alarmı') || message.includes('stok alarmı'))
  ) {
    return 'critical';
  }
  if (importance === 'high') {
    return 'alert';
  }
  return 'info';
}

function gameEventToFeedItem(event: GameEvent): UnifiedFeedItem {
  const kind = resolveKindFromGameEvent(event);
  return {
    id: `event:${event.id}`,
    time: event.time,
    kind,
    severity: resolveSeverity(kind, event.importance, event.title, event.message),
    title: event.title,
    message: event.message,
    importance: event.importance,
    eventType: event.type,
  };
}

function marketNewsToFeedItem(news: MarketNews): UnifiedFeedItem {
  const kind = resolveKindFromMarketNews(news);
  return {
    id: `news:${news.id}`,
    time: news.time,
    kind,
    severity: resolveSeverity(kind, news.importance, news.title, news.message),
    title: news.title,
    message: news.message,
    importance: news.importance,
    marketType: news.type,
  };
}

export function buildUnifiedFeed(
  marketNews: MarketNews[],
  eventLog: GameEvent[],
  feedLimit = DEFAULT_FEED_LIMIT,
): UnifiedFeedResult {
  const byKey = new Map<string, UnifiedFeedItem>();

  for (const event of eventLog) {
    const item = gameEventToFeedItem(event);
    byKey.set(buildDedupKey(item.title, item.message, item.time), item);
  }

  for (const news of marketNews) {
    const key = buildDedupKey(news.title, news.message, news.time);
    if (!byKey.has(key)) {
      byKey.set(key, marketNewsToFeedItem(news));
    }
  }

  const feedItems = Array.from(byKey.values())
    .sort((a, b) => b.time - a.time)
    .slice(0, feedLimit);

  const criticalAlerts = feedItems
    .filter((item) => item.severity === 'critical' || item.severity === 'alert')
    .slice(0, 2);

  return { criticalAlerts, feedItems };
}

export function useUnifiedFeed(feedLimit = DEFAULT_FEED_LIMIT): UnifiedFeedResult {
  const marketNews = useGameStore((state) => state.marketNews) ?? [];
  const eventLog = useGameStore((state) => state.eventLog) ?? [];

  return useMemo(
    () => buildUnifiedFeed(marketNews, eventLog, feedLimit),
    [marketNews, eventLog, feedLimit],
  );
}
