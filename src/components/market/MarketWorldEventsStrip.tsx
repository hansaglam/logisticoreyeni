import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';

import type { WorldEvent } from '../../types/game';
import { colors } from '../../theme';
import { GameIcon } from '../ui';
import { sortWorldEventsByImportance } from '../../utils/worldEventDisplay';
import MarketWorldEventCard from './MarketWorldEventCard';

interface MarketWorldEventsStripProps {
  events: WorldEvent[];
  currentTime?: number;
}

function MarketWorldEventsStrip({ events, currentTime = 0 }: MarketWorldEventsStripProps) {
  const sortedEvents = useMemo(() => sortWorldEventsByImportance(events), [events]);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [showSecondaryList, setShowSecondaryList] = useState(false);

  if (sortedEvents.length === 0) {
    return (
      <View style={styles.calmRow}>
        <GameIcon name="market" size={13} color={colors.textMuted} />
        <Text style={styles.calmText} numberOfLines={1}>
          Piyasa sakin — aktif olay yok
        </Text>
      </View>
    );
  }

  const primaryEvent = sortedEvents[0]!;
  const secondaryEvents = sortedEvents.slice(1);
  const isPrimaryExpanded = expandedEventId === primaryEvent.id;

  const togglePrimary = () => {
    setExpandedEventId((current) => (current === primaryEvent.id ? null : primaryEvent.id));
  };

  const toggleSecondaryList = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowSecondaryList((value) => !value);
  };

  return (
    <View style={styles.container}>
      <MarketWorldEventCard
        event={primaryEvent}
        currentTime={currentTime}
        expanded={isPrimaryExpanded}
        onToggle={togglePrimary}
      />

      {secondaryEvents.length > 0 ? (
        <View style={styles.secondarySection}>
          <Pressable
            onPress={toggleSecondaryList}
            style={styles.secondaryToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: showSecondaryList }}
          >
            <Text style={styles.secondaryToggleText}>
              +{secondaryEvents.length} aktif olay
            </Text>
            <GameIcon
              name={showSecondaryList ? 'chevronUp' : 'chevronDown'}
              size={12}
              color={colors.accentBlue}
            />
          </Pressable>

          {showSecondaryList ? (
            <View style={styles.secondaryList}>
              {secondaryEvents.map((event) => (
                <MarketWorldEventCard
                  key={event.id}
                  event={event}
                  currentTime={currentTime}
                  expanded={expandedEventId === event.id}
                  onToggle={() => {
                    setExpandedEventId((current) => (current === event.id ? null : event.id));
                  }}
                  compact={expandedEventId !== event.id}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default React.memo(MarketWorldEventsStrip);

const styles = StyleSheet.create({
  container: {
    gap: 7,
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
  secondarySection: {
    gap: 6,
  },
  secondaryToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  secondaryToggleText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.accentBlue,
  },
  secondaryList: {
    gap: 6,
  },
});
