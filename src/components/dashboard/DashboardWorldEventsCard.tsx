import React from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { GameIcon } from '../ui';
import { gameDayFromTime } from '../../simulation/worldEvents';
import type { WorldEvent, WorldEventType } from '../../types/game';
import type { GameIconName } from '../../theme/icons';
import { getCityName, getProductName } from '../../utils/entityLookup';
import { DASHBOARD_SPLIT_CARD_HEIGHT } from './dashboardTheme';

interface DashboardWorldEventsCardProps {
  activeCount: number;
  isCalm: boolean;
  topEvents: WorldEvent[];
  currentTime: number;
  onPress: () => void;
}

const EVENT_ICON: Partial<Record<WorldEventType, GameIconName>> = {
  fuel_crisis: 'fuel',
  cold_chain_demand: 'foodApple',
  port_congestion: 'route',
  road_work: 'route',
  harvest_surplus: 'foodApple',
  electronics_boom: 'chip',
  industrial_support: 'cog',
  maintenance_campaign: 'maintenance',
  city_demand_boom: 'city',
};

const BLUE = '#39A0FF';
const BLUE_DEEP = '#2388FF';
const CARD_BG = '#08172A';
const SUBTITLE_COLOR = '#8494AB';

function resolveEventIcon(type: WorldEventType): GameIconName {
  return EVENT_ICON[type] ?? 'alert';
}

/** Display-only kalan süre — gerçek timestamp tercih edilir */
function formatEventRemaining(event: WorldEvent, currentTime: number): string {
  if (typeof event.endsAt === 'number' && Number.isFinite(event.endsAt)) {
    const remainingMs = Math.max(0, event.endsAt - Date.now());
    if (remainingMs <= 0) return 'Sona erdi';
    const totalMinutes = Math.floor(remainingMs / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 24) return `${Math.floor(hours / 24)}g`;
    if (hours > 0) return `${hours}s ${minutes}d`;
    return minutes > 0 ? `${minutes}d` : 'Az kaldı';
  }

  const currentDay = gameDayFromTime(currentTime);
  const endTimeHours = event.endsAtDay * 24;
  const remainingHours = Math.max(0, endTimeHours - currentTime);
  const daysLeft = Math.max(0, event.endsAtDay - currentDay);

  if (remainingHours <= 0 || daysLeft === 0) {
    if (remainingHours > 0 && remainingHours < 24) {
      const totalMinutes = Math.floor(remainingHours * 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours > 0) return `${hours}s ${minutes}d`;
      return minutes > 0 ? `${minutes}d` : 'Bugün';
    }
    return 'Bugün';
  }

  if (daysLeft >= 1) return `${daysLeft}g`;

  const totalMinutes = Math.floor(remainingHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}s ${minutes}d`;
  return `${minutes}d`;
}

/** UI için kısa title/subtitle view model */
function buildEventDisplay(event: WorldEvent): { title: string; subtitle: string } {
  const productName = event.productId ? getProductName(event.productId) : null;
  const cityName = event.cityId ? getCityName(event.cityId) : null;

  if (event.title.includes('—')) {
    const [left, right] = event.title.split('—').map((part) => part.trim());
    return { title: left, subtitle: right };
  }

  if (productName && cityName) {
    return { title: event.title, subtitle: `${productName} · ${cityName}` };
  }

  if (productName) {
    return { title: event.title, subtitle: productName };
  }

  if (cityName) {
    return { title: event.title, subtitle: cityName };
  }

  const desc = event.description.split(/[.!]/)[0]?.trim() ?? '';
  const subtitle = desc.length > 34 ? `${desc.slice(0, 32)}…` : desc;
  return { title: event.title, subtitle };
}

function EventRow({
  event,
  currentTime,
  showDivider,
}: {
  event: WorldEvent;
  currentTime: number;
  showDivider: boolean;
}) {
  const icon = resolveEventIcon(event.type);
  const display = buildEventDisplay(event);

  return (
    <View style={[styles.eventRow, showDivider && styles.eventRowDivider]}>
      <View style={styles.eventIconWrap}>
        <GameIcon name={icon} size={16} color={BLUE} />
      </View>
      <View style={styles.eventText}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {display.title}
        </Text>
        <Text style={styles.eventSub} numberOfLines={1}>
          {display.subtitle}
        </Text>
      </View>
      <Text style={styles.eventTime}>{formatEventRemaining(event, currentTime)}</Text>
    </View>
  );
}

export default function DashboardWorldEventsCard({
  activeCount,
  isCalm,
  topEvents,
  currentTime,
  onPress,
}: DashboardWorldEventsCardProps) {
  const { width } = useWindowDimensions();
  const compactBadge = width < 360;
  const visibleEvents = topEvents.slice(0, 2);
  const badgeLabel = compactBadge ? `${activeCount}` : `${activeCount} aktif`;

  return (
    <Pressable onPress={onPress} style={styles.pressable}>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <GameIcon name="market" size={15} color={BLUE} />
            <Text
              style={styles.headerTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              Piyasa Olayları
            </Text>
          </View>
          {!isCalm ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{badgeLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          {isCalm ? (
            <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <GameIcon name="market" size={24} color={BLUE} />
            </View>
              <Text style={styles.emptyTitle}>Piyasa sakin</Text>
              <Text style={styles.emptySub} numberOfLines={2}>
                Yeni fırsatlar için piyasayı takip et
              </Text>
            </View>
          ) : (
            visibleEvents.map((event, index) => (
              <EventRow
                key={event.id}
                event={event}
                currentTime={currentTime}
                showDivider={index > 0}
              />
            ))
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Tümünü Gör</Text>
          <GameIcon name="chevronRight" size={12} color={BLUE_DEEP} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    height: DASHBOARD_SPLIT_CARD_HEIGHT,
    paddingHorizontal: 11,
    paddingTop: 11,
    paddingBottom: 8,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.55)',
    backgroundColor: CARD_BG,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 1 },
      ios: {
        shadowColor: BLUE_DEEP,
        shadowOpacity: 0.08,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: BLUE,
    flexShrink: 1,
  },
  countBadge: {
    height: 23,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(35, 136, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.50)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  countBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: BLUE,
  },
  body: {
    flex: 1,
    marginTop: 5,
    marginBottom: 4,
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  emptyIconWrap: {
    opacity: 0.9,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F3F7FF',
  },
  emptySub: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '500',
    color: '#74839B',
    textAlign: 'center',
  },
  eventRow: {
    height: 41,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventRowDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(120, 160, 220, 0.08)',
  },
  eventIconWrap: {
    width: 29,
    height: 29,
    borderRadius: 10,
    backgroundColor: 'rgba(35, 136, 255, 0.13)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eventText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 7,
    justifyContent: 'center',
  },
  eventTitle: {
    fontSize: 11.5,
    fontWeight: '700',
    lineHeight: 14,
    color: '#F3F7FF',
  },
  eventSub: {
    fontSize: 9,
    fontWeight: '500',
    lineHeight: 12,
    color: SUBTITLE_COLOR,
  },
  eventTime: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 14,
    color: BLUE_DEEP,
    marginLeft: 4,
    flexShrink: 0,
    textAlign: 'right',
    minWidth: 36,
  },
  footer: {
    height: 26,
    paddingTop: 5,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(35, 136, 255, 0.12)',
  },
  footerText: {
    fontSize: 10,
    fontWeight: '700',
    color: BLUE_DEEP,
  },
});
