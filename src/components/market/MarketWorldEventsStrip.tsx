import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { WorldEvent } from '../../types/game';
import { getPrimaryWorldEventLabel } from '../../simulation/worldEvents';
import { colors } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import { GameIcon } from '../ui';
import {
  getWorldEventAccent,
  getWorldEventBorderAccent,
  MARKET_WORLD_EVENT_HEIGHT,
} from './marketTheme';

const MAX_VISIBLE_EVENTS = 3;

interface MarketWorldEventsStripProps {
  events: WorldEvent[];
}

function resolveEventIcon(type: WorldEvent['type']): GameIconName {
  switch (type) {
    case 'harvest_surplus':
      return 'foodApple';
    case 'fuel_crisis':
      return 'fuel';
    case 'port_congestion':
    case 'road_work':
      return 'route';
    case 'cold_chain_demand':
      return 'cup';
    case 'city_demand_boom':
    case 'electronics_boom':
    case 'industrial_support':
      return 'market';
    default:
      return 'alert';
  }
}

function MarketWorldEventsStrip({ events }: MarketWorldEventsStripProps) {
  if (events.length === 0) {
    return (
      <View style={styles.calmRow}>
        <GameIcon name="market" size={13} color={colors.textMuted} />
        <Text style={styles.calmText} numberOfLines={1}>
          Piyasa sakin — aktif olay yok
        </Text>
      </View>
    );
  }

  const visibleEvents = events.slice(0, MAX_VISIBLE_EVENTS);

  return (
    <View style={styles.row}>
      {visibleEvents.map((event) => {
        const accent = getWorldEventAccent(event.type);
        const accentStyle = getWorldEventBorderAccent(event.type);
        return (
          <View key={event.id} style={[styles.card, accentStyle]}>
            <View style={styles.cardTop}>
              <GameIcon name={resolveEventIcon(event.type)} size={18} color={accent} />
              <Text
                style={[styles.cardTitle, { color: accent }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
              >
                {getPrimaryWorldEventLabel(event)}
              </Text>
            </View>
            <Text style={styles.cardSubtitle} numberOfLines={2}>
              {event.title}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default React.memo(MarketWorldEventsStrip);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  card: {
    flex: 1,
    minWidth: 0,
    height: MARKET_WORLD_EVENT_HEIGHT,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 8,
    justifyContent: 'space-between',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  cardSubtitle: {
    fontSize: 9,
    lineHeight: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  calmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: 2,
  },
  calmText: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '500',
  },
});
